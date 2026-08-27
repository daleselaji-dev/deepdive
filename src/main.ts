import './styles.css';
import { Game } from './game/Game';
import { SIM_SPECS } from './game/Sim';

function showBootError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const el = document.createElement('div');
  el.id = 'boot-error';
  el.innerHTML = `<strong>无法启动 3D 画面</strong><p>${msg}</p><p>请确认显卡驱动正常，并使用 Chrome / Edge；Windows 版请运行 DeepDive.exe。</p>`;
  document.body.appendChild(el);
  console.error(err);
}

try {
  const canvas = document.getElementById('scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('缺少 #scene canvas');
  }
  // Probe WebGL before constructing Three renderer
  const probe = document.createElement('canvas');
  const gl =
    probe.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
    probe.getContext('webgl', { failIfMajorPerformanceCaveat: false });
  if (!gl) {
    throw new Error('当前环境不支持 WebGL，无法渲染洞穴场景。');
  }

  const game = new Game(canvas);
  document.getElementById('start')!.addEventListener('click', () => {
    try {
      game.start();
    } catch (e) {
      showBootError(e);
    }
  });
  document.getElementById('restart')!.addEventListener('click', () => game.restart());

  // ---------- 洞潜安全模拟：选择/复盘接线 ----------
  const simselect = document.getElementById('simselect')!;
  const simlist = document.getElementById('simlist')!;
  for (const spec of SIM_SPECS) {
    const btn = document.createElement('button');
    btn.className = 'simitem';
    btn.type = 'button';
    btn.innerHTML = `<div class="sim-code">${spec.code}</div>` +
      `<div class="sim-title">${spec.title}</div>` +
      `<div class="sim-goal">${spec.goal}</div>`;
    btn.addEventListener('click', () => {
      simselect.classList.add('hidden');
      game.startSim(spec.id);
    });
    simlist.appendChild(btn);
  }
  document.getElementById('simmode')!.addEventListener('click', () => simselect.classList.remove('hidden'));
  document.getElementById('simback')!.addEventListener('click', () => simselect.classList.add('hidden'));
  document.getElementById('debrief-retry')!.addEventListener('click', () => {
    sessionStorage.setItem('dd-sim-auto', String(game.currentSimId));
    location.reload();
  });
  document.getElementById('debrief-menu')!.addEventListener('click', () => {
    sessionStorage.removeItem('dd-sim-auto');
    location.reload();
  });
  // 复盘「再来一次」→ 刷新后自动进入同一场景
  const auto = sessionStorage.getItem('dd-sim-auto');
  if (auto !== null) {
    sessionStorage.removeItem('dd-sim-auto');
    window.setTimeout(() => game.startSim(Number(auto)), 600);
  }
} catch (e) {
  showBootError(e);
}
