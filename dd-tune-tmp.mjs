import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/dd-tune';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'],
  { cwd: '/workspace', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4174/?debug=1', { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.click('[data-id=start]');
await page.waitForTimeout(2000);

// 传送到咽喉段
await page.evaluate('window.__dd.teleport(0.18)');
await page.waitForTimeout(2000);

const combos = [
  { spot: 85, fill: 2.4, exp: 1.15, name: 'a_base' },
  { spot: 170, fill: 6, exp: 1.15, name: 'b_bright_lamp' },
  { spot: 170, fill: 6, exp: 1.35, name: 'c_lamp_exp' },
  { spot: 300, fill: 8, exp: 1.15, name: 'd_max_lamp' },
];
for (const c of combos) {
  await page.evaluate(`(() => {
    const sm = window.__dd.sm();
    sm.spotBase = ${c.spot};
    sm.spot.intensity = ${c.spot};
    sm.fill.intensity = ${c.fill};
    sm.ctx.post.uniforms.uExposure.value = ${c.exp};
  })()`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/axis_${c.name}.png` });
  // 面向侧壁
  await page.evaluate('(() => { const sm = window.__dd.sm(); sm.yaw += 0.9; sm.pitch = 0.05; })()');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/wall_${c.name}.png` });
  await page.evaluate('(() => { const sm = window.__dd.sm(); sm.yaw -= 0.9; })()');
}
await browser.close();
server.kill('SIGTERM');
console.log('done');
