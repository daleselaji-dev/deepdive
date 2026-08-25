/** 编排器：标题 → 介绍卡 → 游玩 → 暂停 → 致谢 状态机；渲染主循环。 */
import * as THREE from 'three';
import { detectQuality, QUALITY_PRESETS, type QualityLevel, type QualitySettings } from '../core/quality';
import { Input } from '../core/input';
import { AudioEngine } from '../core/audio';
import { PostFX } from '../render/post';
import { Hud } from '../ui/hud';
import { Menu, PauseMenu } from '../ui/menu';
import { StoryMode } from './story/storyMode';
import type { GameContext } from './modes';
import { INTRO_CARDS } from './story/script';

type State = 'menu' | 'intro' | 'playing' | 'paused';

export class Game {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private time = 0;
  private quality: QualitySettings;
  private input: Input;
  private audio = new AudioEngine();
  private hud: Hud;
  private post: PostFX;
  private menu: Menu;
  private pauseMenu: PauseMenu;
  private story!: StoryMode;
  private state: State = 'menu';
  private debug = new URLSearchParams(location.search).has('debug');
  private timeScale = 1;

  constructor(root: HTMLDivElement) {
    const level = detectQuality();
    this.quality = QUALITY_PRESETS[level];

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 色调映射在 PostFX 合成通道内手动完成（RT 为线性 HDR）
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    root.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 320);

    this.input = new Input(this.renderer.domElement, root);
    this.hud = new Hud(root);
    this.post = new PostFX(this.renderer, this.quality);
    this.post.uniforms.uFade.value = 0;

    this.menu = new Menu(root, level,
      () => this.startStory(),
      (q) => this.applyQuality(q));
    this.pauseMenu = new PauseMenu(root,
      () => this.resume(),
      () => this.quitToMenu());

    this.createStory();

    this.input.onPointerLockLost = () => {
      if (this.state === 'playing') this.pause();
    };
    // 兜底：游玩中画布点击重新锁定指针
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestPointerLock();
    });

    addEventListener('resize', () => this.onResize());
    this.onResize();

    // 首屏：从黑场淡入标题
    this.hud.fade(1, 0);
    requestAnimationFrame(() => this.hud.fade(0, 2.5));

    if (this.debug) {
      (window as unknown as Record<string, unknown>).__dd = {
        start: () => this.startStory(),
        teleport: (t: number) => this.story.debugTeleport(t),
        face: () => this.story.debugFace(),
        awe: () => this.story.debugAwe(),
        redroom: () => this.story.debugRedRoom(),
        scare: () => this.story.debugScare(),
        sm: () => this.story,
        speed: (x: number) => { this.timeScale = x; },
      };
    }

    this.renderer.setAnimationLoop(() => this.frame());
  }

  private get ctx(): GameContext {
    return {
      renderer: this.renderer,
      camera: this.camera,
      input: this.input,
      audio: this.audio,
      hud: this.hud,
      post: this.post,
      quality: this.quality,
      onStoryEnd: () => this.quitToMenu(),
    };
  }

  private createStory() {
    this.story = new StoryMode();
    this.story.init(this.ctx);
    this.story.setIdle(true);
  }

  private applyQuality(level: QualityLevel) {
    this.quality = QUALITY_PRESETS[level];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.maxPixelRatio));
    this.post.applyQuality(this.quality);
    this.story.applyQuality(this.quality);
    this.onResize();
    this.audio.uiClick();
  }

  private async startStory() {
    if (this.state !== 'menu') return;
    this.state = 'intro';
    this.audio.ensure();
    this.audio.uiClick();
    this.menu.hide();
    if (!this.debug) {
      this.hud.fade(1, 1.2);
      this.audio.setTape(true);
      await this.wait(1300);
      await this.hud.showCards(INTRO_CARDS);
      this.audio.setTape(false);
    }

    // 重置后处理与玩家，入水
    const u = this.post.uniforms;
    u.uWhite.value = 0; u.uClose.value = 0; u.uFlash.value = 0; u.uFade.value = 0;
    u.uGradeDepth.value = 0.4; u.uGradeMode.value = 0;
    this.post.applyQuality(this.quality);

    this.story.resetPlayer();
    this.story.beginPlay();
    this.hud.setVisible(true);
    this.hud.setGaugesVisible(true);
    this.input.requestPointerLock();
    this.input.setTouchVisible(this.input.touch);
    this.state = 'playing';
    this.hud.fade(0, 2.2);
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseMenu.show();
    this.input.exitPointerLock();
    this.audio.suspend();
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.pauseMenu.hide();
    this.audio.resume();
    this.input.requestPointerLock();
  }

  private quitToMenu() {
    this.pauseMenu.hide();
    this.audio.resume();
    this.story.dispose();
    const u = this.post.uniforms;
    u.uWhite.value = 0; u.uClose.value = 0; u.uFlash.value = 0; u.uFade.value = 0;
    u.uGradeDepth.value = 0.4; u.uGradeMode.value = 0;
    this.post.applyQuality(this.quality);
    this.hud.setVisible(false);
    this.hud.clearSubtitles();
    this.hud.fade(1, 0);
    this.input.setTouchVisible(false);
    this.input.exitPointerLock();
    this.createStory();
    this.menu.show();
    this.state = 'menu';
    requestAnimationFrame(() => this.hud.fade(0, 1.8));
  }

  private onResize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, this.renderer.getPixelRatio());
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta()) * this.timeScale;
    this.time += dt;
    this.input.poll();

    if (this.state === 'playing' && this.input.consumePressed('Escape')) {
      this.pause();
    }
    if (this.state !== 'paused') {
      this.story.update(dt);
    }
    this.hud.update(dt);
    this.post.render(this.story.currentScene, this.camera, this.time);
  }

  private wait(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }
}
