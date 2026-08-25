import { grainDataURL } from './textures';

/** DOM HUD：氧气仪表、深度、字幕、写字板、结局画面。仪表美学见 docs/ART_DIRECTION.md §5 */
export class Hud {
  private el = {
    hud: document.getElementById('hud')!,
    o2fill: document.getElementById('o2fill')!,
    o2pct: document.getElementById('o2pct')!,
    n2fill: document.getElementById('n2fill')!,
    depth: document.getElementById('depth')!,
    deco: document.getElementById('deco')!,
    decoTime: document.getElementById('deco-time')!,
    subtitle: document.getElementById('subtitle')!,
    slate: document.getElementById('slate')!,
    slateText: document.getElementById('slate-text')!,
    guide: document.getElementById('guide')!,
    guideArrow: document.getElementById('guide-arrow')!,
    guideLabel: document.getElementById('guide-label')!,
    ending: document.getElementById('ending')!,
    endingQuote: document.getElementById('ending-quote')!,
    endingStat: document.getElementById('ending-stat')!,
    vignette: document.getElementById('vignette')!,
    fade: document.getElementById('fade')!,
    title: document.getElementById('title')!,
    zonebanner: document.getElementById('zonebanner')!,
    zoneCn: document.getElementById('zone-cn')!,
    zoneEn: document.getElementById('zone-en')!,
  };
  private subTimer: number | null = null;
  private zoneTimer: number | null = null;
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

  /** 氮饱和条（0..1） */
  setNitrogen(pct01: number): void {
    const pct = Math.max(0, Math.min(1, pct01));
    (this.el.n2fill as HTMLElement).style.width = `${(pct * 100).toFixed(1)}%`;
    this.el.n2fill.classList.toggle('high', pct > 0.55);
  }

  /**
   * 减压停留面板。
   * @param remainSec 剩余秒数
   * @param inWindow 是否处于停留深度窗口（-4~-7.5m）
   */
  setDeco(remainSec: number, inWindow: boolean): void {
    if (remainSec <= 0) {
      this.el.deco.classList.add('hidden');
      return;
    }
    this.el.deco.classList.remove('hidden');
    this.el.deco.classList.toggle('paused', !inWindow);
    const m = Math.floor(remainSec / 60);
    const s = Math.max(0, Math.ceil(remainSec % 60));
    this.el.decoTime.textContent = `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
  }

  hideDeco(): void {
    this.el.deco.classList.add('hidden');
  }

  /**
   * 导览线罗盘。
   * @param relAngle 目标方向相对视线的水平夹角（弧度，左正）；null 隐藏
   * @param vert 目标方向的垂直分量（-1..1），用于「向上/向下」提示
   * @param label 罗盘文字
   * @param offline 断线状态（红色闪烁）
   */
  setGuide(relAngle: number | null, vert = 0, label = '导览线', offline = false): void {
    if (relAngle === null) {
      this.el.guide.classList.add('hidden');
      return;
    }
    this.el.guide.classList.remove('hidden');
    this.el.guide.classList.toggle('off', offline);
    (this.el.guideArrow as HTMLElement).style.transform = `rotate(${(-relAngle * 180) / Math.PI}deg)`;
    this.el.guideArrow.textContent = offline ? '✕' : '▲';
    let txt = label;
    if (!offline) {
      if (vert > 0.55) txt = `${label} · 向上`;
      else if (vert < -0.55) txt = `${label} · 向下`;
    }
    if (this.el.guideLabel.textContent !== txt) this.el.guideLabel.textContent = txt;
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

  /** 分区进入横幅：中文区名 + 英文/深度副标，淡入淡出 */
  zoneBanner(cn: string, en: string, holdSec = 4.2): void {
    if (this.zoneTimer !== null) window.clearTimeout(this.zoneTimer);
    this.el.zoneCn.textContent = cn;
    this.el.zoneEn.textContent = en;
    this.el.zonebanner.classList.remove('hidden');
    // 强制回流以确保 transition 触发
    void (this.el.zonebanner as HTMLElement).offsetWidth;
    this.el.zonebanner.classList.add('show');
    this.zoneTimer = window.setTimeout(() => {
      this.el.zonebanner.classList.remove('show');
      this.zoneTimer = null;
    }, holdSec * 1000);
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

  /** 结局画面：dawn 破晓 / bends 血里的针 / hypoxia 浅睡 */
  showEnding(kind: 'dawn' | 'bends' | 'hypoxia', quote: string, stat: string): void {
    this.el.ending.classList.remove('dawn', 'bends');
    if (kind !== 'hypoxia') this.el.ending.classList.add(kind);
    this.el.endingQuote.textContent = quote;
    this.el.endingStat.textContent = stat;
    this.el.ending.classList.remove('hidden');
  }

  hideEnding(): void {
    this.el.ending.classList.add('hidden');
  }
}
