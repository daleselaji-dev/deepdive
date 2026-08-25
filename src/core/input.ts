/** 统一输入：键鼠（指针锁）+ 移动端触控（虚拟摇杆/按钮/拖动视角）。 */
import { isTouchDevice, clampNum } from './util';

export class Input {
  moveX = 0;   // 横移 -1..1
  moveZ = 0;   // 前进 +1 / 后退 -1
  moveY = 0;   // 上浮 +1 / 下潜 -1
  lookDX = 0;  // 每帧消费后清零
  lookDY = 0;

  onPointerLockLost: (() => void) | null = null;

  private keys = new Set<string>();
  private pressedEdges = new Set<string>();
  private canvas: HTMLCanvasElement;
  private lockWanted = false;
  readonly touch: boolean;

  // 触控状态
  private joyId = -1;
  private joyOrigin = { x: 0, y: 0 };
  private lookId = -1;
  private lookLast = { x: 0, y: 0 };
  private touchUp = false;
  private touchDown = false;
  private touchRoot: HTMLDivElement | null = null;
  private joyBase: HTMLDivElement | null = null;
  private joyNub: HTMLDivElement | null = null;
  private interactBtn: HTMLDivElement | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.canvas = canvas;
    this.touch = isTouchDevice();

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedEdges.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.lockWanted) {
        this.lockWanted = false;
        this.onPointerLockLost?.();
      }
    });

    if (this.touch) this.buildTouchUI(uiRoot);
  }

  requestPointerLock() {
    if (this.touch) return;
    this.lockWanted = true;
    this.canvas.requestPointerLock?.();
  }

  exitPointerLock() {
    this.lockWanted = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** 每帧调用：聚合键盘/触控为移动向量。 */
  poll() {
    if (!this.touch) {
      const k = this.keys;
      this.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + (k.has('KeyS') || k.has('ArrowDown') ? -1 : 0);
      this.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0);
      this.moveY = (k.has('Space') ? 1 : 0) + (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('ControlLeft') ? -1 : 0);
    } else {
      this.moveY = (this.touchUp ? 1 : 0) + (this.touchDown ? -1 : 0);
    }
  }

  /** 边沿触发（按下一次）。code 例：KeyE / KeyF / Escape / touch:interact */
  consumePressed(code: string): boolean {
    if (this.pressedEdges.has(code)) {
      this.pressedEdges.delete(code);
      return true;
    }
    return false;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  setTouchVisible(v: boolean) {
    if (this.touchRoot) this.touchRoot.style.display = v ? 'block' : 'none';
  }
  setInteractVisible(v: boolean) {
    if (this.interactBtn) this.interactBtn.style.display = v ? 'flex' : 'none';
  }

  private buildTouchUI(root: HTMLElement) {
    const tr = document.createElement('div');
    tr.className = 'touch-root';
    tr.style.display = 'none';
    root.appendChild(tr);
    this.touchRoot = tr;

    const mkBtn = (cls: string, label: string) => {
      const b = document.createElement('div');
      b.className = `touch-btn ${cls}`;
      b.textContent = label;
      tr.appendChild(b);
      return b;
    };

    const base = document.createElement('div');
    base.className = 'joy-base';
    const nub = document.createElement('div');
    nub.className = 'joy-nub';
    base.appendChild(nub);
    tr.appendChild(base);
    this.joyBase = base;
    this.joyNub = nub;

    const upBtn = mkBtn('t-up', '▲');
    const downBtn = mkBtn('t-down', '▼');
    const lampBtn = mkBtn('t-lamp', '灯');
    const journalBtn = mkBtn('t-journal', '档');
    const pauseBtn = mkBtn('t-pause', 'Ⅱ');
    const interactBtn = mkBtn('t-interact', '查看');
    interactBtn.style.display = 'none';
    this.interactBtn = interactBtn;

    const hold = (el: HTMLElement, set: (v: boolean) => void) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); set(true); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); set(false); }, { passive: false });
      el.addEventListener('touchcancel', () => set(false));
    };
    hold(upBtn, (v) => (this.touchUp = v));
    hold(downBtn, (v) => (this.touchDown = v));
    const tap = (el: HTMLElement, code: string) => {
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.pressedEdges.add(code); }, { passive: false });
    };
    tap(lampBtn, 'KeyF');
    tap(journalBtn, 'Tab');
    tap(pauseBtn, 'Escape');
    tap(interactBtn, 'KeyE');

    // 摇杆 + 视角拖动（绑在 canvas 上，按左右半屏区分）
    const JOY_R = 52;
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.45 && this.joyId < 0) {
          this.joyId = t.identifier;
          this.joyOrigin = { x: t.clientX, y: t.clientY };
          if (this.joyBase) {
            this.joyBase.style.left = `${t.clientX - JOY_R}px`;
            this.joyBase.style.top = `${t.clientY - JOY_R}px`;
            this.joyBase.style.opacity = '1';
          }
        } else if (this.lookId < 0) {
          this.lookId = t.identifier;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          let dx = t.clientX - this.joyOrigin.x;
          let dy = t.clientY - this.joyOrigin.y;
          const len = Math.hypot(dx, dy);
          if (len > JOY_R) { dx *= JOY_R / len; dy *= JOY_R / len; }
          this.moveX = clampNum(dx / JOY_R, -1, 1);
          this.moveZ = clampNum(-dy / JOY_R, -1, 1);
          if (this.joyNub) this.joyNub.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === this.lookId) {
          this.lookDX += (t.clientX - this.lookLast.x) * 2.4;
          this.lookDY += (t.clientY - this.lookLast.y) * 2.4;
          this.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });

    const endTouch = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.joyId) {
          this.joyId = -1;
          this.moveX = 0;
          this.moveZ = 0;
          if (this.joyNub) this.joyNub.style.transform = 'translate(0,0)';
          if (this.joyBase) this.joyBase.style.opacity = '0.35';
        } else if (t.identifier === this.lookId) {
          this.lookId = -1;
        }
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }
}
