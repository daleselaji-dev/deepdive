/** HUD：氧气表 / 灯电量 / 深度计 / 字幕队列 / 目标 / 交互提示 / 侦探笔记 / 介绍卡 / 淡入淡出 / 致谢。 */

interface SubEntry {
  text: string;
  dur: number;
  cls: string;
}

interface NoteEntry {
  title: string;
  body: string;
}

export class Hud {
  private root: HTMLDivElement;
  private o2Fill: HTMLDivElement;
  private o2Text: HTMLDivElement;
  private o2Box: HTMLDivElement;
  private battFill: HTMLDivElement;
  private depthText: HTMLDivElement;
  private subEl: HTMLDivElement;
  private objEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private cardsEl: HTMLDivElement;
  private creditsEl: HTMLDivElement;
  private reticle: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private journalEl: HTMLDivElement;

  private subQueue: SubEntry[] = [];
  private subTimer = 0;
  private subActive = false;
  private notes: NoteEntry[] = [];
  private noteTotal = 0;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="o2-box">
        <div class="gauge-col">
          <div class="o2-label">O₂</div>
          <div class="o2-bar"><div class="o2-fill"></div></div>
          <div class="o2-psi">3100</div>
        </div>
        <div class="gauge-col">
          <div class="o2-label">灯</div>
          <div class="o2-bar batt-bar"><div class="batt-fill"></div></div>
          <div class="o2-psi batt-pct">100</div>
        </div>
      </div>
      <div class="depth-box">— 0 m</div>
      <div class="objective"></div>
      <div class="subtitle"></div>
      <div class="prompt"></div>
      <div class="reticle"></div>
      <div class="note-toast"></div>
    `;
    parent.appendChild(this.root);
    this.o2Box = this.root.querySelector('.o2-box')!;
    this.o2Fill = this.root.querySelector('.o2-fill')!;
    this.o2Text = this.root.querySelector('.o2-psi')!;
    this.battFill = this.root.querySelector('.batt-fill')!;
    this.depthText = this.root.querySelector('.depth-box')!;
    this.subEl = this.root.querySelector('.subtitle')!;
    this.objEl = this.root.querySelector('.objective')!;
    this.promptEl = this.root.querySelector('.prompt')!;
    this.reticle = this.root.querySelector('.reticle')!;
    this.toastEl = this.root.querySelector('.note-toast')!;

    this.journalEl = document.createElement('div');
    this.journalEl.id = 'journal';
    this.journalEl.style.display = 'none';
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

  /** 手电电量 0..1。 */
  setBattery(k: number) {
    const c = Math.max(0, Math.min(1, k));
    this.battFill.style.height = `${c * 100}%`;
    this.battFill.style.background = c < 0.15 ? '#c33' : c < 0.35 ? '#c93' : '#9fb8a8';
    const pct = this.root.querySelector('.batt-pct') as HTMLDivElement;
    pct.textContent = `${Math.round(c * 100)}`;
  }

  // ---------- 侦探笔记 ----------

  setNoteTotal(n: number) { this.noteTotal = n; }

  get noteCount() { return this.notes.length; }

  /** 收录线索到笔记并弹出提示。 */
  addNote(title: string, body: string) {
    if (this.notes.some((n) => n.title === title)) return;
    this.notes.push({ title, body });
    this.toastEl.textContent = `✎ 已记入笔记：${title}（${this.notes.length}/${this.noteTotal}）`;
    this.toastEl.classList.add('show');
    this.toastTimer = 3.6;
  }

  resetNotes() {
    this.notes.length = 0;
    this.toastEl.classList.remove('show');
  }

  showJournal(v: boolean) {
    if (!v) {
      this.journalEl.style.display = 'none';
      return;
    }
    const items = this.notes.length
      ? this.notes.map((n) => `
        <div class="journal-item">
          <div class="journal-item-title">◆ ${n.title}</div>
          <div class="journal-item-body">${n.body}</div>
        </div>`).join('')
      : `<div class="journal-empty">还没有记录。凑近可疑之物，按 E 查看。</div>`;
    const missing = this.noteTotal - this.notes.length;
    this.journalEl.innerHTML = `
      <div class="journal-inner">
        <div class="journal-title">— 侦探笔记 —</div>
        <div class="journal-count">线索 ${this.notes.length} / ${this.noteTotal}</div>
        <div class="journal-list">${items}</div>
        ${missing > 0 && this.notes.length > 0 ? `<div class="journal-empty">……水里还有 ${missing} 条线索没找到。</div>` : ''}
        <div class="journal-hint">N / Esc 合上笔记</div>
      </div>
    `;
    this.journalEl.style.display = 'flex';
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
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
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
