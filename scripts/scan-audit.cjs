/**
 * M5-L1 场景巡检（docs/WORKFLOW.md §3.11）：
 * 无头加载构建产物，调用 __dd.scan() 输出破面/透天/阻塞/交互失效清单。
 * 用法：node scripts/scan-audit.cjs
 */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const CHROME = ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));

async function main() {
  if (!CHROME) throw new Error('未找到 Chrome');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--mute-audio',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.goto('file://' + path.join(root, 'dist', 'index.html'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#start', { timeout: 30000 });
  // 等 GLB props 异步加载完（沉船提灯等挂进 landmarks）
  await new Promise((r) => setTimeout(r, 5000));
  const res = await page.evaluate(() => window.__dd.scan());
  console.log(`holesChecked=${res.holesChecked} raysUsed=${res.raysUsed}`);
  console.log(`CRITICAL (${res.critical.length}):`);
  for (const c of res.critical) console.log('  !! ' + c);
  console.log(`WARN (${res.warn.length}):`);
  for (const w of res.warn) console.log('  ~  ' + w);
  await browser.close();
  if (res.critical.length) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
