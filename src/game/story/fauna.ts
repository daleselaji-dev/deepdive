/**
 * 洞穴生物（奇观系统）：
 * - FishSchool：银色小鱼群，绕光柱螺旋回旋；玩家冲入会四散、随后重新聚拢。
 * - PolypField：发光廊道水螅体点阵；关灯更亮（暗适应），靠近激起光的涟漪沿洞壁传播，
 *   可由互动点触发全廊道大波光。
 */
import * as THREE from 'three';

// ---------------------------------------------------------------- 鱼群

interface Fish {
  theta: number;
  radius: number;
  speed: number;
  y0: number;
  bobA: number;
  bobF: number;
  phase: number;
  scale: number;
  scatterDir: THREE.Vector3;
}

export class FishSchool {
  readonly mesh: THREE.InstancedMesh;
  private fish: Fish[] = [];
  private center: THREE.Vector3;
  private scatter = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private tangent = new THREE.Vector3();
  private mZ = new THREE.Vector3(0, 0, 1);

  constructor(center: THREE.Vector3, count: number, spread = 2.6, ySpread = 4) {
    this.center = center.clone();

    // 银色小鱼：拉长的八面体，金属高光在光柱下闪银光
    const geo = new THREE.OctahedronGeometry(0.085);
    geo.scale(0.38, 0.55, 1.7);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcdd8de, metalness: 0.9, roughness: 0.22,
      emissive: 0x1a262c, emissiveIntensity: 0.7,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      this.fish.push({
        theta: Math.random() * Math.PI * 2,
        radius: spread * (0.45 + Math.random() * 0.9),
        speed: 0.5 + Math.random() * 0.5,
        y0: (Math.random() - 0.5) * ySpread,
        bobA: 0.15 + Math.random() * 0.4,
        bobF: 0.5 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
        scale: 0.65 + Math.random() * 0.7,
        scatterDir: new THREE.Vector3(
          Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5
        ).normalize(),
      });
    }
  }

  update(dt: number, time: number, playerPos: THREE.Vector3) {
    // 受惊：玩家冲入鱼群 → 半径外扩、速度提升
    const d = playerPos.distanceTo(this.center);
    const target = d < 3.4 ? 1 : 0;
    this.scatter += (target - this.scatter) * Math.min(1, dt * (target > this.scatter ? 6 : 0.8));

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.theta += f.speed * (1 + this.scatter * 2.2) * dt;
      const r = f.radius * (1 + this.scatter * 1.8);
      const bob = Math.sin(time * f.bobF + f.phase) * f.bobA;
      this.p.set(
        this.center.x + Math.cos(f.theta) * r + f.scatterDir.x * this.scatter * 2.4,
        this.center.y + f.y0 + bob + f.scatterDir.y * this.scatter * 2,
        this.center.z + Math.sin(f.theta) * r + f.scatterDir.z * this.scatter * 2.4
      );
      // 朝向轨道切线
      this.tangent.set(-Math.sin(f.theta), bob * 0.15, Math.cos(f.theta)).normalize();
      this.q.setFromUnitVectors(this.mZ, this.tangent);
      const wiggle = Math.sin(time * 9 + f.phase) * 0.22;
      // 贴脸消隐：距玩家 <1.4m 平滑缩为 0，避免巨型近景剪影糊屏
      const dp = this.p.distanceTo(playerPos);
      const avoid = dp >= 1.4 ? 1 : Math.max(0, (dp - 0.5) / 0.9);
      this.sc.setScalar(f.scale * avoid * avoid);
      this.m.compose(this.p, this.q, this.sc);
      // 尾部摆动：绕 y 微旋
      const rotY = new THREE.Matrix4().makeRotationY(wiggle);
      this.m.multiply(rotY);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- 水螅体点阵

export interface PolypAnchor {
  t: number;
  angle: number;
}

export class PolypField {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(
    positions: THREE.Vector3[],
  ) {
    const n = positions.length;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = positions[i].x;
      pos[i * 3 + 1] = positions[i].y;
      pos[i * 3 + 2] = positions[i].z;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uLamp: { value: 1 },
        uPulseOrigin: { value: new THREE.Vector3(0, -9999, 0) },
        uPulseStart: { value: -100 },
        uPulseAmp: { value: 0 },
        uPulseSpeed: { value: 5.5 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uLamp;
        uniform vec3 uPulseOrigin;
        uniform float uPulseStart, uPulseAmp, uPulseSpeed;
        attribute float aSeed;
        varying float vI;
        varying float vHue;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(0.5, -mv.z);
          // 个体闪烁
          float tw = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * (0.6 + fract(aSeed * 3.7) * 1.3) + aSeed));
          // 暗适应：关灯更亮
          float dark = mix(1.75, 0.5, uLamp);
          // 光的涟漪：从触发点沿洞壁传播的波前
          float age = uTime - uPulseStart;
          float wave = 0.0;
          if (uPulseAmp > 0.001 && age > 0.0 && age < 14.0) {
            float front = uPulseSpeed * age;
            float dd = distance(position, uPulseOrigin);
            wave = exp(-pow((dd - front) * 0.85, 2.0)) * exp(-age * 0.30) * uPulseAmp;
          }
          // 贴脸淡出，防止巨型光斑糊屏
          float nearFade = smoothstep(0.45, 1.4, d);
          vI = (tw * dark * 0.55 + wave * 2.6) * nearFade;
          vHue = fract(aSeed * 7.31);
          float sz = (2.6 + fract(aSeed * 5.13) * 3.6) * (1.0 + wave * 1.1);
          gl_PointSize = min(sz * 18.2 / d, 34.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vI;
        varying float vHue;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5) discard;
          float core = smoothstep(0.5, 0.06, r);
          vec3 cyan = vec3(0.16, 0.85, 1.0);
          vec3 violet = vec3(0.62, 0.35, 1.0);
          vec3 col = mix(cyan, violet, vHue);
          gl_FragColor = vec4(col * vI * (core * 1.4), core * min(vI, 1.4));
        }
      `,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 16;
  }

  /** 触发一圈光的涟漪。big = 互动点全廊道大波光。 */
  triggerPulse(origin: THREE.Vector3, time: number, big = false) {
    const u = this.mat.uniforms;
    (u.uPulseOrigin.value as THREE.Vector3).copy(origin);
    u.uPulseStart.value = time;
    u.uPulseAmp.value = big ? 3.2 : 1.4;
    u.uPulseSpeed.value = big ? 7.5 : 5;
  }

  get lastPulseStart(): number { return this.mat.uniforms.uPulseStart.value as number; }

  update(time: number, lamp: number) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uLamp.value = lamp;
  }
}
