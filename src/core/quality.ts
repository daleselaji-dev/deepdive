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
  bloom: boolean;           // 双通道泛光
  bloomStrength: number;
  caveDetail: boolean;      // 洞壁三平面细节法线 / 湿岩高光 / 晶脉
  caveCaustics: boolean;    // 入口段动画焦散
  caveSegments: number;     // 隧道纵向细分
  caveRadial: number;       // 隧道环向细分
  fishCount: number;        // 穹顶大厅鱼群数量
  glowCount: number;        // 生物发光廊道光点数量
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  high: {
    level: 'high', label: '高', maxPixelRatio: 2, antialias: true, rtSamples: 4,
    siltCount: 2600, volumetric: true, postDistortion: true, postAberration: true,
    bloom: true, bloomStrength: 1.0, caveDetail: true, caveCaustics: true,
    caveSegments: 720, caveRadial: 30, fishCount: 700, glowCount: 900,
  },
  medium: {
    level: 'medium', label: '中', maxPixelRatio: 1.5, antialias: true, rtSamples: 0,
    siltCount: 1200, volumetric: true, postDistortion: true, postAberration: false,
    bloom: true, bloomStrength: 0.8, caveDetail: true, caveCaustics: true,
    caveSegments: 520, caveRadial: 24, fishCount: 450, glowCount: 600,
  },
  low: {
    level: 'low', label: '低', maxPixelRatio: 1, antialias: false, rtSamples: 0,
    siltCount: 500, volumetric: false, postDistortion: false, postAberration: false,
    bloom: false, bloomStrength: 0, caveDetail: false, caveCaustics: false,
    caveSegments: 360, caveRadial: 18, fishCount: 180, glowCount: 260,
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
