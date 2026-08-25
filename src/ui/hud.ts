/** HUD：氧气表 / 深度计 / 字幕队列 / 目标 / 交互提示 / 介绍卡 / 淡入淡出 / 致谢。 */

interface SubEntry {
  text: string;
  dur: number;
  cls: string;
}

export class Hud {
  private root: HTMLDivElement;
  private o2Fill: HTMLDivElement;
  private o2Text: HTMLDivElement;
  private o2Box: HTMLDivElement;
  private depthText: HTMLDivElement;
  private subEl: HTMLDivElement;
  private objEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private cardsEl: HTMLDivElement;
  private creditsEl: HTMLDivElement;
  private reticle: HTMLDivElement;

  private subQueue: SubEntry[] = [];
  private subTimer = 0;
  private subActive = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="o2-box">
        <div class="o2-label">O₂</div>
        <div class="o2-bar"><div class="o2-fill"></div></div>
        <div class="o2-psi">3100</div>
      </div>
      <div class="depth-box">— 0 m</div>
      <div class="objective"></div>
      <div class="subtitle"></div>
      <div class="prompt"></div>
      <div class="reticle"></div>
    `;
    parent.appendChild(this.root);
    this.o2Box = this.root.querySelector('.o2-box')!;
    this.o2Fill = this.root.querySelector('.o2-fill')!;
    this.o2Text = this.root.querySelector('.o2-psi')!;
    this.depthText = this.root.querySelector('.depth-box')!;
    this.subEl = this.root.querySelector('.subtitle')!;
    this.objEl = this.root.querySelector('.objective')!;
    this.promptEl = this.root.querySelector('.prompt')!;
    this.reticle = this.root.querySelector('.reticle')!;

    this.fadeEl = document.createElement('div');
    this.fadeEl.id = 'fade';
    parent.appendChild(this.fadeEl);

    this.cardsEl = document.createElement('div');
    this.cardsEl.id = 'cards';
    parent.appendChild(this.cardsEl);

    this.creditsEl = document.createElement('div');
    this.creditsEl.id = 'credits';
    parent.appendChild(this.creditsEl);

    this.setVisible(false);
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? 'block' : 'none';
  }

  setGaugesVisible(v: boolean) {
    this.o2Box.style.display = v ? 'flex' : 'none';
    this.depthText.style.display = v ? 'block' : 'none';
    this.reticle.style.display = v ? 'block' : 'none';
  }

  setO2(psi: number, max = 3100) {
    const k = Math.max(0, Math.min(1, psi / max));
    this.o2Fill.style.height = `${k * 100}%`;
    this.o2Text.textContent = `${Math.max(0, Math.round(psi))}`;
    this.o2Box.classList.toggle('warn', k < 0.25);
    this.o2Fill.style.background = k < 0.25 ? '#c33' : k < 0.5 ? '#c93' : '#7ec8b8';
  }

  setDepth(m: number) {
    this.depthText.textContent = `— ${Math.max(0, Math.round(m))} m`;
  }

  /** 入队字幕。style: mono=提示/monologue 默认, creature=生物之声 */
  subtitle(text: string, dur = 5, cls = '') {
    this.subQueue.push({ text, dur, cls });
  }

  clearSubtitles() {
    this.subQueue.length = 0;
    this.subActive = false;
    this.subEl.classList.remove('show');
  }

  objective(text: string | null) {
    if (!text) {
      this.objEl.classList.remove('show');
      return;
    }
    this.objEl.textContent = `◆ ${text}`;
    this.objEl.classList.add('show');
  }

  prompt(text: string | null) {
    if (!text) {
      this.promptEl.classList.remove('show');
    } else {
      this.promptEl.textContent = text;
      this.promptEl.classList.add('show');
    }
  }

  update(dt: number) {
    if (this.subActive) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) {
        this.subActive = false;
        this.subEl.classList.remove('show');
      }
    } else if (this.subQueue.length) {
      const e = this.subQueue.shift()!;
      this.subEl.innerHTML = e.text.replace(/\*\*(.+?)\*\*/g, '<em>$1</em>');
      this.subEl.className = `subtitle show ${e.cls}`;
      this.subTimer = e.dur;
      this.subActive = true;
    }
  }

  /** CSS 淡入淡出。color: 'black' | 'white' */
  fade(opacity: number, seconds: number, color = 'black') {
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.background = color === 'white' ? '#dceef5' : '#000';
    this.fadeEl.style.opacity = `${opacity}`;
  }

  /** 打字机介绍卡；resolve 于全部播完（可点击/按键跳过单张）。 */
  showCards(cards: string[]): Promise<void> {
    return new Promise((resolve) => {
      this.cardsEl.style.display = 'flex';
      this.cardsEl.innerHTML = `<div class="card-text"></div><div class="card-hint">点击 / 任意键 继续</div>`;
      const textEl = this.cardsEl.querySelector('.card-text') as HTMLDivElement;
      let idx = 0;
      let charIdx = 0;
      let typing = true;
      let timer = 0;
      const typeSpeed = 45;

      const tick = () => {
        if (!typing) return;
        const full = cards[idx];
        charIdx = Math.min(full.length, charIdx + 1);
        textEl.innerHTML = full.slice(0, charIdx).replace(/\n/g, '<br/>') +
          (charIdx < full.length ? '<span class="caret">▌</span>' : '');
        if (charIdx >= full.length) {
          typing = false;
        } else {
          timer = window.setTimeout(tick, typeSpeed);
        }
      };

      const advance = () => {
        if (typing) {
          window.clearTimeout(timer);
          charIdx = cards[idx].length;
          typing = false;
          textEl.innerHTML = cards[idx].replace(/\n/g, '<br/>');
          return;
        }
        idx++;
        if (idx >= cards.length) {
          cleanup();
          resolve();
          return;
        }
        charIdx = 0;
        typing = true;
        tick();
      };

      const onKey = () => advance();
      const cleanup = () => {
        this.cardsEl.style.display = 'none';
        this.cardsEl.removeEventListener('pointerdown', onKey);
        window.removeEventListener('keydown', onKey);
      };
      this.cardsEl.addEventListener('pointerdown', onKey);
      window.addEventListener('keydown', onKey);
      tick();
    });
  }

  showCredits(lines: string[], onBack: () => void) {
    this.creditsEl.style.display = 'flex';
    this.creditsEl.innerHTML =
      lines.map((l, i) => `<div class="credit-line" style="animation-delay:${i * 1.4}s">${l}</div>`).join('') +
      `<button class="btn credit-back" style="animation-delay:${lines.length * 1.4 + 0.5}s">回到标题</button>`;
    (this.creditsEl.querySelector('.credit-back') as HTMLButtonElement).onclick = () => {
      this.creditsEl.style.display = 'none';
      onBack();
    };
  }
}
