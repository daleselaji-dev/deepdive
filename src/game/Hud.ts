import { grainDataURL } from './textures';

/** DOM HUD：氧气仪表、深度、字幕、写字板、结局画面。仪表美学见 docs/ART_DIRECTION.md §5 */
export class Hud {
  private el = {
    hud: document.getElementById('hud')!,
    o2fill: document.getElementById('o2fill')!,
    o2pct: document.getElementById('o2pct')!,
    depth: document.getElementById('depth')!,
    subtitle: document.getElementById('subtitle')!,
    slate: document.getElementById('slate')!,
    slateText: document.getElementById('slate-text')!,
    ending: document.getElementById('ending')!,
    endingQuote: document.getElementById('ending-quote')!,
    endingStat: document.getElementById('ending-stat')!,
    vignette: document.getElementById('vignette')!,
    fade: document.getElementById('fade')!,
    title: document.getElementById('title')!,
  };
  private subTimer: number | null = null;
  private slateResolve: (() => void) | null = null;

  constructor() {
    document.getElementById('grain')!.style.backgroundImage = `url(${grainDataURL()})`;
    this.el.slate.addEventListener('pointerdown', () => this.dismissSlate());
    window.addEventListener('keydown', () => this.dismissSlate());
  }

  showHud(): void {
    this.el.hud.classList.remove('hidden');
  }

  hideHud(): void {
    this.el.hud.classList.add('hidden');
  }

  hideTitle(): void {
    this.el.title.classList.add('hidden');
  }

  showTitle(): void {
    this.el.title.classList.remove('hidden');
  }

  setOxygen(pct01: number): void {
    const pct = Math.max(0, Math.min(1, pct01));
    (this.el.o2fill as HTMLElement).style.height = `${(pct * 100).toFixed(1)}%`;
    this.el.o2pct.textContent = String(Math.round(pct * 100));
    this.el.o2fill.classList.toggle('low', pct < 0.3);
    this.el.hud.classList.toggle('glitch', pct < 0.3 && pct > 0);
  }

  setDepth(meters: number): void {
    this.el.depth.textContent = Math.abs(meters).toFixed(1);
  }

  /** 字幕：who 为空则纯环境描述 */
  subtitle(text: string, who = '', holdSec = 4.6): void {
    if (this.subTimer !== null) window.clearTimeout(this.subTimer);
    this.el.subtitle.innerHTML = '';
    if (who) {
      const w = document.createElement('span');
      w.className = 'who';
      w.textContent = who;
      this.el.subtitle.appendChild(w);
    }
    this.el.subtitle.appendChild(document.createTextNode(text));
    this.el.subtitle.classList.remove('hidden');
    this.subTimer = window.setTimeout(() => {
      this.el.subtitle.classList.add('hidden');
      this.subTimer = null;
    }, holdSec * 1000);
  }

  clearSubtitle(): void {
    if (this.subTimer !== null) window.clearTimeout(this.subTimer);
    this.el.subtitle.classList.add('hidden');
  }

  /** 写字板全屏呈现，点击/按键关闭后 resolve */
  showSlate(text: string): Promise<void> {
    this.el.slateText.textContent = text;
    this.el.slate.classList.remove('hidden');
    return new Promise((res) => {
      // 延迟接受关闭，避免触发的同一次点击立刻关掉
      window.setTimeout(() => {
        this.slateResolve = res;
      }, 450);
    });
  }

  private dismissSlate(): void {
    if (!this.slateResolve) return;
    this.el.slate.classList.add('hidden');
    const r = this.slateResolve;
    this.slateResolve = null;
    r();
  }

  get slateOpen(): boolean {
    return !this.el.slate.classList.contains('hidden');
  }

  /** 缺氧视野管缩 */
  setHypoxiaVignette(on: boolean): void {
    this.el.vignette.classList.toggle('closing', on);
  }

  /** 黑幕转场 */
  fade(on: boolean, opts: { red?: boolean; fast?: boolean } = {}): void {
    this.el.fade.classList.toggle('red', !!opts.red);
    this.el.fade.classList.toggle('fast', !!opts.fast);
    this.el.fade.classList.toggle('on', on);
  }

  /** 结局画面 */
  showEnding(kind: 'red' | 'hypoxia', quote: string, stat: string): void {
    this.el.ending.classList.toggle('red', kind === 'red');
    this.el.endingQuote.textContent = quote;
    this.el.endingStat.textContent = stat;
    this.el.ending.classList.remove('hidden');
  }

  hideEnding(): void {
    this.el.ending.classList.add('hidden');
  }
}
