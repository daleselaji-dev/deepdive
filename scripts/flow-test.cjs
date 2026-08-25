/**
 * 结局流程回归（docs/WORKFLOW.md §5）：
 * 用 __dd 钩子驱动三条结局路径，断言结局画面与文案正确。
 * 用法：node scripts/flow-test.cjs
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'shots');
const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 810 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const url = 'file://' + path.join(root, 'dist', 'index.html');
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#start', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => document.getElementById('start').click());
  await new Promise((r) => setTimeout(r, 800));
  return page;
}

async function waitEnding(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const done = await page.evaluate(() => {
      const e = document.getElementById('ending');
      if (e && !e.classList.contains('hidden')) {
        return {
          cls: e.className,
          quote: document.getElementById('ending-quote').textContent,
          stat: document.getElementById('ending-stat').textContent,
        };
      }
      return null;
    });
    if (done) return done;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const st = await page.evaluate(() => window.__dd.state());
  throw new Error('结局超时，当前状态：' + JSON.stringify(st));
}

async function swimToBoat(page) {
  // 破水面 → 表层 → 游到船边
  const boat = await page.evaluate(() => window.__dd.boat());
  await page.evaluate((b) => window.__dd.move(b[0] - 4, -0.1, b[2] - 4), boat);
  await new Promise((r) => setTimeout(r, 2500));
  let st = await page.evaluate(() => window.__dd.state());
  if (st.phase !== 'surface') throw new Error('未进入 surface：' + JSON.stringify(st));
  await page.evaluate((b) => window.__dd.move(b[0] - 1.2, -0.28, b[2] - 1.2), boat);
  await new Promise((r) => setTimeout(r, 2000));
  st = await page.evaluate(() => window.__dd.state());
  if (st.phase !== 'boarding' && st.state !== 'ended') throw new Error('未进入 boarding：' + JSON.stringify(st));
}

async function main() {
  if (!CHROME) throw new Error('未找到 Chrome');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--mute-audio',
      '--window-size=1440,810',
    ],
  });

  // ---------- E1 破晓：回程 → 破水面 → 登船 ----------
  {
    const page = await newPage(browser);
    await page.evaluate(() => {
      window.__dd.phase('return');
      window.__dd.zone('chimney', 0.9);
    });
    await swimToBoat(page);
    const end = await waitEnding(page, 150000);
    if (!end.cls.includes('dawn')) throw new Error('E1 期望 dawn，实际：' + end.cls);
    if (!end.stat.includes('破晓')) throw new Error('E1 文案缺失：' + end.stat);
    await page.screenshot({ path: path.join(outDir, 'ending-dawn.png') });
    console.log('  ✓ E1 破晓（上潜回船）');
    await page.close();
  }

  // ---------- E2 血里的针：目击后带氮上浮、跳过减压 ----------
  {
    const page = await newPage(browser);
    await page.evaluate(() => {
      window.__dd.zone('abyss', 0.5); // 触发目击
      window.__dd.n2(70);
      window.__dd.sightAt(0.995); // 快进到演出结束
    });
    // 等 finishSighting（phase → return）
    const t0 = Date.now();
    for (;;) {
      const st = await page.evaluate(() => window.__dd.state());
      if (st.phase === 'return') break;
      if (Date.now() - t0 > 60000) throw new Error('演出未结束：' + JSON.stringify(st));
      await new Promise((r) => setTimeout(r, 1200));
    }
    // 软约束用局部窗口寻径：先跳到烟囱出口更新 hint，再上浮
    await page.evaluate(() => window.__dd.zone('chimney', 0.9));
    await new Promise((r) => setTimeout(r, 800));
    await swimToBoat(page);
    const end = await waitEnding(page, 150000);
    if (!end.cls.includes('bends')) throw new Error('E2 期望 bends，实际：' + end.cls);
    if (!end.stat.includes('血里的针')) throw new Error('E2 文案缺失：' + end.stat);
    await page.screenshot({ path: path.join(outDir, 'ending-bends.png') });
    console.log('  ✓ E2 血里的针（跳过减压）');
    await page.close();
  }

  // ---------- E3 浅睡：缺氧下沉 ----------
  {
    const page = await newPage(browser);
    await page.evaluate(() => {
      window.__dd.zone('wreck', 0.5);
      window.__dd.o2(0.5);
    });
    // 缺氧演出 13.5 游戏秒；无头软渲染下游戏时间可能比墙钟慢 5-10 倍
    const end = await waitEnding(page, 360000);
    if (!end.stat.includes('浅睡')) throw new Error('E3 文案缺失：' + end.stat);
    await page.screenshot({ path: path.join(outDir, 'ending-hypoxia.png') });
    console.log('  ✓ E3 浅睡（缺氧下沉）');
    await page.close();
  }

  await browser.close();
  console.log('→ 三结局流程全部通过');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
