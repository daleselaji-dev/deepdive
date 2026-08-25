/**
 * 游戏模式架构：编排器只依赖 GameMode 接口。
 * 竖切实现 StoryMode；「真实洞潜模拟模式」(sim) 以预留席位注册，
 * 计划复用洞穴生成/渲染/音频，仅替换规则层（见 docs/DESIGN.md §7）。
 */
import type * as THREE from 'three';
import type { Input } from '../core/input';
import type { AudioEngine } from '../core/audio';
import type { Hud } from '../ui/hud';
import type { QualitySettings } from '../core/quality';
import type { PostFX } from '../render/post';

export interface GameContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  input: Input;
  audio: AudioEngine;
  hud: Hud;
  post: PostFX;
  quality: QualitySettings;
  /** 致谢结束回到标题。 */
  onStoryEnd: () => void;
}

export interface GameMode {
  readonly id: string;
  init(ctx: GameContext): void;
  update(dt: number): void;
  dispose(): void;
}

export interface ModeInfo {
  id: string;
  title: string;
  desc: string;
  available: boolean;
}

export const MODES: ModeInfo[] = [
  {
    id: 'story',
    title: '开始调查 — 故事模式',
    desc: '《蓝井》· 一次下潜，一宗悬案。约 15 分钟。',
    available: true,
  },
  {
    id: 'sim',
    title: '真实洞潜模拟',
    desc: '气体三分法则 · 放线导航 · 涌泥能见度 —— v0.2 预留',
    available: false,
  },
];
