/**
 * 端到端流程自测：标题 → 开始 → 各节拍 → 惊吓 → 缺氧 → 白光 → 红房间 → 对白 → 致谢。
 * 需 `npm i -D playwright && npx playwright install chromium`；先 `npm run build`。
 * 无头 SwiftShader 帧率很低，因此用 debug 时间倍速 + 轮询等待。
 * 用法：node scripts/e2e.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/dd-e2e';
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const evalJs = (expr) => page.evaluate(expr);
let failed = false;
const check = async (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL: ${name}`); await shot(`fail_${name}`); }
  else console.log(`ok: ${name}`);
};
/** 轮询直到条件为真或超时（秒）。 */
const waitFor = async (name, expr, timeoutS) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    if (await evalJs(expr)) { console.log(`ok: ${name}`); return true; }
    await page.waitForTimeout(500);
  }
  failed = true;
  console.log(`FAIL(timeout ${timeoutS}s): ${name}`);
  await shot(`fail_${name}`);
  return false;
};

try {
  await page.goto('http://localhost:4175/?debug=1', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.click('[data-id=start]');
  await waitFor('phase_explore', `window.__dd && window.__dd.sm().phase === 'explore'`, 15);
  await evalJs('window.__dd.speed(5)');

  // 游动输入正常推进
  const t0 = await evalJs('window.__dd.sm().progressT');
  await page.keyboard.down('w');
  await page.waitForTimeout(2500);
  await page.keyboard.up('w');
  const t1 = await evalJs('window.__dd.sm().progressT');
  await check('swim_forward', t1 > t0);

  // 逐段传送触发节拍
  for (const t of [0.14, 0.31, 0.47, 0.56, 0.65]) {
    await evalJs(`window.__dd.teleport(${t})`);
    await page.waitForTimeout(900);
  }
  await check('still_explore', (await evalJs('window.__dd.sm().phase')) === 'explore');

  // 触发惊吓（节拍 t=0.75）→ 序列推进到缺氧
  await evalJs('window.__dd.teleport(0.76)');
  await waitFor('phase_scare', `window.__dd.sm().phase === 'scare'`, 10);
  await waitFor('scare_reveal', `window.__dd.sm().seqStep >= 4`, 30);
  await shot('scare_reveal');
  await waitFor('phase_hypoxia', `window.__dd.sm().phase === 'hypoxia'`, 30);

  // 缺氧推进（放掉大部分氧气加速）
  await evalJs('window.__dd.sm().o2 = 980');
  await waitFor('awe_spawned', `window.__dd.sm().aweSpawned === true`, 30);
  await waitFor('awe_visible', `window.__dd.sm().creature.group.visible === true`, 30);
  await shot('hypoxia_awe');
  await evalJs('window.__dd.sm().o2 = 80');
  await waitFor('phase_whiteout', `window.__dd.sm().phase === 'whiteout'`, 20);
  await waitFor('phase_redroom', `window.__dd.sm().phase === 'redroom'`, 40);
  await page.waitForTimeout(3000);
  await shot('redroom_enter');

  // 走向身影触发对白
  await page.keyboard.down('w');
  await waitFor('dialogue_progressed', `window.__dd.sm().dlgIdx >= 5`, 40);
  await page.keyboard.up('w');
  await shot('redroom_dialogue');

  // 终幕 + 致谢
  await waitFor('phase_done', `window.__dd.sm().phase === 'done'`, 90);
  await waitFor('credits_visible',
    `document.getElementById('credits').style.display === 'flex'`, 15);
  await shot('credits');

  // 回到标题
  await evalJs('window.__dd.speed(1)');
  await page.click('.credit-back');
  await page.waitForTimeout(2500);
  await check('back_to_menu',
    await evalJs(`getComputedStyle(document.getElementById('menu')).display !== 'none'`));
  await shot('back_to_menu');
} catch (e) {
  failed = true;
  console.error('e2e crashed:', e);
} finally {
  if (errors.length) { failed = true; console.log('页面错误:', errors.slice(0, 10)); }
  console.log(failed ? 'E2E: FAILED' : 'E2E: PASS');
  process.exitCode = failed ? 1 : 0;
  await browser.close();
  server.kill('SIGTERM');
}
