/* ============================================================
   回声园 ECHO GARDEN — 洞穴潜水原型
   纯 Canvas 2D，零依赖。灵感：Subnautica × 真实洞潜(虚构化)。
   ============================================================ */
'use strict';

/* ---------- 工具 ---------- */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/* ---------- 常量 ---------- */
const TILE = 16, MW = 150, MH = 240;
const W_PX = MW * TILE, H_PX = MH * TILE;
const SURFACE_Y = 64;            // 水面(px)
const PX_PER_M = 16.5;           // 深度换算
const LINE_MAX_M = 204;          // 导览线总长(米)
const LINE_MAX_PX = LINE_MAX_M * PX_PER_M;
const PLAYER_R = 10;

/* ---------- 种子（每日洞穴） ---------- */
const params = new URLSearchParams(location.search);
const now = new Date();
const dayStr = '' + now.getUTCFullYear() +
  String(now.getUTCMonth() + 1).padStart(2, '0') +
  String(now.getUTCDate()).padStart(2, '0');
const seedStr = params.get('seed') || dayStr;
const rng = mulberry32(xmur3('echo-garden:' + seedStr)());

/* ---------- 地图生成 ---------- */
const solid = new Uint8Array(MW * MH).fill(1);
const isSolid = (tx, ty) => (tx < 0 || ty < 0 || tx >= MW || ty >= MH) ? 1 : solid[ty * MW + tx];
function carve(cxT, cyT, rT) {
  const x0 = Math.max(1, Math.floor(cxT - rT)), x1 = Math.min(MW - 2, Math.ceil(cxT + rT));
  const y0 = Math.max(1, Math.floor(cyT - rT)), y1 = Math.min(MH - 2, Math.ceil(cyT + rT));
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const dx = tx + 0.5 - cxT, dy = ty + 0.5 - cyT;
      if (dx * dx + dy * dy <= rT * rT) solid[ty * MW + tx] = 0;
    }
}

// 入口盆地（天窗）
const entrance = { x: W_PX / 2, y: SURFACE_Y + 34 };
for (let k = -9; k <= 9; k++) carve(MW / 2 + k, 5, 5.4 - Math.abs(k) * 0.22);

// 主竖井：随机游走下行（保证连通到底）
const path = [];
{
  let x = W_PX / 2, y = 8 * TILE, ang = Math.PI / 2;
  const down = Math.PI / 2;
  while (y < (MH - 12) * TILE) {
    path.push({ x, y });
    carve(x / TILE, y / TILE, 1.7 + rng() * 2.3);
    ang += (rng() - 0.5) * 0.95;
    ang = down + clamp(ang - down, -1.2, 1.2);
    if (x < 24 * TILE && Math.cos(ang) < 0) ang = down - (0.3 + rng() * 0.5);
    if (x > W_PX - 24 * TILE && Math.cos(ang) > 0) ang = down + (0.3 + rng() * 0.5);
    x += Math.cos(ang) * TILE * 2.1;
    y += Math.sin(ang) * TILE * 2.1;
  }
  path.push({ x, y });
}
const pathAt = f => path[clamp(Math.floor(f * (path.length - 1)), 0, path.length - 1)];

// 支洞（死胡同 + 尽头小室）
const branchEnds = [];
{
  const nB = 9 + Math.floor(rng() * 4);
  for (let i = 0; i < nB; i++) {
    const p0 = path[8 + Math.floor(rng() * Math.max(1, path.length - 20))];
    let bx = p0.x, by = p0.y;
    let bang = (rng() < 0.5 ? 0 : Math.PI) + (rng() - 0.5) * 1.0;
    const steps = 10 + Math.floor(rng() * 22);
    let ok = true;
    for (let s = 0; s < steps; s++) {
      carve(bx / TILE, by / TILE, 1.6 + rng() * 1.1);
      bang += (rng() - 0.5) * 0.7;
      bx += Math.cos(bang) * TILE * 1.9;
      by += Math.sin(bang) * TILE * 1.9;
      if (bx < 8 * TILE || bx > W_PX - 8 * TILE || by < 12 * TILE || by > H_PX - 8 * TILE) { ok = false; break; }
    }
    if (ok) { carve(bx / TILE, by / TILE, 3.2 + rng() * 1.6); branchEnds.push({ x: bx, y: by }); }
  }
}

// 气室（air bell）：主通道中段保底一处 + 最多两处支洞尽头
const airBells = [];
{
  const mid = pathAt(0.45);
  carve(mid.x / TILE, mid.y / TILE, 4.6);
  airBells.push({ x: mid.x, y: mid.y, r: 62, seen: false });
  branchEnds.slice(0, 2).forEach(b => airBells.push({ x: b.x, y: b.y, r: 50, seen: false }));
}

// 备用气瓶
const tanks = [];
[0.3, 0.52, 0.72, 0.9].forEach(f => { const p0 = pathAt(f); tanks.push({ x: p0.x, y: p0.y, taken: false }); });
branchEnds.slice(2, 4).forEach(b => tanks.push({ x: b.x, y: b.y, taken: false }));

// 叙事标记物
const MARKER_TEXTS = [
  '一枚旧的线箭，指向上方。有人在你之前来过。',
  '岩壁上刻着一行小字：「不要相信你的眼睛。」',
  '一段断掉的旧导览线，末端系着一只卷轴。编号 07。'
];
const markers = [0.18, 0.42, 0.65].map((f, i) => {
  const p0 = pathAt(f);
  return { x: p0.x + (rng() - 0.5) * 30, y: p0.y, text: MARKER_TEXTS[i], seen: false };
});

// 深处之物
const anomaly = (() => { const e = path[path.length - 1]; carve(e.x / TILE, e.y / TILE, 6); return { x: e.x, y: e.y, touched: false }; })();

// 深度触发事件
const depthEvents = [
  { d: 12, t: '水温骤降。头顶的光变成了一枚淡蓝色的硬币。' },
  { d: 40, t: '你进入主竖井。手电的光柱碰不到对面的岩壁。' },
  { d: 75, t: '氮醉像三杯酒。表盘上的数字开始游动。' },
  { d: 110, t: '远处传来规律的、金属般的敲击声。三下。停。三下。' },
  { d: 150, t: '你的导览线快用完了。前人的线，也是在这附近断的。' },
  { d: 185, t: '下面有光。那不该有光。' }
].map(e => ({ ...e, done: false }));

/* ---------- 静态地图烘焙 ---------- */
const mapCanvas = document.createElement('canvas');
mapCanvas.width = W_PX; mapCanvas.height = H_PX;
{
  const m = mapCanvas.getContext('2d');
  const shadeRng = mulberry32(xmur3('shade:' + seedStr)());
  for (let ty = 0; ty < MH; ty++) {
    for (let tx = 0; tx < MW; tx++) {
      const px = tx * TILE, py = ty * TILE;
      if (solid[ty * MW + tx]) {
        const n = Math.floor(shadeRng() * 9) - 4;
        m.fillStyle = `rgb(${17 + n},${21 + n},${26 + n})`;
        m.fillRect(px, py, TILE, TILE);
        // 受光边缘
        m.fillStyle = 'rgba(46,61,70,0.6)';
        if (!isSolid(tx, ty - 1)) m.fillRect(px, py, TILE, 2);
        if (!isSolid(tx, ty + 1)) m.fillRect(px, py + TILE - 2, TILE, 2);
        if (!isSolid(tx - 1, ty)) m.fillRect(px, py, 2, TILE);
        if (!isSolid(tx + 1, ty)) m.fillRect(px + TILE - 2, py, 2, TILE);
      } else if (py + TILE <= SURFACE_Y) {
        m.fillStyle = '#93b7a6';                       // 水面之上：天光
        m.fillRect(px, py, TILE, TILE);
      }
    }
  }
  // 水面线
  m.strokeStyle = 'rgba(220,245,235,0.8)';
  m.lineWidth = 2;
  m.beginPath(); m.moveTo(0, SURFACE_Y); m.lineTo(W_PX, SURFACE_Y); m.stroke();
}

/* ---------- 游戏状态 ---------- */
const player = { x: entrance.x, y: entrance.y, vx: 0, vy: 0, aim: Math.PI / 2 };
let state = 'title';            // title | play | dead | win
let t = 0, playTime = 0;
let o2 = 100, blackout = 0, flashT = 0, flickT = 0;
let lightMul = 1;
let inBell = false, bellSaid = false;
const lifeline = [{ x: entrance.x, y: entrance.y }];
let lineUsed = 0, lineOut = false;
const stats = { maxDepth: 0 };
let attempts = 1;
try {
  const k = 'eg_attempts_' + seedStr;
  attempts = (parseInt(localStorage.getItem(k) || '0', 10) || 0) + 1;
} catch (e) { /* file:// 下可能不可用 */ }

const silt = [];    // 扬尘
const bubbles = []; // 呼吸气泡
const motes = [];   // 悬浮微粒
let breathBubbleT = 2.0;

/* ---------- 字幕队列 ---------- */
const msgQ = [];
let curMsg = null;
function say(text) { msgQ.push(text); }
function updateMsg(dt) {
  if (!curMsg && msgQ.length) curMsg = { text: msgQ.shift(), shown: 0, hold: 4.2 };
  if (curMsg) {
    if (curMsg.shown < curMsg.text.length) curMsg.shown += dt * 22;
    else curMsg.hold -= dt;
    if (curMsg.hold <= 0) curMsg = null;
  }
  DOM.msg.textContent = curMsg ? curMsg.text.slice(0, Math.floor(curMsg.shown)) : '';
}

/* ---------- 音频（WebAudio 程序化合成） ---------- */
const AudioSys = {
  ctx: null, on: false, wanted: true, noise: null, droneGain: null,
  breathT: 1.5, beatT: 0,
  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 200;
      [46, 46.6, 92.3].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = this.ctx.createGain(); g.gain.value = i === 2 ? 0.22 : 0.5;
        o.connect(g); g.connect(lp); o.start();
      });
      lp.connect(this.droneGain);
      this.droneGain.connect(this.ctx.destination);
      return true;
    } catch (e) { return false; }
  },
  setOn(v) {
    if (v && !this.ensure()) return;
    this.on = v; this.wanted = v;
    try { localStorage.setItem('eg_audio', v ? '1' : '0'); } catch (e) {}
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.droneGain) this.droneGain.gain.value = v ? 0.05 : 0;
  },
  burst(dur, freq, q, gain) {
    if (!this.on || !this.ctx) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.ctx.destination);
    s.start(t0); s.stop(t0 + dur + 0.05);
  },
  tone(freq, dur, gain, type) {
    if (!this.on || !this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type || 'sine'; o.frequency.value = freq;
    const g = this.ctx.createGain();
    const t0 = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  update(dt, depth, dying) {
    if (!this.on || !this.ctx) return;
    this.droneGain.gain.value = 0.04 + clamp(depth / 220, 0, 1) * 0.05;
    this.breathT -= dt;
    if (this.breathT <= 0 && !dying) {
      this.burst(0.9, 700, 1.2, 0.05);
      this.breathT = 1.4 + 2.3 * (o2 / 100);
    }
    const heart = o2 < 30 || anomaly.touched;
    if (heart && state === 'play') {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        this.tone(52, 0.14, 0.22);
        setTimeout(() => this.tone(48, 0.12, 0.16), 150);
        this.beatT = 0.5 + 0.9 * clamp(o2 / 100, 0, 1);
      }
    }
  }
};
try { AudioSys.wanted = localStorage.getItem('eg_audio') !== '0'; } catch (e) {}

/* ---------- DOM ---------- */
const DOM = {};
['game', 'hud', 'o2fill', 'o2pct', 'depth', 'time', 'line', 'seedtag', 'objective',
 'warn', 'msg', 'title', 'dead', 'win', 'deadStats', 'winStats',
 'start', 'retry1', 'retry2', 'copy1', 'copy2'].forEach(id => DOM[id] = document.getElementById(id));
DOM.seedtag.textContent = '洞穴 #' + seedStr;

const canvas = DOM.game;
const ctx = canvas.getContext('2d');
const lightCanvas = document.createElement('canvas');
const lctx = lightCanvas.getContext('2d');
let VW = 0, VH = 0;
function resize() {
  VW = canvas.width = lightCanvas.width = window.innerWidth;
  VH = canvas.height = lightCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

/* ---------- 输入 ---------- */
const keys = { left: false, right: false, up: false, down: false, shift: false };
const mouse = { x: VW / 2, y: VH / 2 };
window.addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  setKey(e.code, true);
  if (e.code === 'KeyM') AudioSys.setOn(!AudioSys.on);
  if (e.code === 'KeyR' && state !== 'title') restart();
});
window.addEventListener('keyup', e => setKey(e.code, false));
function setKey(code, v) {
  if (code === 'KeyA' || code === 'ArrowLeft') keys.left = v;
  if (code === 'KeyD' || code === 'ArrowRight') keys.right = v;
  if (code === 'KeyW' || code === 'ArrowUp') keys.up = v;
  if (code === 'KeyS' || code === 'ArrowDown') keys.down = v;
  if (code === 'ShiftLeft' || code === 'ShiftRight') keys.shift = v;
}
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
// 自动开局(重开)后，首次交互恢复音频
window.addEventListener('pointerdown', () => { if (state === 'play' && AudioSys.wanted && !AudioSys.on) AudioSys.setOn(true); }, { once: false });

/* ---------- 碰撞 ---------- */
function collide() {
  let hit = false, nX = 0, nY = 0;
  for (let pass = 0; pass < 2; pass++) {
    const x0 = Math.floor((player.x - PLAYER_R) / TILE), x1 = Math.floor((player.x + PLAYER_R) / TILE);
    const y0 = Math.floor((player.y - PLAYER_R) / TILE), y1 = Math.floor((player.y + PLAYER_R) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!isSolid(tx, ty)) continue;
        const cx = clamp(player.x, tx * TILE, tx * TILE + TILE);
        const cy = clamp(player.y, ty * TILE, ty * TILE + TILE);
        const dx = player.x - cx, dy = player.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < PLAYER_R * PLAYER_R) {
          const d = Math.sqrt(d2) || 0.001;
          const push = PLAYER_R - d;
          player.x += (dx / d) * push;
          player.y += (dy / d) * push;
          hit = true; nX += dx / d; nY += dy / d;
        }
      }
    }
  }
  return { hit, nX, nY };
}

/* ---------- 扬尘 / 气泡 / 微粒 ---------- */
function spawnSilt(x, y, n) {
  for (let i = 0; i < n; i++) {
    if (silt.length > 400) silt.shift();
    silt.push({
      x: x + (Math.random() - 0.5) * 18, y: y + (Math.random() - 0.5) * 18,
      r: 8 + Math.random() * 10, vr: 3 + Math.random() * 4,
      vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 6 - 2,
      a: 0.26 + Math.random() * 0.1, life: 6 + Math.random() * 5
    });
  }
}
function updateParticles(dt) {
  for (let i = silt.length - 1; i >= 0; i--) {
    const s = silt[i];
    s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.r += s.vr * dt;
    s.a = Math.min(s.a, s.life * 0.08);
    if (s.life <= 0) silt.splice(i, 1);
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    b.life -= dt; b.y -= (26 + b.r * 6) * dt; b.x += Math.sin(t * 6 + b.ph) * 12 * dt; b.r += dt * 0.8;
    if (b.life <= 0 || b.y < SURFACE_Y || isSolid(Math.floor(b.x / TILE), Math.floor(b.y / TILE))) bubbles.splice(i, 1);
  }
  while (motes.length < 130) {
    motes.push({ x: camX + Math.random() * VW, y: camY + Math.random() * VH, ph: Math.random() * 6.28, s: 0.4 + Math.random() * 0.9 });
  }
  for (const mo of motes) {
    mo.x += Math.sin(t * 0.4 + mo.ph) * 3 * dt; mo.y += 2.5 * mo.s * dt;
    if (mo.x < camX - 20 || mo.x > camX + VW + 20 || mo.y < camY - 20 || mo.y > camY + VH + 20) {
      mo.x = camX + Math.random() * VW; mo.y = camY + Math.random() * VH;
    }
  }
}

/* ---------- 主更新 ---------- */
let camX = 0, camY = 0;
function depthOf(y) { return (y - SURFACE_Y) / PX_PER_M; }

function update(dt) {
  t += dt;
  updateMsg(dt);
  if (state !== 'play') return;
  playTime += dt;

  const dying = o2 <= 0;
  // 移动
  let ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let iy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dying) { ix = 0; iy = 0; }
  const slow = keys.shift;
  const maxV = slow ? 92 : 168, acc = slow ? 300 : 430;
  if (ix || iy) {
    const l = Math.hypot(ix, iy);
    player.vx += (ix / l) * acc * dt;
    player.vy += (iy / l) * acc * dt;
  }
  const drag = Math.exp(-2.2 * dt);
  player.vx *= drag; player.vy *= drag;
  const sp = Math.hypot(player.vx, player.vy);
  if (sp > maxV) { player.vx *= maxV / sp; player.vy *= maxV / sp; }
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  if (player.y < SURFACE_Y + 12) { player.y = SURFACE_Y + 12; if (player.vy < 0) player.vy = 0; }
  player.x = clamp(player.x, TILE + PLAYER_R, W_PX - TILE - PLAYER_R);

  // 碰撞 + 扬尘
  const col = collide();
  if (col.hit) {
    player.vx *= 0.88; player.vy *= 0.88;
    if (sp > 70 && !slow) spawnSilt(player.x - col.nX * PLAYER_R, player.y - col.nY * PLAYER_R, 3);
  }

  // 朝向
  const wx = mouse.x + camX, wy = mouse.y + camY;
  player.aim = Math.atan2(wy - player.y, wx - player.x);

  // 深度
  const depth = depthOf(player.y);
  stats.maxDepth = Math.max(stats.maxDepth, depth);

  // 氧气
  if (!dying) {
    o2 -= (0.55 + 0.75 * (sp / 168)) * dt;
    inBell = false;
    for (const b of airBells) {
      if (dist(player.x, player.y, b.x, b.y) < b.r) {
        inBell = true;
        o2 = Math.min(100, o2 + 10 * dt);
        if (!bellSaid) { bellSaid = true; say('你浮进一处气室。呼吸。——不要想这些气是从哪来的。'); }
      }
    }
    if (depth < 1.2) o2 = Math.min(100, o2 + 30 * dt);
    o2 = Math.max(0, o2);
    if (o2 === 0) say('调节器吸不出气了。');
  } else {
    blackout += dt / 1.8;
    if (blackout >= 1) endRun('dead');
  }

  // 呼吸气泡
  breathBubbleT -= dt;
  if (breathBubbleT <= 0 && !inBell && !dying) {
    breathBubbleT = 1.2 + 1.6 * (o2 / 100);
    for (let i = 0; i < 4; i++) {
      bubbles.push({ x: player.x + Math.cos(player.aim) * 12, y: player.y + Math.sin(player.aim) * 12 - 4, r: 1 + Math.random() * 1.6, ph: Math.random() * 6.28, life: 4 });
    }
  }

  // 导览线
  if (!lineOut && !dying) {
    const last = lifeline[lifeline.length - 1];
    const d = dist(player.x, player.y, last.x, last.y);
    if (d > 26) {
      let nearOld = false;
      for (let i = 0; i < lifeline.length - 4; i++) {
        if (dist(player.x, player.y, lifeline[i].x, lifeline[i].y) < 22) { nearOld = true; break; }
      }
      if (!nearOld) {
        lineUsed += d;
        if (lineUsed >= LINE_MAX_PX) { lineOut = true; say('线轮空了。从这里开始，没有线。'); }
        else lifeline.push({ x: player.x, y: player.y });
      }
    }
  }

  // 事件
  for (const ev of depthEvents) {
    if (!ev.done && depth > ev.d) { ev.done = true; say(ev.t); }
  }
  for (const mk of markers) {
    if (!mk.seen && dist(player.x, player.y, mk.x, mk.y) < 70) { mk.seen = true; say(mk.text); AudioSys.tone(620, 0.2, 0.05); }
  }
  for (const tk of tanks) {
    if (!tk.taken && dist(player.x, player.y, tk.x, tk.y) < 24) {
      tk.taken = true; o2 = Math.min(100, o2 + 35);
      say('拾取备用气瓶。O₂ +35%。'); AudioSys.tone(880, 0.15, 0.08); AudioSys.tone(1320, 0.12, 0.05);
    }
  }
  if (!anomaly.touched && dist(player.x, player.y, anomaly.x, anomaly.y) < 52) {
    anomaly.touched = true; flashT = 1;
    say('你触到了它。它比水更冷，比夜更旧。它记下了你。——现在，回去。');
    DOM.objective.textContent = '任务：活着回到水面';
    AudioSys.tone(30, 2.5, 0.2, 'triangle');
  }
  if (anomaly.touched && depth < 1.0 && !dying) endRun('win');

  // 触后光照抖动
  if (anomaly.touched && Math.random() < 0.006) flickT = 0.14;
  flickT = Math.max(0, flickT - dt);
  flashT = Math.max(0, flashT - dt * 0.8);

  // 扬尘→能见度
  let siltNear = 0;
  for (const s of silt) if (dist(player.x, player.y, s.x, s.y) < 130) siltNear += s.a;
  const target = (dying ? 1 - blackout : 1) * (1 - Math.min(0.65, siltNear * 0.06));
  lightMul += (target - lightMul) * Math.min(1, dt * 3);

  updateParticles(dt);
  AudioSys.update(dt, depth, dying);
  updateHUD(depth, dying);
}

function updateHUD(depth, dying) {
  DOM.o2fill.style.width = clamp(o2, 0, 100) + '%';
  DOM.o2pct.textContent = Math.max(0, Math.round(o2)) + '%';
  DOM.hud.classList.toggle('o2-low', o2 < 25);
  DOM.depth.textContent = '-' + Math.max(0, depth).toFixed(1) + ' m';
  const mm = String(Math.floor(playTime / 60)).padStart(2, '0');
  const ss = String(Math.floor(playTime % 60)).padStart(2, '0');
  DOM.time.textContent = mm + ':' + ss;
  DOM.line.textContent = Math.max(0, Math.round((LINE_MAX_PX - lineUsed) / PX_PER_M)) + ' m';
  DOM.warn.textContent = dying ? '' : (o2 < 25 ? '气 体 不 足' : (lineOut ? '无 导 览 线 区 域' : ''));
}

/* ---------- 渲染 ---------- */
function waterColor(d) {
  d = clamp(d, 0, 220);
  let r, g, b;
  if (d < 60) { const k = d / 60; r = lerp(10, 4, k); g = lerp(51, 18, k); b = lerp(72, 29, k); }
  else { const k = (d - 60) / 160; r = lerp(4, 1, k); g = lerp(18, 2, k); b = lerp(29, 8, k); }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function render() {
  camX = clamp(player.x - VW / 2, 0, Math.max(0, W_PX - VW));
  camY = clamp(player.y - VH / 2, 0, Math.max(0, H_PX - VH));

  // 水体渐变
  const grad = ctx.createLinearGradient(0, 0, 0, VH);
  grad.addColorStop(0, waterColor(depthOf(camY)));
  grad.addColorStop(1, waterColor(depthOf(camY + VH)));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VW, VH);

  // 烘焙地图
  ctx.drawImage(mapCanvas, camX, camY, VW, VH, 0, 0, VW, VH);

  ctx.save();
  ctx.translate(-camX, -camY);

  // 微粒
  ctx.fillStyle = 'rgba(180,210,205,0.16)';
  for (const mo of motes) ctx.fillRect(mo.x, mo.y, 1.5, 1.5);

  // 导览线
  if (lifeline.length > 1) {
    ctx.strokeStyle = '#aef78e';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(lifeline[0].x, lifeline[0].y);
    for (let i = 1; i < lifeline.length; i++) ctx.lineTo(lifeline[i].x, lifeline[i].y);
    ctx.lineTo(player.x, player.y);
    ctx.stroke();
    // 沿线出口箭头
    ctx.fillStyle = '#aef78e';
    for (let i = 12; i < lifeline.length; i += 14) {
      const a = lifeline[i], b = lifeline[i - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -4); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // 标记物（线箭）
  for (const mk of markers) {
    ctx.fillStyle = mk.seen ? 'rgba(174,247,142,0.5)' : '#aef78e';
    ctx.save(); ctx.translate(mk.x, mk.y);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // 气瓶
  for (const tk of tanks) {
    if (tk.taken) continue;
    ctx.save(); ctx.translate(tk.x, tk.y); ctx.rotate(0.4);
    ctx.fillStyle = '#e8c33a';
    ctx.fillRect(-4, -8, 8, 16);
    ctx.fillStyle = '#9aa3a8';
    ctx.fillRect(-1.5, -11, 3, 4);
    ctx.restore();
  }

  // 气室提示（微光圈）
  for (const b of airBells) {
    ctx.strokeStyle = 'rgba(207,227,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * (0.9 + 0.05 * Math.sin(t * 1.5)), 0, Math.PI * 2); ctx.stroke();
  }

  // 深处之物
  {
    const pulse = 0.75 + 0.25 * Math.sin(t * 1.7);
    const rr = anomaly.touched ? 26 : 40 * pulse + 18;
    const g2 = ctx.createRadialGradient(anomaly.x, anomaly.y, 0, anomaly.x, anomaly.y, rr * 2.2);
    g2.addColorStop(0, `rgba(207,227,255,${anomaly.touched ? 0.35 : 0.8})`);
    g2.addColorStop(1, 'rgba(207,227,255,0)');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(anomaly.x, anomaly.y, rr * 2.2, 0, Math.PI * 2); ctx.fill();
  }

  // 扬尘
  for (const s of silt) {
    ctx.fillStyle = `rgba(74,59,40,${Math.max(0, s.a)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }

  // 气泡
  ctx.strokeStyle = 'rgba(200,230,255,0.45)';
  ctx.lineWidth = 1;
  for (const b of bubbles) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); }

  // 潜水员
  drawPlayer();

  ctx.restore();

  renderDarkness();

  // 触碰白闪
  if (flashT > 0) {
    ctx.fillStyle = `rgba(220,232,255,${flashT * 0.75})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  // 黑视
  if (blackout > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Math.pow(blackout, 0.7))})`;
    ctx.fillRect(0, 0, VW, VH);
  }
}

function drawPlayer() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.aim);
  if (Math.cos(player.aim) < 0) ctx.scale(1, -1);
  const kick = Math.sin(t * 8) * 3;
  ctx.fillStyle = '#0e1317';
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-19, -4 + kick); ctx.lineTo(-19, 4 + kick); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3d4a52';
  ctx.fillRect(-9, -8, 13, 4.5);
  ctx.fillStyle = '#161c21';
  ctx.beginPath(); ctx.ellipse(0, 0, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(11, -1, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9fd8cf';
  ctx.fillRect(12.6, -2.6, 2.6, 3.2);
  ctx.fillStyle = '#ffe9a8';
  ctx.beginPath(); ctx.arc(14, -4, 1.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function renderDarkness() {
  const depth = depthOf(player.y);
  const baseA = clamp(0.45 + (depth / 220) * 0.52, 0.45, 0.97);
  lctx.clearRect(0, 0, VW, VH);
  lctx.fillStyle = `rgba(0,0,8,${baseA})`;
  lctx.fillRect(0, 0, VW, VH);

  lctx.globalCompositeOperation = 'destination-out';
  const px = player.x - camX, py = player.y - camY;
  let fl = 1 + 0.03 * Math.sin(t * 7) + 0.02 * Math.sin(t * 13.7);
  if (anomaly.touched) fl *= 0.82 + 0.18 * Math.sin(t * 9.3);
  if (flickT > 0) fl *= 0.45;
  const mul = clamp(lightMul, 0, 1) * fl;

  // 头灯光晕
  const halo = lctx.createRadialGradient(px, py, 0, px, py, 150 * mul + 24);
  halo.addColorStop(0, 'rgba(255,255,255,0.9)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  lctx.fillStyle = halo;
  lctx.beginPath(); lctx.arc(px, py, 150 * mul + 24, 0, Math.PI * 2); lctx.fill();

  // 光锥
  const coneLen = 430 * mul;
  if (coneLen > 30) {
    const cone = lctx.createRadialGradient(px, py, 0, px, py, coneLen);
    cone.addColorStop(0, 'rgba(255,255,255,0.95)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = cone;
    lctx.beginPath();
    lctx.moveTo(px, py);
    lctx.arc(px, py, coneLen, player.aim - 0.42, player.aim + 0.42);
    lctx.closePath(); lctx.fill();
  }

  // 环境自发光挖洞
  const cut = (wx, wy, r, a) => {
    const sx = wx - camX, sy = wy - camY;
    if (sx < -r - 60 || sx > VW + r + 60 || sy < -r - 60 || sy > VH + r + 60) return;
    const g = lctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    lctx.fillStyle = g;
    lctx.beginPath(); lctx.arc(sx, sy, r, 0, Math.PI * 2); lctx.fill();
  };
  cut(entrance.x, SURFACE_Y, 320, 0.85);                                        // 天窗日光
  cut(anomaly.x, anomaly.y, (anomaly.touched ? 90 : 130) + 30 * Math.sin(t * 1.7), 0.8); // 深处之物
  for (const tk of tanks) if (!tk.taken) cut(tk.x, tk.y, 26, 0.5);
  for (const mk of markers) cut(mk.x, mk.y, 20, 0.4);

  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(lightCanvas, 0, 0);
}

/* ---------- 结算 / 分享 ---------- */
function timeStr() {
  const mm = String(Math.floor(playTime / 60)).padStart(2, '0');
  const ss = String(Math.floor(playTime % 60)).padStart(2, '0');
  return mm + ':' + ss;
}
function shareText(result) {
  return [
    `【回声园 · 下潜日志】洞穴 #${seedStr}`,
    `▸ 最深 -${stats.maxDepth.toFixed(1)} m ／ 用时 ${timeStr()} ／ 第 ${attempts} 次下潜`,
    `▸ 氧气余量 ${Math.max(0, Math.round(o2))}%  ▸ 深处之物：${anomaly.touched ? '已接触' : '未发现'}`,
    result === 'win' ? '▸ 结局：生还 ✔' : `▸ 结局：未归 ✘ ——线在 -${stats.maxDepth.toFixed(1)} m 处停了`,
    '同一天，所有人潜的是同一个洞。你能到多深？'
  ].join('\n');
}
function statsHTML(result) {
  return [
    `最深下潜　-${stats.maxDepth.toFixed(1)} m`,
    `水下用时　${timeStr()}`,
    `氧气余量　${Math.max(0, Math.round(o2))}%`,
    `深处之物　${anomaly.touched ? '已接触' : '未发现'}`,
    `本日尝试　第 ${attempts} 次（洞穴 #${seedStr}）`
  ].join('\n');
}
let lastResult = 'dead';
function endRun(result) {
  if (state !== 'play') return;
  state = result;
  lastResult = result;
  try { localStorage.setItem('eg_attempts_' + seedStr, String(attempts)); } catch (e) {}
  if (result === 'dead') {
    DOM.deadStats.textContent = statsHTML(result);
    DOM.dead.classList.remove('hidden');
  } else {
    DOM.winStats.textContent = statsHTML(result);
    DOM.win.classList.remove('hidden');
    AudioSys.tone(440, 0.4, 0.06); AudioSys.tone(660, 0.6, 0.05);
  }
}
function copyLog(btn) {
  const text = shareText(lastResult);
  const done = () => { const old = btn.textContent; btn.textContent = '已复制 ✓'; setTimeout(() => btn.textContent = old, 1600); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) {}
  document.body.removeChild(ta);
}
function restart() {
  try { sessionStorage.setItem('eg_skip_title', '1'); } catch (e) {}
  location.reload();
}

/* ---------- 开局 ---------- */
function startGame() {
  DOM.title.classList.add('hidden');
  DOM.hud.classList.remove('hidden');
  try { localStorage.setItem('eg_attempts_' + seedStr, String(attempts)); } catch (e) {}
  state = 'play';
}
DOM.start.addEventListener('click', () => { AudioSys.setOn(AudioSys.wanted); startGame(); });
DOM.retry1.addEventListener('click', restart);
DOM.retry2.addEventListener('click', restart);
DOM.copy1.addEventListener('click', () => copyLog(DOM.copy1));
DOM.copy2.addEventListener('click', () => copyLog(DOM.copy2));
try {
  if (sessionStorage.getItem('eg_skip_title') === '1') {
    sessionStorage.removeItem('eg_skip_title');
    startGame();
  }
} catch (e) {}

/* ---------- 主循环 ---------- */
let lastT = performance.now();
function frame(nowT) {
  const dt = Math.min(0.05, (nowT - lastT) / 1000);
  lastT = nowT;
  update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
