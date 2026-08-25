/**
 * 奇观系统（穹顶大厅 + 发光廊道）：
 * - 晶柱阵：贯穿洞顶洞底的巨型方解石柱，微透光
 * - 悬雾层：低速漂动的加性雾平面
 * - 深渊开口：大厅底部的蓝黑「无底洞」
 * - 气室水膜镜：大厅顶部一面抖动的银镜（从水下仰望的困住的空气）
 * - 鱼群风暴：绕晶柱洄游的银鱼龙卷，玩家闯入即银色爆散（惊奇瞬间 ①）
 * - 巨影掠过：鱼群爆散后一道无声剪影横穿穹顶（惊奇瞬间 ①.5）
 * - 光尘：发光廊道内随玩家涟漪脉动的悬浮光点（惊奇瞬间 ②）
 */
import * as THREE from 'three';
import type { CaveSystem } from './cave';
import type { QualitySettings } from '../../core/quality';
import { caveDetailTexture } from '../../render/caveMaterial';
import { clamp, damp, mulberry32 } from '../../core/noise';

const DOME_T = 0.405;
const GALLERY_T0 = 0.555;
const GALLERY_T1 = 0.638;

export class Spectacle {
  readonly group = new THREE.Group();

  // 鱼群
  private fish: THREE.InstancedMesh;
  private fishCount: number;
  private fishParams: Float32Array; // [radius, angSpeed, phase, yOff, yAmp, yFreq, jx, jz] × N
  private fishCenter = new THREE.Vector3();
  private scatter = 0;
  private scatterTarget = 0;
  /** 鱼群是否已被惊散过（单次事件）。 */
  fishScattered = false;

  // 巨影
  private shadow: THREE.Mesh;
  private shadowT = -999; // 未触发；鱼群惊散后设为 -2.8（延迟入场）
  private shadowFrom = new THREE.Vector3();
  private shadowTo = new THREE.Vector3();
  /** 巨影是否已经放出。 */
  shadowDone = false;

  // 材质动画
  private mistMats: THREE.ShaderMaterial[] = [];
  private abyssMat: THREE.ShaderMaterial;
  private mirrorMat: THREE.ShaderMaterial;
  private motesMat: THREE.ShaderMaterial;
  private domeLight: THREE.PointLight;

  readonly airdomePos: THREE.Vector3;

  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();

  constructor(cave: CaveSystem, q: QualitySettings) {
    const rand = mulberry32(4451);
    const dome = cave.sampleAtT(DOME_T);
    this.fishCenter.copy(dome.pos).addScaledVector(dome.down, -dome.radius * 0.1);

    // ---------- 晶柱阵 ----------
    {
      const geo = new THREE.CylinderGeometry(1, 1.35, 1, 10, 8, true);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const bulge = 1 + Math.sin(v.y * Math.PI) * 0.25
          + Math.sin(v.y * 21 + v.x * 4) * 0.06 + Math.sin(v.y * 9 - v.z * 5) * 0.08;
        pos.setXYZ(i, v.x * bulge, v.y, v.z * bulge);
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x707d78, roughness: 0.68, metalness: 0.06,
        emissive: 0x142a29, emissiveIntensity: 0.1,
      });
      const columns = new THREE.InstancedMesh(geo, mat, 7);
      const m = new THREE.Matrix4();
      const qt = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < 7; i++) {
        const t = 0.355 + rand() * 0.095;
        const s = cave.sampleAtT(t);
        const side = new THREE.Vector3().crossVectors(s.tangent, s.down).normalize();
        // 只放在两侧（0.3–0.62 半径带），避免怼在玩家行进路线正中
        const off = (0.3 + rand() * 0.32) * s.radius * (rand() < 0.5 ? -1 : 1);
        const base = s.pos.clone().addScaledVector(side, off);
        const h = s.radius * 1.9;
        qt.setFromUnitVectors(up, s.down.clone().negate());
        sc.set(0.5 + rand() * 1.1, h, 0.5 + rand() * 1.1);
        m.compose(base, qt, sc);
        columns.setMatrixAt(i, m);
      }
      columns.instanceMatrix.needsUpdate = true;
      this.group.add(columns);
    }

    // ---------- 悬雾层 ----------
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uTex: { value: caveDetailTexture() },
          uPhase: { value: i * 3.7 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime, uPhase;
          uniform sampler2D uTex;
          varying vec2 vUv;
          void main() {
            vec2 c = vUv - 0.5;
            float edge = 1.0 - smoothstep(0.18, 0.5, length(c));
            float n = texture2D(uTex, vUv * 1.6 + vec2(uTime * 0.006 + uPhase, uTime * 0.004)).r;
            float n2 = texture2D(uTex, vUv * 3.1 - vec2(uTime * 0.004, uPhase)).g;
            float a = smoothstep(0.42, 0.85, n * 0.65 + n2 * 0.35) * edge * 0.055;
            gl_FragColor = vec4(vec3(0.5, 0.75, 0.78) * a, a);
          }
        `,
      });
      this.mistMats.push(mat);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.copy(this.fishCenter);
      plane.position.y += i * 3.4 - 1.2;
      plane.renderOrder = 18;
      this.group.add(plane);
    }

    // ---------- 深渊开口 ----------
    {
      const floor = cave.sampleAtT(0.415);
      this.abyssMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uTex: { value: caveDetailTexture() } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform sampler2D uTex;
          varying vec2 vUv;
          void main() {
            float r = length(vUv);
            float ang = atan(vUv.y, vUv.x);
            float swirl = texture2D(uTex, vec2(ang * 0.159 + uTime * 0.008, r * 0.5 - uTime * 0.012)).g;
            vec3 rim = vec3(0.02, 0.09, 0.13) * smoothstep(0.72, 0.99, r);
            vec3 deep = mix(vec3(0.0, 0.008, 0.014), vec3(0.005, 0.032, 0.05), swirl * (1.0 - r));
            vec3 col = mix(deep, rim, smoothstep(0.85, 1.0, r) * 0.6);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(5.6, 40), this.abyssMat);
      const p = floor.pos.clone().addScaledVector(floor.down, floor.radius * 0.9);
      disc.position.copy(p);
      disc.lookAt(p.clone().addScaledVector(floor.down, -1));
      this.group.add(disc);
    }

    // ---------- 气室水膜镜 ----------
    {
      const ceil = cave.sampleAtT(0.41);
      this.airdomePos = ceil.pos.clone().addScaledVector(ceil.down, -ceil.radius * 0.86);
      this.mirrorMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
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
            float rip = sin(r * 22.0 - uTime * 2.1) * 0.5 + 0.5;
            rip *= sin(vUv.x * 13.0 + uTime * 1.4) * sin(vUv.y * 11.0 - uTime * 1.1) * 0.5 + 0.6;
            float edge = 1.0 - smoothstep(0.72, 1.0, r);
            float rim = smoothstep(0.78, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
            vec3 col = mix(vec3(0.5, 0.62, 0.66), vec3(0.9, 0.98, 1.0), rip * 0.55);
            col += vec3(0.7, 0.9, 1.0) * rim * 0.8;
            float a = edge * (0.55 + 0.45 * rip);
            gl_FragColor = vec4(col * a * 1.5, a);
          }
        `,
      });
      const mirror = new THREE.Mesh(new THREE.CircleGeometry(3.4, 36), this.mirrorMat);
      mirror.position.copy(this.airdomePos);
      mirror.lookAt(this.airdomePos.clone().addScaledVector(ceil.down, 1));
      mirror.scale.set(1.4, 1, 1);
      mirror.renderOrder = 19;
      this.group.add(mirror);
      const glowLight = new THREE.PointLight(0xbfe4ee, 5, 14, 1.8);
      glowLight.position.copy(this.airdomePos).addScaledVector(ceil.down, 1.2);
      this.group.add(glowLight);
    }

    // 大厅中心冷光（很弱，只为晶柱轮廓）
    this.domeLight = new THREE.PointLight(0x4fa8b8, 3, 40, 1.9);
    this.domeLight.position.copy(this.fishCenter);
    this.group.add(this.domeLight);

    // ---------- 鱼群 ----------
    this.fishCount = q.fishCount;
    {
      const geo = new THREE.ConeGeometry(0.045, 0.34, 5);
      geo.rotateX(Math.PI / 2); // 尖端朝 -z → lookAt 方向
      const mat = new THREE.MeshStandardMaterial({
        color: 0xaebfcb, metalness: 0.85, roughness: 0.28,
        emissive: 0x2a3d48, emissiveIntensity: 0.32,
      });
      this.fish = new THREE.InstancedMesh(geo, mat, this.fishCount);
      this.fish.frustumCulled = false;
      this.fishParams = new Float32Array(this.fishCount * 8);
      for (let i = 0; i < this.fishCount; i++) {
        const o = i * 8;
        this.fishParams[o] = 1.6 + rand() * 3.6;              // 轨道半径
        this.fishParams[o + 1] = 0.55 + rand() * 0.5;         // 角速度
        this.fishParams[o + 2] = rand() * Math.PI * 2;        // 相位
        this.fishParams[o + 3] = (rand() - 0.5) * 7.5;        // 高度偏移
        this.fishParams[o + 4] = 0.4 + rand() * 0.9;          // 垂直摆幅
        this.fishParams[o + 5] = 0.5 + rand() * 1.1;          // 垂直频率
        this.fishParams[o + 6] = (rand() - 0.5) * 2;          // 爆散方向 x
        this.fishParams[o + 7] = (rand() - 0.5) * 2;          // 爆散方向 z
      }
      this.group.add(this.fish);
    }

    // ---------- 巨影 ----------
    {
      const geo = new THREE.SphereGeometry(1, 20, 14);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x01050a, transparent: true, opacity: 0,
      });
      this.shadow = new THREE.Mesh(geo, mat);
      this.shadow.scale.set(8.5, 1.7, 2.6);
      this.shadow.visible = false;
      this.group.add(this.shadow);
      const dome2 = cave.sampleAtT(0.44);
      const side = new THREE.Vector3().crossVectors(dome2.tangent, dome2.down).normalize();
      const top = dome2.pos.clone().addScaledVector(dome2.down, -dome2.radius * 0.55);
      this.shadowFrom.copy(top).addScaledVector(side, 26);
      this.shadowTo.copy(top).addScaledVector(side, -26);
    }

    // ---------- 发光廊道光尘 ----------
    {
      const count = q.glowCount;
      const posArr = new Float32Array(count * 3);
      const seedArr = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const t = GALLERY_T0 + rand() * (GALLERY_T1 - GALLERY_T0);
        const s = cave.sampleAtT(t);
        const a = rand() * Math.PI * 2;
        const side = new THREE.Vector3().crossVectors(s.tangent, s.down).normalize();
        const rr = s.radius * (0.35 + rand() * 0.55);
        const p = s.pos.clone()
          .addScaledVector(s.down, Math.cos(a) * rr)
          .addScaledVector(side, Math.sin(a) * rr);
        posArr[i * 3] = p.x; posArr[i * 3 + 1] = p.y; posArr[i * 3 + 2] = p.z;
        seedArr[i] = rand() * 100;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seedArr, 1));
      this.motesMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPlayerPos: { value: new THREE.Vector3() },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uPlayerPos;
          attribute float aSeed;
          varying float vA;
          varying float vHue;
          void main() {
            vec3 p = position + vec3(
              sin(uTime * 0.31 + aSeed * 13.0),
              cos(uTime * 0.23 + aSeed * 17.0),
              sin(uTime * 0.27 + aSeed * 23.0)
            ) * 0.22;
            float d = length(p - uPlayerPos);
            float wave = (sin(d * 1.05 - uTime * 2.4) * 0.5 + 0.5) * exp(-d * 0.07);
            float tw = 0.4 + 0.6 * sin(uTime * (1.1 + fract(aSeed * 0.37)) + aSeed);
            vA = (0.12 + 1.5 * wave) * tw;
            vHue = fract(aSeed * 0.618);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 90.0 * (0.5 + fract(aSeed * 7.31) * 0.8) / max(1.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying float vHue;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float fall = smoothstep(0.5, 0.05, length(c));
            vec3 col = mix(vec3(0.1, 0.9, 0.65), vec3(0.35, 0.65, 1.0), vHue);
            gl_FragColor = vec4(col * vA * fall, vA * fall);
          }
        `,
      });
      const pts = new THREE.Points(geo, this.motesMat);
      pts.frustumCulled = false;
      pts.renderOrder = 21;
      this.group.add(pts);
    }
  }

  /** 鱼群刚被惊散时返回 true（单次）。 */
  update(dt: number, time: number, playerPos: THREE.Vector3): boolean {
    let justScattered = false;

    // 鱼群
    const distToSchool = this.tmp.copy(playerPos).sub(this.fishCenter).length();
    if (distToSchool < 5.5 && !this.fishScattered) {
      this.fishScattered = true;
      this.scatterTarget = 1;
      justScattered = true;
      this.shadowT = -2.8; // 2.8 秒后巨影入场
    }
    if (this.fishScattered && this.scatterTarget > 0 && distToSchool > 12) {
      this.scatterTarget = 0; // 玩家离开后缓慢归群
    }
    this.scatter = damp(this.scatter, this.scatterTarget, this.scatterTarget > this.scatter ? 7 : 0.35, dt);

    if (distToSchool < 60) {
      const s = this.scatter;
      for (let i = 0; i < this.fishCount; i++) {
        const o = i * 8;
        const r = this.fishParams[o] * (1 + s * 2.6);
        const w = this.fishParams[o + 1] * (1 + s * 1.9);
        const th = this.fishParams[o + 2] + time * w;
        const y = this.fishParams[o + 3] * (1 + s * 0.8)
          + Math.sin(time * this.fishParams[o + 5] + this.fishParams[o + 2] * 3) * this.fishParams[o + 4];
        const jx = this.fishParams[o + 6] * s * 5;
        const jz = this.fishParams[o + 7] * s * 5;
        const px = this.fishCenter.x + Math.cos(th) * r + jx;
        const py = this.fishCenter.y + y * 0.55;
        const pz = this.fishCenter.z + Math.sin(th) * r + jz;
        this.dummy.position.set(px, py, pz);
        // 朝向 = 轨道切线
        this.dummy.lookAt(
          px - Math.sin(th) * r * 0.2,
          py + Math.cos(time * this.fishParams[o + 5]) * 0.05,
          pz + Math.cos(th) * r * 0.2
        );
        this.dummy.updateMatrix();
        this.fish.setMatrixAt(i, this.dummy.matrix);
      }
      this.fish.instanceMatrix.needsUpdate = true;
    }

    // 巨影
    if (this.shadowT > -50 && !this.shadowDone) {
      this.shadowT += dt;
      if (this.shadowT >= 0) {
        const k = clamp(this.shadowT / 15, 0, 1);
        if (k >= 1) {
          this.shadowDone = true;
          this.shadow.visible = false;
        } else {
          this.shadow.visible = true;
          this.shadow.position.lerpVectors(this.shadowFrom, this.shadowTo, k);
          this.shadow.position.y += Math.sin(k * Math.PI * 2.3) * 1.4;
          this.shadow.rotation.y = Math.atan2(
            this.shadowTo.x - this.shadowFrom.x, this.shadowTo.z - this.shadowFrom.z) + Math.PI / 2;
          const fade = Math.sin(k * Math.PI);
          (this.shadow.material as THREE.MeshBasicMaterial).opacity = fade * 0.72;
        }
      }
    }

    // 材质动画
    for (const m of this.mistMats) m.uniforms.uTime.value = time;
    this.abyssMat.uniforms.uTime.value = time;
    this.mirrorMat.uniforms.uTime.value = time;
    this.motesMat.uniforms.uTime.value = time;
    (this.motesMat.uniforms.uPlayerPos.value as THREE.Vector3).copy(playerPos);
    this.domeLight.intensity = 3 + Math.sin(time * 0.6) * 0.8;

    return justScattered;
  }

  /** 巨影当前是否可见（用于台词触发）。 */
  get shadowVisible() { return this.shadow.visible; }

  applyQuality(q: QualitySettings) {
    this.fish.count = Math.min(q.fishCount, this.fishCount);
  }
}
