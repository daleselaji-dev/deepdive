import * as THREE from 'three';
import type { QualityProfile } from './quality';
import { rockTexture, shaftTexture } from './textures';

/**
 * 「寂静之井」洞穴本体：样条隧道（顶点噪声位移的自定义管几何）、
 * 导览线与箭头、写字板、备用气瓶、入水光柱、井底红幕。
 */

export interface CaveProp {
  kind: 'slate' | 'tank';
  t: number;
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

export class Cave {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  readonly props: CaveProp[] = [];
  readonly redVeil: THREE.Mesh;
  readonly redLight: THREE.PointLight;
  readonly shafts: THREE.Mesh[] = [];
  private samples: THREE.Vector3[] = [];
  private readonly SAMPLE_N = 1600;

  constructor(q: QualityProfile) {
    this.curve = new THREE.CatmullRomCurve3(
      [
        [0, -4, 0],
        [2, -7, -18],
        [-6, -10, -34],
        [4, -14, -52],
        [-3, -16, -70],
        [0, -20, -86],
        [8, -24, -102],
        [-6, -27, -122],
        [0, -31, -140],
        [7, -34, -158],
        [-4, -38, -176],
        [0, -41, -192],
        [0, -44, -206],
        [0, -45.5, -222],
      ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      false,
      'catmullrom',
      0.5,
    );

    for (let i = 0; i <= this.SAMPLE_N; i++) {
      this.samples.push(this.curve.getPointAt(i / this.SAMPLE_N));
    }

    const rockMat = new THREE.MeshStandardMaterial({
      map: rockTexture(q.tier === 'mobile' ? 256 : 512),
      color: 0x8a9a94,
      roughness: 0.96,
      metalness: 0.02,
      side: THREE.BackSide,
    });
    rockMat.map!.repeat.set(6, 22);

    const tube = this.buildTunnel(q, rockMat);
    this.group.add(tube);

    this.buildRocks(q);
    this.buildGuideline();
    this.buildSpeleothems(q);
    this.buildShafts(q);

    // 井底红幕
    const veilMat = new THREE.MeshBasicMaterial({
      color: 0x8a1111,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.redVeil = new THREE.Mesh(new THREE.CircleGeometry(6.5, 40), veilMat);
    const endP = this.curve.getPointAt(0.995);
    const endTan = this.curve.getTangentAt(0.995);
    this.redVeil.position.copy(endP);
    this.redVeil.lookAt(endP.clone().sub(endTan));
    this.group.add(this.redVeil);

    this.redLight = new THREE.PointLight(0xc8341f, 0, 26, 1.4);
    this.redLight.position.copy(this.curve.getPointAt(0.975));
    this.group.add(this.redLight);
  }

  /** 半径剖面：入口宽 → 咽喉收窄 → 中段 → 井底大厅 */
  radiusAt(t: number): number {
    const throat = 1 - 0.62 * Math.exp(-Math.pow((t - 0.3) / 0.07, 2));
    const mid = 1 - 0.3 * Math.exp(-Math.pow((t - 0.62) / 0.05, 2));
    const base = 6.4 - 2.8 * Math.min(t * 4, 1);
    const hall = 1 + 3.2 * Math.exp(-Math.pow((t - 1.0) / 0.045, 2));
    return Math.max(2.1, base * throat * mid * hall);
  }

  private buildTunnel(q: QualityProfile, mat: THREE.Material): THREE.Mesh {
    const segs = q.tubeSegments;
    const radial = q.tubeRadial;
    const frames = this.curve.computeFrenetFrames(segs, false);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const center = this.curve.getPointAt(t);
      const N = frames.normals[Math.min(i, segs - 1)];
      const B = frames.binormals[Math.min(i, segs - 1)];
      const baseR = this.radiusAt(t);
      for (let j = 0; j <= radial; j++) {
        const ang = (j / radial) * Math.PI * 2;
        // 岩壁起伏：分形噪声 + 底部沉积平坦化
        const bump = ridged(t, ang) * 0.34 * baseR * 0.24;
        let r = baseR + bump;
        const sin = Math.sin(ang);
        if (sin < -0.45) r *= 1 - (Math.abs(sin) - 0.45) * 0.25; // 底部略平（沉积物）
        const x = center.x + (N.x * Math.cos(ang) + B.x * sin) * r;
        const y = center.y + (N.y * Math.cos(ang) + B.y * sin) * r;
        const z = center.z + (N.z * Math.cos(ang) + B.z * sin) * r;
        pos.push(x, y, z);
        uv.push(j / radial, t * 30);
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
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  /** 岩壁凸石：打散管壁剪影 */
  private buildRocks(q: QualityProfile): void {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(1 + n2(i, i * 3) * 0.38);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c6a66, roughness: 0.98 });
    const mesh = new THREE.InstancedMesh(geo, mat, q.rocks);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    for (let i = 0; i < q.rocks; i++) {
      const t = 0.02 + Math.random() * 0.95;
      const ang = Math.random() * Math.PI * 2;
      const center = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      const N = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
      if (N.lengthSq() < 0.01) N.set(1, 0, 0);
      const B = tan.clone().cross(N).normalize();
      const r = this.radiusAt(t) * (0.94 + Math.random() * 0.1);
      const posv = center
        .clone()
        .addScaledVector(N, Math.cos(ang) * r)
        .addScaledVector(B, Math.sin(ang) * r);
      const s = 0.35 + Math.random() * 1.5;
      scl.set(s, s * (0.6 + Math.random() * 0.9), s);
      quat.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
      m.compose(posv, quat, scl);
      mesh.setMatrixAt(i, m);
    }
    this.group.add(mesh);
  }

  /** 导览线：贴着右侧壁的细白线 + 指向"里面"的箭头（叙事点） */
  private buildGuideline(): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 320; i++) {
      const t = 0.02 + (i / 320) * 0.955;
      const center = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t);
      const N = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
      if (N.lengthSq() < 0.01) N.set(1, 0, 0);
      const B = tan.clone().cross(N).normalize();
      const r = this.radiusAt(t) * 0.8;
      const sag = Math.sin(i * 1.7) * 0.06;
      pts.push(
        center
          .clone()
          .addScaledVector(N, Math.cos(-0.9) * r)
          .addScaledVector(B, Math.sin(-0.9) * r + sag),
      );
    }
    const lineCurve = new THREE.CatmullRomCurve3(pts);
    const lineGeo = new THREE.TubeGeometry(lineCurve, 360, 0.014, 5, false);
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xd8d2c2,
      roughness: 0.7,
      emissive: 0x2a281f,
    });
    this.group.add(new THREE.Mesh(lineGeo, lineMat));

    // 箭头标：全部指向深处（不对劲的关键道具）
    const arrowGeo = new THREE.ConeGeometry(0.06, 0.2, 4);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2d4,
      emissive: 0x4a4030,
      roughness: 0.5,
    });
    for (let k = 0; k < 9; k++) {
      const t = 0.1 + k * 0.1;
      const i = Math.min(319, Math.round(((t - 0.02) / 0.955) * 320));
      const p = pts[i];
      const dir = pts[Math.min(i + 2, 320)].clone().sub(p).normalize();
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.copy(p);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      this.group.add(arrow);
    }
  }

  /** 浅段钟乳石（cenote 特征） */
  private buildSpeleothems(q: QualityProfile): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a857e, roughness: 0.92 });
    const count = Math.floor(q.rocks * 0.24);
    const geo = new THREE.ConeGeometry(0.35, 2.6, 7);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const quatDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    for (let i = 0; i < count; i++) {
      const t = 0.01 + Math.random() * 0.16;
      const center = this.curve.getPointAt(t);
      const r = this.radiusAt(t);
      const posv = center.clone();
      posv.y += r * (0.82 + Math.random() * 0.12);
      posv.x += (Math.random() - 0.5) * r * 1.1;
      posv.z += (Math.random() - 0.5) * 2;
      const s = 0.4 + Math.random() * 1.2;
      m.compose(posv, quatDown, new THREE.Vector3(s, s * (0.8 + Math.random()), s));
      mesh.setMatrixAt(i, m);
    }
    this.group.add(mesh);
  }

  /** 入水段光柱（天坑开口漏下的光） */
  private buildShafts(q: QualityProfile): void {
    const tex = shaftTexture();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < q.godRays; i++) {
      const h = 12 + Math.random() * 8;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.7 + Math.random() * 1.6, h), mat);
      const t = Math.random() * 0.045;
      const c = this.curve.getPointAt(t);
      plane.position.set(c.x + (Math.random() - 0.5) * 7, c.y + 3 + Math.random() * 3, c.z + (Math.random() - 0.5) * 6);
      plane.rotation.set((Math.random() - 0.5) * 0.24, Math.random() * Math.PI, (Math.random() - 0.5) * 0.18);
      this.shafts.push(plane);
      this.group.add(plane);
    }
  }

  /** 布设写字板与备用气瓶（叙事+资源道具） */
  addProp(kind: CaveProp['kind'], t: number, angle: number): CaveProp {
    const center = this.curve.getPointAt(t);
    const tan = this.curve.getTangentAt(t);
    const N = new THREE.Vector3(0, 1, 0).cross(tan).normalize();
    if (N.lengthSq() < 0.01) N.set(1, 0, 0);
    const B = tan.clone().cross(N).normalize();
    const r = this.radiusAt(t) * 0.66;
    const posv = center
      .clone()
      .addScaledVector(N, Math.cos(angle) * r)
      .addScaledVector(B, Math.sin(angle) * r);

    let obj: THREE.Object3D;
    if (kind === 'slate') {
      const g = new THREE.Group();
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.22, 0.012),
        new THREE.MeshStandardMaterial({ color: 0xd8d2c2, emissive: 0x35301f, roughness: 0.5 }),
      );
      g.add(board);
      const glow = new THREE.PointLight(0xe8d9a0, 1.6, 2.6, 1.8);
      g.add(glow);
      obj = g;
    } else {
      const g = new THREE.Group();
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
      obj = g;
    }
    obj.position.copy(posv);
    obj.lookAt(center);
    this.group.add(obj);
    const prop: CaveProp = { kind, t, mesh: obj };
    this.props.push(prop);
    return prop;
  }

  /** 最近样条参数（带 hint 的局部搜索，玩家约束用） */
  nearestT(p: THREE.Vector3, hintT: number): number {
    const n = this.SAMPLE_N;
    const center = Math.round(hintT * n);
    const win = 90;
    let best = Math.max(0, Math.min(n, center));
    let bestD = Infinity;
    for (let i = Math.max(0, center - win); i <= Math.min(n, center + win); i++) {
      const d = this.samples[i].distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best / n;
  }

  pointAt(t: number): THREE.Vector3 {
    return this.samples[Math.max(0, Math.min(this.SAMPLE_N, Math.round(t * this.SAMPLE_N)))];
  }
}
