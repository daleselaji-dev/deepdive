/** 标题菜单与暂停菜单。 */
import { MODES } from '../game/modes';
import { QUALITY_PRESETS, type QualityLevel } from '../core/quality';

const ORDER: QualityLevel[] = ['high', 'medium', 'low'];

export class Menu {
  private root: HTMLDivElement;
  private qualityBtn: HTMLButtonElement;
  private level: QualityLevel;

  constructor(
    parent: HTMLElement,
    initial: QualityLevel,
    onStart: () => void,
    private onQuality: (q: QualityLevel) => void,
  ) {
    this.level = initial;
    this.root = document.createElement('div');
    this.root.id = 'menu';
    const sim = MODES.find((m) => m.id === 'sim')!;
    const story = MODES.find((m) => m.id === 'story')!;
    this.root.innerHTML = `
      <div class="menu-inner">
        <div class="title-block">
          <div class="title-en">DEEP DIVE</div>
          <div class="title-cn">《蓝　井》</div>
          <div class="tagline">一次下潜 · 一宗悬案 · 一间红房间</div>
        </div>
        <div class="menu-buttons">
          <button class="btn primary" data-id="start">▶&nbsp; ${story.title}</button>
          <div class="mode-desc">${story.desc}</div>
          <button class="btn locked" disabled title="${sim.desc}">◇&nbsp; ${sim.title}<span class="soon">v0.2</span></button>
          <button class="btn" data-id="quality"></button>
          <button class="btn" data-id="help">操作说明</button>
        </div>
        <div class="help-panel hidden">
          <div class="help-grid">
            <span>游动</span><span>W A S D / 左摇杆</span>
            <span>视角</span><span>鼠标 / 右侧拖动</span>
            <span>上浮 / 下潜</span><span>Space / Shift（触屏 ▲▼）</span>
            <span>手电</span><span>F（触屏「灯」）</span>
            <span>查看线索</span><span>E（触屏「查看」）</span>
            <span>暂停</span><span>Esc（触屏「Ⅱ」）</span>
          </div>
          <div class="help-note">跟着线绳走。线绳是回家的路。</div>
        </div>
        <div class="menu-footer">建议佩戴耳机 · 含恐怖内容与闪光画面 · 几何 / 纹理 / 声音全部程序生成</div>
      </div>
    `;
    parent.appendChild(this.root);

    (this.root.querySelector('[data-id=start]') as HTMLButtonElement).onclick = () => onStart();
    this.qualityBtn = this.root.querySelector('[data-id=quality]') as HTMLButtonElement;
    this.qualityBtn.onclick = () => this.cycleQuality();
    this.refreshQualityLabel();
    (this.root.querySelector('[data-id=help]') as HTMLButtonElement).onclick = () => {
      this.root.querySelector('.help-panel')!.classList.toggle('hidden');
    };
  }

  private cycleQuality() {
    const i = (ORDER.indexOf(this.level) + 1) % ORDER.length;
    this.level = ORDER[i];
    this.refreshQualityLabel();
    this.onQuality(this.level);
  }

  private refreshQualityLabel() {
    this.qualityBtn.textContent = `画质：${QUALITY_PRESETS[this.level].label}`;
  }

  show() { this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; }
}

export class PauseMenu {
  private root: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    onResume: () => void,
    onQuit: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'pause';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="pause-inner">
        <div class="pause-title">— 暂 停 —</div>
        <button class="btn primary" data-id="resume">继续下潜</button>
        <button class="btn" data-id="quit">放弃调查（回到标题）</button>
      </div>
    `;
    parent.appendChild(this.root);
    (this.root.querySelector('[data-id=resume]') as HTMLButtonElement).onclick = () => onResume();
    (this.root.querySelector('[data-id=quit]') as HTMLButtonElement).onclick = () => onQuit();
  }

  show() { this.root.style.display = 'flex'; }
  hide() { this.root.style.display = 'none'; }
}
