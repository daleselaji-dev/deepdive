/** 质量分档：Ultra（桌面独显）/ High / Mobile。详见 docs/ART_DIRECTION.md §6 */
export interface QualityProfile {
  tier: 'ultra' | 'high' | 'mobile';
  maxDPR: number;
  particles: number;
  tubeSegments: number;
  tubeRadial: number;
  rocks: number;
  godRays: number;
}

const PROFILES: Record<QualityProfile['tier'], QualityProfile> = {
  ultra: { tier: 'ultra', maxDPR: 2.0, particles: 2400, tubeSegments: 1200, tubeRadial: 48, rocks: 260, godRays: 14 },
  high: { tier: 'high', maxDPR: 1.75, particles: 1200, tubeSegments: 800, tubeRadial: 32, rocks: 170, godRays: 10 },
  mobile: { tier: 'mobile', maxDPR: 1.25, particles: 500, tubeSegments: 500, tubeRadial: 24, rocks: 90, godRays: 5 },
};

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 1;
}

export function detectQuality(): QualityProfile {
  const override = new URLSearchParams(location.search).get('q');
  if (override && override in PROFILES) return PROFILES[override as QualityProfile['tier']];
  const mobileUA = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobileUA || (isTouchDevice() && Math.min(screen.width, screen.height) < 820)) return PROFILES.mobile;
  const smallScreen = Math.max(screen.width, screen.height) < 1500;
  return smallScreen ? PROFILES.high : PROFILES.ultra;
}
