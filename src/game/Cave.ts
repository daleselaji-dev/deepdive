import * as THREE from 'three';
import type { QualityProfile } from './quality';
import { rockMaps } from './textures';

/**
 * 「寂静之井」v2 —— 闭环多区洞穴系统（docs/GAME_DESIGN.md §2）。
 * 一条闭环主脉（去程 Z1→Z8 + 回程烟囱 Z9）+ 2 条支线枝管（祭坛壁龛 / 错绳死胡同）。
 * 几何为顶点噪声位移的自定义管网格；洞口/天窗/深井用建索引时跳面镂空。
 */

export type ZoneName =
  | 'shaft' | 'gallery' | 'throat' | 'hall' | 'halo'
  | 'wreck' | 'collapse' | 'abyss' | 'chimney';

export interface Zone {
  name: ZoneName;
  t0: number;
  t1: number;
}

export interface CavePath {
  id: number;
  curve: THREE.CatmullRomCurve3;
  closed: boolean;
  samples: THREE.Vector3[];
  sampleN: number;
  radiusAt(t: number): number;
}

export interface CaveHit {
  pathId: number;
  t: number;
  center: THREE.Vector3;
  radius: number;
  dist: number;
  /** dist - radius：负值越深表示越在管内 */
  containment: number;
}

export interface CaveProp {
  kind:
    | 'slate' | 'tank' | 'tankEmpty' | 'reel' | 'gauge' | 'camera' | 'altar'
    | 'ammonite' | 'handprints' | 'pot' | 'helictite' | 'crayfish';
  t: number;
  pathId: number;
  mesh: THREE.Object3D;
  taken?: boolean;
}

const n2 = (a: number, b: number): number => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
};

/** 平滑分形噪声（径向位移用） */
function ridged(t: number, ang: number): number {
  let v = 0, amp = 1, f = 1;
  for (let o = 0; o < 4; o++) {
    const x = t * 40 * f;
    const y = ang * 3 * f;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = n2(xi, yi), b = n2(xi + 1, yi), c = n2(xi, yi + 1), d = n2(xi + 1, yi + 1);
    v += (a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

/** 主脉控制点：[x, y, z, 区名] —— 闭环（尾接头） */
const CP: [number, number, number, ZoneName][] = [
  [0, 3, 0, 'shaft'], // 0 接缝（水面上方，天窗镂空）
  [0.5, -6, 2, 'shaft'], // 1
  [-2, -13, 6, 'shaft'], // 2 竖井底
  [-12, -16.5, 13, 'gallery'], // 3
  [-24, -18, 17, 'gallery'], // 4
  [-35, -20, 12, 'throat'], // 5
  [-45, -23, 2, 'throat'], // 6
  [-52, -24.5, -12, 'throat'], // 7
  [-60, -26.5, -30, 'hall'], // 8 光之厅
  [-63, -28.5, -48, 'hall'], // 9
  [-61, -31, -66, 'halo'], // 10 卤水层
  [-53, -33.5, -82, 'halo'], // 11
  [-41, -36, -94, 'wreck'], // 12 沉船厅
  [-25, -38, -102, 'wreck'], // 13
  [-9, -40.5, -104, 'collapse'], // 14
  [5, -42.5, -99, 'collapse'], // 15
  [17, -45, -87, 'abyss'], // 16
  [27, -47, -68, 'abyss'], // 17 深渊大厅中心
  [31, -46, -48, 'abyss'], // 18 烟囱入口侧
  [27, -38, -33, 'chimney'], // 19
  [17, -29.5, -21, 'chimney'], // 20
  [7, -21.5, -14, 'chimney'], // 21
  [1, -14, -7, 'chimney'], // 22
  [0.2, -7.5, -2, 'shaft'], // 23 回接竖井
];

const ZONE_RADIUS: Record<ZoneName, number> = {
  shaft: 6.2,
  gallery: 5.0,
  throat: 2.7,
  hall: 12.5,
  halo: 7.5,
  wreck: 10.5,
  collapse: 3.2,
  abyss: 16.5,
  chimney: 4.2,
};

/** 半径插值节点 */
interface RKnot { t: number; r: number; }

function radiusFromKnots(knots: RKnot[], closed: boolean, t: number): number {
  const n = knots.length;
  if (t <= knots[0].t) {
    if (!closed) return knots[0].r;
  }
  for (let i = 0; i < n; i++) {
    const a = knots[i];
    const b = knots[(i + 1) % n];
    let t1 = b.t;
    let tt = t;
    if (i === n - 1) {
      if (!closed) return a.r;
      t1 = b.t + 1;
      if (tt < a.t) tt += 1;
    }
    if (tt >= a.t && tt <= t1) {
      const k = t1 === a.t ? 0 : (tt - a.t) / (t1 - a.t);
      const s = 0.5 - 0.5 * Math.cos(k * Math.PI); // cosine 平滑
      return a.r + (b.r - a.r) * s;
    }
  }
  return knots[0].r;
}

export class Cave {
  readonly group = new THREE.Group();
  readonly paths: CavePath[] = [];
  readonly zones: Zone[] = [];
  readonly props: CaveProp[] = [];
  /** 区域点光注册表：Game 每帧按距离启停 */
  readonly zoneLights: THREE.PointLight[] = [];
  /** 道具辉光灯（半径小，用更近的剔除距离） */
  readonly propLights: THREE.PointLight[] = [];

  /** 主脉便捷别名（兼容 Story/Scare 旧接口） */
  get curve(): THREE.CatmullRomCurve3 {
    return this.paths[0].curve;
  }

  /** 关键地标（Landmarks/Game 共用） */
  readonly pitCenter = new THREE.Vector3(); // 深渊井口
  readonly crackPoint = new THREE.Vector3(); // 光之厅顶部裂隙
  readonly poolCenter = new THREE.Vector3(0, 0, 0.6); // 水面泳池中心
  readonly poolRadius = 6.4;

  private zoneT = new Map<ZoneName, { t0: number; t1: number }>();
  readonly rock: ReturnType<typeof rockMaps>;
  private q: QualityProfile;

  constructor(q: QualityProfile) {
    this.q = q;
    this.rock = rockMaps(q.texSize);

    // ---------- 主脉（闭环） ----------
    const mainCurve = new THREE.CatmullRomCurve3(
      CP.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      'catmullrom',
      0.5,
    );
    const MAIN_N = 1600;
    const mainSamples: THREE.Vector3[] = [];
    for (let i = 0; i <= MAIN_N; i++) mainSamples.push(mainCurve.getPointAt(i / MAIN_N));

    // 控制点 → t（最近采样搜索）
    const cpT: number[] = CP.map(([x, y, z]) => {
      const p = new THREE.Vector3(x, y, z);
      let best = 0, bd = Infinity;
      for (let i = 0; i <= MAIN_N; i++) {
        const d = mainSamples[i].distanceToSquared(p);
        if (d < bd) { bd = d; best = i; }
      }
      return best / MAIN_N;
    });

    // 半径节点 & 分区表
    const knots: RKnot[] = CP.map(([, , , zn], i) => ({ t: cpT[i], r: ZONE_RADIUS[zn] }));
    const mainPath: CavePath = {
      id: 0,
      curve: mainCurve,
      closed: true,
      samples: mainSamples,
      sampleN: MAIN_N,
      radiusAt: (t: number) => {
        const tt = ((t % 1) + 1) % 1;
        let r = radiusFromKnots(knots, true, tt);
        // 咽喉局部起伏（挤压感）
        r *= 1 + Math.sin(tt * 230) * 0.05;
        return Math.max(1.8, r);
      },
    };
    this.paths.push(mainPath);

    // 分区 t 范围（同名控制点跨度，向邻居中点扩展）
    const order: ZoneName[] = ['shaft', 'gallery', 'throat', 'hall', 'halo', 'wreck', 'collapse', 'abyss', 'chimney'];
    const firstIdx: Partial<Record<ZoneName, number>> = {};
    const lastIdx: Partial<Record<ZoneName, number>> = {};
    CP.forEach(([, , , zn], i) => {
      if (!(zn in firstIdx) && zn !== 'shaft') firstIdx[zn] = i;
      if (zn !== 'shaft') lastIdx[zn] = i;
    });
    firstIdx.shaft = 0;
    lastIdx.shaft = 2;
    for (let k = 0; k < order.length; k++) {
      const zn = order[k];
      const prev = order[(k - 1 + order.length) % order.length];
      const next = order[(k + 1) % order.length];
      let t0 = (cpT[firstIdx[zn]!] + cpT[lastIdx[prev]!]) / 2;
      let t1 = (cpT[lastIdx[zn]!] + cpT[firstIdx[next]!]) / 2;
      if (zn === 'shaft') t0 = 0;
      if (zn === 'chimney') t1 = cpT[23] + (1 - cpT[23]) * 0.5;
      this.zones.push({ name: zn, t0, t1 });
      this.zoneT.set(zn, { t0, t1 });
    }

    // ---------- 支线 A：玛雅祭坛壁龛（沉船厅侧壁） ----------
    const stubA = this.buildStub(1, [
      [-36, -39, -106],
      [-38, -40.5, -114],
      [-41, -41, -122],
      [-43, -40.5, -130],
    ], [
      { t: 0, r: 3.0 },
      { t: 0.35, r: 2.3 },
      { t: 0.8, r: 4.3 },
      { t: 1, r: 0.8 },
    ]);
    this.paths.push(stubA);

    // ---------- 支线 B：错绳死胡同（塌方段侧壁） ----------
    const stubB = this.buildStub(2, [
      [-2, -41.5, -104],
      [0, -42.5, -112],
      [5, -44, -118],
      [3, -46, -126],
    ], [
      { t: 0, r: 2.8 },
      { t: 0.4, r: 2.1 },
      { t: 0.85, r: 3.4 },
      { t: 1, r: 0.7 },
    ]);
    this.paths.push(stubB);

    // ---------- 地标锚点 ----------
    const abyssT = (this.zoneT.get('abyss')!.t0 + this.zoneT.get('abyss')!.t1) / 2;
    const abyssC = mainCurve.getPointAt(abyssT);
    this.pitCenter.set(abyssC.x, abyssC.y - mainPath.radiusAt(abyssT) * 0.92, abyssC.z);
    const hallT = (this.zoneT.get('hall')!.t0 + this.zoneT.get('hall')!.t1) / 2;
    const hallC = mainCurve.getPointAt(hallT);
    this.crackPoint.set(hallC.x, hallC.y + mainPath.radiusAt(hallT) * 0.94, hallC.z);

    // ---------- 网格 ----------
    const rockMat = new THREE.MeshStandardMaterial({
      map: this.rock.map,
      bumpMap: this.rock.bumpMap,
      bumpScale: 1.4,
      roughnessMap: this.rock.roughnessMap,
      color: 0x93a29c,
      roughness: 0.96,
      metalness: 0.02,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    rockMat.map!.anisotropy = 4;

    this.group.add(this.buildTube(mainPath, q.tubeSegments, q.tubeRadial, rockMat, true));
    this.group.add(this.buildTube(stubA, 140, Math.max(20, Math.floor(q.tubeRadial * 0.5)), rockMat, false));
    this.group.add(this.buildTube(stubB, 140, Math.max(20, Math.floor(q.tubeRadial * 0.5)), rockMat, false));

    this.buildRocks(q, rockMat);
  }

  private buildStub(id: number, pts: [number, number, number][], knots: RKnot[]): CavePath {
    const curve = new THREE.CatmullRomCurve3(
      pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      'catmullrom',
      0.5,
    );
    const N = 400;
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) samples.push(curve.getPointAt(i / N));
    return {
      id,
      curve,
      closed: false,
      samples,
      sampleN: N,
      radiusAt: (t: number) => Math.max(0.7, radiusFromKnots(knots, false, Math.max(0, Math.min(1, t)))),
    };
  }

  // ---------- 管几何（带镂空） ----------
  private buildTube(
    path: CavePath,
    segs: number,
    radial: number,
    mat: THREE.Material,
    isMain: boolean,
  ): THREE.Mesh {
    const frames = path.curve.computeFrenetFrames(segs, path.closed);
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const centers: THREE.Vector3[] = [];
    const ringT: number[] = [];

    const lenScale = isMain ? 1 : 0.16; // 支线噪声频率贴近主脉尺度
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ringT.push(t);
      const center = path.curve.getPointAt(path.closed ? t % 1 : Math.min(1, t));
      centers.push(center);
      const fi = Math.min(i, segs - 1);
      const N = frames.normals[fi];
      const B = frames.binormals[fi];
      const baseR = path.radiusAt(t);
      for (let j = 0; j <= radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        const bump = ridged(t * lenScale, ang) * 0.34 * baseR * 0.24;
        let r = baseR + bump;
        const worldY = N.y * Math.cos(ang) + B.y * Math.sin(ang);
        if (worldY < -0.45) r *= 1 - (Math.abs(worldY) - 0.45) * 0.28; // 底部沉积平坦
        const sin = Math.sin(ang);
        const x = center.x + (N.x * Math.cos(ang) + B.x * sin) * r;
        const y = center.y + (N.y * Math.cos(ang) + B.y * sin) * r;
        const z = center.z + (N.z * Math.cos(ang) + B.z * sin) * r;
        pos.push(x, y, z);
        uv.push((j / radial) * (isMain ? 10 : 3), t * (isMain ? 120 : 8));
        // 顶点 AO：凹陷更暗（bump 为负→裂隙）
        const ao = Math.max(0.42, Math.min(1.15, 0.86 + (bump / Math.max(0.4, baseR * 0.082)) * 0.34));
        col.push(ao, ao, ao);
      }
    }

    // 镂空球列表
    const holes: { c: THREE.Vector3; r: number }[] = [];
    if (isMain) {
      holes.push({ c: this.pitCenter, r: 5.0 }); // 深渊井口
      holes.push({ c: this.crackPoint, r: 1.9 }); // 光之厅天窗裂隙
    }

    const qc = new THREE.Vector3();
    const stubs = this.paths.filter((p) => p.id !== path.id && !p.closed);
    const main = this.paths[0];

    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        // 四边形中心
        qc.set(
          (pos[a * 3] + pos[b * 3] + pos[(a + 1) * 3] + pos[(b + 1) * 3]) / 4,
          (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[(a + 1) * 3 + 1] + pos[(b + 1) * 3 + 1]) / 4,
          (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[(a + 1) * 3 + 2] + pos[(b + 1) * 3 + 2]) / 4,
        );
        let skip = false;

        if (isMain) {
          // ① 天窗：水面以上全部敞开（天坑开口）
          if (qc.y > -0.35) skip = true;
          // ② 接缝双壁去重：去程/回程管在竖井重叠段，去掉互相穿插的内壁
          if (!skip) {
            const t = ringT[i];
            if (t < 0.09 || t > 0.91) {
              const cont = this.containmentExcluding(main, qc, t, 0.09);
              if (cont < -0.6) skip = true;
            }
          }
          // ③ 支线洞口
          if (!skip) {
            for (const s of stubs) {
              if (qc.distanceToSquared(s.samples[0]) < 14 * 14) {
                const hit = this.nearestOnPath(s, qc, null);
                if (hit.dist - s.radiusAt(hit.t) < -0.35) { skip = true; break; }
              }
            }
          }
          // ④ 深井/裂隙镂空
          if (!skip) {
            for (const h of holes) {
              if (qc.distanceToSquared(h.c) < h.r * h.r) { skip = true; break; }
            }
          }
        } else {
          // 支线：深入主厅内部的管壁裁掉（保留 ~1.2m 洞口领圈）
          const hit = this.nearestOnPath(main, qc, null);
          if (hit.dist - main.radiusAt(hit.t) < -1.2) skip = true;
        }

        if (!skip) idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  /**
   * 焦散壳几何：与主管完全相同的顶点公式（含凹凸位移）内缩 inset，
   * 保证贴合岩壁。顶点色 = 深度衰减（水面以上为 0）。
   */
  buildShellGeometry(tEnd: number, inset: number): THREE.BufferGeometry {
    const path = this.paths[0];
    const segs = Math.max(24, Math.ceil(this.q.tubeSegments * tEnd));
    const radial = this.q.tubeRadial;
    const fullSegs = this.q.tubeSegments;
    const frames = path.curve.computeFrenetFrames(fullSegs, true);
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * tEnd;
      const center = path.curve.getPointAt(t % 1);
      const fi = Math.min(Math.round(t * fullSegs), fullSegs - 1);
      const N = frames.normals[fi];
      const B = frames.binormals[fi];
      const baseR = path.radiusAt(t);
      for (let j = 0; j <= radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        const bump = ridged(t, ang) * 0.34 * baseR * 0.24;
        let r = baseR + bump;
        const worldY = N.y * Math.cos(ang) + B.y * Math.sin(ang);
        if (worldY < -0.45) r *= 1 - (Math.abs(worldY) - 0.45) * 0.28;
        r -= inset;
        const sin = Math.sin(ang);
        const x = center.x + (N.x * Math.cos(ang) + B.x * sin) * r;
        const y = center.y + (N.y * Math.cos(ang) + B.y * sin) * r;
        const z = center.z + (N.z * Math.cos(ang) + B.z * sin) * r;
        pos.push(x, y, z);
        uv.push((j / radial) * 3, t * 110);
        const fade = y > -0.4 ? 0 : Math.pow(Math.max(0, Math.min(1, 1 - Math.abs(y) / 13)), 1.5);
        col.push(fade, fade, fade);
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /** 主脉上排除 |Δt|<excl 邻域后的最深包含（接缝去重用） */
  private containmentExcluding(path: CavePath, p: THREE.Vector3, selfT: number, excl: number): number {
    let best = Infinity;
    const n = path.sampleN;
    for (let i = 0; i <= n; i += 2) {
      const t = i / n;
      let dt = Math.abs(t - selfT);
      if (dt > 0.5) dt = 1 - dt;
      if (dt < excl) continue;
      const d = path.samples[i].distanceTo(p) - path.radiusAt(t);
      if (d < best) best = d;
    }
    return best;
  }

  /** 岩壁凸石：跨主脉打散管壁剪影 */
  private buildRocks(q: QualityProfile, baseMat: THREE.MeshStandardMaterial): void {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(1 + n2(i, i * 3) * 0.38);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = baseMat.clone();
    mat.color.set(0x606d67);
    mat.vertexColors = false;
    mat.side = THREE.FrontSide;
    const mesh = new THREE.InstancedMesh(geo, mat, q.rocks);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const main = this.paths[0];
    for (let i = 0; i < q.rocks; i++) {
      const t = Math.random();
      const ang = Math.random() * Math.PI * 2;
      const center = main.curve.getPointAt(t);
      const tan = main.curve.getTangentAt(t);
      const N = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
      if (N.lengthSq() < 0.01) N.set(1, 0, 0);
      const B = tan.clone().cross(N).normalize();
      const r = main.radiusAt(t) * (1.02 + Math.random() * 0.12);
      const posv = center
        .clone()
        .addScaledVector(N, Math.cos(ang) * r)
        .addScaledVector(B, Math.sin(ang) * r);
      if (posv.y > -3) { // 井口浅层不放凸石：从下仰望时会在 Snell 窗上剪出杂乱黑块
        i--;
        continue;
      }
      const s = (0.28 + Math.random() * 0.85) * Math.min(2.2, main.radiusAt(t) * 0.16 + 0.7);
      scl.set(s, s * (0.6 + Math.random() * 0.9), s);
      quat.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      m.compose(posv, quat, scl);
      mesh.setMatrixAt(i, m);
    }
    this.group.add(mesh);
  }

  // ---------- 空间查询 ----------

  /** 路径上最近点（hint 为空则粗扫+细化；主脉窗口环形回绕） */
  nearestOnPath(path: CavePath, p: THREE.Vector3, hintT: number | null): { t: number; dist: number } {
    const n = path.sampleN;
    let center: number;
    let win: number;
    if (hintT === null) {
      let best = 0, bd = Infinity;
      for (let i = 0; i <= n; i += 8) {
        const d = path.samples[i].distanceToSquared(p);
        if (d < bd) { bd = d; best = i; }
      }
      center = best;
      win = 10;
    } else {
      center = Math.round(((hintT % 1) + 1) % 1 * n);
      win = path.id === 0 ? 150 : 60;
    }
    let best = center, bd = Infinity;
    for (let k = -win; k <= win; k++) {
      let i = center + k;
      if (path.closed) i = ((i % n) + n) % n;
      else i = Math.max(0, Math.min(n, i));
      const d = path.samples[i].distanceToSquared(p);
      if (d < bd) { bd = d; best = i; }
    }
    return { t: best / n, dist: Math.sqrt(bd) };
  }

  /**
   * 多路径解算：返回包含度最深的管（玩家软约束、支线进出自然切换）。
   * hint 供上一帧路径 t 加速。
   */
  resolve(p: THREE.Vector3, hintPathId: number, hintT: number): CaveHit {
    let best: CaveHit | null = null;
    for (const path of this.paths) {
      const hint = path.id === hintPathId ? hintT : null;
      const near = this.nearestOnPath(path, p, hint);
      const radius = path.radiusAt(near.t);
      const containment = near.dist - radius;
      if (!best || containment < best.containment) {
        best = {
          pathId: path.id,
          t: near.t,
          center: path.samples[Math.round(near.t * path.sampleN)].clone(),
          radius,
          dist: near.dist,
          containment,
        };
      }
    }
    return best!;
  }

  /** 主脉便捷接口（兼容旧代码） */
  pointAt(t: number): THREE.Vector3 {
    const main = this.paths[0];
    const tt = ((t % 1) + 1) % 1;
    return main.samples[Math.max(0, Math.min(main.sampleN, Math.round(tt * main.sampleN)))];
  }

  radiusAt(t: number): number {
    return this.paths[0].radiusAt(((t % 1) + 1) % 1);
  }

  nearestT(p: THREE.Vector3, hintT: number): number {
    return this.nearestOnPath(this.paths[0], p, hintT).t;
  }

  zoneAt(t: number): ZoneName {
    const tt = ((t % 1) + 1) % 1;
    for (const z of this.zones) {
      if (tt >= z.t0 && tt < z.t1) return z.name;
    }
    return 'shaft';
  }

  zoneRange(name: ZoneName): { t0: number; t1: number } {
    return this.zoneT.get(name)!;
  }

  /** 路径局部坐标系 */
  frameAt(pathId: number, t: number): { p: THREE.Vector3; tan: THREE.Vector3; N: THREE.Vector3; B: THREE.Vector3 } {
    const path = this.paths[pathId];
    const tt = path.closed ? ((t % 1) + 1) % 1 : Math.max(0, Math.min(1, t));
    const p = path.curve.getPointAt(tt);
    const tan = path.curve.getTangentAt(tt);
    const N = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
    if (N.lengthSq() < 0.01) N.set(1, 0, 0);
    const B = tan.clone().cross(N).normalize();
    return { p, tan, N, B };
  }

  /** 布设道具（写字板/气瓶/线轴/减压表/相机） */
  addProp(kind: CaveProp['kind'], t: number, angle: number, pathId = 0): CaveProp {
    const { p: center, N, B } = this.frameAt(pathId, t);
    const path = this.paths[pathId];
    const r = path.radiusAt(t) * 0.66;
    const posv = center
      .clone()
      .addScaledVector(N, Math.cos(angle) * r)
      .addScaledVector(B, Math.sin(angle) * r);

    const obj = this.buildPropMesh(kind);
    obj.position.copy(posv);
    obj.lookAt(center);
    this.group.add(obj);
    // 道具辉光灯全部注册进近距剔除列表（前向渲染灯数是帧成本大头）
    obj.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) this.propLights.push(o as THREE.PointLight);
    });
    const prop: CaveProp = { kind, t, pathId, mesh: obj };
    this.props.push(prop);
    return prop;
  }

  private buildPropMesh(kind: CaveProp['kind']): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'slate') {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.22, 0.012),
        new THREE.MeshStandardMaterial({ color: 0xd8d2c2, emissive: 0x35301f, roughness: 0.5 }),
      );
      g.add(board);
      const glow = new THREE.PointLight(0xe8d9a0, 1.6, 2.6, 1.8);
      g.add(glow);
    } else if (kind === 'tank' || kind === 'tankEmpty') {
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.62, 12),
        new THREE.MeshStandardMaterial({ color: 0xb8b4a6, metalness: 0.6, roughness: 0.35 }),
      );
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.112, 0.112, 0.09, 12),
        new THREE.MeshStandardMaterial({ color: 0xe8a33d, emissive: 0x6a4310, roughness: 0.4 }),
      );
      stripe.position.y = 0.12;
      const valve = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.045, 0.1, 8),
        new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8, roughness: 0.3 }),
      );
      valve.position.y = 0.36;
      g.add(body, stripe, valve);
      g.rotation.z = 0.45 + Math.random() * 0.4;
      const glow = new THREE.PointLight(0xe8a33d, 1.4, 3, 1.8);
      g.add(glow);
    } else if (kind === 'reel') {
      // 线轴：不属于任何人的崭新线轴（错绳支线终点）
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.1, 14),
        new THREE.MeshStandardMaterial({ color: 0xdfdad0, roughness: 0.4, metalness: 0.15 }),
      );
      drum.rotation.x = Math.PI / 2;
      const frame = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.014, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0x30363a, roughness: 0.5, metalness: 0.4 }),
      );
      g.add(drum, frame);
      const glow = new THREE.PointLight(0xd8e8e0, 1.2, 3, 1.8);
      g.add(glow);
    } else if (kind === 'gauge') {
      // 挂在线上的减压表（Z9 剧情道具）
      const dial = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.025, 16),
        new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.35, metalness: 0.5 }),
      );
      dial.rotation.x = Math.PI / 2;
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.05, 16),
        new THREE.MeshStandardMaterial({ color: 0xd9d2b8, emissive: 0x4a4430, roughness: 0.3 }),
      );
      face.position.z = 0.014;
      const hose = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.8 }),
      );
      hose.position.y = 0.28;
      g.add(dial, face, hose);
      const glow = new THREE.PointLight(0xe8d9a0, 1.2, 2.4, 1.8);
      g.add(glow);
    } else if (kind === 'camera') {
      // 萝拉的水下相机
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x2c3236, roughness: 0.4, metalness: 0.35 }),
      );
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.04, 0.05, 12),
        new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.2, metalness: 0.6 }),
      );
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.06;
      // 还亮着的红色录制灯
      const rec = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xc8341f, emissiveIntensity: 3 }),
      );
      rec.position.set(0.06, 0.06, 0.03);
      g.add(body, lens, rec);
      const glow = new THREE.PointLight(0xc8341f, 1.0, 3, 1.8);
      g.add(glow);
    } else if (kind === 'ammonite') {
      // 菊石化石：嵌在岩壁里的对数螺旋（一段一段的环面近似）
      const mat = new THREE.MeshStandardMaterial({ color: 0x9a8f78, roughness: 0.75, metalness: 0.05 });
      let r = 0.3;
      for (let i = 0; i < 9; i++) {
        const seg = new THREE.Mesh(new THREE.TorusGeometry(r, 0.028 + r * 0.14, 6, 12, 1.15), mat);
        seg.rotation.z = i * 1.05;
        g.add(seg);
        r *= 0.78;
      }
      g.scale.setScalar(0.9);
      const glow = new THREE.PointLight(0xd8c8a0, 1.1, 3.2, 1.8);
      glow.position.z = 0.4;
      g.add(glow);
    } else if (kind === 'handprints') {
      // 手印岩画：赭红色负手印一片（玛雅洞穴岩画的经典形制）
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(1.3, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x6e4634, roughness: 0.95, transparent: true, opacity: 0.85 }),
      );
      g.add(panel);
      const printMat = new THREE.MeshStandardMaterial({ color: 0xa8442c, emissive: 0x30100a, roughness: 0.9 });
      for (let i = 0; i < 7; i++) {
        const palm = new THREE.Mesh(new THREE.CircleGeometry(0.055, 8), printMat);
        palm.position.set((Math.sin(i * 5.3) * 0.5), (Math.cos(i * 3.7) * 0.3), 0.01);
        g.add(palm);
        for (let f = 0; f < 5; f++) {
          const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.05, 3, 5), printMat);
          const ang = -0.6 + f * 0.3;
          finger.position.set(
            palm.position.x + Math.sin(ang) * 0.085,
            palm.position.y + Math.cos(ang) * 0.085,
            0.01,
          );
          finger.rotation.z = -ang;
          g.add(finger);
        }
      }
      const glow = new THREE.PointLight(0xc87a54, 1.3, 3.6, 1.8);
      glow.position.z = 0.5;
      g.add(glow);
    } else if (kind === 'pot') {
      // 玛雅陶罐：车削轮廓 + 缠枝纹刻痕
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const v = i / 12;
        const r = 0.05 + Math.sin(v * Math.PI) * 0.16 + (v > 0.85 ? -(v - 0.85) * 0.5 : 0);
        pts.push(new THREE.Vector2(Math.max(0.04, r), v * 0.42));
      }
      const body = new THREE.Mesh(
        new THREE.LatheGeometry(pts, 18),
        new THREE.MeshStandardMaterial({ color: 0x7a5138, roughness: 0.88 }),
      );
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.014, 6, 14),
        new THREE.MeshStandardMaterial({ color: 0x5e3c28, roughness: 0.9 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.42;
      const stripe = new THREE.Mesh(
        new THREE.TorusGeometry(0.205, 0.008, 5, 20),
        new THREE.MeshStandardMaterial({ color: 0xc8a874, emissive: 0x2a2012, roughness: 0.7 }),
      );
      stripe.rotation.x = Math.PI / 2;
      stripe.position.y = 0.2;
      g.add(body, rim, stripe);
      g.rotation.z = 0.35; // 半埋斜倚
      const glow = new THREE.PointLight(0xd8b48a, 1.2, 3.2, 1.8);
      glow.position.y = 0.5;
      g.add(glow);
    } else if (kind === 'helictite') {
      // 石膏针晶簇：违反重力方向乱长的细针（洞穴学奇观）
      const mat = new THREE.MeshStandardMaterial({
        color: 0xe8e4da, emissive: 0x2a2820, roughness: 0.35, metalness: 0.1,
      });
      for (let i = 0; i < 22; i++) {
        const len = 0.12 + Math.abs(Math.sin(i * 7.3)) * 0.3;
        const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, len, 5), mat);
        needle.position.set(Math.sin(i * 2.4) * 0.3, Math.cos(i * 1.7) * 0.22, Math.sin(i * 3.1) * 0.1);
        needle.rotation.set(Math.sin(i * 5.1) * 1.4, 0, Math.cos(i * 4.3) * 1.4);
        g.add(needle);
      }
      const glow = new THREE.PointLight(0xe8f0e4, 1.5, 3.4, 1.8);
      glow.position.z = 0.4;
      g.add(glow);
    } else if (kind === 'crayfish') {
      // 盲螯虾群：无色素的白色小虾伏在岩面（顶级掠食者，指甲盖大）
      const body = new THREE.MeshStandardMaterial({ color: 0xe9e2d4, emissive: 0x3a352a, roughness: 0.5 });
      for (let i = 0; i < 6; i++) {
        const shrimp = new THREE.Group();
        const thorax = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.05, 3, 6), body);
        thorax.rotation.x = Math.PI / 2;
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.045, 5), body);
        tail.rotation.x = -Math.PI / 2;
        tail.position.z = -0.055;
        for (const s of [-1, 1]) {
          const claw = new THREE.Mesh(new THREE.CapsuleGeometry(0.005, 0.035, 3, 5), body);
          claw.rotation.set(Math.PI / 2, 0, s * 0.5);
          claw.position.set(s * 0.02, 0, 0.045);
          shrimp.add(claw);
        }
        shrimp.add(thorax, tail);
        shrimp.position.set(Math.sin(i * 4.1) * 0.35, Math.cos(i * 2.9) * 0.25, 0.02);
        shrimp.rotation.z = i * 2.2;
        g.add(shrimp);
      }
      const glow = new THREE.PointLight(0xdfe8de, 1.0, 2.8, 1.8);
      glow.position.z = 0.3;
      g.add(glow);
    }
    return g;
  }
}
