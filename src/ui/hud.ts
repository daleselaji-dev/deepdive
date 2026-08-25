/** HUD：氧气表 / 灯电量 / 深度计 / 字幕队列 / 目标 / 交互提示 / 案件档案 / 介绍卡 / 淡入淡出 / 致谢。 */

interface SubEntry {
  text: string;
  dur: number;
  cls: string;
}

export interface JournalEntry {
  title: string;
  note: string;
  collected: boolean;
}

export class Hud {
  private root: HTMLDivElement;
  private o2Fill: HTMLDivElement;
  private o2Text: HTMLDivElement;
  private o2Box: HTMLDivElement;
  private battBox: HTMLDivElement;
  private battFill: HTMLDivElement;
  private depthText: HTMLDivElement;
  private subEl: HTMLDivElement;
  private objEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private cardsEl: HTMLDivElement;
  private creditsEl: HTMLDivElement;
  private reticle: HTMLDivElement;
  private clueBox: HTMLDivElement;
  private notifyEl: HTMLDivElement;
  private journalEl: HTMLDivElement;
  private notifyTimer = 0;
  journalOpen = false;

  private subQueue: SubEntry[] = [];
  private subTimer = 0;
  private subActive = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="gauge-row">
        <div class="o2-box">
          <div class="o2-label">O₂</div>
          <div class="o2-bar"><div class="o2-fill"></div></div>
          <div class="o2-psi">3100</div>
        </div>
        <div class="batt-box">
          <div class="o2-label">灯</div>
          <div class="o2-bar"><div class="batt-fill"></div></div>
          <div class="o2-psi batt-pct">100</div>
        </div>
      </div>
      <div class="depth-box">— 0 m</div>
      <div class="clue-box">档案 0/8</div>
      <div class="clue-notify"></div>
      <div class="objective"></div>
      <div class="subtitle"></div>
      <div class="prompt"></div>
      <div class="reticle"></div>
    `;
    parent.appendChild(this.root);
    this.o2Box = this.root.querySelector('.o2-box')!;
    this.o2Fill = this.root.querySelector('.o2-fill')!;
    this.o2Text = this.root.querySelector('.o2-psi')!;
    this.battBox = this.root.querySelector('.batt-box')!;
    this.battFill = this.root.querySelector('.batt-fill')!;
    this.depthText = this.root.querySelector('.depth-box')!;
    this.subEl = this.root.querySelector('.subtitle')!;
    this.objEl = this.root.querySelector('.objective')!;
    this.promptEl = this.root.querySelector('.prompt')!;
    this.reticle = this.root.querySelector('.reticle')!;
    this.clueBox = this.root.querySelector('.clue-box')!;
    this.notifyEl = this.root.querySelector('.clue-notify')!;

    this.journalEl = document.createElement('div');
    this.journalEl.id = 'journal';
    parent.appendChild(this.journalEl);

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
    if (!v) this.closeJournal();
  }

  setGaugesVisible(v: boolean) {
    this.o2Box.style.display = v ? 'flex' : 'none';
    this.battBox.style.display = v ? 'flex' : 'none';
    this.depthText.style.display = v ? 'block' : 'none';
    this.reticle.style.display = v ? 'block' : 'none';
    this.clueBox.style.display = v ? 'block' : 'none';
    if (!v) this.closeJournal();
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

  /** 手电电量 0..1。 */
  setBattery(x: number) {
    const k = Math.max(0, Math.min(1, x));
    this.battFill.style.height = `${k * 100}%`;
    this.battFill.style.background = k < 0.25 ? '#c33' : '#d9c47a';
    (this.battBox.querySelector('.batt-pct') as HTMLDivElement).textContent =
      `${Math.round(k * 100)}`;
    this.battBox.classList.toggle('warn', k < 0.25);
  }

  setClues(n: number, total: number) {
    this.clueBox.textContent = `档案 ${n}/${total}`;
  }

  /** 收录线索时的滑入通知。 */
  notifyClue(title: string) {
    this.notifyEl.textContent = `✚ 已收录 · ${title}`;
    this.notifyEl.classList.add('show');
    this.notifyTimer = 3.6;
  }

  /** 案件档案面板开关；返回当前是否打开。 */
  toggleJournal(entries: JournalEntry[]): boolean {
    if (this.journalOpen) {
      this.closeJournal();
      return false;
    }
    const items = entries.map((e) => e.collected
      ? `<div class="j-item"><div class="j-title">◆ ${e.title}</div><div class="j-note">${e.note}</div></div>`
      : `<div class="j-item j-locked"><div class="j-title">◇ ——</div><div class="j-note">未收录</div></div>`
    ).join('');
    const n = entries.filter((e) => e.collected).length;
    this.journalEl.innerHTML = `
      <div class="j-inner">
        <div class="j-head">案件档案 · 蓝井失踪案<span class="j-count">${n}/${entries.length}</span></div>
        <div class="j-list">${items}</div>
        <div class="j-hint">Tab / 「档」 关闭</div>
      </div>`;
    this.journalEl.style.display = 'flex';
    this.journalOpen = true;
    return true;
  }

  closeJournal() {
    this.journalEl.style.display = 'none';
    this.journalOpen = false;
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
    if (this.notifyTimer > 0) {
      this.notifyTimer -= dt;
      if (this.notifyTimer <= 0) this.notifyEl.classList.remove('show');
    }
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
