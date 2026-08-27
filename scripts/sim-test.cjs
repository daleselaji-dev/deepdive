/**
 * 洞潜安全模拟回归（docs/WORKFLOW.md §3.2 Loop4 / §3.11 M5-L5）：
 * 用 __dd 钩子驱动六个安全模拟场景，断言复盘面板出现且判定正确；
 * SIM-06 覆盖成/败两路并断言原因链复现。
 * 用法：node scripts/sim-test.cjs
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('file://' + path.join(root, 'dist', 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#start', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  return page;
}

async function startSim(page, id) {
  await page.evaluate((i) => {
    window.__dd.sim(i);
    window.__dd.simScale(8); // 无头软渲染很慢：放大模拟内部计时
    window.__dd.adapt(false); // 低帧会触发自适应降档 → 无头回归关闭
  }, id);
  // 关闭简报（450ms 防误触延迟在无头下可能被节流，轮询重试）
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const closed = await page.evaluate(() => {
      window.__dd.dismissSlate();
      return document.getElementById('slate').classList.contains('hidden');
    });
    if (closed) break;
  }
  await new Promise((r) => setTimeout(r, 600));
}

function debriefNow(page) {
  return page.evaluate(() => {
    const el = document.getElementById('debrief');
    if (el && !el.classList.contains('hidden')) {
      return { pass: el.classList.contains('pass'), title: document.getElementById('debrief-title').textContent };
    }
    return null;
  });
}

/** 等待模拟 step 前进到 n（无头渲染帧率极低，跳转后必须确认触发再走下一步） */
async function waitStep(page, n, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const st = await page.evaluate(() => window.__dd.simState());
    if (st.step >= n) return st;
    await new Promise((r) => setTimeout(r, 800));
  }
  const st = await page.evaluate(() => window.__dd.simState());
  throw new Error(`step 未达 ${n}：` + JSON.stringify(st));
}

async function waitDebrief(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const d = await page.evaluate(() => {
      const el = document.getElementById('debrief');
      if (el && !el.classList.contains('hidden')) {
        return {
          pass: el.classList.contains('pass'),
          title: document.getElementById('debrief-title').textContent,
        };
      }
      return null;
    });
    if (d) return d;
    await new Promise((r) => setTimeout(r, 900));
  }
  const st = await page.evaluate(() => ({ sim: window.__dd.simState(), state: window.__dd.state() }));
  throw new Error('复盘超时：' + JSON.stringify(st));
}

async function main() {
  if (!CHROME) throw new Error('未找到 Chrome');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--mute-audio',
      '--window-size=960,540',
    ],
  });

  // ---------- SIM-01 白雾：沿线撤离 → PASS ----------
  {
    const page = await newPage(browser);
    await startSim(page, 0);
    await waitStep(page, 1);
    await page.evaluate(() => window.__dd.zone('wreck', 0.45)); // 触发起雾
    await waitStep(page, 2);
    await page.evaluate(() => window.__dd.zone('wreck', 0.9)); // 贴线到集合点
    const d = await waitDebrief(page, 30000);
    if (!d.pass) throw new Error('SIM-01 期望 PASS：' + JSON.stringify(d));
    console.log('  ✓ SIM-01 白雾（贴线撤离 PASS）');
    await page.close();
  }

  // ---------- SIM-02 错箭头：存疑返航 → PASS ----------
  {
    const page = await newPage(browser);
    await startSim(page, 1);
    await page.evaluate(() => window.__dd.zone('throat', 0.5)); // 发现错箭头
    await waitStep(page, 1);
    await page.evaluate(() => window.__dd.zone('throat', 0.05)); // 返航
    const d = await waitDebrief(page, 30000);
    if (!d.pass) throw new Error('SIM-02 期望 PASS：' + JSON.stringify(d));
    console.log('  ✓ SIM-02 错箭头（存疑返航 PASS）');
    await page.close();
  }

  // ---------- SIM-02b 跟随错误箭头 → FAIL ----------
  {
    const page = await newPage(browser);
    await startSim(page, 1);
    await page.evaluate(() => window.__dd.zone('throat', 0.5));
    await waitStep(page, 1);
    await page.evaluate(() => window.__dd.zone('throat', 0.95)); // 顺着错箭头深入
    const d = await waitDebrief(page, 30000);
    if (d.pass) throw new Error('SIM-02b 期望 FAIL：' + JSON.stringify(d));
    console.log('  ✓ SIM-02b 错箭头（深入 FAIL）');
    await page.close();
  }

  // ---------- SIM-03 三分线：66 转向带余量出洞 → PASS ----------
  {
    const page = await newPage(browser);
    await startSim(page, 2);
    await waitStep(page, 1);
    await page.evaluate(() => window.__dd.o2(60)); // 直接压到转向点以下
    await waitStep(page, 2);
    await page.evaluate(() => window.__dd.zone('gallery', 0.02)); // 回到洞口
    const d = await waitDebrief(page, 30000);
    if (!d.pass) throw new Error('SIM-03 期望 PASS：' + JSON.stringify(d));
    console.log('  ✓ SIM-03 三分线（按线转向 PASS）');
    await page.close();
  }

  // ---------- SIM-04 失散：停住→扫灯→汇合 → PASS ----------
  {
    const page = await newPage(browser);
    await startSim(page, 3);
    await page.evaluate(() => window.__dd.zone('hall', 0.5)); // 触发失散
    // 第一步：原地停住（无输入即静止）
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 1200));
      const st = await page.evaluate(() => window.__dd.simState());
      if (st.step >= 3) break;
      if (i > 30) throw new Error('SIM-04 停住步骤超时：' + JSON.stringify(st));
    }
    // 第二步：360° 扫灯（无头帧率极低：扫足两圈半 + 收尾等待游戏帧追上）
    for (let i = 0; i < 44; i++) {
      await page.evaluate((k) => window.__dd.look(k * 0.42, 0), i + 1);
      await new Promise((r) => setTimeout(r, 300));
      const st = await page.evaluate(() => window.__dd.simState());
      if (st.step >= 4) break;
    }
    const stepNow = await waitStep(page, 4, 12).catch(() => null);
    if (!stepNow) throw new Error('SIM-04 扫灯未完成：' + JSON.stringify(await page.evaluate(() => window.__dd.simState())));
    // 第三步：向特奥汇合
    await page.evaluate(() => {
      const b = window.__dd.buddy();
      window.__dd.move(b.pos[0], b.pos[1], b.pos[2] + 1.5);
    });
    const d = await waitDebrief(page, 30000);
    if (!d.pass) throw new Error('SIM-04 期望 PASS：' + JSON.stringify(d));
    console.log('  ✓ SIM-04 失散（协议三步 PASS）');
    await page.close();
  }

  // ---------- SIM-05 减压债：两段停留后出水 → PASS ----------
  {
    const page = await newPage(browser);
    await startSim(page, 4);
    const pool = await page.evaluate(() => window.__dd.mark('pool'));
    // 第一段：−9M
    await page.evaluate((p) => window.__dd.move(p[0] + 1.5, -9, p[2] + 1.5), pool);
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const dnow = await debriefNow(page);
      if (dnow) throw new Error('SIM-05 第一段中途出复盘：' + JSON.stringify(dnow));
      const st = await page.evaluate(() => window.__dd.simState());
      if (st.step >= 2) break;
      if (i > 40) throw new Error('SIM-05 第一段停留超时：' + JSON.stringify(st));
      // 轻微下沉补偿
      await page.evaluate((p) => window.__dd.move(p[0] + 1.5, -9, p[2] + 1.5), pool);
    }
    // 第二段：−5.5M
    await page.evaluate((p) => window.__dd.move(p[0] + 1.5, -5.5, p[2] + 1.5), pool);
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const dnow = await debriefNow(page);
      if (dnow) throw new Error('SIM-05 第二段中途出复盘：' + JSON.stringify(dnow));
      const st = await page.evaluate(() => window.__dd.simState());
      if (st.step >= 3) break;
      if (i > 90) throw new Error('SIM-05 第二段停留超时：' + JSON.stringify(st));
      await page.evaluate((p) => window.__dd.move(p[0] + 1.5, -5.5, p[2] + 1.5), pool);
    }
    // 出水
    await page.evaluate((p) => window.__dd.move(p[0] + 1.5, -0.05, p[2] + 1.5), pool);
    const d = await waitDebrief(page, 40000);
    if (!d.pass) throw new Error('SIM-05 期望 PASS：' + JSON.stringify(d));
    console.log('  ✓ SIM-05 减压债（两段停留 PASS）');
    await page.close();
  }

  // ---------- SIM-06 断线：定点→弧扫→接线撤离 → PASS ----------
  {
    const page = await newPage(browser);
    await startSim(page, 5);
    await waitStep(page, 1);
    // 游到断口（近端断头）
    await page.evaluate(() => {
      const st = window.__dd.simState();
      window.__dd.zone('collapse', 0.35);
      window.__dd.move(st.breakNear[0], st.breakNear[1], st.breakNear[2]);
    });
    await waitStep(page, 2);
    // 第一步：原地定点（无输入即静止）
    await waitStep(page, 3);
    // 第二步：弧形扫描（同 SIM-04：扫足 + 收尾等待）
    for (let i = 0; i < 44; i++) {
      await page.evaluate((k) => window.__dd.look(k * 0.42, 0), i + 1);
      await new Promise((r) => setTimeout(r, 300));
      const st = await page.evaluate(() => window.__dd.simState());
      if (st.step >= 4) break;
    }
    const stepNow = await waitStep(page, 4, 12).catch(() => null);
    if (!stepNow) throw new Error('SIM-06 弧扫未完成：' + JSON.stringify(await page.evaluate(() => window.__dd.simState())));
    // 第三步：摸到远端断头接线
    await page.evaluate(() => {
      const st = window.__dd.simState();
      window.__dd.move(st.breakFar[0], st.breakFar[1], st.breakFar[2]);
    });
    await waitStep(page, 5);
    // 撤离：回到塌方段入口
    await page.evaluate(() => window.__dd.zone('collapse', 0.05));
    const d = await waitDebrief(page, 30000);
    if (!d.pass) throw new Error('SIM-06 期望 PASS：' + JSON.stringify(d));
    // 原因链复现面板：PASS 应有打断点标记
    const cut = await page.evaluate(() => document.querySelector('#debrief-chain .dc-cut')?.textContent ?? '');
    if (!cut.includes('打断')) throw new Error('SIM-06 复盘缺少原因链打断点：' + cut);
    console.log('  ✓ SIM-06 断线（定点弧扫接线 PASS + 复盘链路）');
    await page.close();
  }

  // ---------- SIM-06b 断线：离点乱找 → FAIL（原因链走到致命点） ----------
  {
    const page = await newPage(browser);
    await startSim(page, 5);
    await waitStep(page, 1);
    await page.evaluate(() => {
      const st = window.__dd.simState();
      window.__dd.zone('collapse', 0.35);
      window.__dd.move(st.breakNear[0], st.breakNear[1], st.breakNear[2]);
    });
    await waitStep(page, 2);
    // 违反协议：不定点，直接乱找（离开断头 >18m —— 传送到深渊入口约 29m 处）
    await page.evaluate(() => window.__dd.zone('abyss', 0.12));
    const d = await waitDebrief(page, 40000);
    if (d.pass) throw new Error('SIM-06b 期望 FAIL：' + JSON.stringify(d));
    const chain = await page.evaluate(() => window.__dd.simState().chain);
    if (chain < 3) throw new Error('SIM-06b 原因链未走到致命点：chain=' + chain);
    console.log('  ✓ SIM-06b 断线（乱找 FAIL + 链条走满）');
    await page.close();
  }

  await browser.close();
  console.log('→ 六个安全模拟场景全部通过（SIM-06 含成/败两路）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
