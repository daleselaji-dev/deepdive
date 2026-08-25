export const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}
