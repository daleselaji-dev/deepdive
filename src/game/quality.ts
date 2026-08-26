/** 质量分档：Ultra（桌面独显）/ High / Mobile。详见 docs/ART_DIRECTION.md §6 */
export interface QualityProfile {
  tier: 'ultra' | 'high' | 'mobile';
  maxDPR: number;
  particles: number; // marine snow
  tubeSegments: number;
  tubeRadial: number;
  rocks: number;
  godRays: number;
  texSize: number; // 岩壁反照率纹理
  fish: number; // 天光井鱼群
  plankton: number; // 发光浮游
  jellies: number; // 深渊水母
  branches: number; // 卤水层枯枝
  beamSegs: number; // 体积光锥分段
  causticSize: number; // 焦散帧尺寸
  causticFrames: number;
}

const PROFILES: Record<QualityProfile['tier'], QualityProfile> = {
  ultra: {
    tier: 'ultra', maxDPR: 2.0, particles: 2600, tubeSegments: 1600, tubeRadial: 72,
    rocks: 340, godRays: 14, texSize: 1024, fish: 120, plankton: 1050, jellies: 12,
    branches: 26, beamSegs: 48, causticSize: 256, causticFrames: 16,
  },
  high: {
    tier: 'high', maxDPR: 1.75, particles: 1400, tubeSegments: 1150, tubeRadial: 52,
    rocks: 220, godRays: 10, texSize: 512, fish: 80, plankton: 650, jellies: 9,
    branches: 18, beamSegs: 32, causticSize: 192, causticFrames: 12,
  },
  mobile: {
    tier: 'mobile', maxDPR: 1.25, particles: 620, tubeSegments: 680, tubeRadial: 32,
    rocks: 120, godRays: 6, texSize: 320, fish: 44, plankton: 320, jellies: 6,
    branches: 10, beamSegs: 24, causticSize: 128, causticFrames: 8,
  },
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
