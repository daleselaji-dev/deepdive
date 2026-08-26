import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { QualityProfile } from './quality';
import type { Cave } from './Cave';
import type { Models, MeshAsset } from './Models';
import { particleSprite, bubbleSprite } from './textures';

/**
 * 可交互洞穴生态（docs/GAME_DESIGN.md §5；分区依据 docs/WORKFLOW.md §3.9 anchialine 生态说明）：
 * 淡水层（卤跃层以上）——
 * - 银汉鱼群：天光井光柱绕游，玩家靠近惊散。真实拓扑鱼模型实例（Models.ts）。
 * - 巡游大鱼：天坑上层水体的大个体（现实原型：溶洞海鲢），怕光缓慢避让。
 * - 盲眼洞鱼：石笋回廊首见、光之厅成群，被手电长照会缓慢趋光（细思恐）。
 * - 盲螯虾：光之厅/塌方区底栖，苍白无色素，靠太近会尾弹后逃。
 * - 端足类微群：回廊壁面附近的白色微尘游动点。
 * 卤跃层以下（海源水体）——
 * - 桨足类（remipede）：anchialine 标志物种，细长分节泳体腹面朝上缓游。
 * - 小型水螅水母（hydromedusae）：掌心尺度半透明伞体，深渊井口群游（非大型海月水母）。
 * 气室段——
 * - 蝙蝠群：支线C 气穴洞顶倒挂，玩家出水惊起盘旋（事件供 Game 触发音频与字幕）。
 * 通用——
 * - 浮游发光体：快速游过时脉冲蓝光尾迹。
 * - 换气泡帘：大厅裂隙持续上涌的气泡柱。
 */

interface Fish {
  ang: number;
  radius: number;
  y: number;
  speed: number;
  bobPhase: number;
  scatter: THREE.Vector3;
  len: number;
}

interface Cruiser {
  pos: THREE.Vector3;
  home: THREE.Vector3;
  phase: number;
  len: number;
  wanderR: number;
  avoid: THREE.Vector3;
}

interface Jelly {
  group: THREE.Group;
  bell: THREE.Mesh;
  glow: THREE.Sprite;
  base: THREE.Vector3;
  phase: number;
  drift: THREE.Vector3;
  shrink: number;
}

interface Remipede {
  pos: THREE.Vector3;
  home: THREE.Vector3;
  phase: number;
  speed: number;
}

interface Crayfish {
  pos: THREE.Vector3;
  home: THREE.Vector3;
  yaw: number;
  phase: number;
  dart: THREE.Vector3;
  cool: number;
}

export class Ecology {
  readonly group = new THREE.Group();

  private fishMesh: THREE.InstancedMesh | null = null;
  private fish: Fish[] = [];
  private fishCenter: THREE.Vector3;
  private fishSource: 'pending' | 'gltf' | 'procedural' = 'pending';

  private blindMesh: THREE.InstancedMesh | null = null;
  private blind: { pos: THREE.Vector3; home: THREE.Vector3; phase: number }[] = [];

  private cruiserMesh: THREE.InstancedMesh | null = null;
  private cruisers: Cruiser[] = [];

  private plankton: THREE.Points;
  private pkPos: Float32Array;
  private pkGlow: Float32Array;
  private pkCol: Float32Array;

  private jellies: Jelly[] = [];
  private vents: { pts: THREE.Points; pos: Float32Array; base: THREE.Vector3; h: number }[] = [];

  private remiMesh: THREE.InstancedMesh | null = null;
  private remis: Remipede[] = [];

  private crayMesh: THREE.InstancedMesh | null = null;
  private crays: Crayfish[] = [];

  private amphi: THREE.Points | null = null;
  private amphiBase: Float32Array = new Float32Array(0);
  private amphiPhase: Float32Array = new Float32Array(0);

  private batMesh: THREE.InstancedMesh | null = null;
  private batRoost: THREE.Matrix4[] = [];
  private batPos: THREE.Vector3[] = [];
  private batHome: THREE.Vector3[] = [];
  private batState: 'roost' | 'fly' | 'return' = 'roost';
  private batTimer = 0;
  private batCooldown = 0;
  private batStartled = false;
  private batCenter = new THREE.Vector3();
  private batWaterY = 0;

  private dummy = new THREE.Object3D();

  constructor(q: QualityProfile, cave: Cave, scene: THREE.Scene, models: Models) {
    scene.add(this.group);
    this.fishCenter = new THREE.Vector3(cave.poolCenter.x, -6, cave.poolCenter.z);

    // ---------- 银汉鱼群（行为数据先建，网格待模型解码后挂载） ----------
    for (let i = 0; i < q.fish; i++) {
      this.fish.push({
        ang: Math.random() * Math.PI * 2,
        radius: 1.6 + Math.random() * 3.4,
        y: -2.5 - Math.random() * 7,
        speed: 0.35 + Math.random() * 0.4,
        bobPhase: Math.random() * Math.PI * 2,
        scatter: new THREE.Vector3(),
        len: 0.24 + Math.random() * 0.14,
      });
    }

    // ---------- 盲眼洞鱼（仅淡水层：回廊首见 + 光之厅成群；卤下海源水体不放淡水种，§3.9） ----------
    const blindCount = Math.max(8, Math.floor(q.fish * 0.12));
    const zones: ['gallery' | 'hall', number][] = [['gallery', 0.55], ['hall', 0.38], ['hall', 0.68]];
    for (let i = 0; i < blindCount; i++) {
      const [zn, frac] = zones[i % zones.length];
      const zr = cave.zoneRange(zn);
      const t = zr.t0 + (zr.t1 - zr.t0) * (frac + (Math.random() - 0.5) * 0.3);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t) * 0.55;
      const home = c.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * r,
        (Math.random() - 0.5) * r * 0.6,
        (Math.random() - 0.5) * r,
      ));
      this.blind.push({ pos: home.clone(), home, phase: Math.random() * 10 });
    }

    // ---------- 巡游大鱼（淡水层独游个体：天光井悬停 + 回廊 + 光之厅——现实原型是溶洞里的海鲢/大型丽鱼，
    //             不下卤跃层：海源深水段的真实居民是穴居甲壳类而非大型鱼，§3.9） ----------
    const cruiserZones: ['shaft' | 'gallery' | 'hall', number][] = q.tier === 'mobile'
      ? [['hall', 0.5], ['gallery', 0.5]]
      : [['shaft', 0.6], ['gallery', 0.5], ['hall', 0.35], ['hall', 0.7]];
    for (const [zn, frac] of cruiserZones) {
      const zr = cave.zoneRange(zn);
      const t = zr.t0 + (zr.t1 - zr.t0) * frac;
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const home = c.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * r * 0.5,
        r * 0.1 + Math.random() * r * 0.25,
        (Math.random() - 0.5) * r * 0.5,
      ));
      this.cruisers.push({
        pos: home.clone(),
        home,
        phase: Math.random() * Math.PI * 2,
        len: 0.9 + Math.random() * 0.5,
        wanderR: Math.max(2.5, r * 0.42),
        avoid: new THREE.Vector3(),
      });
    }

    // 模型解码完成后挂载三种鱼网格（data URI 解码近乎即时；失败自动程序化中模）
    void models.fish.then((asset) => this.mountFishMeshes(q, asset));

    // ---------- 浮游发光体 ----------
    const n = q.plankton;
    this.pkPos = new Float32Array(n * 3);
    this.pkGlow = new Float32Array(n);
    this.pkCol = new Float32Array(n * 3);
    const haloT = cave.zoneRange('halo');
    const abyssT = cave.zoneRange('abyss');
    for (let i = 0; i < n; i++) {
      const t = haloT.t0 + Math.random() * (abyssT.t1 - haloT.t0);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t) * 0.85;
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r;
      this.pkPos[i * 3] = c.x + Math.cos(ang) * rr;
      this.pkPos[i * 3 + 1] = c.y + (Math.random() - 0.5) * r * 1.2;
      this.pkPos[i * 3 + 2] = c.z + Math.sin(ang) * rr;
      this.pkGlow[i] = 0;
    }
    const pkGeo = new THREE.BufferGeometry();
    pkGeo.setAttribute('position', new THREE.BufferAttribute(this.pkPos, 3));
    pkGeo.setAttribute('color', new THREE.BufferAttribute(this.pkCol, 3));
    const pkMat = new THREE.PointsMaterial({
      map: particleSprite(),
      size: 0.08,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this.plankton = new THREE.Points(pkGeo, pkMat);
    this.group.add(this.plankton);

    // ---------- 深渊水螅水母群（§3.9 尺度修正：anchialine 海源层的真实居民是掌心尺度的
    //             小型 hydromedusae，不是大型海月水母——M3 的 0.6~1.7m 大伞体按科学说明缩到 0.16~0.30m，
    //             数量翻倍成"发光尘埃群"，升降漂移幅度也随体型减半） ----------
    const bellMat = new THREE.MeshStandardMaterial({
      color: 0x2a4a52,
      emissive: 0x3a7a8c,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.5,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });
    const glowTex = particleSprite();
    const { p: abyssC } = cave.frameAt(0, (abyssT.t0 + abyssT.t1) / 2);
    const jellyCount = q.jellies * 2;
    for (let i = 0; i < jellyCount; i++) {
      const g = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), bellMat.clone());
      g.add(bell);
      // 触手：小水螅水母的触手短而细
      for (let k = 0; k < 4; k++) {
        const tent = new THREE.Mesh(
          new THREE.CylinderGeometry(0.008, 0.016, 1.1 + Math.random() * 0.7, 4),
          new THREE.MeshStandardMaterial({
            color: 0x2a4a52,
            emissive: 0x2a6a7c,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.4,
          }),
        );
        tent.position.set(Math.sin(k * 1.57) * 0.26, -0.7, Math.cos(k * 1.57) * 0.26);
        g.add(tent);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: 0x66c8d8,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(2.2);
      g.add(glow);
      const base = abyssC.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.35) * 10,
        (Math.random() - 0.5) * 16,
      ));
      // 出生点至少离大厅中轴 4.5m：小水母不挡路，但也别怼在泳道正中
      const dx = base.x - abyssC.x;
      const dz = base.z - abyssC.z;
      const dHoriz = Math.hypot(dx, dz);
      if (dHoriz < 4.5) {
        const push = dHoriz < 0.01 ? { x: 1, z: 0 } : { x: dx / dHoriz, z: dz / dHoriz };
        base.x = abyssC.x + push.x * (4.5 + Math.random() * 3);
        base.z = abyssC.z + push.z * (4.5 + Math.random() * 3);
      }
      g.position.copy(base);
      const s = 0.16 + Math.random() * 0.14;
      g.scale.setScalar(s);
      this.group.add(g);
      this.jellies.push({
        group: g, bell, glow, base,
        phase: Math.random() * Math.PI * 2,
        drift: new THREE.Vector3(),
        shrink: 0,
      });
    }

    this.buildRemipedes(q, cave);
    this.buildCrayfish(q, cave);
    this.buildAmphipods(q, cave);
    this.buildBats(cave);

    // ---------- 气泡帘（光之厅 + 深渊井口） ----------
    const ventDefs: [THREE.Vector3, number][] = [
      [new THREE.Vector3(cave.crackPoint.x - 6, cave.crackPoint.y - 20, cave.crackPoint.z + 5), 14],
      [new THREE.Vector3(cave.pitCenter.x + 3.4, cave.pitCenter.y, cave.pitCenter.z - 2), 16],
    ];
    const bubTex = bubbleSprite();
    for (const [base, h] of ventDefs) {
      const count = q.tier === 'mobile' ? 40 : 90;
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i * 3] = base.x + (Math.random() - 0.5) * 0.7;
        pos[i * 3 + 1] = base.y + Math.random() * h;
        pos[i * 3 + 2] = base.z + (Math.random() - 0.5) * 0.7;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        map: bubTex,
        size: 0.06,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      this.group.add(pts);
      this.vents.push({ pts, pos, base, h });
    }
  }

  // ---------- 桨足类（remipede）：卤跃层以下海源水体的标志物种（§3.9） ----------
  // 真实个体 2~4cm，游戏内放大到 ~30cm 保证黑水可读性（放大系数已在 WORKFLOW §3.9 注明）
  private buildRemipedes(q: QualityProfile, cave: Cave): void {
    const count = q.tier === 'mobile' ? 8 : 18;
    const wr = cave.zoneRange('wreck');
    const ar = cave.zoneRange('abyss');
    for (let i = 0; i < count; i++) {
      // 60% 沉船峡 / 40% 深渊边缘
      const zr = i % 5 < 3 ? wr : ar;
      const t = zr.t0 + (0.15 + Math.random() * 0.7) * (zr.t1 - zr.t0);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const home = c.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * r * 0.9,
        (Math.random() - 0.4) * r * 0.6,
        (Math.random() - 0.5) * r * 0.9,
      ));
      this.remis.push({
        pos: home.clone(),
        home,
        phase: Math.random() * Math.PI * 2,
        speed: 0.55 + Math.random() * 0.4,
      });
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdcd6c8,
      roughness: 0.55,
      emissive: 0x18140f,
    });
    this.remiMesh = new THREE.InstancedMesh(this.remipedeGeometry(), mat, count);
    this.remiMesh.frustumCulled = false;
    this.group.add(this.remiMesh);
  }

  /** 细长分节泳体 + 侧桨毛缘 + 头触角（沿 +Z 朝前） */
  private remipedeGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.CylinderGeometry(0.014, 0.006, 0.3, 7, 8);
    body.rotateX(Math.PI / 2);
    parts.push(body);
    // 侧桨（swimmerets）：一排横向薄板，游泳时像船桨
    for (let i = 0; i < 9; i++) {
      const paddle = new THREE.BoxGeometry(0.085 - i * 0.004, 0.003, 0.014);
      paddle.translate(0, 0, 0.11 - i * 0.028);
      parts.push(paddle);
    }
    for (const sx of [-1, 1]) {
      const ant = new THREE.CylinderGeometry(0.0016, 0.0016, 0.1, 3);
      ant.rotateX(Math.PI / 2);
      ant.rotateY(sx * 0.5);
      ant.translate(sx * 0.012, 0, 0.18);
      parts.push(ant);
    }
    return mergeGeometries(parts)!;
  }

  // ---------- 盲螯虾（Creaseria 属型）：淡水层底栖，苍白无色素（§3.9） ----------
  private buildCrayfish(q: QualityProfile, cave: Cave): void {
    const spots: ['hall' | 'collapse', number][] = q.tier === 'mobile'
      ? [['hall', 0.3], ['hall', 0.6], ['collapse', 0.5]]
      : [['hall', 0.25], ['hall', 0.45], ['hall', 0.68], ['collapse', 0.35], ['collapse', 0.55], ['collapse', 0.75]];
    // 洞底高度用一次性向下射线求真实壁面（管壁噪声只向外凸、底部还有沉积平坦化，
    // 固定比例会把 16cm 的小生物埋进地板或悬空——M4-L4 踩坑）
    const rc = new THREE.Raycaster();
    for (const [zn, frac] of spots) {
      const zr = cave.zoneRange(zn);
      const t = zr.t0 + (zr.t1 - zr.t0) * (frac + (Math.random() - 0.5) * 0.06);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      const hx = c.x + (Math.random() - 0.5) * r * 0.6;
      const hz = c.z + (Math.random() - 0.5) * r * 0.6;
      rc.set(new THREE.Vector3(hx, c.y, hz), new THREE.Vector3(0, -1, 0));
      rc.far = r * 1.6;
      const hit = rc.intersectObject(cave.group, true)[0];
      const home = new THREE.Vector3(hx, hit ? hit.point.y + 0.015 : c.y - r * 0.85, hz);
      this.crays.push({
        pos: home.clone(),
        home,
        yaw: Math.random() * Math.PI * 2,
        phase: Math.random() * 10,
        dart: new THREE.Vector3(),
        cool: 0,
      });
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe6ddcd,
      roughness: 0.6,
      emissive: 0x161210,
    });
    this.crayMesh = new THREE.InstancedMesh(this.crayfishGeometry(), mat, this.crays.length);
    this.crayMesh.frustumCulled = false;
    this.group.add(this.crayMesh);
  }

  /** 头胸甲 + 腹节 + 尾扇 + 双螯 + 步足 + 长触角（沿 +Z 朝前，贴地） */
  private crayfishGeometry(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const carapace = new THREE.CapsuleGeometry(0.02, 0.045, 3, 8);
    carapace.rotateX(Math.PI / 2);
    carapace.translate(0, 0.018, 0.02);
    parts.push(carapace);
    const abdomen = new THREE.CylinderGeometry(0.017, 0.009, 0.06, 7);
    abdomen.rotateX(Math.PI / 2 + 0.22);
    abdomen.translate(0, 0.016, -0.05);
    parts.push(abdomen);
    const fan = new THREE.ConeGeometry(0.02, 0.04, 6);
    fan.rotateX(Math.PI / 2);
    fan.scale(1, 0.3, 1);
    fan.translate(0, 0.01, -0.09);
    parts.push(fan);
    for (const sx of [-1, 1]) {
      const claw = new THREE.CapsuleGeometry(0.009, 0.05, 3, 6);
      claw.rotateX(Math.PI / 2);
      claw.rotateY(sx * 0.35);
      claw.translate(sx * 0.022, 0.012, 0.075);
      parts.push(claw);
      const ant = new THREE.CylinderGeometry(0.0015, 0.0015, 0.13, 3);
      ant.rotateX(Math.PI / 2);
      ant.rotateY(sx * 0.75);
      ant.translate(sx * 0.012, 0.024, 0.1);
      parts.push(ant);
      for (let li = 0; li < 3; li++) {
        const leg = new THREE.CylinderGeometry(0.0022, 0.0016, 0.045, 3);
        leg.rotateZ(sx * 1.15);
        leg.translate(sx * 0.026, 0.006, 0.02 - li * 0.022);
        parts.push(leg);
      }
    }
    return mergeGeometries(parts)!;
  }

  // ---------- 端足类微群：回廊壁面附近的白色微尘游动点（淡水层微型甲壳类，§3.9） ----------
  private buildAmphipods(q: QualityProfile, cave: Cave): void {
    const n = q.tier === 'mobile' ? 60 : 140;
    this.amphiBase = new Float32Array(n * 3);
    this.amphiPhase = new Float32Array(n);
    const gr = cave.zoneRange('gallery');
    const dir = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = gr.t0 + Math.random() * (gr.t1 - gr.t0);
      const { p: c } = cave.frameAt(0, t);
      const r = cave.radiusAt(t);
      dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const rr = r * (0.55 + Math.random() * 0.3);
      this.amphiBase[i * 3] = c.x + dir.x * rr;
      this.amphiBase[i * 3 + 1] = c.y + dir.y * rr;
      this.amphiBase[i * 3 + 2] = c.z + dir.z * rr;
      this.amphiPhase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.amphiBase.slice(), 3));
    const mat = new THREE.PointsMaterial({
      map: particleSprite(),
      color: 0xcfd8cc,
      size: 0.03,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.amphi = new THREE.Points(geo, mat);
    this.group.add(this.amphi);
  }

  // ---------- 蝙蝠群（支线C 气穴）：洞顶倒挂，玩家出水/贴近水面惊起盘旋（§3.9 洞口段生态） ----------
  private buildBats(cave: Cave): void {
    this.batCenter.copy(cave.batChamberTop);
    this.batWaterY = cave.batWaterY;
    const c = this.batCenter;
    const mat = new THREE.MeshStandardMaterial({ color: 0x120e0a, roughness: 0.95 });
    const geo = new THREE.ConeGeometry(0.05, 0.17, 5);
    const mesh = new THREE.InstancedMesh(geo, mat, 30);
    mesh.frustumCulled = false;
    // 栖位贴在气室岩石穹顶内侧（Landmarks.buildBatChamber 的椭球壳：中心 c+(0,-0.7,0)，
    // 水平半径 4.3、竖直 2.67，内缩 0.84 保证不穿壳）
    const m = new THREE.Matrix4();
    const dir = new THREE.Vector3();
    const qFlip = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    for (let i = 0; i < 30; i++) {
      dir.set(Math.sin(i * 12.9) * 0.8, 0.55 + Math.abs(Math.sin(i * 7.7)) * 0.45, Math.cos(i * 5.3) * 0.8).normalize();
      const posv = new THREE.Vector3(
        c.x + dir.x * 4.3 * 0.84,
        c.y - 0.7 + dir.y * 2.67 * 0.84,
        c.z + dir.z * 4.3 * 0.84,
      );
      m.compose(posv, qFlip, new THREE.Vector3(1, 1 + Math.abs(Math.sin(i * 3.1)) * 0.4, 1));
      mesh.setMatrixAt(i, m);
      this.batRoost.push(m.clone());
      this.batHome.push(posv.clone());
      this.batPos.push(posv.clone());
    }
    this.batMesh = mesh;
    this.group.add(mesh);
  }

  /** Game 逐帧消费的一次性事件：蝙蝠群刚被惊起（触发扑翼音频与字幕） */
  consumeBatStartle(): boolean {
    const v = this.batStartled;
    this.batStartled = false;
    return v;
  }

  /** 调试：取某生态组第 i 个个体的当前世界坐标（__dd 取景/验证用） */
  probe(
    name: 'remipedes' | 'crayfish' | 'jellies' | 'bats' | 'blind' | 'cruisers', i = 0,
  ): [number, number, number] | null {
    const v =
      name === 'remipedes' ? this.remis[i]?.pos :
      name === 'crayfish' ? this.crays[i]?.pos :
      name === 'jellies' ? this.jellies[i]?.group.position :
      name === 'bats' ? this.batPos[i] :
      name === 'blind' ? this.blind[i]?.pos :
      this.cruisers[i]?.pos;
    return v ? [v.x, v.y, v.z] : null;
  }

  /** 调试：取离给定点最近的个体坐标（玩家站轴线上取景用——teleport 离轴会被物理拉回） */
  probeNearest(
    name: Parameters<Ecology['probe']>[0], pos: THREE.Vector3,
  ): [number, number, number] | null {
    const list: THREE.Vector3[] =
      name === 'remipedes' ? this.remis.map((r) => r.pos) :
      name === 'crayfish' ? this.crays.map((r) => r.pos) :
      name === 'jellies' ? this.jellies.map((j) => j.group.position) :
      name === 'bats' ? this.batPos :
      name === 'blind' ? this.blind.map((b) => b.pos) :
      this.cruisers.map((c) => c.pos);
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const v of list) {
      const d = v.distanceToSquared(pos);
      if (d < bd) { bd = d; best = v; }
    }
    return best ? [best.x, best.y, best.z] : null;
  }

  /** 模型解码完成 → 建三种鱼的 InstancedMesh（银汉鱼群 / 盲鱼 / 巡游大鱼） */
  private mountFishMeshes(q: QualityProfile, asset: MeshAsset): void {
    this.fishSource = asset.source;

    // 银汉鱼群：银蓝色调 + 微弱冷发光（黑水里可读）
    const schoolMat = asset.material.clone();
    schoolMat.metalness = Math.max(schoolMat.metalness, 0.35);
    schoolMat.roughness = Math.min(schoolMat.roughness, 0.5);
    schoolMat.emissive = new THREE.Color(0x101c1c);
    schoolMat.color.multiply(new THREE.Color(0xbcd4d8));
    this.fishMesh = new THREE.InstancedMesh(asset.geometry, schoolMat, q.fish);
    this.fishMesh.frustumCulled = false;
    // 个体色差：银青微变
    const tint = new THREE.Color();
    for (let i = 0; i < q.fish; i++) {
      tint.setHSL(0.5 + Math.sin(i * 3.7) * 0.03, 0.12, 0.62 + Math.sin(i * 7.1) * 0.1);
      this.fishMesh.setColorAt(i, tint);
    }
    this.group.add(this.fishMesh);

    // 盲眼洞鱼：无色素的苍白（洞穴特有种不需要贴图色）
    const blindMat = new THREE.MeshStandardMaterial({
      color: 0xd8cfc4,
      roughness: 0.55,
      emissive: 0x2a2620,
      side: asset.source === 'procedural' ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.blindMesh = new THREE.InstancedMesh(asset.geometry, blindMat, this.blind.length);
    this.blindMesh.frustumCulled = false;
    this.group.add(this.blindMesh);

    // 巡游大鱼：保留原贴图（近看细节），色调压暗融入深水
    const cruiserMat = asset.material.clone();
    cruiserMat.color.multiply(new THREE.Color(0x9ab4ac));
    cruiserMat.emissive = new THREE.Color(0x0a1210);
    this.cruiserMesh = new THREE.InstancedMesh(asset.geometry, cruiserMat, this.cruisers.length);
    this.cruiserMesh.frustumCulled = false;
    this.group.add(this.cruiserMesh);
  }

  /** 调试：鱼资产来源与各生态组规模（无头回归断言用） */
  fishInfo(): {
    source: string; school: number; blind: number; cruisers: number;
    remipedes: number; crayfish: number; jellies: number; bats: number;
  } {
    return {
      source: this.fishSource,
      school: this.fish.length,
      blind: this.blind.length,
      cruisers: this.cruisers.length,
      remipedes: this.remis.length,
      crayfish: this.crays.length,
      jellies: this.jellies.length,
      bats: this.batPos.length,
    };
  }

  /** 调试：生态分组可见性开关。group 省略时切换整个生态层。返回切换后的状态表。 */
  toggle(
    name?: 'fish' | 'blind' | 'cruisers' | 'plankton' | 'jellies' | 'vents'
      | 'remipedes' | 'crayfish' | 'amphipods' | 'bats' | 'all',
  ): Record<string, boolean> {
    const flip = (o: THREE.Object3D | null): void => { if (o) o.visible = !o.visible; };
    switch (name) {
      case 'fish': flip(this.fishMesh); break;
      case 'blind': flip(this.blindMesh); break;
      case 'cruisers': flip(this.cruiserMesh); break;
      case 'plankton': flip(this.plankton); break;
      case 'jellies': for (const j of this.jellies) flip(j.group); break;
      case 'vents': for (const v of this.vents) flip(v.pts); break;
      case 'remipedes': flip(this.remiMesh); break;
      case 'crayfish': flip(this.crayMesh); break;
      case 'amphipods': flip(this.amphi); break;
      case 'bats': flip(this.batMesh); break;
      default: flip(this.group);
    }
    return {
      all: this.group.visible,
      fish: this.fishMesh?.visible ?? false,
      blind: this.blindMesh?.visible ?? false,
      cruisers: this.cruiserMesh?.visible ?? false,
      plankton: this.plankton.visible,
      jellies: this.jellies[0]?.group.visible ?? false,
      vents: this.vents[0]?.pts.visible ?? false,
      remipedes: this.remiMesh?.visible ?? false,
      crayfish: this.crayMesh?.visible ?? false,
      amphipods: this.amphi?.visible ?? false,
      bats: this.batMesh?.visible ?? false,
    };
  }

  update(dt: number, time: number, playerPos: THREE.Vector3, playerSpeed: number): void {
    this.updateFish(dt, time, playerPos);
    this.updateBlind(dt, time, playerPos);
    this.updateCruisers(dt, time, playerPos);
    this.updatePlankton(dt, time, playerPos, playerSpeed);
    this.updateJellies(dt, time, playerPos);
    this.updateVents(dt);
    this.updateRemipedes(dt, time, playerPos);
    this.updateCrayfish(dt, time, playerPos);
    this.updateAmphipods(time, playerPos);
    this.updateBats(dt, time, playerPos);
  }

  private updateFish(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.fishMesh) return;
    const c = this.fishCenter;
    const prev = new THREE.Vector3();
    const next = new THREE.Vector3();
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.ang += f.speed * dt * (1 + f.scatter.length() * 0.7);
      const bob = Math.sin(time * 0.8 + f.bobPhase) * 0.4;
      prev.set(c.x + Math.cos(f.ang) * f.radius, f.y + bob, c.z + Math.sin(f.ang) * f.radius);
      // 惊散：4m 内被推离
      const d2 = prev.distanceToSquared(playerPos);
      if (d2 < 16) {
        const away = prev.clone().sub(playerPos).normalize().multiplyScalar((4 - Math.sqrt(d2)) * 2.2);
        f.scatter.add(away.multiplyScalar(dt * 4));
      }
      f.scatter.multiplyScalar(Math.exp(-1.4 * dt));
      prev.add(f.scatter);
      // 朝向 = 运动切线 + 惊散方向
      const ang2 = f.ang + 0.06;
      next.set(c.x + Math.cos(ang2) * f.radius, f.y + bob, c.z + Math.sin(ang2) * f.radius).add(f.scatter);
      this.dummy.position.copy(prev);
      this.dummy.lookAt(next);
      // 尾摆：绕 Y 的小幅摆动（速度越快摆越快）
      this.dummy.rotateY(Math.sin(time * (6 + f.speed * 5) + f.bobPhase * 3) * 0.14);
      this.dummy.scale.setScalar(f.len);
      this.dummy.updateMatrix();
      this.fishMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;
  }

  private updateBlind(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.blindMesh) return;
    for (let i = 0; i < this.blind.length; i++) {
      const b = this.blind[i];
      // 缓慢盘旋 + 被"光"（玩家）静静吸引
      const wander = new THREE.Vector3(
        Math.sin(time * 0.4 + b.phase) * 0.4,
        Math.sin(time * 0.3 + b.phase * 2) * 0.2,
        Math.cos(time * 0.35 + b.phase) * 0.4,
      );
      const target = b.home.clone().add(wander);
      const dp = playerPos.distanceTo(b.pos);
      if (dp < 7) target.lerp(playerPos, 0.35 * (1 - dp / 7)); // 它们不该看得见
      const dir = target.clone().sub(b.pos);
      b.pos.addScaledVector(dir, Math.min(1, dt * 0.5));
      this.dummy.position.copy(b.pos);
      this.dummy.lookAt(target.add(dir));
      this.dummy.rotateY(Math.sin(time * 4.5 + b.phase * 5) * 0.12);
      this.dummy.scale.setScalar(0.2);
      this.dummy.updateMatrix();
      this.blindMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.blindMesh.instanceMatrix.needsUpdate = true;
  }

  /** 巡游大鱼：家域内缓慢巡游，怕玩家手电——4.5m 内缓慢转向避离 */
  private updateCruisers(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.cruiserMesh) return;
    const target = new THREE.Vector3();
    for (let i = 0; i < this.cruisers.length; i++) {
      const cr = this.cruisers[i];
      cr.phase += dt * 0.16;
      target.set(
        cr.home.x + Math.cos(cr.phase) * cr.wanderR,
        cr.home.y + Math.sin(cr.phase * 1.7 + i) * cr.wanderR * 0.22,
        cr.home.z + Math.sin(cr.phase) * cr.wanderR * 0.8,
      );
      const dp = cr.pos.distanceTo(playerPos);
      if (dp < 4.5) {
        const away = cr.pos.clone().sub(playerPos).normalize();
        cr.avoid.addScaledVector(away, dt * (4.5 - dp) * 1.4);
      }
      cr.avoid.multiplyScalar(Math.exp(-0.8 * dt));
      target.add(cr.avoid);
      const dir = target.clone().sub(cr.pos);
      cr.pos.addScaledVector(dir, Math.min(1, dt * 0.32));
      this.dummy.position.copy(cr.pos);
      this.dummy.lookAt(target.add(dir));
      this.dummy.rotateY(Math.sin(time * 2.2 + i * 2.6) * 0.1);
      this.dummy.scale.setScalar(cr.len);
      this.dummy.updateMatrix();
      this.cruiserMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.cruiserMesh.instanceMatrix.needsUpdate = true;
  }

  private updatePlankton(dt: number, time: number, playerPos: THREE.Vector3, playerSpeed: number): void {
    const n = this.pkGlow.length;
    const excite = playerSpeed > 1.1;
    for (let i = 0; i < n; i++) {
      // 扰动激发
      if (excite) {
        const dx = this.pkPos[i * 3] - playerPos.x;
        const dy = this.pkPos[i * 3 + 1] - playerPos.y;
        const dz = this.pkPos[i * 3 + 2] - playerPos.z;
        if (dx * dx + dy * dy + dz * dz < 6.5) this.pkGlow[i] = 1;
      }
      this.pkGlow[i] *= Math.exp(-1.1 * dt);
      const twinkle = 0.05 + 0.04 * Math.sin(time * 1.7 + i * 2.3);
      const g = this.pkGlow[i];
      this.pkCol[i * 3] = twinkle * 0.4 + g * 0.25;
      this.pkCol[i * 3 + 1] = twinkle + g * 0.95;
      this.pkCol[i * 3 + 2] = twinkle + g * 1.0;
    }
    (this.plankton.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateJellies(dt: number, time: number, playerPos: THREE.Vector3): void {
    for (const j of this.jellies) {
      j.phase += dt * 0.9;
      const pulse = Math.sin(j.phase);
      j.bell.scale.set(1 + pulse * 0.08, 1 - pulse * 0.14, 1 + pulse * 0.08);
      // 靠近 → 收缩闪光 + 避让（小水母感知半径也小）
      const d = j.group.position.distanceTo(playerPos);
      if (d < 2.4) {
        j.shrink = Math.min(1, j.shrink + dt * 3);
        const away = j.group.position.clone().sub(playerPos).normalize();
        j.drift.addScaledVector(away, dt * (0.6 + (2.4 - d) * 1.4));
      } else {
        j.shrink = Math.max(0, j.shrink - dt * 0.5);
      }
      j.drift.multiplyScalar(Math.exp(-0.4 * dt));
      const mat = j.bell.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + pulse * 0.3 + j.shrink * 2.2;
      (j.glow.material as THREE.SpriteMaterial).opacity = 0.35 + pulse * 0.12 + j.shrink * 0.45;
      j.group.scale.setScalar(j.group.scale.x * (1 - j.shrink * 0.12 * dt * 3));
      // 缓慢升降漂移（小水母幅度更小：随波逐流的"发光尘埃"）
      j.group.position.copy(j.base)
        .add(new THREE.Vector3(
          Math.sin(time * 0.11 + j.phase) * 1.0,
          Math.sin(time * 0.07 + j.phase * 1.7) * 1.8 + pulse * 0.08,
          Math.cos(time * 0.09 + j.phase) * 1.0,
        ))
        .add(j.drift);
    }
  }

  private updateVents(dt: number): void {
    for (const v of this.vents) {
      const n = v.pos.length / 3;
      for (let i = 0; i < n; i++) {
        v.pos[i * 3 + 1] += (0.55 + (i % 5) * 0.06) * dt;
        v.pos[i * 3] += Math.sin(v.pos[i * 3 + 1] * 2.1 + i) * 0.14 * dt;
        if (v.pos[i * 3 + 1] > v.base.y + v.h) {
          v.pos[i * 3] = v.base.x + (Math.random() - 0.5) * 0.7;
          v.pos[i * 3 + 1] = v.base.y;
          v.pos[i * 3 + 2] = v.base.z + (Math.random() - 0.5) * 0.7;
        }
      }
      (v.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** 桨足类：腹面朝上缓慢巡游（remipede 的真实泳姿），盲——不理会玩家，只在贴脸时轻微让开 */
  private updateRemipedes(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.remiMesh) return;
    const target = new THREE.Vector3();
    for (let i = 0; i < this.remis.length; i++) {
      const rm = this.remis[i];
      rm.phase += dt * rm.speed * 0.3;
      target.set(
        rm.home.x + Math.cos(rm.phase) * 1.3,
        rm.home.y + Math.sin(rm.phase * 1.6 + i) * 0.5,
        rm.home.z + Math.sin(rm.phase) * 1.3,
      );
      const dp = rm.pos.distanceTo(playerPos);
      if (dp < 0.9) target.addScaledVector(rm.pos.clone().sub(playerPos).normalize(), 1.2);
      const dir = target.clone().sub(rm.pos);
      rm.pos.addScaledVector(dir, Math.min(1, dt * 0.5));
      this.dummy.position.copy(rm.pos);
      this.dummy.lookAt(target.add(dir));
      // 腹面朝上（滚转 π）+ 体侧起伏泳姿
      this.dummy.rotateZ(Math.PI + Math.sin(time * 5 + i * 2.4) * 0.16);
      this.dummy.rotateX(Math.sin(time * 3.4 + i) * 0.1);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.remiMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.remiMesh.instanceMatrix.needsUpdate = true;
  }

  /** 盲螯虾：底栖缓爬；玩家 <1.5m 时尾弹后逃（真实螯虾的逃逸反射），几秒后再缓慢爬回家域 */
  private updateCrayfish(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.crayMesh) return;
    const target = new THREE.Vector3();
    const euler = new THREE.Euler();
    for (let i = 0; i < this.crays.length; i++) {
      const cf = this.crays[i];
      cf.cool = Math.max(0, cf.cool - dt);
      const dp = cf.pos.distanceTo(playerPos);
      if (dp < 1.5 && cf.cool <= 0) {
        // 尾弹：背离玩家的水平爆发（面朝威胁、尾部先行）
        const away = cf.pos.clone().sub(playerPos);
        away.y = 0;
        away.normalize();
        cf.dart.addScaledVector(away, 2.6);
        cf.dart.y = 0.35; // 弹起离底一点
        cf.cool = 4;
        cf.yaw = Math.atan2(playerPos.x - cf.pos.x, playerPos.z - cf.pos.z);
      }
      cf.dart.multiplyScalar(Math.exp(-3.2 * dt));
      cf.pos.addScaledVector(cf.dart, dt);
      // 缓爬：家域内极慢兜圈
      target.set(
        cf.home.x + Math.sin(time * 0.07 + cf.phase) * 0.35,
        cf.home.y,
        cf.home.z + Math.cos(time * 0.05 + cf.phase) * 0.35,
      );
      cf.pos.addScaledVector(target.sub(cf.pos), Math.min(1, dt * (cf.cool > 0 ? 0.05 : 0.3)));
      if (cf.cool <= 0) {
        // 面向爬行方向缓慢转体
        const wantYaw = Math.atan2(
          Math.cos(time * 0.07 + cf.phase), -Math.sin(time * 0.05 + cf.phase),
        ) * 0.2 + cf.phase;
        let dy = wantYaw - cf.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        cf.yaw += dy * Math.min(1, dt * 0.4);
      }
      euler.set(0, cf.yaw, 0);
      this.dummy.position.copy(cf.pos);
      this.dummy.quaternion.setFromEuler(euler);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.crayMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.crayMesh.instanceMatrix.needsUpdate = true;
  }

  /** 端足类微群：只在玩家身处回廊附近时做微幅游动（省一遍无效遍历） */
  private updateAmphipods(time: number, playerPos: THREE.Vector3): void {
    if (!this.amphi || !this.amphi.visible) return;
    const attr = this.amphi.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    // 粗判：离第一颗微尘 60m 外就不必逐点更新
    const dx = arr[0] - playerPos.x, dy = arr[1] - playerPos.y, dz = arr[2] - playerPos.z;
    if (dx * dx + dy * dy + dz * dz > 3600) return;
    const n = this.amphiPhase.length;
    for (let i = 0; i < n; i++) {
      const ph = this.amphiPhase[i];
      arr[i * 3] = this.amphiBase[i * 3] + Math.sin(time * 1.3 + ph) * 0.06;
      arr[i * 3 + 1] = this.amphiBase[i * 3 + 1] + Math.sin(time * 0.9 + ph * 2.1) * 0.05;
      arr[i * 3 + 2] = this.amphiBase[i * 3 + 2] + Math.cos(time * 1.1 + ph) * 0.06;
    }
    attr.needsUpdate = true;
  }

  /** 蝙蝠群状态机：roost（零开销静止）→ fly（受惊盘旋 9s）→ return（归巢）→ roost（45s 冷却） */
  private updateBats(dt: number, time: number, playerPos: THREE.Vector3): void {
    if (!this.batMesh) return;
    const c = this.batCenter;
    if (this.batState === 'roost') {
      if (
        time > this.batCooldown &&
        playerPos.y > this.batWaterY - 1.4 &&
        Math.hypot(playerPos.x - c.x, playerPos.z - c.z) < 3.2 &&
        Math.abs(playerPos.y - c.y) < 5
      ) {
        this.batState = 'fly';
        this.batTimer = 0;
        this.batStartled = true;
      }
      return;
    }
    this.batTimer += dt;
    const target = new THREE.Vector3();
    for (let i = 0; i < this.batPos.length; i++) {
      const ang = time * (2.0 + (i % 5) * 0.3) + i * 0.66;
      if (this.batState === 'fly') {
        const r = 1.1 + (i % 7) * 0.24;
        target.set(
          c.x + Math.cos(ang) * r,
          this.batWaterY + 1.2 + Math.sin(time * 1.6 + i * 1.3) * 0.7,
          c.z + Math.sin(ang) * r,
        );
      } else {
        target.copy(this.batHome[i]);
      }
      const k = Math.min(1, dt * (this.batState === 'fly' && this.batTimer < 1 ? 2.4 : 3.6));
      this.batPos[i].lerp(target, k);
      this.dummy.position.copy(this.batPos[i]);
      // 朝盘旋切线方向 + 高频扑翼脉动
      this.dummy.lookAt(this.batPos[i].x - Math.sin(ang), this.batPos[i].y, this.batPos[i].z + Math.cos(ang));
      const flap = 1 + Math.sin(time * 26 + i * 2.1) * 0.45;
      this.dummy.scale.set(flap, 0.7, 1.1);
      this.dummy.updateMatrix();
      this.batMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.batMesh.instanceMatrix.needsUpdate = true;
    if (this.batState === 'fly' && this.batTimer > 9) {
      this.batState = 'return';
      this.batTimer = 0;
    } else if (this.batState === 'return' && this.batTimer > 2.4) {
      this.batState = 'roost';
      this.batCooldown = time + 45;
      for (let i = 0; i < this.batRoost.length; i++) {
        this.batMesh.setMatrixAt(i, this.batRoost[i]);
        this.batPos[i].copy(this.batHome[i]);
      }
      this.batMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
