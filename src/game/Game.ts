import * as THREE from 'three';
import { detectQuality } from './quality';
import { particleSprite } from './textures';
import { AudioEngine } from './AudioEngine';
import { InputManager } from './Input';
import { Cave, type CaveProp } from './Cave';
import { Player } from './Player';
import { Hud } from './Hud';
import { Story, type StoryContext } from './Story';
import { Scare } from './Scare';
import { RedRoom } from './RedRoom';

type GameState = 'title' | 'play' | 'redroom' | 'hypoxia' | 'ended';

const FOG_SHALLOW = new THREE.Color(0x06181d);
const FOG_DEEP = new THREE.Color(0x041014);
const O2_DRAIN = 100 / 360; // 基础 6 分钟
const SPRINT_MULT = 2.2;
const TANK_REFILL = 38;

export class Game {
  private q = detectQuality();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cave: Cave;
  private player: Player;
  private input: InputManager;
  private hud = new Hud();
  private audio = new AudioEngine();
  private story: Story;
  private scare: Scare;
  private redRoom: RedRoom;

  private state: GameState = 'title';
  private clock = new THREE.Clock();
  private time = 0;

  // 资源与统计
  private oxygen = 100;
  private maxDepth = 0;
  private tension = 0;

  // 粒子（marine snow）
  private particles!: THREE.Points;
  private pPos!: Float32Array;
  private pVel!: Float32Array;
  private snowDrift = -0.045;

  // 节奏计时
  private scareAt = -1;
  private bedRestored = 0; // 0 未恢复 1 半恢复 2 全恢复
  private hypoxiaAt = -1;
  private redRoomAt = -1;
  private redRoomSubs: { at: number; text: string; who: string; hold: number }[] = [];
  private introQueue: { at: number; text: string; who: string; hold: number }[] = [];
  private startedAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.q.tier !== 'mobile',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.q.maxDPR));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;

    this.scene.fog = new THREE.FogExp2(FOG_SHALLOW.getHex(), 0.05);
    this.scene.background = new THREE.Color(0x030a0d);

    // 极低冷环境光：只保证岩壁剪影可读
    this.scene.add(new THREE.HemisphereLight(0x0e2a33, 0x020608, 0.3));
    // 入水段：天坑开口漏下的局部冷光（点光源，避免照亮全洞）
    const entryGlow = new THREE.PointLight(0x9fd4d8, 130, 50, 1.5);
    entryGlow.position.set(0, 4, -2);
    const entryGlow2 = new THREE.PointLight(0x7db8c4, 48, 32, 1.6);
    entryGlow2.position.set(2, -2, -14);
    this.scene.add(entryGlow, entryGlow2);

    this.cave = new Cave(this.q);
    this.scene.add(this.cave.group);

    this.input = new InputManager(canvas);
    this.player = new Player(this.scene, innerWidth / innerHeight, this.input.touch);
    this.player.setStart(this.cave, 0.012);

    this.story = new Story(this.cave);
    this.scare = new Scare(this.scene);
    this.redRoom = new RedRoom(this.scene);

    this.buildParticles();

    addEventListener('resize', () => {
      this.player.camera.aspect = innerWidth / innerHeight;
      this.player.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    // Esc 解锁后点击画布重新锁定
    canvas.addEventListener('click', () => {
      if (this.state === 'play') this.input.requestPointerLock();
    });

    this.renderer.setAnimationLoop(() => this.frame());

    // 调试钩子：跳到指定样条进度（截图与流程自测用，见 docs/WORKFLOW.md §5）
    (window as unknown as { __dd: object }).__dd = {
      jump: (t: number) => {
        this.player.setStart(this.cave, Math.max(0.01, Math.min(0.99, t)));
      },
      o2: (v: number) => {
        this.oxygen = Math.max(0, Math.min(100, v));
      },
    };
  }

  private buildParticles(): void {
    const n = this.q.particles;
    this.pPos = new Float32Array(n * 3);
    this.pVel = new Float32Array(n * 3);
    const box = 26;
    for (let i = 0; i < n; i++) {
      this.pPos[i * 3] = (Math.random() - 0.5) * box;
      this.pPos[i * 3 + 1] = (Math.random() - 0.5) * box;
      this.pPos[i * 3 + 2] = (Math.random() - 0.5) * box;
      this.pVel[i * 3] = (Math.random() - 0.5) * 0.05;
      this.pVel[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
      this.pVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    const mat = new THREE.PointsMaterial({
      map: particleSprite(),
      size: 0.055,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  private updateParticles(dt: number, center: THREE.Vector3): void {
    const n = this.q.particles;
    const half = 13;
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      this.pPos[ix] += (this.pVel[ix] + Math.sin(this.time * 0.4 + i) * 0.012) * dt;
      this.pPos[ix + 1] += (this.pVel[ix + 1] + this.snowDrift) * dt;
      this.pPos[ix + 2] += this.pVel[ix + 2] * dt;
      // 围绕玩家的环绕盒回绕（粒子密度恒定）
      for (let a = 0; a < 3; a++) {
        const rel = this.pPos[ix + a] + this.particles.position.getComponent(a) - center.getComponent(a);
        if (rel > half) this.pPos[ix + a] -= half * 2;
        else if (rel < -half) this.pPos[ix + a] += half * 2;
      }
    }
    (this.particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  /** 「开始下潜」：用户手势内初始化音频 + 指针锁定 */
  start(): void {
    if (this.state !== 'title') return;
    this.audio.init();
    this.hud.hideTitle();
    this.hud.showHud();
    this.input.enable();
    this.input.requestPointerLock();
    this.player.lightOn(46);
    this.state = 'play';
    this.startedAt = this.time;
    this.introQueue = [
      { at: this.time + 1.2, text: '尤卡坦半岛 · 天坑「寂静之井」\n萝拉·卡尔最后一次被目击的位置。', who: '案件档案 № 044', hold: 6 },
      { at: this.time + 8.4, text: '委托：找回她——或者找回答案。', who: '案件档案 № 044', hold: 5 },
    ];
  }

  restart(): void {
    location.reload();
  }

  // ---------- 叙事上下文 ----------
  private storyCtx: StoryContext = {
    radio: (text, hold = 6) => {
      this.audio.radioBlip();
      this.hud.subtitle(text, '无线电 · M', hold);
    },
    env: (text, hold = 5.5) => this.hud.subtitle(text, '', hold),
    slate: (text) => {
      void this.hud.showSlate(text);
    },
    tank: (prop: CaveProp) => {
      const idx = this.story.tankIndex(prop);
      this.oxygen = Math.min(100, this.oxygen + TANK_REFILL);
      this.audio.tankPickup();
      this.hud.subtitle(Story.tankText(idx), '', 6.5);
    },
    silenceBegins: () => this.audio.duckBed(0.04, 9),
    scare: () => {
      this.scare.trigger(this.cave, this.player, this.audio);
      this.scareAt = this.time;
    },
  };

  // ---------- 主循环 ----------
  private frame(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;

    switch (this.state) {
      case 'title':
        this.titleIdle(dt);
        break;
      case 'play':
        this.playFrame(dt);
        break;
      case 'hypoxia':
        this.hypoxiaFrame(dt);
        break;
      case 'redroom':
        this.redRoomFrame(dt);
        break;
      case 'ended':
        break;
    }

    this.redRoom.update(dt, this.time);
    this.renderer.render(this.scene, this.player.camera);
  }

  /** 标题首屏：相机在入水段缓慢漂移，光柱可见 */
  private titleIdle(dt: number): void {
    const t = 0.012 + Math.sin(this.time * 0.02) * 0.004;
    const p = this.cave.pointAt(t);
    this.player.camera.position.set(
      p.x + Math.sin(this.time * 0.11) * 0.8,
      p.y + 0.6 + Math.sin(this.time * 0.07) * 0.35,
      p.z + Math.cos(this.time * 0.09) * 0.7,
    );
    this.player.camera.lookAt(p.x, p.y + 2.4 + Math.sin(this.time * 0.05), p.z - 9);
    this.player.camera.rotation.z = Math.sin(this.time * 0.06) * 0.02;
    this.shimmerShafts();
    this.updateParticles(dt, this.player.camera.position);
    this.audio.update(dt, { oxygen01: 1, depth01: 0.1, sprinting: false });
  }

  private shimmerShafts(): void {
    const mat = this.cave.shafts[0]?.material as THREE.MeshBasicMaterial | undefined;
    if (mat) mat.opacity = 0.6 + Math.sin(this.time * 0.4) * 0.14 + Math.sin(this.time * 1.7) * 0.05;
  }

  private playFrame(dt: number): void {
    // 开场字幕队列
    while (this.introQueue.length && this.time >= this.introQueue[0].at) {
      const s = this.introQueue.shift()!;
      this.hud.subtitle(s.text, s.who, s.hold);
    }

    const reading = this.hud.slateOpen;
    const scareActive = this.scare.update(dt, this.player);

    // 移动（读写字板/惊吓时锁移动，视角保留）
    if (reading) {
      this.input.moveX = 0;
      this.input.moveZ = 0;
    }
    const { speed } = this.player.update(dt, this.input, this.cave, this.time);

    // 氧气
    if (!reading) {
      const drain = O2_DRAIN * (this.input.sprint && speed > 0.5 ? SPRINT_MULT : 1);
      this.oxygen = Math.max(0, this.oxygen - drain * dt);
    }
    const depth = Math.abs(this.player.position.y);
    this.maxDepth = Math.max(this.maxDepth, depth);
    this.hud.setOxygen(this.oxygen / 100);
    this.hud.setDepth(depth);

    // 雾随深度加深、变绿
    const depth01 = Math.min(1, depth / 46);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(FOG_SHALLOW).lerp(FOG_DEEP, depth01);
    fog.density = 0.048 + depth01 * 0.024;
    (this.scene.background as THREE.Color).copy(fog.color).multiplyScalar(0.5);
    this.shimmerShafts();

    // 心跳张力：低氧基线 + 惊吓峰值衰减
    const o2 = this.oxygen / 100;
    const base = o2 < 0.3 ? Math.min(0.85, (0.3 - o2) * 3) : 0;
    this.tension = Math.max(base, this.tension - dt * 0.07);
    if (scareActive) this.tension = 0.95;
    this.audio.setTension(this.tension);

    // 低氧视野收缩
    this.hud.setHypoxiaVignette(o2 < 0.12 && o2 > 0);

    // 惊吓前兆：中段偶发微频闪（假警报，见 GDD §4.5）
    if (!this.scare.hasFired && this.player.curveT > 0.4 && this.player.curveT < 0.56) {
      if (Math.random() < dt * 0.06) {
        this.player.flashlight.intensity = 46 * (0.4 + Math.random() * 0.4);
        setTimeout(() => this.player.lightOn(46), 60 + Math.random() * 90);
      }
    }

    // 惊吓余韵：12 秒死寂 → 半恢复 → 全恢复
    if (this.scareAt > 0) {
      const since = this.time - this.scareAt;
      if (since > 12 && this.bedRestored === 0) {
        this.bedRestored = 1;
        this.audio.duckBed(0.35, 7);
      } else if (since > 26 && this.bedRestored === 1) {
        this.bedRestored = 2;
        this.audio.duckBed(1, 10);
      }
    }

    // 井底红幕脉动
    const tNow = this.player.curveT;
    if (tNow > 0.9) {
      const k = (tNow - 0.9) / 0.1;
      this.cave.redLight.intensity = (5 + Math.sin(this.time * 1.9) * 2.2) * k;
      (this.cave.redVeil.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(this.time * 1.3) * 0.22;
    }

    this.story.update(tNow, this.player.position, this.storyCtx);
    this.updateParticles(dt, this.player.position);
    this.audio.update(dt, { oxygen01: o2, depth01, sprinting: this.input.sprint });

    // ---- 结局判定 ----
    if (this.oxygen <= 0) {
      this.enterHypoxia();
    } else if (tNow >= 0.985) {
      this.enterRedRoom();
    }
  }

  // ---------- 结局 B ·「浅睡」 ----------
  private enterHypoxia(): void {
    this.state = 'hypoxia';
    this.hypoxiaAt = this.time;
    this.hud.setHypoxiaVignette(true);
    this.hud.clearSubtitle();
    this.snowDrift = 0.5; // 你在下沉——"雪"在往上飘
    this.audio.duckBed(0.15, 6);
    this.hud.subtitle('手电的光越来越暖。\n像很久以前某盏你熟悉的灯。', '', 8);
  }

  private hypoxiaFrame(dt: number): void {
    const since = this.time - this.hypoxiaAt;
    const k = Math.min(1, since / 13);
    this.player.control = 1 - k * 0.8;
    this.player.update(dt, this.input, this.cave, this.time);
    // 光变暖、变亮——产房的灯
    this.player.flashlight.color.lerpColors(new THREE.Color(0xffd9a0), new THREE.Color(0xffe9cf), k);
    this.player.flashlight.intensity = 46 + k * 30;
    this.player.flashlight.angle = 0.46 + k * 0.3;
    this.hud.setOxygen(0);
    this.hud.setDepth(Math.abs(this.player.position.y));
    this.tension = Math.max(0.15, 0.9 - k);
    this.audio.setTension(since > 11 ? 0 : this.tension); // 最后心跳也停了
    this.audio.update(dt, { oxygen01: 0, depth01: 1, sprinting: false, muffle01: k });
    this.updateParticles(dt, this.player.position);

    if (since > 13.5) {
      this.state = 'ended';
      this.input.disable();
      this.hud.fade(true);
      this.audio.fadeOutAll(3.5);
      const depthStr = this.maxDepth.toFixed(1);
      setTimeout(() => {
        this.hud.hideHud();
        this.hud.showEnding(
          'hypoxia',
          '深处没有黑暗。\n只有你带来的光，和它照不到的你。',
          `你停在 -${depthStr}M · 结局：浅睡\n下一位潜水员，会读到你的写字板。`,
        );
        document.exitPointerLock?.();
      }, 2600);
    }
  }

  // ---------- 结局 A ·「红厅」 ----------
  private enterRedRoom(): void {
    this.state = 'redroom';
    this.redRoomAt = this.time;
    this.hud.fade(true, { red: true, fast: true });
    this.audio.enterRedRoom();
    this.hud.clearSubtitle();
    this.hud.hideHud();

    setTimeout(() => {
      this.redRoom.show();
      // 红厅内近乎无雾，只留一点红霾
      const fog = this.scene.fog as THREE.FogExp2;
      fog.color.set(0x150202);
      fog.density = 0.012;
      (this.scene.background as THREE.Color).set(0x0a0101);
      this.player.flashlight.intensity = 0;
      this.player.camera.position.copy(this.redRoom.entryPos);
      this.player.yaw = 0; // 面向房间中央的竹节虫
      this.player.pitch = 0;
      this.hud.fade(false, { red: true });
    }, 900);

    const t0 = this.time;
    this.redRoomSubs = [
      { at: t0 + 4, text: '水不见了。你站着。\n你的湿衣是干的。', who: '', hold: 5.5 },
      { at: t0 + 10.5, text: '它不动。它在看。\n它已经看了很久。', who: '', hold: 5.5 },
      { at: t0 + 17, text: '「你把光带下来了。\n我们等的就是这个。」', who: '红 厅', hold: 6 },
      { at: t0 + 24, text: '「萝拉没有失踪。\n萝拉是上一个你。」', who: '红 厅', hold: 6.5 },
    ];
  }

  private redRoomFrame(dt: number): void {
    const since = this.time - this.redRoomAt;
    while (this.redRoomSubs.length && this.time >= this.redRoomSubs[0].at) {
      const s = this.redRoomSubs.shift()!;
      this.hud.subtitle(s.text, s.who, s.hold);
    }
    // 只保留视角，缓慢被"引"向中央
    const look = this.input.consumeLook();
    this.player.yaw -= look.dx * 0.0016;
    this.player.pitch = Math.max(-1.2, Math.min(1.2, this.player.pitch - look.dy * 0.0016));
    const drift = Math.min(1, Math.max(0, (since - 3) / 26));
    const target = this.redRoom.anchor.clone().add(new THREE.Vector3(0, 1.6, 3.6));
    this.player.camera.position.lerpVectors(this.redRoom.entryPos, target, drift * drift);
    this.player.camera.position.y += Math.sin(this.time * 0.8) * 0.03;
    const e = new THREE.Euler(this.player.pitch, this.player.yaw, Math.sin(this.time * 0.4) * 0.01, 'YXZ');
    this.player.camera.quaternion.setFromEuler(e);

    this.audio.update(dt, { oxygen01: 1, depth01: 0, sprinting: false });

    if (since > 31) {
      this.state = 'ended';
      this.input.disable();
      this.hud.fade(true);
      this.audio.fadeOutAll(4);
      const o2Str = Math.round(this.oxygen);
      const timeStr = ((this.time - this.startedAt) / 60).toFixed(1);
      setTimeout(() => {
        this.hud.showEnding(
          'red',
          '它展开肢体的那一瞬，\n你想起自己从来没有学过潜水。',
          `最大深度 -${this.maxDepth.toFixed(1)}M · 剩余氧气 ${o2Str}% · 用时 ${timeStr} 分钟\n结局：红厅`,
        );
        document.exitPointerLock?.();
      }, 3200);
    }
  }
}
