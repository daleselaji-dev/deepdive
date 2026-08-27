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
import { PlayerBody } from './PlayerBody';
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
  hall: { fog: 0x04161a, den: 0.028, exp: 1.04 },
  halo: { fog: 0x0a1d1c, den: 0.05, exp: 0.9 },
  wreck: { fog: 0x061418, den: 0.044, exp: 0.9 },
  collapse: { fog: 0x040f13, den: 0.062, exp: 0.86 },
  abyss: { fog: 0x02090e, den: 0.024, exp: 0.88 },
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

/** M4-L6 自然观察手记：靠近某类生物首次触发的一次性教学字幕（生态互动+科学诚实口吻） */
const NATURE_NOTES: {
  key: string;
  group: 'school' | 'blind' | 'cruisers' | 'crayfish' | 'remipedes' | 'jellies' | 'bats';
  dist: number;
  text: string;
}[] = [
  { key: 'school', group: 'school', dist: 7, text: '银汉鱼群。它们只住在有光的水层——\n再往下，光和它们都会一起消失。' },
  { key: 'cruiser', group: 'cruisers', dist: 5, text: '一条独游的大鱼。海鲢会沿暗河缝隙进出天坑上层，\n把这里当作安静的食堂。' },
  { key: 'blind', group: 'blind', dist: 3.5, text: '尤卡坦盲鳚。终生的黑暗拿走了眼睛和色素，\n只留下侧线里的一张水压地图。' },
  { key: 'crayfish', group: 'crayfish', dist: 2.6, text: '洞穴盲螯虾。苍白、缓慢、几乎透明——\n在没有季节的水里，它们能活几十年。' },
  { key: 'remipede', group: 'remipedes', dist: 3, text: '桨足类。盲眼的深层猎手，只住在海水入侵的洞穴水体，\n1979 年人类才第一次见到它们。' },
  { key: 'jelly', group: 'jellies', dist: 3.5, text: '水螅水母。掌心大小的半透明伞体，随卤下水团漂移——\n淡水层里看不到它们。' },
  { key: 'bat', group: 'bats', dist: 5, text: '蝙蝠群。它们的粪便是这座洞穴无脊椎食物网的能量来源——\n这个气穴是它们的家，不是出口。' },
];

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

  // M4-L4 分区氛围：气穴空气段 / 深区远处闷响 / 滴水声景
  private inAirPocket = false;
  private airPocketTold = false;
  private nextDripAt = 0;
  private nextRumbleAt = 45;

  // M4-L6 自然观察手记（M5-L4 升级为准星注视观察）
  private noteTimer = 0;
  private notesSeen = new Set<string>();
  private gazeNoteKey: string | null = null;
  private gazeNoteAcc = 0;
  private gazeCandidate: { key: string; pos: THREE.Vector3 } | null = null;

  // M5-L4 生态可交互：光束缓存 / 气泡帘冷却 / 卤水搅动
  private beamPos = new THREE.Vector3();
  private beamDir = new THREE.Vector3(0, 0, -1);
  /** 相机实时朝向（准星判定用——beamDir 带手持惯性，注视判定用它会慢半拍） */
  private camFwd = new THREE.Vector3(0, 0, -1);
  private ventCoolAt = 0;
  private ventTold = false;
  private ventCross = 0;
  private haloStirTold = false;
  private haloStirs = 0;
  private prevY = 0;
  private relicPrompt: string | null = null;

  // M4-L5 自适应降档：低帧持续 → 阶梯降 DPR；富余持续 → 缓慢回升
  private fpsEma = 60;
  private dprScale = 1;
  private dprLowT = 0;
  private dprHighT = 0;
  private adaptOn = true;
  private lightRank: { l: THREE.PointLight; d2: number }[] = [];

  // M5-L3 玩家第一人称身体（持灯手臂/腕表电脑/呼吸气泡）
  private body!: PlayerBody;
  private buddySlowAt = -99;

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
    this.body = new PlayerBody(this.scene, this.player.lightRig, particleSprite());
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

    // 调试钩子（docs/WORKFLOW.md §5）：help() 打印全表
    (window as unknown as { __dd: object }).__dd = {
      help: (): Record<string, string> => ({
        'tp(name)': '传送：分区 shaft/gallery/throat/hall/halo/wreck/collapse/abyss/chimney；支线 altar/fakeline/bat/bypass；地标 pit/crack/wrk',
        'eco(g?)': "生态开关：'fish'|'blind'|'cruisers'|'plankton'|'jellies'|'vents'|'remipedes'|'crayfish'|'amphipods'|'bats'|省略=整层",
        'creature(n,i)': "生态个体坐标：'remipedes'|'crayfish'|'jellies'|'bats'|'blind'|'cruisers'",
        'perf()': '性能 HUD 开关（FPS/drawcall/三角形/活跃灯数）',
        'stats()/adapt(on)': '性能指标快照 / 自适应 DPR 开关（截图脚本应关）',
        'pick()': '准星射线：命中对象层级/距离/世界坐标',
        'scan()': '全管道巡检：破面/透天射线复验 + 通路阻塞 + 道具可达性（M5-L1）',
        'jump(t)/zone(n,f)': '主脉进度传送 / 分区比例传送',
        'look(yaw,pitch)/lookWorld(xyz)/lookAncient()': '视角控制',
        'move(x,y,z)': '直接移动（含支线，自动吸附路径）',
        'o2(v)/n2(v)/phase(p)': '氧气/氮气/阶段',
        'sight()/sightAt(k)': '远古目击触发/跳节点',
        'silt(s)': '搅浑水 s 秒（0=立即恢复）',
        'state()/fish()/buddy()/relics()/simState()': '状态查询',
        'notes()/report()': '自然手记进度 / 本次运行复盘（深度/资源/收集/到访分区）',
        'sim(id)/simScale(k)': '安全模拟关启动/时间缩放',
        'buddyGesture(k)/buddyWarp()': '潜伴手势/瞬移到身边',
        'mark(name)/boat()': '地标坐标查询',
      }),
      tp: (name: string): string => {
        const zones = ['shaft', 'gallery', 'throat', 'hall', 'halo', 'wreck', 'collapse', 'abyss', 'chimney'];
        if (zones.includes(name)) {
          const zr = this.cave.zoneRange(name as ZoneName);
          this.player.setStart(this.cave, zr.t0 + (zr.t1 - zr.t0) * 0.5);
          return `→ 分区 ${name}`;
        }
        // 支线传送：直接落到支线轴上，resolve 会吸附 pathId
        const stubSpots: Record<string, [number, number]> = {
          altar: [1, 0.7], fakeline: [2, 0.8], bat: [3, 0.82], bypass: [4, 0.5],
        };
        const spot = stubSpots[name];
        if (spot) {
          const { p } = this.cave.frameAt(spot[0], spot[1]);
          this.player.position.copy(p);
          this.player.velocity.set(0, 0, 0);
          this.player.pathId = spot[0];
          this.player.curveT = spot[1];
          return `→ 支线 ${name}`;
        }
        const marks: Record<string, THREE.Vector3> = {
          pit: this.cave.pitCenter, crack: this.cave.crackPoint, wrk: this.landmarks.wreckPos,
        };
        if (marks[name]) {
          this.player.position.copy(marks[name]).y += 1.2;
          this.player.velocity.set(0, 0, 0);
          return `→ 地标 ${name}`;
        }
        return '未知目标：见 __dd.help()';
      },
      eco: (g?: Parameters<Ecology['toggle']>[0]) => this.ecology.toggle(g),
      perf: () => this.togglePerf(),
      stats: () => {
        let zOn = 0, pOn = 0;
        for (const l of this.cave.zoneLights) if (l.visible) zOn++;
        for (const l of this.cave.propLights) if (l.visible) pOn++;
        return {
          fps: +this.fpsEma.toFixed(1),
          calls: this.renderer.info.render.calls,
          tris: this.renderer.info.render.triangles,
          geos: this.renderer.info.memory.geometries,
          tex: this.renderer.info.memory.textures,
          lightsOn: zOn + pOn,
          lightsTotal: this.cave.zoneLights.length + this.cave.propLights.length,
          dpr: +this.renderer.getPixelRatio().toFixed(2),
          dprScale: +this.dprScale.toFixed(2),
        };
      },
      adapt: (on: boolean) => {
        this.adaptOn = on;
        if (!on) {
          this.dprScale = 1;
          this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.q.maxDPR));
        }
        return `adaptive DPR ${on ? 'on' : 'off'}`;
      },
      pick: (): { chain: string; geo: string; color: string; dist: number; point: number[] } | null => {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(0, 0), this.player.camera);
        // 跳过粒子/精灵/透明体积（浮游云、光柱会截胡射线，拾取它们几乎从不是本意）
        const h = rc.intersectObjects(this.scene.children, true)
          .find((x) => {
            if (x.object instanceof THREE.Points || x.object instanceof THREE.Sprite) return false;
            const m = (x.object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
            const mm = Array.isArray(m) ? m[0] : m;
            return !(mm && mm.transparent);
          });
        if (!h) return null;
        const chain: string[] = [];
        let p: THREE.Object3D | null = h.object;
        while (p) { chain.push(p.name || p.type); p = p.parent; }
        const mesh = h.object as THREE.Mesh;
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
        return {
          chain: chain.join(' < '),
          geo: mesh.geometry?.type ?? '?',
          color: mat?.color ? `#${mat.color.getHexString()}` : '?',
          dist: +h.distance.toFixed(2),
          point: h.point.toArray().map((v) => +v.toFixed(1)),
        };
      },
      jump: (t: number) => {
        this.player.setStart(this.cave, Math.max(0.001, Math.min(0.999, t)));
      },
      /** 任意两点射线探测：返回首个不透明命中（机位勘察/穿帮排查用） */
      ray: (ox: number, oy: number, oz: number, tx: number, ty: number, tz: number):
        { dist: number; point: number[]; geo: string } | null => {
        const o = new THREE.Vector3(ox, oy, oz);
        const d = new THREE.Vector3(tx, ty, tz).sub(o);
        const len = d.length();
        const rc = new THREE.Raycaster(o, d.normalize(), 0.01, len);
        rc.camera = this.player.camera; // Sprite.raycast 需要相机引用，缺了会空指针
        const h = rc.intersectObjects(this.scene.children, true)
          .find((x) => {
            if (x.object instanceof THREE.Points || x.object instanceof THREE.Sprite) return false;
            const m = (x.object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
            const mm = Array.isArray(m) ? m[0] : m;
            return !(mm && mm.transparent);
          });
        if (!h) return null;
        return {
          dist: +h.distance.toFixed(2),
          point: h.point.toArray().map((v) => +v.toFixed(2)),
          geo: (h.object as THREE.Mesh).geometry?.type ?? '?',
        };
      },
      scan: () => this.runScan(),
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
          organ: this.landmarks.organPos,
          arch: this.landmarks.archPos,
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
      vents: () => this.ecology.ventInfo(),
      gaze: () => ({
        key: this.gazeNoteKey,
        acc: +this.gazeNoteAcc.toFixed(2),
        cand: this.gazeCandidate?.key ?? null,
        beam: this.beamDir.toArray().map((v) => +v.toFixed(2)),
        ventCross: this.ventCross,
        haloStirs: this.haloStirs,
      }),
      relicPos: (i: number) => this.story.relicPos(i),
      creature: (n: Parameters<Ecology['probe']>[0], i = 0) => this.ecology.probe(n, i),
      creatureNear: (n: Parameters<Ecology['probe']>[0]) =>
        this.ecology.probeNearest(n, this.player.position),
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
      notes: () => `${this.notesSeen.size}/${NATURE_NOTES.length}: ${Array.from(this.notesSeen).join(',')}`,
      report: () => ({
        mode: this.mode,
        phase: this.phase,
        minutes: +((this.time - this.startedAt) / 60).toFixed(1),
        maxDepth: +this.maxDepth.toFixed(1),
        o2: +this.oxygen.toFixed(1),
        n2: +this.nitrogen.toFixed(1),
        slates: `${this.story.slatesFound}/${this.story.slateTotal}`,
        relics: `${this.story.relicsSeen}/${this.story.relicTotal}`,
        notes: `${this.notesSeen.size}/${NATURE_NOTES.length}`,
        zonesVisited: Array.from(this.seenZones),
        branchesVisited: Array.from(this.seenBranches),
        decoDone: this.decoDone,
      }),
      sim: (id: number) => this.startSim(id),
      simState: () => this.sim.debugState(),
      simScale: (k: number) => { this.sim.debugScale = Math.max(1, k); },
      dismissSlate: () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
      },
    };
  }

  /**
   * M5-L1 全管道巡检（§3.11）：
   * A) 镂空审计——接缝去重/支线洞口的镂空四边形，穿洞射线必须命中另一侧岩壁，
   *    否则就是透天/破面（天窗水柱/深井/裂隙方向白名单）；
   * B) 通路阻塞——沿每条路径轴向逐段射线，游泳走廊必须畅通；
   * C) 道具可达性——触发球必须与玩家软约束可达区相交，否则交互失效。
   */
  private runScan(): { critical: string[]; warn: string[]; holesChecked: number; raysUsed: number } {
    const critical: string[] = [];
    const warn: string[] = [];
    const targets: THREE.Object3D[] = [this.cave.group, this.landmarks.group];
    const rc = new THREE.Raycaster();
    rc.camera = this.player.camera; // Sprite.raycast 需要相机引用
    const opaqueHit = (o: THREE.Vector3, d: THREE.Vector3, far: number): { d: number; what: string } => {
      rc.set(o, d);
      rc.near = 0.01;
      rc.far = far;
      const hits = rc.intersectObjects(targets, true);
      for (const x of hits) {
        if (x.object instanceof THREE.Points || x.object instanceof THREE.Sprite) continue;
        const m = (x.object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        const mm = Array.isArray(m) ? m[0] : m;
        if (mm && mm.transparent) continue;
        return { d: x.distance, what: x.object.name || (x.object as THREE.Mesh).geometry?.type || '?' };
      }
      return { d: -1, what: '' };
    };

    // ---- A) 镂空审计（1.6m 网格去重：相邻四边形只验一次） ----
    const seen = new Set<string>();
    const pool = this.cave.poolCenter;
    let holesChecked = 0;
    let raysUsed = 0;
    for (const rec of this.cave.skipAudit) {
      const key = `${Math.round(rec.c.x / 1.6)},${Math.round(rec.c.y / 1.6)},${Math.round(rec.c.z / 1.6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      holesChecked++;
      const { p } = this.cave.frameAt(rec.pathId, rec.t);
      const dir = rec.c.clone().sub(p);
      const inDist = dir.length();
      if (inDist < 1e-4) continue;
      dir.multiplyScalar(1 / inDist);
      const far = inDist + Math.max(30, this.cave.paths[rec.pathId].radiusAt(rec.t) * 4);
      raysUsed++;
      if (opaqueHit(p, dir, far).d < 0) {
        const nearPit = this.segDistTo(p, dir, far, this.cave.pitCenter) < 5.2;
        const nearCrack = this.segDistTo(p, dir, far, this.cave.crackPoint) < 2.4;
        // 管内行走白名单：洞后每 1.2m 采样，若射线始终跑在某条管道内部
        // （或先进入管内再穿出天窗水柱），这是合法连通而非透天
        let escaped = false;
        if (!nearPit && !nearCrack) {
          const pt = new THREE.Vector3();
          for (let s = inDist + 0.4; s < far; s += 1.2) {
            pt.copy(p).addScaledVector(dir, s);
            if (pt.y > -0.4 && Math.hypot(pt.x - pool.x, pt.z - pool.z) < 9) break; // 天窗水柱出水
            const h = this.cave.resolve(pt, rec.pathId, rec.t);
            if (h.containment > 0.25) { escaped = true; break; }
          }
        }
        if (!nearPit && !nearCrack && escaped) {
          critical.push(
            `HOLE path${rec.pathId} t=${rec.t.toFixed(3)} @(${rec.c.x.toFixed(1)},${rec.c.y.toFixed(1)},${rec.c.z.toFixed(1)})`,
          );
        }
      }
    }

    // ---- B) 通路阻塞：轴向走廊 5 射线（轴 + N/B ±35% 半径）；全部被挡才算堵死 ----
    for (const path of this.cave.paths) {
      const steps = path.id === 0 ? 160 : 30;
      for (let i = 0; i < steps; i++) {
        const f0 = path.id === 0 ? i / steps : 0.04 + (i / steps) * 0.9;
        const f1 = path.id === 0 ? (i + 1) / steps : 0.04 + ((i + 1) / steps) * 0.9;
        const fr = this.cave.frameAt(path.id, f0);
        const b = this.cave.frameAt(path.id, f1).p;
        if (fr.p.y > -0.4 || b.y > -0.4) continue; // 水面以上（天窗段）不算游泳走廊
        const seg = b.clone().sub(fr.p);
        const len = seg.length() - 0.15;
        if (len <= 0.2) continue;
        seg.normalize();
        const off = path.radiusAt(f0) * 0.35;
        const lanes: THREE.Vector3[] = [
          fr.p.clone(),
          fr.p.clone().addScaledVector(fr.N, off),
          fr.p.clone().addScaledVector(fr.N, -off),
          fr.p.clone().addScaledVector(fr.B, off),
          fr.p.clone().addScaledVector(fr.B, -off),
        ];
        let blocked = 0;
        let what = '';
        for (const o of lanes) {
          raysUsed++;
          const h = opaqueHit(o, seg, len);
          if (h.d >= 0) { blocked++; what = what || h.what; }
        }
        if (blocked === lanes.length) {
          critical.push(`BLOCK path${path.id} t=${f0.toFixed(3)}→${f1.toFixed(3)} [${what}]`);
        } else if (blocked >= 3) {
          warn.push(`NARROW path${path.id} t=${f0.toFixed(3)} ${blocked}/5 [${what}]`);
        }
      }
    }

    // ---- C) 道具可达性 ----
    const trigR: Record<string, number> = { slate: 2.4, tank: 2.2, tankEmpty: 2.2 };
    const wp = new THREE.Vector3();
    for (const prop of this.cave.props) {
      prop.mesh.getWorldPosition(wp);
      const hit = this.cave.resolve(wp, prop.pathId, prop.t);
      const maxR = hit.radius - (0.55 + hit.radius * 0.1);
      const tr = trigR[prop.kind] ?? 3.4;
      if (hit.dist - maxR > tr - 0.2) {
        critical.push(
          `UNREACHABLE ${prop.kind} path${prop.pathId} t=${prop.t.toFixed(2)} dist=${hit.dist.toFixed(1)} maxR=${maxR.toFixed(1)}`,
        );
      } else if (hit.containment > 0.4) {
        warn.push(`PROP-OUTSIDE ${prop.kind} path${prop.pathId} t=${prop.t.toFixed(2)} cont=${hit.containment.toFixed(1)}`);
      }
    }
    return { critical, warn, holesChecked, raysUsed };
  }

  /** 点到射线段的最近距离（scan 白名单判定用） */
  private segDistTo(o: THREE.Vector3, dir: THREE.Vector3, far: number, p: THREE.Vector3): number {
    const toP = p.clone().sub(o);
    const s = THREE.MathUtils.clamp(toP.dot(dir), 0, far);
    return toP.addScaledVector(dir, -s).length();
  }

  /** 调试：把视线对准世界点（用 player.position——同帧 move 后相机还没跟上，用相机位会瞄向旧点） */
  private faceWorldPoint(v: THREE.Vector3): void {
    const d = v.clone().sub(this.player.position).normalize();
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

    // M5-L3 行为节拍：护送段玩家冲刺 → 特奥打「慢」灯语（呼吸与鳍法教学）
    if (
      this.mode === 'story' && this.buddy.mode === 'follow' && !this.buddy.gesturing &&
      this.input.sprint && this.lastSpeed > 2.2 && this.time - this.buddySlowAt > 25
    ) {
      this.buddySlowAt = this.time;
      this.buddy.gesture('slow', 3.2);
      if (this.buddySlowAt < 60) {
        this.hud.subtitle('特奥掌心向下，缓缓压了两下——慢。\n在洞里，快就是费气，费气就是危险。', '', 5.5);
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
    this.body.setVisible(true);
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
    this.body.setVisible(true);
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
    this.landmarks.cullByDistance(this.player.camera.position);
    this.adaptDPR(dt);
    // 手电光束（M5-L4 生态趋光/惊散用）：位置与朝向取 lightRig（带惯性的手持光轴）
    this.beamDir.set(0, 0, -1).applyQuaternion(this.player.lightRig.quaternion);
    this.beamPos.copy(this.player.lightRig.position);
    this.ecology.update(
      dt,
      this.time,
      this.state === 'title' ? this.player.camera.position : this.player.position,
      this.lastSpeed,
      { on: this.state === 'play' && this.player.flashlight.intensity > 5, pos: this.beamPos, dir: this.beamDir },
    );
    const sightProg = this.ancient.update(dt, this.time, this.player.position);
    if (this.state === 'play' && this.phase === 'sighting') this.sightingBeats(sightProg);
    this.cullZoneLights();
    this.renderer.render(this.scene, this.player.camera);
    if (this.perfDiv) this.updatePerf(dt);
  }

  // ---------- 性能 HUD（__dd.perf() 开关） ----------
  private perfDiv: HTMLDivElement | null = null;
  private perfFrames = 0;
  private perfClock = 0;

  private togglePerf(): string {
    if (this.perfDiv) {
      this.perfDiv.remove();
      this.perfDiv = null;
      return 'perf HUD off';
    }
    const d = document.createElement('div');
    d.style.cssText =
      'position:fixed;top:8px;left:8px;z-index:99;padding:6px 10px;font:11px/1.5 monospace;' +
      'color:#9fe8d8;background:rgba(2,10,12,0.72);border:1px solid rgba(120,220,200,0.25);' +
      'border-radius:4px;pointer-events:none;white-space:pre';
    document.body.appendChild(d);
    this.perfDiv = d;
    this.perfFrames = 0;
    this.perfClock = 0;
    return 'perf HUD on';
  }

  private updatePerf(dt: number): void {
    this.perfFrames++;
    this.perfClock += dt;
    if (this.perfClock < 0.5) return;
    const fps = this.perfFrames / this.perfClock;
    const info = this.renderer.info;
    let lightsOn = 0;
    for (const l of this.cave.zoneLights) if (l.visible) lightsOn++;
    for (const l of this.cave.propLights) if (l.visible) lightsOn++;
    this.perfDiv!.textContent =
      `FPS ${fps.toFixed(0)}  (${(1000 / fps).toFixed(1)}ms)\n` +
      `calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k\n` +
      `lights ${lightsOn}/${this.cave.zoneLights.length + this.cave.propLights.length}` +
      `  geo ${info.memory.geometries}  tex ${info.memory.textures}\n` +
      `zone ${this.cave.zoneAt(this.player.mainT)}  tier ${this.q.tier}  dpr ${this.renderer.getPixelRatio().toFixed(2)}`;
    this.perfFrames = 0;
    this.perfClock = 0;
  }

  /** 区域点光按距离启停 + 预算上限（前向渲染每盏可见点光都进片元循环，必须封顶） */
  private cullZoneLights(): void {
    const p = this.player.camera.position;
    this.lightRank.length = 0;
    for (const l of this.cave.zoneLights) {
      l.visible = false;
      const d2 = l.position.distanceToSquared(p);
      if (d2 < 48 * 48) this.lightRank.push({ l, d2 });
    }
    this.lightRank.sort((a, b) => a.d2 - b.d2);
    const zCap = this.q.tier === 'mobile' ? 6 : 10;
    const zn = Math.min(zCap, this.lightRank.length);
    for (let i = 0; i < zn; i++) this.lightRank[i].l.visible = true;
    // 道具辉光半径只有 2~3m：26m 外直接关灯，最近 6 盏封顶
    this.lightRank.length = 0;
    for (const l of this.cave.propLights) {
      let wp = l.userData.wp as THREE.Vector3 | undefined;
      if (!wp) {
        wp = l.getWorldPosition(new THREE.Vector3());
        l.userData.wp = wp;
      }
      l.visible = false;
      const d2 = wp.distanceToSquared(p);
      if (d2 < 26 * 26) this.lightRank.push({ l, d2 });
    }
    this.lightRank.sort((a, b) => a.d2 - b.d2);
    const pn = Math.min(6, this.lightRank.length);
    for (let i = 0; i < pn; i++) this.lightRank[i].l.visible = true;
  }

  /** M4-L5 自适应 DPR：帧率 EMA 低于 34 持续 3s → 降 12%；高于 56 持续 8s → 回升 8%（上限档位 DPR） */
  private adaptDPR(dt: number): void {
    if (!this.adaptOn) return;
    const fps = 1 / Math.max(1e-3, dt);
    this.fpsEma += (fps - this.fpsEma) * Math.min(1, dt * 1.5);
    const base = Math.min(devicePixelRatio || 1, this.q.maxDPR);
    if (this.fpsEma < 34 && this.dprScale > 0.62) {
      this.dprLowT += dt;
      if (this.dprLowT > 3) {
        this.dprLowT = 0;
        this.dprScale = Math.max(0.6, this.dprScale - 0.12);
        this.renderer.setPixelRatio(base * this.dprScale);
      }
    } else {
      this.dprLowT = 0;
    }
    if (this.fpsEma > 56 && this.dprScale < 1) {
      this.dprHighT += dt;
      if (this.dprHighT > 8) {
        this.dprHighT = 0;
        this.dprScale = Math.min(1, this.dprScale + 0.08);
        this.renderer.setPixelRatio(base * this.dprScale);
      }
    } else {
      this.dprHighT = 0;
    }
  }

  /** 标题首屏（英雄机位）：井口净空柱内仰望 Snell 窗——船底剪影与太阳爆点同框，光柱簇+鱼群绕柱 */
  private titleIdle(dt: number): void {
    const pc = this.cave.poolCenter;
    this.player.camera.position.set(
      pc.x - 2.4 + Math.sin(this.time * 0.06) * 0.3,
      -8.6 + Math.sin(this.time * 0.09) * 0.35,
      pc.z - 1.5 + Math.cos(this.time * 0.055) * 0.3,
    );
    const look = new THREE.Vector3(
      pc.x - 0.9 + Math.sin(this.time * 0.05) * 0.5,
      4.0,
      pc.z + 0.9 + Math.cos(this.time * 0.045) * 0.5,
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

    // 第一人称身体：手臂摆动 + 潜水电脑屏色 + 呼吸气泡（气穴/水面/缺氧不吐泡）
    this.body.update(
      dt, this.time, speed, this.input.sprint,
      this.oxygen > 0 && !this.inAirPocket && this.phase !== 'surface' && this.phase !== 'boarding',
      this.player.camera.position, this.player.camera.quaternion, this.oxygen / 100,
    );

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

    // ---- 分区氛围事件（蝙蝠惊起 / 气穴滴水 / 深区闷响） ----
    this.updateAtmosphere();

    // ---- 自然观察手记（生态互动：靠近首见触发） ----
    this.updateNatureNotes(dt);

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
      this.relicPrompt = this.story.update(this.player.mainT, this.player.position, this.storyCtx, {
        fwd: this.camFwd.set(0, 0, -1).applyQuaternion(this.player.camera.quaternion),
        interact: this.input.consumeInteract(),
        touchAuto: this.input.touch,
      });
    } else {
      this.relicPrompt = null;
    }
    // 准星提示优先级：遗物 F 观察 > 注视观察进度
    let prompt = this.relicPrompt;
    if (!prompt && this.gazeNoteKey && this.gazeNoteAcc > 0.25) {
      const pct = Math.min(9, Math.floor((this.gazeNoteAcc / 1.4) * 10));
      prompt = `观察中 ${'●'.repeat(pct)}${'○'.repeat(9 - pct)}`;
    }
    this.hud.prompt(prompt);

    // ---- M5-L4 气泡帘穿越：帘内被气泡裹住——嘶声 + 上托 + 视野口的密集泡串 ----
    const vent = this.ecology.ventAt(this.player.position);
    if (vent && this.time >= this.ventCoolAt) {
      this.ventCoolAt = this.time + 4.5;
      this.ventCross++;
      this.player.velocity.y += 0.55; // 上涌气泡的浮托
      this.audio.ventFizz();
      this.body.burst(this.player.camera.position, this.player.camera.quaternion);
      if (!this.ventTold) {
        this.ventTold = true;
        this.hud.subtitle('气泡帘。洞底裂隙一直在呼气——\n穿过去的瞬间，上千个小气泡贴着你的皮肤炸开。', '', 6);
      }
    }

    // ---- M5-L4 卤水跃层搅动：带速度穿越云面 → 波纹涌动 + 浊雾卷起 ----
    const lm = this.landmarks;
    const nearHalo = this.player.position.distanceTo(lm.haloCenter) < lm.haloRadius;
    if (nearHalo && (this.prevY - lm.haloPlaneY) * (this.player.position.y - lm.haloPlaneY) < 0
      && Math.abs(this.player.velocity.y) > 0.45) {
      this.haloStirs++;
      lm.stirHalo(Math.min(1, Math.abs(this.player.velocity.y) * 0.5));
      if (!this.haloStirTold) {
        this.haloStirTold = true;
        this.hud.subtitle('你搅动了卤水跃层。脚下的"水面"晕开一圈慢波，\n硫化氢的浊雾跟着卷了上来——教科书说：贴着它游，别踢它。', '', 7);
      }
    }
    this.prevY = this.player.position.y;

    this.updateParticles(dt, this.player.position);
    const depth01 = Math.min(1, depth / 50);
    this.audio.update(dt, {
      oxygen01: o2,
      depth01,
      sprinting: this.input.sprint,
      above: this.phase === 'surface' || this.phase === 'boarding' || this.inAirPocket,
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
          `最大深度 -${this.maxDepth.toFixed(1)}M · 用时 ${timeStr} 分钟 · 写字板 ${slates}/${this.story.slateTotal} · 观察 ${this.story.relicsSeen}/${this.story.relicTotal} · 手记 ${this.notesSeen.size}/${NATURE_NOTES.length}\n结局：血里的针（跳过了减压停留）`,
        );
      } else {
        this.hud.showEnding(
          'dawn',
          '太阳正从丛林线上升起来。\n你看见过它照不到的地方，\n以及在那里等了五亿年的东西。',
          `最大深度 -${this.maxDepth.toFixed(1)}M · 用时 ${timeStr} 分钟 · 写字板 ${slates}/${this.story.slateTotal} · 观察 ${this.story.relicsSeen}/${this.story.relicTotal} · 手记 ${this.notesSeen.size}/${NATURE_NOTES.length}\n结局：破晓`,
        );
      }
      document.exitPointerLock?.();
    }, 2600);
  }

  /**
   * M5-L4 自然观察手记：从「走过就弹」升级为主动观察——
   * 准星对准生物（~11°）且在观察距离内时开始累计注视，1.4s 后触发手记；
   * 候选 0.35s 重扫一次（probeNearest 便宜但没必要逐帧），注视进度逐帧累计。
   */
  private updateNatureNotes(dt: number): void {
    if (this.mode !== 'story' || this.hud.slateOpen) {
      this.gazeCandidate = null;
      this.gazeNoteKey = null;
      return;
    }
    const pp = this.player.position;
    const fwd = this.camFwd.set(0, 0, -1).applyQuaternion(this.player.camera.quaternion);
    this.noteTimer += dt;
    if (this.noteTimer >= 0.35) {
      this.noteTimer = 0;
      this.gazeCandidate = null;
      const to = new THREE.Vector3();
      let bestDot = 0.982; // ~11°
      for (const n of NATURE_NOTES) {
        if (this.notesSeen.has(n.key)) continue;
        let p: [number, number, number] | null;
        if (n.group === 'school') {
          const pc = this.cave.poolCenter;
          p = [pc.x, -6, pc.z]; // 鱼群绕天光井光柱（Ecology.fishCenter 同源）
        } else {
          p = this.ecology.probeNearest(n.group, pp);
        }
        if (!p) continue;
        to.set(p[0] - pp.x, p[1] - pp.y, p[2] - pp.z);
        const d = to.length();
        if (d > n.dist * 2.2) continue; // 观察距离放宽（原贴近距离的 2.2 倍——主动观察不必贴脸）
        const dot = to.normalize().dot(fwd);
        if (dot > bestDot) {
          bestDot = dot;
          this.gazeCandidate = { key: n.key, pos: new THREE.Vector3(p[0], p[1], p[2]) };
        }
      }
    }
    // 注视累计（候选变化即清零重计）
    if (this.gazeCandidate) {
      if (this.gazeNoteKey !== this.gazeCandidate.key) {
        this.gazeNoteKey = this.gazeCandidate.key;
        this.gazeNoteAcc = 0;
      }
      this.gazeNoteAcc += dt;
      if (this.gazeNoteAcc >= 1.4) {
        const n = NATURE_NOTES.find((x) => x.key === this.gazeNoteKey)!;
        this.notesSeen.add(n.key);
        this.hud.subtitle(n.text, `自然手记 ${this.notesSeen.size}/${NATURE_NOTES.length}`, 7);
        this.gazeCandidate = null;
        this.gazeNoteKey = null;
      }
    } else {
      this.gazeNoteKey = null;
      this.gazeNoteAcc = 0;
    }
  }

  /** M4-L4 分区氛围事件：蝙蝠群惊起（音频+字幕）、气穴滴水声景、深区远处岩层闷响 */
  private updateAtmosphere(): void {
    // 蝙蝠群被惊起（Ecology 状态机产生一次性事件）
    if (this.ecology.consumeBatStartle()) {
      this.audio.batFlutter();
      this.hud.subtitle('灯光扫过洞顶的一瞬，整个穹顶都动了起来。\n上百对翅膀贴着水面盘旋——这里是它们的家，不是你的。', '', 6.5);
    }
    // 气穴内：滴水回声 + 首次警示（S8 写字板的口头版）
    if (this.inAirPocket) {
      if (this.time >= this.nextDripAt) {
        this.nextDripAt = this.time + 0.7 + Math.random() * 2.2;
        this.audio.drip();
      }
      if (!this.airPocketTold) {
        this.airPocketTold = true;
        this.hud.subtitle('气穴。空气里全是氨味——蝙蝠粪在头顶发酵了几百年。\n咬嘴留在嘴里。这不是能呼吸的地方。', '', 7.5);
      }
    }
    // 深区随机闷响：塌方/沉船/深渊里，远处的岩层每隔几十秒挪一下
    const zn = this.cave.zoneAt(this.player.mainT);
    const deep = zn === 'abyss' || zn === 'collapse' || zn === 'wreck' || this.player.pathId === 4;
    if (deep && this.time >= this.nextRumbleAt) {
      this.nextRumbleAt = this.time + 24 + Math.random() * 32;
      this.audio.distantRumble(0.6 + Math.random() * 0.5);
    }
    // 不在深区时把计时器往后推：进入深区后至少 12s 才可能响第一声
    if (!deep) this.nextRumbleAt = Math.max(this.nextRumbleAt, this.time + 12);
  }

  /** 分区雾/曝光/卤水层 */
  private updateEnvironment(dt: number, depth: number): void {
    const fog = this.scene.fog as THREE.FogExp2;
    const zone = this.cave.zoneAt(this.player.mainT);
    let target = ZONE_ENV[zone];
    // 支线沿用所属大区的雾
    if (this.player.pathId === 1) target = ZONE_ENV.wreck;
    if (this.player.pathId === 2) target = ZONE_ENV.collapse;
    if (this.player.pathId === 3) target = ZONE_ENV.gallery;
    if (this.player.pathId === 4) target = ZONE_ENV.collapse;

    let fogColor = new THREE.Color(target.fog);
    let den = target.den;
    let exp = target.exp;

    // 深区雾"呼吸"：极慢的密度起伏——压抑感的低频节拍（不影响能见度判断）
    if (zone === 'abyss' || zone === 'collapse' || this.player.pathId === 4) {
      den *= 1 + Math.sin(this.time * 0.12) * 0.07;
    }

    // 卤水层下方：硫化氢浊水
    const inHalo =
      this.player.position.y < this.landmarks.haloPlaneY + 0.3 &&
      this.player.position.distanceTo(this.landmarks.haloCenter) < this.landmarks.haloRadius;
    if (inHalo) {
      fogColor = new THREE.Color(0x25301e);
      den = 0.085;
      exp = 0.82;
    }

    // 支线C 气穴：出水后是幽暗但清透的空气（不可呼吸——高 CO₂/氨，见 S8 警示）
    const bc = this.cave.batChamberTop;
    this.inAirPocket =
      this.player.pathId === 3 &&
      this.player.position.y > this.cave.batWaterY - 0.15 &&
      Math.hypot(this.player.position.x - bc.x, this.player.position.z - bc.z) < 3.4;
    if (this.inAirPocket) {
      fogColor = new THREE.Color(0x0c1410);
      den = 0.014;
      exp = 1.0;
    }
    // 搅浑水 silt-out：白雾吞掉能见度，尾段 6s 缓慢散开
    if (this.time < this.siltUntil) {
      const left = this.siltUntil - this.time;
      const k2 = Math.min(1, left / 6);
      fogColor.lerp(new THREE.Color(0x4a4438), 0.85 * k2);
      den = den + (0.24 - den) * k2;
      exp = exp - 0.1 * k2;
    }
    // 水面之上：清晨空气（气穴内的"出水"不算——那里只有一线裂隙光）
    if (!this.inAirPocket && (this.phase === 'surface' || this.phase === 'boarding' || this.player.position.y > -0.1)) {
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
    // 身体还在，气泡停了——最后一口气已经呼出去了
    this.body.update(dt, this.time, 0, false, false, this.player.camera.position, this.player.camera.quaternion, 0);
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
