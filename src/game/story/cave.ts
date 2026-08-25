/**
 * 程序化洞穴系统：
 * 样条路径 + 半径剖面 + Simplex 噪声置换的管状几何（内表面）、
 * 主线绳（含 t=0.55 的割断点）、入口竖井与光柱、钟厅石笋、线索道具、碰撞采样。
 */
import * as THREE from 'three';
import { Simplex3, clamp, lerp } from '../../core/noise';
import type { QualitySettings } from '../../core/quality';
import { makeLightCone, makeGlowSprite, tickCone } from '../../render/volumetric';
import { makeCaveMaterial, type CaveMaterialHandle } from '../../render/caveMaterial';

export interface CaveSample {
  pos: THREE.Vector3;
  radius: number;
  tangent: THREE.Vector3;
  down: THREE.Vector3;
}

export interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  prompt: string;
  used: boolean;
  lines: string[];
}

const PATH_POINTS: [number, number, number][] = [
  [0, -4, 0],
  [0, -6, -14],
  [6, -9, -30],
  [10, -14, -48],
  [4, -18, -66],
  [-6, -22, -84],
  [-14, -26, -104],
  [-16, -30, -126],
  [-10, -34, -148],
  [0, -40, -166],
  [10, -44, -184],
  [14, -48, -202],
  [10, -52, -222],
  [0, -54, -242],
  [-8, -50, -262],
  [-12, -44, -282],
  [-10, -38, -302],
];

const RADIUS_KEYS: [number, number][] = [
  [0.0, 4.4], [0.06, 3.4], [0.12, 2.7], [0.22, 2.35], [0.3, 3.6],
  [0.36, 10.5], [0.44, 11.5], [0.5, 3.2], [0.55, 1.75], [0.62, 1.45],
  [0.68, 2.3], [0.75, 2.7], [0.82, 3.1], [0.9, 5.4], [1.0, 7.5],
];

export const LINE_CUT_T = 0.55;
const SAMPLE_COUNT = 1400;

function radiusProfile(u: number): number {
  const keys = RADIUS_KEYS;
  for (let i = 0; i < keys.length - 1; i++) {
    if (u >= keys[i][0] && u <= keys[i + 1][0]) {
      const k = (u - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
      const s = k * k * (3 - 2 * k);
      return lerp(keys[i][1], keys[i + 1][1], s);
    }
  }
  return keys[keys.length - 1][1];
}

export class CaveSystem {
  readonly group = new THREE.Group();
  readonly samples: CaveSample[] = [];
  readonly interactables: Interactable[] = [];
  readonly curve: THREE.CatmullRomCurve3;
  readonly spawnPos = new THREE.Vector3();
  readonly entranceLight: THREE.SpotLight;
  readonly computerLight: THREE.PointLight;

  private noise: Simplex3;
  private ledMat: THREE.MeshStandardMaterial;
  private danglingLine: THREE.Mesh | null = null;
  private matHandle!: CaveMaterialHandle;
  private surfaceMat: THREE.ShaderMaterial | null = null;
  private entranceCones: THREE.Mesh[] = [];

  constructor(quality: QualitySettings, seed = 20260825) {
    this.noise = new Simplex3(seed);
    this.curve = new THREE.CatmullRomCurve3(
      PATH_POINTS.map((p) => new THREE.Vector3(...p)),
      false, 'centripetal', 0.5
    );

    this.buildSamples();
    this.buildTunnel(quality);
    this.buildEntrance();
    this.buildGuideline();
    this.buildSpeleothems(quality);

    // 出生点：入口下方，面向隧道
    const s0 = this.sampleAtT(0.03);
    this.spawnPos.copy(s0.pos).addScaledVector(s0.down, -s0.radius * 0.1);

    // 入口天光
    const spot = new THREE.SpotLight(0x9fe0ff, 55, 55, 0.45, 0.9, 1.5);
    spot.position.set(0, 8, 2);
    spot.target.position.set(1, -14, -22);
    this.group.add(spot, spot.target);
    this.entranceLight = spot;

    // 潜水电脑红色 LED
    this.ledMat = new THREE.MeshStandardMaterial({
      color: 0x220000, emissive: 0xff1a05, emissiveIntensity: 0,
    });
    this.computerLight = new THREE.PointLight(0xff2211, 0, 7, 1.8);
    this.buildProps();
  }

  // ---------- 碰撞 / 进度 ----------

  private buildSamples() {
    const up = new THREE.Vector3(0, -1, 0);
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
      const u = i / SAMPLE_COUNT;
      const pos = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).normalize();
      const down = up.clone().addScaledVector(tangent, -tangent.dot(up));
      if (down.lengthSq() < 0.05) down.set(1, 0, 0);
      down.normalize();
      this.samples.push({ pos, radius: radiusProfile(u), tangent, down });
    }
  }

  sampleAtT(t: number): CaveSample {
    const i = Math.round(clamp(t, 0, 1) * SAMPLE_COUNT);
    return this.samples[i];
  }

  /** 局部搜索最近样点。hint 为上一帧索引。 */
  nearest(pos: THREE.Vector3, hint: number): { idx: number; t: number; sample: CaveSample; dist: number } {
    const lo = Math.max(0, hint - 60);
    const hi = Math.min(SAMPLE_COUNT, hint + 60);
    let best = hint, bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const d = this.samples[i].pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { idx: best, t: best / SAMPLE_COUNT, sample: this.samples[best], dist: Math.sqrt(bestD) };
  }

  /** 墙面置换噪声（几何与碰撞共用同一函数）。 */
  private wallNoise(p: THREE.Vector3): number {
    return this.noise.fbm(p.x * 0.13, p.y * 0.13, p.z * 0.13, 4) +
      0.22 * this.noise.noise(p.x * 0.9, p.y * 0.9, p.z * 0.9);
  }

  // ---------- 几何 ----------

  private buildTunnel(q: QualitySettings) {
    const seg = q.caveSegments;
    const rad = q.caveRadial;
    const frames = this.curve.computeFrenetFrames(seg, false);
    const vertCount = (seg + 1) * (rad + 1);
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const progress = new Float32Array(vertCount);
    const indices: number[] = [];
    const tmp = new THREE.Vector3();
    const dir = new THREE.Vector3();

    const cA = new THREE.Color(0x8a7a63); // 暖褐岩
    const cB = new THREE.Color(0x8fa0aa); // 冷灰岩
    const cAlgae = new THREE.Color(0x5f8a5c); // 入口藻绿
    const col = new THREE.Color();

    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const C = this.curve.getPointAt(u);
      const N = frames.normals[i];
      const B = frames.binormals[i];
      const rBase = radiusProfile(u);
      for (let j = 0; j <= rad; j++) {
        const theta = (j / rad) * Math.PI * 2;
        dir.copy(N).multiplyScalar(Math.cos(theta)).addScaledVector(B, Math.sin(theta));
        tmp.copy(C).addScaledVector(dir, rBase);
        const n = this.wallNoise(tmp);
        const r = rBase * (1 + 0.3 * n);
        tmp.copy(C).addScaledVector(dir, r);
        const vi = (i * (rad + 1) + j) * 3;
        positions[vi] = tmp.x;
        positions[vi + 1] = tmp.y;
        positions[vi + 2] = tmp.z;
        progress[i * (rad + 1) + j] = u;

        const n2 = this.noise.noise(tmp.x * 0.31 + 40, tmp.y * 0.31, tmp.z * 0.31);
        const n3 = this.noise.noise(tmp.x * 1.7, tmp.y * 1.7 + 9, tmp.z * 1.7);
        // 凹陷处更暗（廉价 AO），高频噪声提对比
        const crevice = 0.5 + 0.5 * clamp(n * 0.9 + 0.5, 0, 1);
        col.copy(cA).lerp(cB, n2 * 0.5 + 0.5)
          .multiplyScalar((0.62 + 0.38 * (n3 * 0.5 + 0.5)) * crevice);
        // 入口上半部藻绿
        if (u < 0.1 && dir.y > 0.1) {
          col.lerp(cAlgae, (0.1 - u) * 8 * dir.y);
        }
        colors[vi] = col.r; colors[vi + 1] = col.g; colors[vi + 2] = col.b;
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < rad; j++) {
        const a = i * (rad + 1) + j;
        const b = a + rad + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aU', new THREE.BufferAttribute(progress, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // 注意：该索引绕序生成的面朝向隧道内部，因此用 FrontSide 渲染内壁。
    // 平滑法线 + 三平面细节法线取代 flatShading：低模轮廓消失，出现湿岩微高光。
    this.matHandle = makeCaveMaterial(q.caveDetail, q.caveCaustics);
    const mesh = new THREE.Mesh(geo, this.matHandle.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** 入口竖井 + 水面辉光 + 光柱。 */
  private buildEntrance() {
    const shaft = new THREE.CylinderGeometry(3.6, 4.4, 12, 20, 8, true);
    shaft.translate(0, 2, 0);
    const pos = shaft.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = this.wallNoise(v);
      const rl = Math.hypot(v.x, v.z) || 1;
      const k = 1 + 0.22 * n;
      pos.setXYZ(i, (v.x / rl) * rl * k, v.y, (v.z / rl) * rl * k);
    }
    shaft.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6f7a6e, roughness: 0.9, metalness: 0.05, side: THREE.BackSide, flatShading: true,
    });
    const mesh = new THREE.Mesh(shaft, mat);
    this.group.add(mesh);

    // 水面辉光盘
    const glow = makeGlowSprite(0xbdf3ff, 9, 0.55);
    glow.position.set(0, 9.5, 0);
    this.group.add(glow);

    // 从下方仰望的动态水膜（干涉波纹，「慢慢合上的眼睛」）
    this.surfaceMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float rip = sin(r * 16.0 - uTime * 1.35) * 0.5 + 0.5;
          rip *= sin((vUv.x + vUv.y) * 8.0 + uTime * 0.8) * 0.5 + 0.5;
          rip += (sin(vUv.x * 21.0 - uTime * 1.7) * sin(vUv.y * 19.0 + uTime * 1.2)) * 0.18;
          float edge = 1.0 - smoothstep(0.5, 1.0, r);
          vec3 col = mix(vec3(0.4, 0.82, 0.92), vec3(0.9, 1.0, 1.0), clamp(rip, 0.0, 1.0) * 0.65);
          float a = edge * (0.3 + 0.7 * clamp(rip, 0.0, 1.0));
          gl_FragColor = vec4(col * a * 1.3, a);
        }
      `,
    });
    const surf = new THREE.Mesh(new THREE.CircleGeometry(4.4, 40), this.surfaceMat);
    surf.rotation.x = Math.PI / 2;
    surf.position.set(0, 9.3, 0);
    surf.renderOrder = 24;
    this.group.add(surf);

    // 四根下射神光柱（泛光管线会给它们镀上光晕）
    for (let i = 0; i < 4; i++) {
      const cone = makeLightCone({
        length: 24 + i * 4,
        radius: 1.4 + i * 1.7,
        color: 0x8fd8f0,
        intensity: 0.11 - i * 0.022,
      });
      cone.position.set((i - 1.5) * 0.9, 8.5, (i - 1.5) * 0.7);
      cone.rotateX(-Math.PI / 2 + (i - 1.5) * 0.07);
      this.group.add(cone);
      this.entranceCones.push(cone);
    }
  }

  /** 主线绳：沿隧道下侧铺设，LINE_CUT_T 处被割断，留下漂浮断头。 */
  private buildGuideline() {
    const linePos = (t: number): THREE.Vector3 => {
      const s = this.sampleAtT(t);
      const sway = this.noise.noise(t * 40, 7, 3) * 0.3;
      const side = new THREE.Vector3().crossVectors(s.tangent, s.down).normalize();
      return s.pos.clone()
        .addScaledVector(s.down, s.radius * 0.58)
        .addScaledVector(side, sway);
    };

    const pts: THREE.Vector3[] = [];
    for (let t = 0.015; t <= LINE_CUT_T; t += 0.004) pts.push(linePos(t));
    const lineCurve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(lineCurve, 360, 0.02, 6, false);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd9b96a, roughness: 0.6, metalness: 0.05,
      emissive: 0x6b5322, emissiveIntensity: 0.32,
    });
    const line = new THREE.Mesh(geo, mat);
    line.frustumCulled = false;
    this.group.add(line);

    // 割断后的漂浮断头（向上卷曲）
    const endP = linePos(LINE_CUT_T);
    const s = this.sampleAtT(LINE_CUT_T);
    const upDir = s.down.clone().negate();
    const dangPts = [
      endP.clone(),
      endP.clone().addScaledVector(s.tangent, 0.4).addScaledVector(upDir, 0.35),
      endP.clone().addScaledVector(s.tangent, 0.55).addScaledVector(upDir, 0.95),
      endP.clone().addScaledVector(s.tangent, 0.35).addScaledVector(upDir, 1.5),
    ];
    const dGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dangPts), 32, 0.02, 6, false);
    this.danglingLine = new THREE.Mesh(dGeo, mat);
    this.group.add(this.danglingLine);
  }

  /** 钟厅石笋 / 石钟乳。 */
  private buildSpeleothems(q: QualitySettings) {
    const count = q.level === 'low' ? 26 : 46;
    const geo = new THREE.ConeGeometry(0.4, 2.4, 7, 4);
    geo.translate(0, 1.2, 0);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = this.noise.noise(v.x * 3.1, v.y * 1.2 + 5, v.z * 3.1);
      pos.setXYZ(i, v.x * (1 + n * 0.35), v.y, v.z * (1 + n * 0.35));
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d7466, roughness: 0.92 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const dirV = new THREE.Vector3();
    const side = new THREE.Vector3();
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    for (let i = 0; i < count; i++) {
      const t = rand(0.33, 0.48);
      const s = this.sampleAtT(t);
      const fromCeiling = Math.random() < 0.5;
      // 沿环截面选一个靠近顶/底的角度，保证贴在洞壁上
      const a = rand(-0.55, 0.55);
      side.crossVectors(s.tangent, s.down).normalize();
      dirV.copy(s.down).multiplyScalar(Math.cos(a) * (fromCeiling ? -1 : 1))
        .addScaledVector(side, Math.sin(a));
      const base = s.pos.clone().addScaledVector(dirV, s.radius * rand(0.86, 0.98));
      qt.setFromUnitVectors(up, dirV.clone().negate());
      sc.set(rand(0.5, 1.6), rand(0.7, 2.4), rand(0.5, 1.6));
      m.compose(base, qt, sc);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  // ---------- 线索道具 ----------

  private textPlate(text: string, w: number, h: number, bg: string, fg: string): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = fg;
    g.lineWidth = 4;
    g.strokeRect(8, 8, 240, 112);
    g.fillStyle = fg;
    g.font = 'bold 52px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.5, metalness: 0.6,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.06,
    });
    return new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat);
  }

  private buildProps() {
    // 线索1：线绳铭牌 "E.V."
    {
      const t = 0.2;
      const s = this.sampleAtT(t);
      const p = s.pos.clone().addScaledVector(s.down, s.radius * 0.56);
      const plate = this.textPlate('E.V.', 0.24, 0.13, '#3a3a38', '#cfc9b0');
      plate.position.copy(p).add(new THREE.Vector3(0, 0.1, 0));
      plate.rotation.set(0.3, Math.atan2(s.tangent.x, s.tangent.z) + Math.PI, 0.12);
      this.group.add(plate);
      this.interactables.push({
        id: 'tag', pos: plate.position.clone(), radius: 2.0, used: false,
        prompt: '查看铭牌',
        lines: [
          '铭牌：**E.V. — 32m**。字是钢印的，边缘已经起了钙壳。',
          '埃利亚斯·凡恩到过这里。线绳是他布的。',
          '委托人说他哥哥"做事有始有终"。有始有终的人不会不回来。',
        ],
      });
    }
    // 线索2：仍在闪烁的潜水电脑（钟厅）
    {
      const t = 0.385;
      const s = this.sampleAtT(t);
      const base = s.pos.clone().addScaledVector(s.down, s.radius * 0.8);
      // 落座的岩块
      const rockGeo = new THREE.DodecahedronGeometry(0.7, 1);
      const rp = rockGeo.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < rp.count; i++) {
        v.fromBufferAttribute(rp, i);
        const n = this.noise.noise(v.x * 2.2, v.y * 2.2, v.z * 2.2);
        rp.setXYZ(i, v.x * (1 + n * 0.3), v.y * (0.7 + n * 0.2), v.z * (1 + n * 0.3));
      }
      rockGeo.computeVertexNormals();
      const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x776f5f, roughness: 0.95 }));
      rock.position.copy(base);
      this.group.add(rock);

      const comp = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.05, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.3 })
      );
      comp.position.copy(base).add(new THREE.Vector3(0.1, 0.5, 0.1));
      comp.rotation.set(0.1, 0.8, 0.05);
      this.group.add(comp);

      const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), this.ledMat);
      led.position.copy(comp.position).add(new THREE.Vector3(0.05, 0.032, 0.06));
      this.group.add(led);
      this.computerLight.position.copy(led.position);
      this.group.add(this.computerLight);

      this.interactables.push({
        id: 'computer', pos: comp.position.clone(), radius: 2.2, used: false,
        prompt: '查看潜水电脑',
        lines: [
          '一台潜水电脑，表带断了。屏幕还活着：**深度 52.6m，下潜时间 19 天 06:41:12**。',
          '计时没有停。它还以为主人在潜水。',
          '……或者它是对的。',
        ],
      });
    }
    // 线索3：割断的线绳
    {
      const s = this.sampleAtT(LINE_CUT_T);
      const p = s.pos.clone().addScaledVector(s.down, s.radius * 0.4);
      this.interactables.push({
        id: 'cutline', pos: p, radius: 2.4, used: false,
        prompt: '查看断绳',
        lines: [
          '主线绳到此为止。断口平整——不是磨断的，是**割**断的。',
          '洞潜员宁可割掉自己的手指，也不会割断自己的命脉。',
          '除非，割绳的时候，他已经不打算回去了。',
          '（线绳没了。沿着断口的方向继续。）',
        ],
      });
    }
  }

  /** 运行时画质热切换。 */
  applyQuality(q: QualitySettings) {
    this.matHandle.setQuality(q.caveDetail, q.caveCaustics);
  }

  /** LED 呼吸闪烁 / 水膜与光柱动画 / 材质 uniform。 */
  update(time: number, playerPos: THREE.Vector3) {
    const blink = (Math.sin(time * 2.6) > 0.93) ? 1 : 0;
    this.ledMat.emissiveIntensity = blink * 3.2;
    this.computerLight.intensity = blink * 2.4;
    if (this.danglingLine) {
      this.danglingLine.rotation.y = Math.sin(time * 0.5) * 0.05;
    }
    if (this.surfaceMat) this.surfaceMat.uniforms.uTime.value = time;
    for (let i = 0; i < this.entranceCones.length; i++) {
      const breath = 1 + 0.22 * Math.sin(time * 0.4 + i * 1.9);
      tickCone(this.entranceCones[i], time, (0.11 - i * 0.022) * breath);
    }
    this.matHandle.tick(time, playerPos);
  }
}
