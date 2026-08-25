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
  ['z1-shaft-lookup', 'shaft', 0.35, 0.4, 1.3, 1400],
  ['z1-shaft-side', 'shaft', 0.55, -0.6, 0.4, 900],
  ['z2-gallery', 'gallery', 0.5, -1.1, 0.05, 900],
  ['z3-throat', 'throat', 0.5, -1.4, 0, 900],
  ['z4-hall-tower', 'hall', 0.45, -1.5, -0.1, 1200],
  ['z5-halocline', 'halo', 0.5, -1.8, -0.3, 1200],
  ['z6-wreck', 'wreck', 0.45, -2.1, -0.4, 1200],
  ['z7-collapse', 'collapse', 0.5, -2.3, 0, 900],
  ['z8-abyss', 'abyss', 0.45, -2.5, -0.2, 1300],
  ['z8-pit', 'abyss', 0.55, -2.5, -1.0, 900],
  ['z9-chimney', 'chimney', 0.4, 2.6, 0.75, 900],
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

  for (const [name, zone, frac, yaw, pitch, wait] of SPOTS) {
    if (zone === null) {
      await new Promise((r) => setTimeout(r, wait));
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
