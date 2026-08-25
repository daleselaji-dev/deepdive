/**
 * 程序化洞穴系统：
 * 样条路径 + 半径剖面 + Simplex 噪声置换的管状几何（内表面）、
 * 湿岩微表面 / 地层分色 / 入口焦散 / 生物膜辉纹（onBeforeCompile 注入）、
 * 主线绳（含 t=0.55 的割断点）、入口竖井与水面仰视盘、钟厅石笋、线索道具、碰撞采样。
 */
import * as THREE from 'three';
import { Simplex3, clamp, lerp, smoothstep } from '../../core/noise';
import type { QualitySettings } from '../../core/quality';
import { makeLightCone, makeGlowSprite } from '../../render/volumetric';

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
  /** 侦探笔记条目：[标题, 批注]。 */
  note: [string, string];
  /** 使用后的玩法效果（storyMode 消费）。 */
  effect?: 'o2' | 'polypWave';
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
  [0.36, 8.2], [0.44, 8.6], [0.5, 3.2], [0.55, 1.75], [0.62, 1.45],
  [0.68, 2.3], [0.75, 2.7], [0.82, 3.1], [0.9, 5.4], [1.0, 7.5],
];

export const LINE_CUT_T = 0.55;
/** 生物发光廊道区间。 */
export const GALLERY_T0 = 0.575;
export const GALLERY_T1 = 0.68;
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

/** 岩石 shader 注入共享 uniforms。 */
export interface RockUniforms {
  uTime: { value: number };
  uCaustics: { value: number };
  uBump: { value: number };
  uGlowBoost: { value: number };
  uShaftPos: { value: THREE.Vector3 };
}

/**
 * 向 MeshStandardMaterial 注入：
 * - 世界空间高频法线微扰（湿岩细节）
 * - 湿润度（aWet）调制 roughness → 手电扫出湿石高光
 * - 入口焦散光斑（世界 y 衰减 + 朝上法线加权）
 * - 生物膜辉纹（aGlow，青紫脉动，关灯增亮由 uGlowBoost 驱动）
 */
function injectRockShader(mat: THREE.MeshStandardMaterial, u: RockUniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `
        #include <common>
        attribute float aWet;
        attribute float aGlow;
        varying vec3 vRockWP;
        varying vec3 vRockWN;
        varying float vWet;
        varying float vGlow;
      `)
      .replace('#include <begin_vertex>', /* glsl */ `
        #include <begin_vertex>
        vRockWP = (modelMatrix * vec4(position, 1.0)).xyz;
        vRockWN = normalize(mat3(modelMatrix) * normal);
        vWet = aWet;
        vGlow = aGlow;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uCaustics;
        uniform float uBump;
        uniform float uGlowBoost;
        uniform vec3 uShaftPos;
        varying vec3 vRockWP;
        varying vec3 vRockWN;
        varying float vWet;
        varying float vGlow;

        float rockHash(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        float rockVNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(rockHash(i), rockHash(i + vec3(1.,0.,0.)), f.x),
                mix(rockHash(i + vec3(0.,1.,0.)), rockHash(i + vec3(1.,1.,0.)), f.x), f.y),
            mix(mix(rockHash(i + vec3(0.,0.,1.)), rockHash(i + vec3(1.,0.,1.)), f.x),
                mix(rockHash(i + vec3(0.,1.,1.)), rockHash(i + vec3(1.,1.,1.)), f.x), f.y),
            f.z);
        }
        float rockDetail(vec3 p) {
          return rockVNoise(p * 2.2) * 0.62 + rockVNoise(p * 6.4) * 0.38;
        }
        // 水面折射焦散（干涉纹样，3 次迭代；坐标偏移避开原点，除法有保护，输出钳制防 NaN/inf）
        float causticPattern(vec2 p, float t) {
          p += vec2(37.31, 91.17);
          vec2 i = p;
          float c = 1.0;
          float inten = 0.005;
          for (int n = 0; n < 3; n++) {
            float ft = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(ft - i.x) + sin(ft + i.y), sin(ft - i.y) + cos(ft + i.x));
            vec2 sc = vec2(sin(i.x + ft), cos(i.y + ft)) / inten;
            sc.x = (sc.x >= 0.0 ? 1.0 : -1.0) * max(abs(sc.x), 1.0);
            sc.y = (sc.y >= 0.0 ? 1.0 : -1.0) * max(abs(sc.y), 1.0);
            c += 1.0 / max(length(p / sc), 5e-3);
          }
          c /= 3.0;
          c = 1.17 - pow(clamp(c, 0.0, 8.0), 1.4);
          return clamp(pow(abs(c), 7.0), 0.0, 1.4);
        }
      `)
      .replace('#include <normal_fragment_begin>', /* glsl */ `
        #include <normal_fragment_begin>
        if (uBump > 0.001) {
          float bmp = uBump * (1.0 - vWet * 0.65);
          float e = 0.05;
          float b0 = rockDetail(vRockWP);
          vec3 grad = vec3(
            rockDetail(vRockWP + vec3(e, 0.0, 0.0)) - b0,
            rockDetail(vRockWP + vec3(0.0, e, 0.0)) - b0,
            rockDetail(vRockWP + vec3(0.0, 0.0, e)) - b0) / e;
          grad -= normal * dot(grad, normal);
          normal = normalize(normal - grad * bmp);
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, vWet);
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */ `
        #include <emissivemap_fragment>
        // 焦散：入口浅水区（y > -24，限竖井周边）+ 钟厅天光池（uShaftPos 周围），仅朝上表面
        if (uCaustics > 0.5) {
          float entranceFade = smoothstep(-24.0, -5.0, vRockWP.y)
                             * smoothstep(17.0, 8.0, length(vRockWP.xz));
          float shaftFade = (1.0 - smoothstep(2.5, 7.5, distance(vRockWP.xz, uShaftPos.xz)))
                          * smoothstep(uShaftPos.y - 1.0, uShaftPos.y - 14.0, vRockWP.y);
          float depthFade = max(entranceFade, shaftFade * 0.8);
          if (depthFade > 0.002) {
            float nUp = clamp(normalize(vRockWN).y, 0.0, 1.0);
            float upFace = nUp * nUp * 0.95;
            float ca = causticPattern(vRockWP.xz * 0.85, uTime * 0.42);
            totalEmissiveRadiance += vec3(0.45, 0.85, 0.95) * ca * depthFade * upFace * 0.10;
          }
        }
        // 生物膜辉纹：稀疏丝缕状青→紫脉动（高频掩码提结构感）
        if (vGlow > 0.002) {
          float ph = uTime * 1.25 + vRockWP.x * 0.6 + vRockWP.y * 0.45 + vRockWP.z * 0.35;
          float pulse = 0.55 + 0.45 * sin(ph);
          float fil = rockVNoise(vRockWP * 5.0);
          float vein = smoothstep(0.58, 0.88, rockVNoise(vRockWP * 9.5) * 0.6 + fil * 0.4);
          vec3 glowCol = mix(vec3(0.10, 0.85, 1.0), vec3(0.55, 0.30, 1.0), fil);
          totalEmissiveRadiance += glowCol * vGlow * pulse * vein * (0.35 + 0.85 * fil) * uGlowBoost;
        }
      `);
  };
  // attribute 缺省兜底（竖井几何没有 aWet/aGlow 时由 geometry 补 0）
  mat.customProgramCacheKey = () => 'rock-injected';
}

export class CaveSystem {
  readonly group = new THREE.Group();
  readonly samples: CaveSample[] = [];
  readonly interactables: Interactable[] = [];
  readonly curve: THREE.CatmullRomCurve3;
  readonly spawnPos = new THREE.Vector3();
  readonly entranceLight: THREE.SpotLight;
  readonly computerLight: THREE.PointLight;
  readonly rockUniforms: RockUniforms = {
    uTime: { value: 0 },
    uCaustics: { value: 1 },
    uBump: { value: 0.55 },
    uGlowBoost: { value: 1 },
    uShaftPos: { value: new THREE.Vector3(0, -999, 0) },
  };
  /** 钟厅天光竖井：光池中心（供鱼群/焦散使用）。 */
  readonly shaftTop = new THREE.Vector3();
  readonly shaftFloor = new THREE.Vector3();

  private noise: Simplex3;
  private ledMat: THREE.MeshStandardMaterial;
  private danglingLine: THREE.Mesh | null = null;
  private surfaceMat: THREE.ShaderMaterial | null = null;
  private spinProps: THREE.Object3D[] = [];

  constructor(quality: QualitySettings, seed = 20260825) {
    this.noise = new Simplex3(seed);
    this.curve = new THREE.CatmullRomCurve3(
      PATH_POINTS.map((p) => new THREE.Vector3(...p)),
      false, 'centripetal', 0.5
    );

    this.rockUniforms.uCaustics.value = quality.microDetail ? 1 : 0;
    this.rockUniforms.uBump.value = quality.microDetail ? 0.3 : 0;

    this.buildSamples();
    this.buildTunnel(quality);
    this.buildEntrance();
    this.buildBellShaft();
    this.buildGuideline();
    this.buildSpeleothems(quality);

    // 出生点：井筒水柱内（刚入水），正仰望焦散水面盘——首屏奇观；下潜穿过井底即隧道
    this.spawnPos.set(0, 0.6, 0);

    // 入口天光：从水面正上方垂直下照——光柱进井、四壁均匀，不再把单侧井壁打爆
    const spot = new THREE.SpotLight(0x9fe0ff, 52, 58, 0.42, 0.9, 1.5);
    spot.position.set(0, 14, 0);
    spot.target.position.set(0, -4, 3);
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

  /** 生物膜辉光窗口（廊道区间 + 噪声补丁，稀疏化）。 */
  private glowMask(u: number, p: THREE.Vector3): number {
    const win = smoothstep(GALLERY_T0 - 0.012, GALLERY_T0 + 0.02, u) *
      (1 - smoothstep(GALLERY_T1 - 0.02, GALLERY_T1 + 0.012, u));
    if (win <= 0) return 0;
    const patch = smoothstep(0.18, 0.62, this.noise.fbm(p.x * 0.42 + 31, p.y * 0.42, p.z * 0.42, 3));
    return win * patch;
  }

  /**
   * 洞壁上一点（几何置换后），angle 为环截面角（0 = 底部），inset 为半径比例。
   * 供水螅体点阵 / 道具贴壁使用。
   */
  wallPoint(t: number, angle: number, inset = 0.96): THREE.Vector3 {
    const s = this.sampleAtT(t);
    const side = new THREE.Vector3().crossVectors(s.tangent, s.down).normalize();
    const dir = s.down.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle));
    const base = s.pos.clone().addScaledVector(dir, s.radius);
    const n = this.wallNoise(base);
    return s.pos.clone().addScaledVector(dir, s.radius * (1 + 0.3 * n) * inset);
  }

  // ---------- 几何 ----------

  private buildTunnel(q: QualitySettings) {
    const seg = q.caveSegments;
    const rad = q.caveRadial;
    const frames = this.curve.computeFrenetFrames(seg, false);
    const vertCount = (seg + 1) * (rad + 1);
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const wet = new Float32Array(vertCount);
    const glow = new Float32Array(vertCount);
    const indices: number[] = [];
    const tmp = new THREE.Vector3();
    const dir = new THREE.Vector3();

    const cA = new THREE.Color(0x8a7a63);    // 暖褐岩
    const cB = new THREE.Color(0x8fa0aa);    // 冷灰岩
    const cRust = new THREE.Color(0x6e4f38); // 铁锈层
    const cDark = new THREE.Color(0x3d3a36); // 锰黑层
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
        const k = i * (rad + 1) + j;
        const vi = k * 3;
        positions[vi] = tmp.x;
        positions[vi + 1] = tmp.y;
        positions[vi + 2] = tmp.z;

        const n2 = this.noise.noise(tmp.x * 0.31 + 40, tmp.y * 0.31, tmp.z * 0.31);
        const n3 = this.noise.noise(tmp.x * 1.7, tmp.y * 1.7 + 9, tmp.z * 1.7);
        // 凹陷处更暗（廉价 AO），高频噪声提对比
        const crevice = 0.5 + 0.5 * clamp(n * 0.9 + 0.5, 0, 1);
        col.copy(cA).lerp(cB, n2 * 0.5 + 0.5);
        // 地质分层：沿高度的条带（弯折由低频噪声驱动）
        const bend = this.noise.noise(tmp.x * 0.05, tmp.y * 0.05, tmp.z * 0.05) * 3.0;
        const band = Math.sin(tmp.y * 0.55 + bend);
        if (band > 0.55) col.lerp(cRust, (band - 0.55) * 1.4);
        else if (band < -0.62) col.lerp(cDark, (-band - 0.62) * 1.6);
        col.multiplyScalar((0.62 + 0.38 * (n3 * 0.5 + 0.5)) * crevice);
        // 入口上半部藻绿
        if (u < 0.1 && dir.y > 0.1) {
          col.lerp(cAlgae, (0.1 - u) * 8 * dir.y);
        }
        colors[vi] = col.r; colors[vi + 1] = col.g; colors[vi + 2] = col.b;

        // 湿润度：大尺度补丁 + 下半侧渗水加权 + 凹陷积水
        const wetPatch = smoothstep(0.02, 0.5, this.noise.fbm(tmp.x * 0.07 + 90, tmp.y * 0.07, tmp.z * 0.07, 3));
        const seep = dir.y < 0 ? 0.28 : 0;
        wet[k] = clamp(wetPatch * 0.85 + seep + Math.max(0, -n) * 0.3, 0, 1);
        // 生物膜辉光掩码（廊道）
        glow[k] = this.glowMask(u, tmp);
        // 生物膜处岩面染深蓝黑，衬托辉光
        if (glow[k] > 0.01) {
          col.setRGB(colors[vi], colors[vi + 1], colors[vi + 2]).lerp(new THREE.Color(0x0a1418), glow[k] * 0.7);
          colors[vi] = col.r; colors[vi + 1] = col.g; colors[vi + 2] = col.b;
        }
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
    geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // 注意：该索引绕序生成的面朝向隧道内部，因此用 FrontSide 渲染内壁。
    // 平滑法线 + 片元级法线微扰（湿岩细节）取代旧 flatShading。
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
      side: THREE.FrontSide,
    });
    injectRockShader(mat, this.rockUniforms);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** 入口竖井 + 水面仰视盘 + 光柱。 */
  private buildEntrance() {
    const shaft = new THREE.CylinderGeometry(4.2, 5.0, 14, 32, 9, true);
    shaft.translate(0, 2.5, 0);
    const pos = shaft.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const wet = new Float32Array(pos.count);
    const glow = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = this.wallNoise(v);
      const rl = Math.hypot(v.x, v.z) || 1;
      const k = 1 + 0.22 * n;
      pos.setXYZ(i, (v.x / rl) * rl * k, v.y, (v.z / rl) * rl * k);
      wet[i] = 0.75; // 竖井常年湿润
    }
    shaft.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    shaft.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
    shaft.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6f7a6e, roughness: 0.9, metalness: 0.05, side: THREE.BackSide,
    });
    injectRockShader(mat, this.rockUniforms);
    const mesh = new THREE.Mesh(shaft, mat);
    this.group.add(mesh);

    // 井底弹射补光：让领口与井壁在仰望时可读
    const bounce = new THREE.PointLight(0x6fb0c4, 9, 22, 1.7);
    bounce.position.set(0, -1.2, 0);
    this.group.add(bounce);

    // 井口岩石领口：填补竖井与隧道之间的可视空洞（从下方仰望时的洞顶）
    const collar = new THREE.RingGeometry(4.1, 16, 28, 5);
    collar.rotateX(Math.PI / 2); // 面朝 -y（从下方可见）
    collar.translate(0, -3.5, 0);
    const cpos = collar.attributes.position as THREE.BufferAttribute;
    const cv = new THREE.Vector3();
    const cwet = new Float32Array(cpos.count);
    for (let i = 0; i < cpos.count; i++) {
      cv.fromBufferAttribute(cpos, i);
      const n = this.wallNoise(cv);
      // 越靠外越向下垂（穹顶感）
      const rr = Math.hypot(cv.x, cv.z);
      cpos.setY(i, cv.y - (rr - 4.1) * 0.35 + n * 1.4);
      cwet[i] = 0.6;
    }
    collar.setAttribute('aWet', new THREE.BufferAttribute(cwet, 1));
    collar.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(cpos.count), 1));
    collar.computeVertexNormals();
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0x5f6a60, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide,
    });
    injectRockShader(collarMat, this.rockUniforms);
    this.group.add(new THREE.Mesh(collar, collarMat));

    // 水面仰视盘：从下方看向明亮摇曳的水面（HDR 亮度喂给 Bloom）
    this.surfaceMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 11.0;
          float w = sin(p.x * 3.1 + uTime * 1.7) * sin(p.y * 2.7 - uTime * 1.3)
                  + sin(length(p) * 4.2 - uTime * 2.1) * 0.55
                  + sin(p.x * 7.7 - uTime * 2.6) * sin(p.y * 6.3 + uTime * 1.9) * 0.35;
          float radial = 1.0 - clamp(length(vUv - 0.5) * 2.0, 0.0, 1.0);
          float bright = pow(radial, 1.35);
          float glint = pow(clamp(w * 0.5 + 0.5, 0.0, 1.0), 3.0);
          vec3 col = mix(vec3(0.10, 0.55, 0.75), vec3(0.85, 1.05, 1.15), glint);
          float a = bright * (0.4 + 0.5 * glint);
          gl_FragColor = vec4(col * a * 2.6, a);
        }
      `,
    });
    const surf = new THREE.Mesh(new THREE.CircleGeometry(5.6, 48), this.surfaceMat);
    surf.rotation.x = Math.PI / 2;
    surf.position.set(0, 11.4, 0);
    surf.renderOrder = 18;
    this.group.add(surf);

    // 水面辉光盘
    const glowS = makeGlowSprite(0xbdf3ff, 10, 0.55);
    glowS.position.set(0, 10.8, 0);
    this.group.add(glowS);

    // 三根下射光柱
    for (let i = 0; i < 3; i++) {
      const cone = makeLightCone({
        length: 17 + i * 3,
        radius: 1.6 + i * 1.4,
        color: 0x8fd8f0,
        intensity: 0.105 - i * 0.028,
        nearFade: 3.4,
      });
      cone.position.set((i - 1) * 1.1, 7.5, (i - 1) * 0.8);
      cone.rotateX(-Math.PI / 2 + (i - 1) * 0.1);
      this.group.add(cone);
    }
  }

  /**
   * 钟厅穹顶天光竖井（奇观 1）：
   * 洞顶裂隙泻下巨大光柱，照亮地面光池（焦散跟随 uShaftPos），鱼群绕柱回旋。
   */
  private buildBellShaft() {
    const s = this.sampleAtT(0.4);
    const up = s.down.clone().negate();
    this.shaftTop.copy(s.pos).addScaledVector(up, s.radius * 0.92);
    this.shaftFloor.copy(s.pos).addScaledVector(s.down, s.radius * 0.86);
    (this.rockUniforms.uShaftPos.value as THREE.Vector3).copy(this.shaftFloor);

    // 主光柱（体积锥）+ 内芯亮柱
    const len = this.shaftTop.distanceTo(this.shaftFloor) + 3;
    const beam = makeLightCone({ length: len, radius: 2.6, color: 0x9fdcf0, intensity: 0.075, nearFade: 3.2 });
    beam.position.copy(this.shaftTop);
    beam.rotateX(-Math.PI / 2);
    this.group.add(beam);
    const core = makeLightCone({ length: len * 0.92, radius: 1.1, color: 0xcdeef8, intensity: 0.17, nearFade: 3.2 });
    core.position.copy(this.shaftTop);
    core.rotateX(-Math.PI / 2);
    this.group.add(core);

    // 裂隙辉光 + 真实聚光（照亮光池）
    const crack = makeGlowSprite(0xd9f4ff, 3.2, 0.5);
    crack.position.copy(this.shaftTop);
    this.group.add(crack);
    const spot = new THREE.SpotLight(0xaee4f5, 260, len + 10, 0.32, 0.6, 1.6);
    spot.position.copy(this.shaftTop).addScaledVector(up, 1.5);
    spot.target.position.copy(this.shaftFloor);
    this.group.add(spot, spot.target);
    // 光池弱补光（往上打亮周围石笋）
    const pool = new THREE.PointLight(0x7fc8dd, 4, 12, 1.8);
    pool.position.copy(this.shaftFloor).addScaledVector(up, 1.2);
    this.group.add(pool);
  }

  /** 给小型道具几何补默认 aWet/aGlow（注入 shader 需要）。 */
  private static padRockAttrs(geo: THREE.BufferGeometry, wetV = 0.4) {
    const n = (geo.attributes.position as THREE.BufferAttribute).count;
    const wet = new Float32Array(n).fill(wetV);
    geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
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
    CaveSystem.padRockAttrs(geo, 0.55);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7d7466, roughness: 0.92 });
    injectRockShader(mat, this.rockUniforms);
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
        note: ['线绳铭牌 E.V.', '钢印 32m。线绳确系埃利亚斯所布。起了钙壳——挂了不止三周。'],
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
        note: ['潜水电脑', '19 天没有停表。要么它坏了，要么"下潜"从未结束。'],
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
        note: ['割断的主线绳', '断口平整。自愿割断。他不打算回去。'],
      });
    }
    // 线索4：漂浮的脚蹼（钟厅顶部石缝）
    {
      const p = this.wallPoint(0.335, Math.PI, 0.8);
      const fin = new THREE.Group();
      const rubber = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55 });
      const accent = new THREE.MeshStandardMaterial({ color: 0x9a8018, roughness: 0.5, emissive: 0x3d3206, emissiveIntensity: 0.3 });
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.16), rubber);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.4), accent);
      blade.position.z = -0.26;
      fin.add(pocket, blade);
      fin.position.copy(p);
      fin.rotation.set(0.5, 1.1, 0.3);
      this.group.add(fin);
      this.spinProps.push(fin);
      this.interactables.push({
        id: 'fin', pos: p.clone(), radius: 2.2, used: false,
        prompt: '查看脚蹼',
        lines: [
          '一只脚蹼，卡在石缝里，随水流慢慢转。',
          '型号：**Marlin XR-4**。和委托人给的装备清单对得上。',
          '只有一只。人不会自己脱掉一只脚蹼。',
        ],
        note: ['漂浮的脚蹼', 'Marlin XR-4，与埃利亚斯装备清单吻合。只有一只。'],
      });
    }
    // 线索5：备用气瓶（钟厅地面，可取用氧气）
    {
      const p = this.wallPoint(0.445, 0.35, 0.82);
      const tank = new THREE.Group();
      const alu = new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.35, metalness: 0.75 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.58, 18), alu);
      const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.09, 10),
        new THREE.MeshStandardMaterial({ color: 0x35414a, roughness: 0.4, metalness: 0.8 }));
      valve.position.y = 0.33;
      const knob = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 18),
        new THREE.MeshStandardMaterial({ color: 0x7a1f1a, roughness: 0.5 }));
      knob.position.y = 0.37;
      knob.rotation.x = Math.PI / 2;
      tank.add(body, valve, knob);
      tank.position.copy(p);
      tank.rotation.set(0.2, 0.7, 1.35); // 侧躺
      this.group.add(tank);
      this.interactables.push({
        id: 'stage', pos: p.clone(), radius: 2.2, used: false,
        prompt: '检查气瓶阀门',
        effect: 'o2',
        lines: [
          '一支侧挂瓶，铝壳上刻着 **E.V.**。他按规程放的接力瓶——回程用的气。',
          '残压表：**450 psi**。我把它接上了备用接口。（氧气 +450）',
          '他没回来取。这瓶气等了他十九天。',
        ],
        note: ['埃利亚斯的接力瓶', '回程气还在原地。氧气 +450 psi。他没走到这一步。'],
      });
    }
    // 线索6：岩壁刻痕（断线之后）
    {
      const p = this.wallPoint(0.585, 4.2, 0.9);
      const s = this.sampleAtT(0.585);
      const markMat = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.6 });
      const marks = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.34, 0.012), markMat);
        m.position.set((i - 1) * 0.09, 0, 0);
        m.rotation.z = 0.15 + (i - 1) * 0.06;
        marks.add(m);
      }
      marks.position.copy(p);
      marks.lookAt(s.pos);
      this.group.add(marks);
      this.interactables.push({
        id: 'marks', pos: p.clone(), radius: 2.0, used: false,
        prompt: '查看刻痕',
        lines: [
          '三道刻痕，露出岩石里新鲜的白。是潜水刀刻的。',
          '不是箭头，不是编号。只是三道。像在数什么。',
          '刻痕的方向——**指向下**。谁会往下指？',
        ],
        note: ['三道刻痕', '新鲜的刀刻，指向下。在数什么？还是在给谁指路？'],
      });
    }
    // 线索7：水螅体群（发光廊道·触摸激发大波光）
    {
      const p = this.wallPoint(0.622, 3.9, 0.9);
      const cluster = new THREE.Group();
      const polypMat = new THREE.MeshStandardMaterial({
        color: 0x0a2a30, roughness: 0.4,
        emissive: 0x2fd8ff, emissiveIntensity: 1.4,
      });
      for (let i = 0; i < 7; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.028 + Math.random() * 0.03, 10, 8), polypMat);
        b.position.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.12);
        cluster.add(b);
      }
      const gl = makeGlowSprite(0x63e0ff, 0.9, 0.35);
      cluster.add(gl);
      cluster.position.copy(p);
      this.group.add(cluster);
      this.interactables.push({
        id: 'polyp', pos: p.clone(), radius: 2.0, used: false,
        prompt: '触碰发光的水螅体',
        effect: 'polypWave',
        lines: [
          '指尖刚碰到，它们就缩了回去——然后整面墙**亮**了。',
          '一圈光沿着洞壁荡开，像我往一口黑井里投了块石头。',
          '生物学不管这个叫语言。可它确实在回答我。',
        ],
        note: ['发光水螅体', '触碰会激起整条廊道的光波。它们对来客有反应。'],
      });
    }
    // 线索8：潜水写字板（廊道尽头）
    {
      const p = this.wallPoint(0.667, 0.4, 0.86);
      const slate = this.textPlate('别关灯', 0.3, 0.2, '#c9c2ae', '#2a2622');
      slate.position.copy(p).add(new THREE.Vector3(0, 0.06, 0));
      const s = this.sampleAtT(0.667);
      slate.rotation.set(-1.1, Math.atan2(s.tangent.x, s.tangent.z), 0.35);
      this.group.add(slate);
      this.interactables.push({
        id: 'slate', pos: p.clone(), radius: 2.0, used: false,
        prompt: '查看写字板',
        lines: [
          '潜水写字板，铝框。塑料面上三个字，划得太用力，穿透了板面——',
          '**「别关灯」**',
          '这里的生物在黑暗里发光。他到底看见了什么，才写下这三个字？',
        ],
        note: ['写字板：「别关灯」', '刻穿板面的字。在一条越黑越亮的廊道尽头。'],
      });
    }
  }

  /** LED 呼吸闪烁 / 岩石 uniforms / 水面波动。 */
  update(time: number, lampEffective = 1) {
    const blink = (Math.sin(time * 2.6) > 0.93) ? 1 : 0;
    this.ledMat.emissiveIntensity = blink * 3.2;
    this.computerLight.intensity = blink * 2.4;
    if (this.danglingLine) {
      this.danglingLine.rotation.y = Math.sin(time * 0.5) * 0.05;
    }
    this.rockUniforms.uTime.value = time;
    // 关灯 → 生物膜更亮（暗适应）
    this.rockUniforms.uGlowBoost.value = 1 + (1 - lampEffective) * 1.6;
    if (this.surfaceMat) this.surfaceMat.uniforms.uTime.value = time;
    for (let i = 0; i < this.spinProps.length; i++) {
      this.spinProps[i].rotation.y += 0.0016;
      this.spinProps[i].rotation.z = 0.3 + Math.sin(time * 0.4 + i) * 0.1;
    }
  }
}
