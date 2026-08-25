/**
 * 视觉自测截图脚本（可选工具，需 `npm i -D playwright && npx playwright install chromium`）。
 * 用无头 Chromium（SwiftShader WebGL）跑构建产物，对关键叙事节拍截图。
 * 用法：npm run build && node scripts/capture.mjs [输出目录，默认 /tmp/dd-shots]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/dd-shots';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
  stdio: 'ignore', detached: false,
});
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log('shot:', name);
};
const dd = (expr) => page.evaluate(expr);
const wait = (ms) => page.waitForTimeout(ms);

try {
  await page.goto('http://localhost:4173/?debug=1', { waitUntil: 'load' });
  await wait(4500);
  await shot('01_title');

  await page.click('[data-id=start]');
  await wait(4000);
  await shot('02_entrance');

  await dd('window.__dd.teleport(0.18)'); await wait(2600); await shot('03_throat');
  await dd('window.__dd.teleport(0.345)'); await wait(2600); await shot('04_bell_chamber');
  await dd('window.__dd.teleport(0.405)'); await wait(1200); await shot('04b_fish_scatter');
  await wait(4200); await shot('04c_shadow_pass');
  await dd('window.__dd.teleport(0.60)'); await wait(2600); await shot('05_glow_gallery');
  await dd('window.__dd.teleport(0.68)'); await wait(2600); await shot('05b_dark_zone');

  // 案件档案（先收录三条）
  await dd(`window.__dd.collect('tag')`);
  await dd(`window.__dd.collect('computer')`);
  await dd(`window.__dd.collect('airdome')`);
  await page.keyboard.press('Tab'); await wait(700); await shot('09_journal');
  await page.keyboard.press('Tab'); await wait(400);

  await dd('window.__dd.face()'); await wait(400); await shot('06_scare_face');
  await dd('window.__dd.teleport(0.86)');
  await dd('window.__dd.awe()'); await wait(3500); await shot('07_awe_creature');

  await dd('window.__dd.redroom()'); await wait(5000); await shot('08_redroom');
  await dd('window.__dd.teleport ? 0 : 0');
} catch (e) {
  console.error('capture failed:', e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
