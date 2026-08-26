/**
 * 无头截图回归（docs/WORKFLOW.md §5）：
 * 构建后打开 dist/index.html，用 __dd 调试钩子跳到各区截图。
 * 用法：node scripts/shots.cjs
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'shots');

const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));

/** [名称, 区名, 区内比例, yaw, pitch, 额外等待ms] —— yaw/pitch 为弧度 */
const SPOTS = [
  ['title', null, 0, 0, 0, 2600],
  // POS 型：[名称, 'POS', [区名, 区内比例], [相机x,y,z], [注视x,y,z], 等待ms]
  // 竖井机位放进井筒净空柱内（M4-L7 挖井+领圈石后，旧机位会被岩石挡住太阳窗）
  ['z1-shaft-lookup', 'POS', ['shaft', 0.3], [0.5, -6.5, 2.1], [1.2, 4, 0.9], 3400],
  ['z1-shaft-side', 'POS', ['shaft', 0.3], [-3.5, -9.5, -1.9], [4.5, -2, 6.1], 1400],
  ['z2-gallery', 'gallery', 0.5, -1.1, 0.05, 900],
  // AXIS 型：[名称, 'AXIS', [区名, 机位比例, 注视比例], [机位偏移xyz], [注视偏移xyz], 等待ms]
  // ——机位与注视点都取管轴上的点（区内比例），再加偏移；解决固定 yaw 怼墙问题（M4-L8）
  ['z3-throat', 'AXIS', ['throat', 0.42, 0.72], [0, 0.4, 0], [0, -0.4, 0], 1000],
  // MARK 型：[名称, 'MARK', [区名, 区内比例], 地标名, y偏移, 等待ms]
  ['z4-hall-tower', 'MARK', ['hall', 0.16], 'crack', -7, 1400],
  // 卤水镜 Angelita 式构图：云面上低掠俯瞰，枯枝穿云（M4-L7 英雄取景移植）
  ['z5-halocline', 'AXIS', ['halo', 0.3, 0.55], [0, 0.5, 0], [0, -2.5, 0], 1600],
  // 沉船斜拍：直接以沉船地标为锚（提灯侧上方俯拍）
  ['z6-wreck', 'MARKPOS', ['wreck', 0.4, 'wreck'], [-5.5, 3.2, -4], [0, 0.3, 0], 1600],
  ['z6-silt', 'SILT', 0, 0, 0, 2200],
  // 塌方走廊：石膏针晶簇+塌方石堆同框（近景巨石会被手电轰白，机位抬高 1.8m）
  ['z7-collapse', 'AXIS', ['collapse', 0.2, 0.48], [0, 1.8, 0], [0, -0.5, 0], 1400],
  ['z8-abyss', 'abyss', 0.45, -2.5, -0.2, 1300],
  // MARKPOS 型：[名称, 'MARKPOS', [区名, 区内比例, 地标名], [机位偏移xyz], [注视偏移xyz], 等待ms]
  // 黑井俯瞰：悬停在井口正上方内侧看「呼吸的幽光」（6.8 偏移会卡进井缘巨石）
  ['z8-pit', 'MARKPOS', ['abyss', 0.55, 'pit'], [0.3, 3.4, 3.4], [0, -6, 0], 1400],
  // 目击演出：frac 复用为演出进度 k（sightAt 快进 + lookAncient 对准）
  ['sight-rise', 'SIGHT', 0.18, 0, 0, 1600],
  ['sight-gaze', 'SIGHT', 0.47, 0, 0, 1600],
  ['sight-leave', 'SIGHT', 0.8, 0, 0, 1600],
  ['z9-chimney', 'chimney', 0.4, 2.6, 0.75, 900],
  ['buddy-escort', 'BUDDY', 0, 0, 0, 2400],
  ['surface-boat', 'SURFACE', 0, 0, 0, 2600],
];

async function main() {
  if (!CHROME) throw new Error('未找到 Chrome');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
      '--mute-audio',
      '--window-size=1440,810',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 810 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
  });

  const url = 'file://' + path.join(root, 'dist', 'index.html');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#start', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1800));
  // SwiftShader 帧率低会触发自适应降档 → 截图变糊，无头截图一律关闭
  await page.evaluate(() => window.__dd.adapt(false));

  for (const [name, zone, frac, yaw, pitch, wait] of SPOTS) {
    if (zone === null) {
      await new Promise((r) => setTimeout(r, wait));
    } else if (zone === 'MARK') {
      // 跳区后把视线对准命名地标
      const [z2, f2] = frac;
      const markName = yaw;
      const dy = pitch;
      await page.evaluate(
        (za, fa, mn, dya) => {
          const dd = window.__dd;
          const title = document.getElementById('title');
          if (title && !title.classList.contains('hidden')) document.getElementById('start').click();
          dd.zone(za, fa);
          const m = dd.mark(mn);
          dd.lookWorld(m[0], m[1] + dya, m[2]);
          dd.silt(0);
        },
        z2, f2, markName, dy,
      );
      await new Promise((r) => setTimeout(r, wait));
      for (let k = 0; k < 3; k++) {
        const open = await page.evaluate(() => {
          const s = document.getElementById('slate');
          if (s && !s.classList.contains('hidden')) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
            return true;
          }
          return false;
        });
        if (!open) break;
        await new Promise((r) => setTimeout(r, 550));
      }
      await page.evaluate(() => window.__dd.silt(0));
      await new Promise((r) => setTimeout(r, 450));
    } else if (zone === 'AXIS' || zone === 'MARKPOS') {
      // AXIS：机位/注视点取管轴上的区内比例点；MARKPOS：两点均相对命名地标。
      // 首瞄含 zone 传送（触发分区流送/剧情），复位只 move+lookWorld——
      // 再次 zone 传送会重触发剧情钩子把机位打歪（M4-L8 踩坑）
      const spec = frac;
      const camOff = yaw;
      const lookOff = pitch;
      const cl = await page.evaluate(
        (kind, sp, co, lo) => {
          const dd = window.__dd;
          const title = document.getElementById('title');
          if (title && !title.classList.contains('hidden')) document.getElementById('start').click();
          let cp, lp;
          if (kind === 'MARKPOS') {
            dd.zone(sp[0], sp[1]);
            const m = dd.mark(sp[2]);
            cp = [m[0] + co[0], m[1] + co[1], m[2] + co[2]];
            lp = [m[0] + lo[0], m[1] + lo[1], m[2] + lo[2]];
          } else {
            dd.zone(sp[0], sp[2]);
            const look = dd.state().pos;
            dd.zone(sp[0], sp[1]);
            const cam = dd.state().pos;
            cp = [cam[0] + co[0], cam[1] + co[1], cam[2] + co[2]];
            lp = [look[0] + lo[0], look[1] + lo[1], look[2] + lo[2]];
          }
          dd.move(cp[0], cp[1], cp[2]);
          dd.lookWorld(lp[0], lp[1], lp[2]);
          dd.silt(0);
          return { cp, lp };
        },
        zone, spec, camOff, lookOff,
      );
      await new Promise((r) => setTimeout(r, wait));
      for (let k = 0; k < 3; k++) {
        const open = await page.evaluate(() => {
          const s = document.getElementById('slate');
          if (s && !s.classList.contains('hidden')) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
            return true;
          }
          return false;
        });
        if (!open) break;
        await new Promise((r) => setTimeout(r, 550));
      }
      await page.evaluate((c) => {
        const dd = window.__dd;
        dd.move(c.cp[0], c.cp[1], c.cp[2]);
        dd.lookWorld(c.lp[0], c.lp[1], c.lp[2]);
        dd.silt(0);
        // 瞬态字幕（自然手记/无线电）与截图时序耦合会破坏回归确定性——隐藏
        document.getElementById('subtitle')?.classList.add('hidden');
      }, cl);
      await new Promise((r) => setTimeout(r, 500));
    } else if (zone === 'POS') {
      // 跳区后把相机放到绝对坐标并注视世界点（写字板关闭后再复位一次防物理漂移）
      const [z2, f2] = frac;
      const posArr = yaw;
      const lookArr = pitch;
      await page.evaluate(
        (za, fa, p, l) => {
          const dd = window.__dd;
          const title = document.getElementById('title');
          if (title && !title.classList.contains('hidden')) document.getElementById('start').click();
          dd.zone(za, fa);
          dd.move(p[0], p[1], p[2]);
          dd.lookWorld(l[0], l[1], l[2]);
          dd.silt(0);
        },
        z2, f2, posArr, lookArr,
      );
      await new Promise((r) => setTimeout(r, wait));
      for (let k = 0; k < 3; k++) {
        const open = await page.evaluate(() => {
          const s = document.getElementById('slate');
          if (s && !s.classList.contains('hidden')) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
            return true;
          }
          return false;
        });
        if (!open) break;
        await new Promise((r) => setTimeout(r, 550));
      }
      await page.evaluate(
        (p, l) => {
          const dd = window.__dd;
          dd.move(p[0], p[1], p[2]);
          dd.lookWorld(l[0], l[1], l[2]);
          dd.silt(0);
        },
        posArr, lookArr,
      );
      await new Promise((r) => setTimeout(r, 500));
    } else if (zone === 'SURFACE') {
      // 水面英雄镜头：破水 → 看向支援船与晨光（必须从池内一侧接近，池外会穿崖壁）
      await page.evaluate(() => {
        const dd = window.__dd;
        dd.phase('return');
        dd.zone('chimney', 0.9);
      });
      await new Promise((r) => setTimeout(r, 600));
      await page.evaluate(() => {
        const dd = window.__dd;
        const b = dd.mark('boat');
        dd.move(b[0] + 4.6, -0.1, b[2] + 2.6);
      });
      await new Promise((r) => setTimeout(r, wait));
      await page.evaluate(() => {
        const dd = window.__dd;
        const b = dd.mark('boat');
        dd.lookWorld(b[0], b[1] + 0.9, b[2]);
      });
      await new Promise((r) => setTimeout(r, 400));
    } else if (zone === 'BUDDY') {
      // 潜伴护送段：回到竖井中段，把特奥瞬移到身边（跟随限速追不上传送）
      await page.evaluate(() => {
        const dd = window.__dd;
        const title = document.getElementById('title');
        if (title && !title.classList.contains('hidden')) document.getElementById('start').click();
        dd.zone('shaft', 0.3);
        dd.buddyWarp();
      });
      await new Promise((r) => setTimeout(r, wait));
      await page.evaluate(() => {
        const dd = window.__dd;
        dd.buddyGesture('ok');
        const b = dd.buddy();
        dd.lookWorld(b.pos[0], b.pos[1], b.pos[2]);
      });
      await new Promise((r) => setTimeout(r, 1100));
      await page.evaluate(() => {
        const dd = window.__dd;
        const b = dd.buddy();
        dd.lookWorld(b.pos[0], b.pos[1], b.pos[2]);
      });
      await new Promise((r) => setTimeout(r, 400));
    } else if (zone === 'SILT') {
      // 搅浑水验证：手动触发白雾 → 截图 → 立即清除避免污染后续
      await page.evaluate(() => window.__dd.silt(30));
      await new Promise((r) => setTimeout(r, wait));
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      await page.evaluate(() => window.__dd.silt(0));
      await new Promise((r) => setTimeout(r, 1500));
      console.log('  ✓', name);
      continue;
    } else if (zone === 'SIGHT') {
      // 快进演出到指定进度并对准生物（无头下游戏时间慢于墙钟，不能等真实时间）
      await page.evaluate((first, k) => {
        const dd = window.__dd;
        if (first) dd.zone('abyss', 0.5);
        dd.sightAt(k);
      }, name === 'sight-rise', frac);
      await new Promise((r) => setTimeout(r, wait));
      await page.evaluate(() => window.__dd.lookAncient());
      await new Promise((r) => setTimeout(r, 350));
    } else {
      await page.evaluate(
        (z2, f2, y2, p2) => {
          const dd = window.__dd;
          const title = document.getElementById('title');
          if (title && !title.classList.contains('hidden')) {
            document.getElementById('start').click();
          }
          dd.zone(z2, f2);
          dd.look(y2, p2);
          dd.silt(0); // 跳区会补触发剧情节点（含搅浑水）——清掉避免污染画面
        },
        zone, frac, yaw, pitch,
      );
      await new Promise((r) => setTimeout(r, wait));
      // 关掉可能弹出的写字板（keydown 关闭）
      for (let k = 0; k < 3; k++) {
        const open = await page.evaluate(() => {
          const s = document.getElementById('slate');
          if (s && !s.classList.contains('hidden')) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
            return true;
          }
          return false;
        });
        if (!open) break;
        await new Promise((r) => setTimeout(r, 550));
      }
      // 剧情节点已在等待期间触发完毕，此刻再清一次浑水并让雾瞬间归位
      await page.evaluate(() => window.__dd.silt(0));
      await new Promise((r) => setTimeout(r, 450));
    }
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log('  ✓', name);
  }

  const state = await page.evaluate(() => window.__dd.state());
  console.log('state:', JSON.stringify(state));
  await browser.close();
  console.log('→ shots/ 完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
