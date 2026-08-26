import * as THREE from 'three';
import { detectQuality } from './quality';
import { particleSprite } from './textures';
import { AudioEngine } from './AudioEngine';
import { InputManager } from './Input';
import { Cave, type CaveProp, type ZoneName } from './Cave';
import { Landmarks } from './Landmarks';
import { WaterWorld } from './WaterWorld';
import { Ecology } from './Ecology';
import { Ancient } from './Ancient';
import { Models } from './Models';
import { Player } from './Player';
import { Hud } from './Hud';
import { Story, type StoryContext } from './Story';
import { Scare } from './Scare';
import { Buddy, type BuddyGesture } from './Buddy';
import { SimDirector, SIM_SPECS } from './Sim';

type GameState = 'title' | 'play' | 'hypoxia' | 'ended';
/** play 内部阶段：下潜 → 目击 → 回程 → 水面 → 登船 */
type Phase = 'descent' | 'sighting' | 'return' | 'surface' | 'boarding';

const O2_DRAIN = 100 / 400; // 基础 ~6.7 分钟
const SPRINT_MULT = 2.2;
const TANK_REFILL = 35;

/** 分区雾表（深渊青黑体系，docs/ART_DIRECTION.md §2） */
const ZONE_ENV: Record<ZoneName, { fog: number; den: number; exp: number }> = {
  shaft: { fog: 0x0b2a33, den: 0.032, exp: 1.02 },
  gallery: { fog: 0x081c23, den: 0.044, exp: 0.96 },
  throat: { fog: 0x05161c, den: 0.058, exp: 0.92 },
  hall: { fog: 0x04161a, den: 0.034, exp: 0.94 },
  halo: { fog: 0x0a1d1c, den: 0.05, exp: 0.9 },
  wreck: { fog: 0x061418, den: 0.044, exp: 0.9 },
  collapse: { fog: 0x040f13, den: 0.062, exp: 0.86 },
  abyss: { fog: 0x02090e, den: 0.024, exp: 0.84 },
  chimney: { fog: 0x05161e, den: 0.04, exp: 0.94 },
};

/** 分区进入横幅文案（地图可读性：让玩家永远知道自己在哪一章） */
const ZONE_BANNER: Record<ZoneName, { cn: string; en: string }> = {
  shaft: { cn: '天光竖井', en: 'THE SHAFT' },
  gallery: { cn: '回 廊', en: 'THE GALLERY' },
  throat: { cn: '咽 喉', en: 'THE THROAT' },
  hall: { cn: '光之厅', en: 'HALL OF LIGHT' },
  halo: { cn: '卤水镜', en: 'THE HALOCLINE' },
  wreck: { cn: '沉船峡', en: 'WRECK CANYON' },
  collapse: { cn: '塌方迷宫', en: 'THE COLLAPSE' },
  abyss: { cn: '深渊大厅', en: 'THE ABYSS' },
  chimney: { cn: '荧光烟囱', en: 'GLOW CHIMNEY' },
};

export class Game {
  private q = detectQuality();
  private models = new Models();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cave: Cave;
  private landmarks: Landmarks;
  private water: WaterWorld;
  private ecology: Ecology;
  private ancient: Ancient;
  private player: Player;
  private input: InputManager;
  private hud = new Hud();
  private audio = new AudioEngine();
  private story: Story;
  private scare: Scare;

  private state: GameState = 'title';
  private phase: Phase = 'descent';
  /** story 主线 / sim 安全模拟 */
  private mode: 'story' | 'sim' = 'story';
  private sim!: SimDirector;
  private simDrain = 1;
  /** 当前模拟场景 id（复盘重试用） */
  currentSimId = -1;
  private clock = new THREE.Clock();
  private time = 0;

  // 资源与统计
  private oxygen = 100;
  private nitrogen = 0; // 氮饱和 0..100
  private maxDepth = 0;
  private tension = 0;
  private decoDone = false;
  private decoTimer = 0;
  private decoNeed = 0;

  // 粒子（marine snow）
  private particles!: THREE.Points;
  private pPos!: Float32Array;
  private pVel!: Float32Array;
  private snowDrift = -0.045;

  // 节奏计时
  private scareAt = -1;
  private bedRestored = 0;
  private hypoxiaAt = -1;
  private boardingAt = -1;
  private surfaceWarned = false;
  private introQueue: { at: number; text: string; who: string; hold: number }[] = [];
  private startedAt = 0;
  private abyssMidT: number;
  private lastSpeed = 0;
  private sightBeat = 0;
  private prevDepth = 0;
  private ascentRate = 0; // 平滑后的上升速率 m/s（正=上升）
  private ascentWarnAt = -99;
  private o2Warn50 = false;
  private o2Warn25 = false;
  private siltUntil = -1; // 搅浑水结束时刻
  private envSnap = false; // 调试跳转后雾立即归位

  // 潜伴「特奥」（支援潜水员：护送段 + 减压带汇合）
  private buddy!: Buddy;
  private buddyPathId = 0;
  private buddyT = 0.01;
  private buddyNodes: { t: number; fired: boolean; run: () => void }[] = [];
  private gazeAwaitUntil = -1; // 等待玩家看向潜伴回应气检
  private buddyDecoSpawned = false;
  private buddyDecoGreeted = false;
  private buddyDecoUpSent = false;
  private seenZones = new Set<ZoneName>();
  private seenBranches = new Set<number>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.q.tier !== 'mobile',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.q.maxDPR));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.fog = new THREE.FogExp2(0x0b2a33, 0.032);
    this.scene.background = new THREE.Color(0x030a0d);

    // 极低冷环境光：只保证岩壁剪影可读（水下层）
    this.scene.add(new THREE.HemisphereLight(0x0e2a33, 0x020608, 0.26));

    this.cave = new Cave(this.q, this.models);
    this.scene.add(this.cave.group);
    this.landmarks = new Landmarks(this.q, this.cave, this.models);
    this.scene.add(this.landmarks.group);
    this.water = new WaterWorld(this.q, this.cave, this.scene);
    this.ecology = new Ecology(this.q, this.cave, this.scene, this.models);
    this.ancient = new Ancient(this.cave, this.scene);

    const ab = this.cave.zoneRange('abyss');
    this.abyssMidT = (ab.t0 + ab.t1) / 2;

    this.input = new InputManager(canvas);
    this.player = new Player(this.scene, innerWidth / innerHeight, this.input.touch);
    this.player.setStart(this.cave, 0.012);

    this.story = new Story(this.cave);
    this.scare = new Scare(this.scene);
    this.buddy = new Buddy(this.scene);
    this.buildBuddyBeats();
    this.sim = new SimDirector(this.cave, this.player, this.buddy, this.hud, this.audio, this.scene, {
      time: () => this.time,
      o2: () => this.oxygen,
      setO2: (v) => { this.oxygen = Math.max(0, Math.min(100, v)); },
      n2: () => this.nitrogen,
      setN2: (v) => { this.nitrogen = Math.max(0, Math.min(100, v)); },
      setDrain: (m) => { this.simDrain = m; },
      silt: (s) => { this.siltUntil = this.time + s; },
      end: (pass, headline, body) => this.endSim(pass, headline, body),
    });

    this.buildParticles();

    addEventListener('resize', () => {
      this.player.camera.aspect = innerWidth / innerHeight;
      this.player.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'play') this.input.requestPointerLock();
    });

    this.renderer.setAnimationLoop(() => this.frame());

    // 调试钩子（docs/WORKFLOW.md §5）：jump/o2/n2/phase/end
    (window as unknown as { __dd: object }).__dd = {
      jump: (t: number) => {
        this.player.setStart(this.cave, Math.max(0.001, Math.min(0.999, t)));
      },
      look: (yaw: number, pitch: number) => {
        this.player.yaw = yaw;
        this.player.pitch = Math.max(-1.35, Math.min(1.35, pitch));
      },
      move: (x: number, y: number, z: number) => {
        this.player.position.set(x, y, z);
        this.player.velocity.set(0, 0, 0);
      },
      zone: (name: ZoneName, frac = 0.5) => {
        const zr = this.cave.zoneRange(name);
        this.player.setStart(this.cave, zr.t0 + (zr.t1 - zr.t0) * frac);
      },
      o2: (v: number) => {
        this.oxygen = Math.max(0, Math.min(100, v));
      },
      n2: (v: number) => {
        this.nitrogen = Math.max(0, Math.min(100, v));
      },
      phase: (p: Phase) => {
        this.phase = p;
        if (p === 'return') this.landmarks.igniteChimney();
        if (p === 'surface') this.enterSurface();
      },
      sight: () => this.beginSighting(),
      sightAt: (k: number) => {
        if (this.phase === 'descent') this.beginSighting();
        this.ancient.skipTo(k);
      },
      lookAncient: () => this.faceWorldPoint(this.ancient.group.position),
      lookWorld: (x: number, y: number, z: number) => this.faceWorldPoint(new THREE.Vector3(x, y, z)),
      mark: (name: string): number[] => {
        const marks: Record<string, THREE.Vector3> = {
          crack: this.cave.crackPoint,
          pit: this.cave.pitCenter,
          pool: this.cave.poolCenter,
          altar: this.landmarks.altarPos,
          wreck: this.landmarks.wreckPos,
          boat: this.water.boatPos,
        };
        return (marks[name] ?? this.player.position).toArray();
      },
      boat: () => this.water.boatPos.toArray(),
      silt: (seconds: number) => {
        this.siltUntil = this.time + seconds;
        if (seconds <= 0) this.envSnap = true;
      },
      state: () => ({
        state: this.state,
        phase: this.phase,
        t: this.player.curveT,
        pathId: this.player.pathId,
        pos: this.player.position.toArray().map((v) => +v.toFixed(1)),
        o2: +this.oxygen.toFixed(1),
        n2: +this.nitrogen.toFixed(1),
        zone: this.cave.zoneAt(this.player.mainT),
      }),
      fish: () => this.ecology.fishInfo(),
      buddy: () => ({
        mode: this.buddy.mode,
        pos: this.buddy.worldPos.toArray().map((v) => +v.toFixed(1)),
        gesturing: this.buddy.gesturing,
      }),
      buddyGesture: (k: BuddyGesture) => this.buddy.gesture(k),
      buddyWarp: () => {
        this.buddy.spawn(this.player.position.clone().add(new THREE.Vector3(-1.4, 0.6, 1.4)));
      },
      relics: () => `${this.story.relicsSeen}/${this.story.relicTotal}`,
      sim: (id: number) => this.startSim(id),
      simState: () => this.sim.debugState(),
      simScale: (k: number) => { this.sim.debugScale = Math.max(1, k); },
      dismissSlate: () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      },
    };
  }

  /** 调试：把视线对准世界点 */
  private faceWorldPoint(v: THREE.Vector3): void {
    const d = v.clone().sub(this.player.camera.position).normalize();
    this.player.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    this.player.yaw = Math.atan2(-d.x, -d.z);
  }

  // ---------- 潜伴「特奥」：双人洞潜协议演出 ----------
  /**
   * 护送段节拍（按主脉 t 触发）：
   * 灯语教学 → 气检互动（玩家看向他回应）→ 导览线箭头讲解 → 洞穴区界停步（stop + up）。
   * 特奥是支援潜水员：他的训练等级止步于回廊末端——玩家独潜进洞是剧情成立的前提。
   */
  private buildBuddyBeats(): void {
    const zt = (zone: ZoneName, frac: number): number => {
      const { t0, t1 } = this.cave.zoneRange(zone);
      return t0 + (t1 - t0) * frac;
    };
    const N = (t: number, run: () => void): { t: number; fired: boolean; run: () => void } =>
      ({ t, fired: false, run });
    this.buddyNodes = [
      N(zt('shaft', 0.22), () => {
        this.buddy.gesture('ok', 3.2);
        this.storyCtx.radio('特奥在你左后方，护送你到洞穴区界。\n规矩再对一遍：灯画圈=OK；灯快速横扫=注意；\n拇指向上不是"好"，是"上升"。', 9);
      }),
      N(zt('shaft', 0.62), () => {
        this.buddy.gesture('airCheck', 5);
        this.gazeAwaitUntil = this.time + 16;
        this.hud.subtitle('特奥敲了敲压力表——气检。\n看向他，回一个 OK。', '', 6.5);
      }),
      N(zt('gallery', 0.3), () => {
        const { tan } = this.cave.frameAt(0, this.player.mainT);
        this.buddy.gesture('point', 3.4, tan);
        this.hud.subtitle('特奥的灯扫过导览线上的箭头。\n箭头，永远指向最近的出口。记住它现在的朝向。', '', 7);
      }),
      N(zt('gallery', 0.9), () => {
        this.buddy.gesture('stop', 2.4);
        this.hud.subtitle('特奥打出"停"。\n然后指了指自己，又指了指上面。', '', 5.5);
      }),
      N(zt('throat', 0.04), () => {
        this.buddy.gesture('up', 3);
        this.storyCtx.radio('洞穴区界。特奥的等级到此为止——这是他的规矩，也该是你的。\n回程他会在减压带等你。……从这里开始，你是一个人了。', 9);
        window.setTimeout(() => {
          const exitPos = this.cave.pointAt(0.015).add(new THREE.Vector3(0, 1.5, 0));
          this.buddy.leave(exitPos);
        }, 3200);
      }),
    ];
  }

  /** 潜伴每帧逻辑：节拍触发、气检对视回应、隧道约束、减压带汇合 */
  private updateBuddy(dt: number): void {
    // 护送段节拍（故事模式专属；模拟模式的潜伴由 SimDirector 指挥）
    if (this.mode === 'story' && this.phase === 'descent' && this.player.pathId === 0) {
      for (const n of this.buddyNodes) {
        if (!n.fired && this.player.mainT >= n.t) {
          n.fired = true;
          n.run();
        }
      }
    }

    // 气检对视回应：玩家把视线对准特奥
    if (this.gazeAwaitUntil > 0) {
      const toBuddy = this.buddy.worldPos.clone().sub(this.player.camera.position).normalize();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.camera.quaternion);
      if (fwd.dot(toBuddy) > 0.9) {
        this.gazeAwaitUntil = -1;
        this.buddy.gesture('ok', 2.8);
        this.audio.radioBlip(0.5);
        this.hud.subtitle(`你举起压力表：${Math.round(this.oxygen)}%。\n特奥的灯画了一个圈。OK。`, '', 5.5);
      } else if (this.time > this.gazeAwaitUntil) {
        this.gazeAwaitUntil = -1;
        this.buddy.gesture('attention', 2.2);
        this.hud.subtitle('特奥的灯快速横扫了两下——注意。\n气检不是客套：水下没有"以为"。', '', 6);
      }
    }

    // 减压带汇合：回程进入浅水（荧光烟囱后段）时特奥重新出现
    if (this.phase === 'return' && !this.buddyDecoSpawned && this.player.depth < 13 &&
        this.cave.zoneAt(this.player.mainT) === 'chimney') {
      this.buddyDecoSpawned = true;
      const pc = this.cave.poolCenter;
      this.buddy.spawn(new THREE.Vector3(pc.x + 2.2, -6.0, pc.z - 1.4), 'hold');
    }
    if (this.buddyDecoSpawned && !this.buddyDecoGreeted &&
        this.buddy.worldPos.distanceTo(this.player.position) < 9) {
      this.buddyDecoGreeted = true;
      this.buddy.gesture('ok', 3.5);
      this.hud.subtitle('浅处有一盏灯，在黑暗里画了一个圈。\n特奥。他一直在等。', '', 6.5);
    }
    // 减压期间他悬停在停留带陪你；减压完成打"上升"
    if (this.buddyDecoSpawned && this.buddy.mode === 'hold') {
      const pc = this.cave.poolCenter;
      this.buddy.hold(new THREE.Vector3(pc.x + 1.6, Math.min(-4.6, this.player.position.y + 0.4), pc.z - 1.2));
      if ((this.decoDone || this.decoNeed === 0) && !this.buddyDecoUpSent && this.buddyDecoGreeted) {
        this.buddyDecoUpSent = true;
        this.buddy.gesture('up', 3);
      }
    }

    this.buddy.update(dt, this.time, this.player.position, this.player.yaw);

    // 隧道软约束（跟随/悬停时不穿岩壁；撤离时放行——他走的是"你看不见的路"）
    if (this.buddy.mode === 'follow' || this.buddy.mode === 'hold') {
      const hit = this.cave.resolve(this.buddy.position, this.buddyPathId, this.buddyT);
      this.buddyPathId = hit.pathId;
      this.buddyT = hit.t;
      const maxR = hit.radius - 0.5;
      const radial = this.buddy.position.clone().sub(hit.center);
      const len = radial.length();
      if (len > maxR && maxR > 0) {
        this.buddy.position.copy(hit.center).addScaledVector(radial.multiplyScalar(1 / len), maxR);
        this.buddy.group.position.copy(this.buddy.position);
      }
    }
  }

  /** 分区横幅 + 支线横幅（每处只提示一次） */
  private updateZoneBanner(): void {
    if (this.player.pathId !== 0) {
      if (!this.seenBranches.has(this.player.pathId)) {
        this.seenBranches.add(this.player.pathId);
        if (this.player.pathId === 1) this.hud.zoneBanner('祭坛支线', 'SIDE PASSAGE · ALTAR');
        else this.hud.zoneBanner('岔路 · 白线', 'SIDE PASSAGE · UNKNOWN LINE');
      }
      return;
    }
    const zone = this.cave.zoneAt(this.player.mainT);
    if (!this.seenZones.has(zone)) {
      this.seenZones.add(zone);
      const b = ZONE_BANNER[zone];
      this.hud.zoneBanner(b.cn, `${b.en} · −${Math.max(1, Math.round(this.player.depth))}M`);
    }
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
    this.player.lightOn(40);
    this.state = 'play';
    this.phase = 'descent';
    this.startedAt = this.time;
    // 潜伴特奥：从入水点开始护送
    this.buddy.spawn(this.player.position.clone().add(new THREE.Vector3(-1.3, 0.9, 1.2)));
    this.introQueue = [
      { at: this.time + 1.2, text: '尤卡坦半岛 · 天坑「寂静之井」\n萝拉·卡尔最后一次被目击的位置。', who: '案件档案 № 044', hold: 6 },
      { at: this.time + 8.4, text: '委托：找回她——或者找回答案。', who: '案件档案 № 044', hold: 5 },
    ];
  }

  restart(): void {
    location.reload();
  }

  /** 洞潜安全模拟：进入指定训练场景 */
  startSim(id: number): void {
    if (this.state !== 'title') return;
    this.audio.init();
    this.hud.hideTitle();
    this.hud.showHud();
    this.input.enable();
    this.input.requestPointerLock();
    this.player.lightOn(40);
    this.state = 'play';
    this.phase = 'descent';
    this.mode = 'sim';
    this.currentSimId = id;
    this.startedAt = this.time;
    this.envSnap = true;
    this.sim.start(id);
  }

  /** 模拟结束：冻结输入，弹出教学复盘 */
  private endSim(pass: boolean, headline: string, body: string): void {
    this.state = 'ended';
    this.input.disable();
    this.hud.hideDeco();
    this.hud.setGuide(null);
    this.hud.clearSubtitle();
    this.audio.duckBed(0.25, 2);
    this.hud.showDebrief(pass, SIM_SPECS[this.currentSimId].code, headline, body);
    document.exitPointerLock?.();
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
      const meta = Story.tankMeta(this.story.tankIndex(prop));
      if (!meta.empty) {
        this.oxygen = Math.min(100, this.oxygen + TANK_REFILL);
        this.audio.tankPickup();
      } else {
        // 空瓶：只有金属叩击，没有换气阀的嘶声——那声空响本身就是线索
        this.audio.radioBlip(0.4);
        this.tension = Math.max(this.tension, 0.5);
      }
      this.hud.subtitle(meta.text, '', 6.5);
    },
    silenceBegins: () => this.audio.duckBed(0.04, 9),
    scare: () => {
      this.scare.trigger(this.cave, this.player, this.audio);
      this.scareAt = this.time;
    },
    siltOut: (seconds: number) => {
      this.siltUntil = this.time + seconds;
      this.tension = Math.max(this.tension, 0.6);
      this.audio.duckBed(0.4, 3);
      this.audio.ancientCall(0.3); // 扫过船底的"什么东西"——远处的低频（伏笔）
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
      case 'ended':
        break;
    }

    this.water.update(dt, this.time);
    this.landmarks.update(this.time);
    this.ecology.update(
      dt,
      this.time,
      this.state === 'title' ? this.player.camera.position : this.player.position,
      this.lastSpeed,
    );
    const sightProg = this.ancient.update(dt, this.time, this.player.position);
    if (this.state === 'play' && this.phase === 'sighting') this.sightingBeats(sightProg);
    this.cullZoneLights();
    this.renderer.render(this.scene, this.player.camera);
  }

  /** 区域点光按距离启停（全场活跃点光受控） */
  private cullZoneLights(): void {
    const p = this.player.camera.position;
    for (const l of this.cave.zoneLights) {
      l.visible = l.position.distanceToSquared(p) < 48 * 48;
    }
    // 道具辉光半径只有 2~3m，26m 外直接关灯
    for (const l of this.cave.propLights) {
      let wp = l.userData.wp as THREE.Vector3 | undefined;
      if (!wp) {
        wp = l.getWorldPosition(new THREE.Vector3());
        l.userData.wp = wp;
      }
      l.visible = wp.distanceToSquared(p) < 26 * 26;
    }
  }

  /** 标题首屏（英雄机位）：井轴 8m 深处定点仰望 Snell 窗——船底剪影恰好悬在阳光爆点上，光柱簇+鱼群绕柱 */
  private titleIdle(dt: number): void {
    const pc = this.cave.poolCenter;
    this.player.camera.position.set(
      pc.x - 0.4 + Math.sin(this.time * 0.06) * 0.3,
      -10.2 + Math.sin(this.time * 0.09) * 0.35,
      pc.z + 3.6 + Math.cos(this.time * 0.055) * 0.3,
    );
    const look = new THREE.Vector3(
      pc.x + this.water.sunDir.x * 2.6 + Math.sin(this.time * 0.05) * 0.5,
      3.0,
      pc.z + this.water.sunDir.z * 2.6 + Math.cos(this.time * 0.045) * 0.5,
    );
    this.player.camera.lookAt(look);
    this.player.camera.rotation.z += Math.sin(this.time * 0.045) * 0.01;
    this.updateParticles(dt, this.player.camera.position);
    this.audio.update(dt, { oxygen01: 1, depth01: 0.1, sprinting: false });
  }

  private playFrame(dt: number): void {
    while (this.mode === 'story' && this.introQueue.length && this.time >= this.introQueue[0].at) {
      const s = this.introQueue.shift()!;
      this.hud.subtitle(s.text, s.who, s.hold);
    }

    const reading = this.hud.slateOpen;
    const scareActive = this.scare.update(dt, this.player);

    if (reading) {
      this.input.moveX = 0;
      this.input.moveZ = 0;
    }
    const { speed } = this.player.update(dt, this.input, this.cave, this.time);
    this.lastSpeed = speed;

    // ---- 氧气 ----
    if (!reading && this.phase !== 'surface' && this.phase !== 'boarding') {
      const drain = O2_DRAIN * (this.mode === 'sim' ? this.simDrain : 1) *
        (this.input.sprint && speed > 0.5 ? SPRINT_MULT : 1);
      this.oxygen = Math.max(0, this.oxygen - drain * dt);
    }
    const depth = this.player.depth;
    this.maxDepth = Math.max(this.maxDepth, depth);
    this.hud.setOxygen(this.oxygen / 100);
    this.hud.setDepth(depth);

    // ---- 氮饱和（轻度机制，见 GDD §4.2）：47m 处约 12%/分钟 ----
    if (depth > 18) this.nitrogen = Math.min(100, this.nitrogen + ((depth - 18) / 32) * 0.22 * dt);
    else if (depth < 10) this.nitrogen = Math.max(0, this.nitrogen - 0.9 * dt);
    this.hud.setNitrogen(this.nitrogen / 100);

    // ---- 上升速率监控（气泡比你慢——潜水员铁律；SIM-05 有自己的版本） ----
    const rawRate = dt > 0 ? (this.prevDepth - depth) / dt : 0;
    this.prevDepth = depth;
    this.ascentRate += (rawRate - this.ascentRate) * Math.min(1, dt * 3);
    if (
      this.mode === 'story' &&
      this.ascentRate > 2.3 && depth > 8 && this.nitrogen > 30 &&
      this.time - this.ascentWarnAt > 10
    ) {
      this.ascentWarnAt = this.time;
      this.nitrogen = Math.min(100, this.nitrogen + 4);
      this.audio.radioBlip(0.5);
      this.hud.subtitle('上升太快了。别超过你呼出的气泡。\n慢下来。', '潜水电脑', 4.5);
    }

    // ---- 气量三分法警报 ----
    if (this.mode === 'story' && !this.o2Warn50 && this.oxygen < 50 && this.phase === 'descent') {
      this.o2Warn50 = true;
      this.storyCtx.radio('气压表过半了。按三分法你现在就该回头。\n……继续。备用瓶都在线上，我给你标了位置。', 7.5);
    }
    if (this.mode === 'story' && !this.o2Warn25 && this.oxygen < 25) {
      this.o2Warn25 = true;
      this.tension = Math.max(this.tension, 0.55);
      this.hud.subtitle('气压表指针进入红区。\n每一口都开始有了重量。', '', 6);
    }

    // ---- 阶段推进（故事）/ 场景导演（模拟） ----
    if (this.mode === 'story') this.updatePhase(dt);
    else this.sim.update(dt);

    // ---- 潜伴与分区横幅 ----
    this.updateBuddy(dt);
    this.updateZoneBanner();

    // ---- 导览线罗盘 ----
    this.updateGuide();

    // ---- 分区雾与曝光 ----
    this.updateEnvironment(dt, depth);

    // ---- 心跳张力 ----
    const o2 = this.oxygen / 100;
    const base = o2 < 0.3 ? Math.min(0.85, (0.3 - o2) * 3) : 0;
    this.tension = Math.max(base, this.tension - dt * 0.07);
    if (scareActive) this.tension = 0.95;
    this.audio.setTension(this.tension);
    this.hud.setHypoxiaVignette(o2 < 0.12 && o2 > 0);

    // ---- 惊吓余韵 ----
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

    if (this.mode === 'story' && (this.phase === 'descent' || this.phase === 'return')) {
      this.story.update(this.player.mainT, this.player.position, this.storyCtx);
    }
    this.updateParticles(dt, this.player.position);
    const depth01 = Math.min(1, depth / 50);
    this.audio.update(dt, {
      oxygen01: o2,
      depth01,
      sprinting: this.input.sprint,
      above: this.phase === 'surface' || this.phase === 'boarding',
    });

    // ---- 缺氧结局（模拟模式由 SimDirector 的安全网接管） ----
    if (this.mode === 'story' && this.oxygen <= 0 && this.phase !== 'surface' && this.phase !== 'boarding') {
      this.enterHypoxia();
    }
  }

  /** 阶段机：下潜 → 目击（Loop C 接管）→ 回程 → 破水面 → 登船 */
  private updatePhase(dt: number): void {
    const p = this.player;
    switch (this.phase) {
      case 'descent': {
        // 早期上浮压制：涌浪 + M 的说辞
        if (p.position.y > -2.4 && p.pathId === 0 && p.mainT < 0.05) {
          p.velocity.y -= 3.2 * dt;
          if (!this.surfaceWarned) {
            this.surfaceWarned = true;
            this.storyCtx.radio('别浮上来。风暴锋面正在过境，水面全是涌浪。\n往下走。她在下面。', 6.5);
          }
        }
        // 抵达深渊大厅中心 → 奇虾目击演出
        if (this.cave.zoneAt(p.mainT) === 'abyss' && Math.abs(p.mainT - this.abyssMidT) < 0.02) {
          this.beginSighting();
        }
        break;
      }
      case 'sighting':
        break; // 节拍由 sightingBeats() 驱动
      case 'return': {
        // 减压停留：-7.5~-3.5m 深度带计时；面板在接近停留带时出现
        const depth = p.depth;
        if (this.decoNeed > 0 && !this.decoDone) {
          const inWindow = depth < 7.5 && depth > 3.5;
          if (inWindow) {
            this.decoTimer += dt;
            if (this.decoTimer >= this.decoNeed) {
              this.decoDone = true;
              this.hud.hideDeco();
              this.hud.subtitle('减压完成。潜水电脑不再尖叫。\n上面的光很近了。', '', 5);
            }
          }
          if (!this.decoDone) {
            if (depth < 16) this.hud.setDeco(this.decoNeed - this.decoTimer, inWindow);
            else this.hud.hideDeco();
          }
        }
        // 破水面
        if (p.position.y > -0.15) this.enterSurface();
        break;
      }
      case 'surface': {
        // 游向支援船
        const d = p.position.distanceTo(this.water.boatPos);
        if (d < 2.1) this.beginBoarding();
        break;
      }
      case 'boarding':
        this.boardingFrame(dt);
        break;
    }
  }

  /**
   * 导览线罗盘：
   * - 主脉：沿行进方向（闭环 t 递增——下潜与回程同向）。
   * - 支线下潜段：指向支线深处（错绳陷阱正是靠这一点成立）；回程段指回主线。
   * - 塌方区：主线被割断——断线状态（Loop E 的 silt-out 一并使用）。
   * - 水面：指向支援船。
   */
  private updateGuide(): void {
    const p = this.player;
    if (this.phase === 'boarding') {
      this.hud.setGuide(null);
      return;
    }
    // 模拟场景可关闭罗盘（错箭头/失散：决策必须自己做）
    if (this.mode === 'sim' && !this.sim.wantGuide()) {
      this.hud.setGuide(null);
      return;
    }
    let dir: THREE.Vector3;
    let label = '导览线';
    let offline = false;
    if (this.phase === 'surface') {
      dir = this.water.boatPos.clone().sub(p.position);
      dir.y = 0;
      label = '支援船';
    } else if (p.pathId !== 0) {
      const { tan } = this.cave.frameAt(p.pathId, p.curveT);
      const outbound = this.phase === 'descent';
      dir = outbound ? tan : tan.negate();
      label = outbound ? '导览线' : '导览线 · 回主线';
    } else {
      const zone = this.cave.zoneAt(p.mainT);
      if (zone === 'collapse' && this.phase === 'descent') {
        this.hud.setGuide(0, 0, '线断了 · 沿岩缝走', true);
        return;
      }
      const { tan } = this.cave.frameAt(0, p.mainT);
      dir = tan;
      offline = false;
      if (this.time < this.siltUntil) label = '白雾 · 握住线';
    }
    if (dir.lengthSq() < 1e-6) {
      this.hud.setGuide(null);
      return;
    }
    dir.normalize();
    const vert = dir.y;
    const dirYaw = Math.atan2(-dir.x, -dir.z);
    let rel = dirYaw - p.yaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    this.hud.setGuide(rel, vert, label, offline);
  }

  /** 目击开场：水体异动 + 奇虾从深井升起（docs/GAME_DESIGN.md §3.1） */
  private beginSighting(): void {
    if (this.phase !== 'descent') return;
    this.phase = 'sighting';
    this.sightBeat = 0;
    this.ancient.play();
    this.audio.duckBed(0.12, 4);
    this.audio.ancientCall(1);
    this.tension = 0.7;
    this.hud.subtitle('水在动。\n整个大厅的水都在往深井那边退。', '', 6);
  }

  /** 目击演出节拍（prog 由 Ancient.update 返回） */
  private sightingBeats(prog: number): void {
    if (prog < 0) return;
    if (this.sightBeat === 0 && prog > 0.14) {
      this.sightBeat = 1;
      this.tension = Math.max(this.tension, 0.82);
      this.hud.subtitle('有东西从井里升上来。\n它比支援船还要长。', '', 6.5);
    } else if (this.sightBeat === 1 && prog > 0.42) {
      this.sightBeat = 2;
      this.tension = 0.95;
      this.audio.ancientCall(0.7);
      this.hud.subtitle('柄状的眼睛转了过来。\n它看见你了。它看了很久。', '', 6);
    } else if (this.sightBeat === 2 && prog > 0.68) {
      this.sightBeat = 3;
      this.hud.subtitle('然后它失去了兴趣。\n在它的五亿年里，你只是一粒会发光的浮游生物。', '', 7);
    } else if (this.sightBeat === 3 && prog >= 1) {
      this.sightBeat = 4;
      this.finishSighting();
    }
  }

  /** 目击结束 → 回程：点亮荧光烟囱标，计算减压需求 */
  private finishSighting(): void {
    this.phase = 'return';
    this.landmarks.igniteChimney();
    this.audio.duckBed(1, 8);
    // 氮饱和超过阈值才需要减压停留（轻度机制）
    this.decoNeed = this.nitrogen > 25 ? Math.min(45, Math.max(20, this.nitrogen * 0.55)) : 0;
    this.hud.subtitle('大厅另一侧的岩壁上，一排蓝绿色的荧光标亮了。\n那是回家的路。', '', 7);
    this.storyCtx.radio('……信号恢复了。我不知道你刚才看见了什么，我也不想知道。\n沿荧光标上升。慢一点——你还有减压要做。', 8);
  }

  private enterSurface(): void {
    if (this.phase === 'surface' || this.phase === 'boarding') return;
    this.phase = 'surface';
    this.player.surfaceMode = true;
    this.player.lightOn(5); // 晨光下手电收暗，不再把船体照成白斑
    this.audio.breach();
    // 特奥先行回船（他的灯在水下朝船移动）
    if (this.buddy.mode !== 'hidden') {
      this.buddy.leave(this.water.boatPos.clone().add(new THREE.Vector3(0, -1.2, 0)));
    }
    this.hud.subtitle('空气。真实的、带着丛林潮气的空气。\n支援船就在那里。', '', 6);
  }

  private beginBoarding(): void {
    this.phase = 'boarding';
    this.boardingAt = this.time;
    this.input.disable();
    this.audio.duckBed(0.2, 3);
  }

  private boardingFrame(dt: number): void {
    void dt;
    const k = Math.min(1, (this.time - this.boardingAt) / 4.5);
    const s = k * k * (3 - 2 * k);
    const from = this.player.position.clone();
    const deck = this.water.boatPos.clone().add(new THREE.Vector3(0, 1.7, -0.6));
    this.player.camera.position.lerpVectors(from, deck, s * 0.12); // 每帧渐进
    this.player.position.copy(this.player.camera.position);
    // 看向井口
    const target = new THREE.Vector3(this.cave.poolCenter.x - 2, 0.4, this.cave.poolCenter.z - 2);
    const m = new THREE.Matrix4().lookAt(this.player.camera.position, target, new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    this.player.camera.quaternion.slerp(q, 0.04);

    if (k >= 1) this.endDawn();
  }

  /** 结局 E1「破晓」/ E2「血里的针」（Loop D 完善变体） */
  private endDawn(): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.hud.fade(true);
    this.audio.fadeOutAll(3.5);
    const bends = !this.decoDone && this.decoNeed > 18;
    const timeStr = ((this.time - this.startedAt) / 60).toFixed(1);
    const slates = this.story.slatesFound;
    setTimeout(() => {
      this.hud.hideHud();
      if (bends) {
        this.hud.showEnding(
          'bends',
          '你趴在船板上，关节里有细小的针。\n咳出的泡沫在晨光里是粉红色的。\n你把深渊带上来了一点。',
          `最大深度 -${this.maxDepth.toFixed(1)}M · 用时 ${timeStr} 分钟 · 写字板 ${slates}/${this.story.slateTotal} · 观察 ${this.story.relicsSeen}/${this.story.relicTotal}\n结局：血里的针（跳过了减压停留）`,
        );
      } else {
        this.hud.showEnding(
          'dawn',
          '太阳正从丛林线上升起来。\n你看见过它照不到的地方，\n以及在那里等了五亿年的东西。',
          `最大深度 -${this.maxDepth.toFixed(1)}M · 用时 ${timeStr} 分钟 · 写字板 ${slates}/${this.story.slateTotal} · 观察 ${this.story.relicsSeen}/${this.story.relicTotal}\n结局：破晓`,
        );
      }
      document.exitPointerLock?.();
    }, 2600);
  }

  /** 分区雾/曝光/卤水层 */
  private updateEnvironment(dt: number, depth: number): void {
    const fog = this.scene.fog as THREE.FogExp2;
    let target = ZONE_ENV[this.cave.zoneAt(this.player.mainT)];
    // 支线沿用所属大区的雾
    if (this.player.pathId === 1) target = ZONE_ENV.wreck;
    if (this.player.pathId === 2) target = ZONE_ENV.collapse;

    let fogColor = new THREE.Color(target.fog);
    let den = target.den;
    let exp = target.exp;

    // 卤水层下方：硫化氢浊水
    const inHalo =
      this.player.position.y < this.landmarks.haloPlaneY + 0.3 &&
      this.player.position.distanceTo(this.landmarks.haloCenter) < this.landmarks.haloRadius;
    if (inHalo) {
      fogColor = new THREE.Color(0x25301e);
      den = 0.085;
      exp = 0.82;
    }
    // 搅浑水 silt-out：白雾吞掉能见度，尾段 6s 缓慢散开
    if (this.time < this.siltUntil) {
      const left = this.siltUntil - this.time;
      const k2 = Math.min(1, left / 6);
      fogColor.lerp(new THREE.Color(0x4a4438), 0.85 * k2);
      den = den + (0.24 - den) * k2;
      exp = exp - 0.1 * k2;
    }
    // 水面之上：清晨空气
    if (this.phase === 'surface' || this.phase === 'boarding' || this.player.position.y > -0.1) {
      fogColor = new THREE.Color(0x14212a);
      den = 0.004;
      exp = 1.05;
    }

    const k = this.envSnap ? 1 : Math.min(1, dt * 1.4);
    this.envSnap = false;
    fog.color.lerp(fogColor, k);
    fog.density += (den - fog.density) * k;
    (this.scene.background as THREE.Color).copy(fog.color).multiplyScalar(0.5);
    this.renderer.toneMappingExposure += (exp - this.renderer.toneMappingExposure) * k;
    void depth;
  }

  // ---------- 结局 E3 ·「浅睡」（缺氧下沉） ----------
  private enterHypoxia(): void {
    this.state = 'hypoxia';
    this.hypoxiaAt = this.time;
    this.hud.setHypoxiaVignette(true);
    this.hud.clearSubtitle();
    this.hud.setGuide(null);
    this.hud.hideDeco();
    this.snowDrift = 0.5; // 你在下沉——"雪"在往上飘
    this.audio.duckBed(0.15, 6);
    this.hud.subtitle('手电的光越来越暖。\n像很久以前某盏你熟悉的灯。', '', 8);
  }

  private hypoxiaFrame(dt: number): void {
    const since = this.time - this.hypoxiaAt;
    const k = Math.min(1, since / 13);
    this.player.control = 1 - k * 0.85;
    // 身体下沉：负浮力失控
    this.player.velocity.y -= 0.35 * k * dt;
    this.player.update(dt, this.input, this.cave, this.time);
    this.player.flashlight.color.lerpColors(new THREE.Color(0xffd9a0), new THREE.Color(0xffe9cf), k);
    this.player.flashlight.intensity = 40 + k * 28;
    this.player.flashlight.angle = 0.48 + k * 0.3;
    this.hud.setOxygen(0);
    this.hud.setDepth(this.player.depth);
    this.tension = Math.max(0.15, 0.9 - k);
    this.audio.setTension(since > 11 ? 0 : this.tension);
    this.audio.update(dt, { oxygen01: 0, depth01: 1, sprinting: false, muffle01: k });
    this.updateParticles(dt, this.player.position);
    this.water.update(dt, this.time);

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
}
