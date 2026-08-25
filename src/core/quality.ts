/** 画质档位：高 / 中 / 低，移动端默认低档系。 */
import { isTouchDevice } from './util';
export { isTouchDevice };

export type QualityLevel = 'high' | 'medium' | 'low';

export interface QualitySettings {
  level: QualityLevel;
  label: string;
  maxPixelRatio: number;
  antialias: boolean;
  rtSamples: number;        // 渲染目标 MSAA 采样数
  siltCount: number;        // 悬浮微粒数量
  volumetric: boolean;      // 手电体积光锥
  postDistortion: boolean;  // 水下屏幕扭曲
  postAberration: boolean;  // 色偏
  caveSegments: number;     // 隧道纵向细分
  caveRadial: number;       // 隧道环向细分
  bloomIters: number;       // Bloom 模糊迭代次数（0 = 关闭）
  microDetail: boolean;     // 湿岩法线微扰 + 焦散
  fishCount: number;        // 钟厅鱼群数量
  polypCount: number;       // 发光廊道水螅体点数
  dropletCount: number;     // 红房间逆浮水珠
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  high: {
    level: 'high', label: '高', maxPixelRatio: 2, antialias: true, rtSamples: 4,
    siltCount: 2600, volumetric: true, postDistortion: true, postAberration: true,
    caveSegments: 720, caveRadial: 30,
    bloomIters: 2, microDetail: true, fishCount: 120, polypCount: 900, dropletCount: 260,
  },
  medium: {
    level: 'medium', label: '中', maxPixelRatio: 1.5, antialias: true, rtSamples: 0,
    siltCount: 1200, volumetric: true, postDistortion: true, postAberration: false,
    caveSegments: 520, caveRadial: 24,
    bloomIters: 1, microDetail: true, fishCount: 64, polypCount: 520, dropletCount: 160,
  },
  low: {
    level: 'low', label: '低', maxPixelRatio: 1, antialias: false, rtSamples: 0,
    siltCount: 500, volumetric: false, postDistortion: false, postAberration: false,
    caveSegments: 360, caveRadial: 18,
    bloomIters: 0, microDetail: false, fishCount: 28, polypCount: 240, dropletCount: 90,
  },
};

/** 自动检测：触屏 → 中(≥6核)/低；桌面 → 高。 */
export function detectQuality(): QualityLevel {
  if (isTouchDevice()) {
    const cores = navigator.hardwareConcurrency ?? 4;
    return cores >= 6 ? 'medium' : 'low';
  }
  return 'high';
}
