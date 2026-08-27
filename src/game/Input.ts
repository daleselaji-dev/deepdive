import { isTouchDevice } from './quality';

/** 统一输入：桌面 WASD+指针锁定 / 移动端 左摇杆+右侧拖拽视角 */
export class InputManager {
  moveX = 0; // 左右 -1..1
  moveZ = 0; // 前后 -1..1（1 = 前进）
  sprint = false;
  readonly touch = isTouchDevice();
  private interactEdge = false;

  private lookDX = 0;
  private lookDY = 0;
  private keys = new Set<string>();
  private enabled = false;
  private canvas: HTMLCanvasElement;
  private stickTouchId: number | null = null;
  private lookTouchId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private stickEl: HTMLElement;
  private nubEl: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.stickEl = document.getElementById('stick')!;
    this.nubEl = document.getElementById('stick-nub')!;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprint = true;
      if (e.code === 'KeyF' && !e.repeat) this.interactEdge = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprint = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });

    if (this.touch) this.bindTouch();
  }

  private bindTouch(): void {
    const stickRect = () => this.stickEl.getBoundingClientRect();

    window.addEventListener(
      'touchstart',
      (e) => {
        if (!this.enabled) return;
        for (const t of Array.from(e.changedTouches)) {
          const r = stickRect();
          const inStick =
            t.clientX > r.left - 30 && t.clientX < r.right + 30 && t.clientY > r.top - 30 && t.clientY < r.bottom + 30;
          if (inStick && this.stickTouchId === null) {
            this.stickTouchId = t.identifier;
            this.updateStick(t.clientX, t.clientY);
          } else if (this.lookTouchId === null) {
            this.lookTouchId = t.identifier;
            this.lookLast = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: false },
    );

    window.addEventListener(
      'touchmove',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier === this.stickTouchId) {
            this.updateStick(t.clientX, t.clientY);
          } else if (t.identifier === this.lookTouchId) {
            this.lookDX += (t.clientX - this.lookLast.x) * 2.4;
            this.lookDY += (t.clientY - this.lookLast.y) * 2.4;
            this.lookLast = { x: t.clientX, y: t.clientY };
          }
        }
      },
      { passive: false },
    );

    const endTouch = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickTouchId) {
          this.stickTouchId = null;
          this.moveX = 0;
          this.moveZ = 0;
          this.sprint = false;
          this.nubEl.style.transform = '';
        }
        if (t.identifier === this.lookTouchId) this.lookTouchId = null;
      }
    };
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);
  }

  private updateStick(cx: number, cy: number): void {
    const r = this.stickEl.getBoundingClientRect();
    const ox = cx - (r.left + r.width / 2);
    const oy = cy - (r.top + r.height / 2);
    const max = r.width / 2;
    const len = Math.hypot(ox, oy);
    const clamped = Math.min(len, max);
    const nx = (ox / (len || 1)) * clamped;
    const ny = (oy / (len || 1)) * clamped;
    this.nubEl.style.transform = `translate(${nx}px, ${ny}px)`;
    this.moveX = nx / max;
    this.moveZ = -ny / max;
    // 推到外圈 = 加速踢蹼（耗氧翻倍）
    this.sprint = clamped > max * 0.86;
  }

  /** 键盘轮询合成移动向量 */
  poll(): void {
    if (this.touch && this.stickTouchId !== null) return;
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    this.moveX = x;
    this.moveZ = z;
  }

  consumeLook(): { dx: number; dy: number } {
    const d = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = 0;
    this.lookDY = 0;
    return d;
  }

  /** F 观察键的一次性边沿（M5-L4 遗物观察交互） */
  consumeInteract(): boolean {
    const v = this.interactEdge;
    this.interactEdge = false;
    return v;
  }

  enable(): void {
    this.enabled = true;
    if (this.touch) document.getElementById('touch')!.classList.remove('hidden');
  }

  disable(): void {
    this.enabled = false;
    this.moveX = 0;
    this.moveZ = 0;
    this.sprint = false;
    if (this.touch) document.getElementById('touch')!.classList.add('hidden');
  }

  requestPointerLock(): void {
    if (!this.touch && document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  }
}
