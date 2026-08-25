import './styles.css';
import { Game } from './game/Game';

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
} catch (e) {
  showBootError(e);
}
