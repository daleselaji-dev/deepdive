import * as THREE from 'three';
import type { QualityProfile } from './quality';
import type { Cave } from './Cave';
import { causticFrames, shaftTexture, skyTexture, sunSprite } from './textures';

/**
 * 水面与阳光系统（docs/ART_DIRECTION.md §3.5）：
 * - 双面水面着色器：水下仰视 Snell 窗 + 太阳亮斑；水上俯视天空反射。
 * - 天坑地表世界：天空穹顶、峭壁环、丛林剪影、垂根、支援船。
 * - 体积光锥（天光井主束 + 光之厅裂隙束）、焦散覆盖层、god-ray 面片。
 */

const SUN_DIR = new THREE.Vector3(0.34, 0.86, 0.24).normalize();

const BEAM_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fres = abs(dot(viewDir, normalize(vNormal)));
  float edge = smoothstep(0.0, 0.6, fres);
  float grad = pow(vUv.y, 1.5);
  float tail = smoothstep(0.0, 0.18, vUv.y);
  float noise = 0.72
    + 0.18 * sin(vUv.x * 19.0 + uTime * 0.55) * sin(vUv.y * 7.0 - uTime * 0.34)
    + 0.10 * sin(vUv.x * 41.0 - uTime * 0.9);
  float a = edge * grad * tail * noise * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}
`;

const WATER_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
varying vec3 vWorldPos;
varying vec2 vUv;
void main() {
  vec2 p = vWorldPos.xz;
  vec3 n = normalize(vec3(
    sin(p.x * 1.7 + uTime * 1.35) * 0.16 + sin(p.y * 2.3 - uTime * 0.95) * 0.11,
    1.0,
    sin(p.y * 1.9 + uTime * 1.1) * 0.16 + sin(p.x * 2.7 - uTime * 0.8) * 0.09
  ));
  if (!gl_FrontFacing) {
    // ---- 水下仰视：Snell 窗 + 太阳亮斑 ----
    vec3 vd = normalize(vWorldPos - cameraPosition);
    float up = dot(vd, vec3(0.0, 1.0, 0.0));
    float snell = smoothstep(0.52, 0.95, up);
    float sunAmt = pow(max(0.0, dot(normalize(vd + n * 0.4), uSunDir)), 26.0);
    float halo = pow(max(0.0, dot(vd, uSunDir)), 5.0);
    vec3 base = mix(vec3(0.006, 0.026, 0.030), vec3(0.085, 0.2, 0.22), snell * 0.9);
    float sparkle = pow(max(0.0, sin(p.x * 21.0 + uTime * 2.1) * sin(p.y * 17.0 - uTime * 1.6)), 14.0)
      * pow(max(0.0, sin((p.x + p.y) * 9.0 - uTime * 1.1)), 4.0) * snell;
    vec3 col = base
      + vec3(1.0, 0.93, 0.72) * sunAmt * 1.7
      + vec3(0.30, 0.46, 0.46) * halo * 0.4 * snell
      + vec3(0.55, 0.66, 0.6) * sparkle * 0.32;
    gl_FragColor = vec4(col, 0.94);
  } else {
    // ---- 水上俯视：天空反射（黎明） ----
    vec3 vd = normalize(vWorldPos - cameraPosition);
    vec3 rd = reflect(vd, n);
    float horiz = smoothstep(-0.05, 0.55, rd.y);
    vec3 sky = mix(vec3(0.82, 0.56, 0.28), vec3(0.05, 0.13, 0.18), horiz);
    float sunspec = pow(max(0.0, dot(rd, uSunDir)), 70.0);
    float ripple = 0.5 + 0.5 * sin(p.x * 4.0 + uTime * 1.6) * sin(p.y * 3.4 - uTime * 1.2);
    vec3 col = sky * (0.5 + ripple * 0.12) + vec3(1.0, 0.85, 0.55) * sunspec * 1.8;
    gl_FragColor = vec4(col, 0.92);
  }
}
`;

export class WaterWorld {
  readonly group = new THREE.Group();
  readonly sunDir = SUN_DIR.clone();
  readonly boat = new THREE.Group();
  readonly boatPos = new THREE.Vector3(2.6, 0.0, 3.0);
  /** 水下主"太阳"（照亮竖井与回廊口） */
  readonly sunLight: THREE.SpotLight;

  private waterMat: THREE.ShaderMaterial;
  private beamMats: THREE.ShaderMaterial[] = [];
  private caustics: THREE.CanvasTexture[];
  private causticMesh!: THREE.Mesh;
  private causticIdx = 0;
  private causticTimer = 0;
  private rayMat: THREE.MeshBasicMaterial;
  private rays: THREE.Mesh[] = [];

  constructor(q: QualityProfile, cave: Cave, scene: THREE.Scene) {
    scene.add(this.group);

    // ---------- 水面 ----------
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(9.5, 48), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(cave.poolCenter.x, 0, cave.poolCenter.z);
    water.renderOrder = 4;
    this.group.add(water);

    // ---------- 天空穹顶 + 太阳 ----------
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(230, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
    );
    sky.position.y = 40;
    this.group.add(sky);
    const sun = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sunSprite(), color: 0xfff2d0, transparent: true, fog: false, depthWrite: false }),
    );
    sun.position.copy(SUN_DIR).multiplyScalar(190);
    sun.scale.setScalar(56);
    this.group.add(sun);

    // ---------- 峭壁环 + 丛林剪影 + 垂根 ----------
    const cliffMat = new THREE.MeshStandardMaterial({
      map: cave.rock.map,
      bumpMap: cave.rock.bumpMap,
      bumpScale: 1.2,
      color: 0x6d7a72,
      roughness: 0.95,
      side: THREE.BackSide,
    });
    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 7.4, 11, 28, 3, true), cliffMat);
    cliff.position.set(cave.poolCenter.x, 4.4, cave.poolCenter.z);
    this.group.add(cliff);

    const jungleMat = new THREE.MeshBasicMaterial({ color: 0x060d08, fog: false });
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      const h = 3 + Math.abs(Math.sin(i * 13.7)) * 6;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(1.2 + Math.sin(i * 7.1) * 0.6, h, 5), jungleMat);
      tree.position.set(
        cave.poolCenter.x + Math.cos(ang) * (9.2 + Math.sin(i * 3.3) * 1.4),
        9.6 + h * 0.5,
        cave.poolCenter.z + Math.sin(ang) * (9.2 + Math.cos(i * 5.1) * 1.4),
      );
      this.group.add(tree);
    }
    // 垂根：从洞口垂进井里（尺度感）
    const rootMat = new THREE.MeshStandardMaterial({ color: 0x2a231a, roughness: 0.9 });
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + Math.sin(i * 9.4);
      const len = 4 + Math.abs(Math.sin(i * 5.7)) * 7;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, len, 5), rootMat);
      root.position.set(
        cave.poolCenter.x + Math.cos(ang) * (6.6 + Math.sin(i * 3.1) * 0.8),
        9 - len / 2,
        cave.poolCenter.z + Math.sin(ang) * (6.6 + Math.cos(i * 4.7) * 0.8),
      );
      root.rotation.z = Math.sin(i * 3.3) * 0.1;
      this.group.add(root);
    }

    // ---------- 地表光照（距离受限点光，不污染洞内） ----------
    const dawnKey = new THREE.PointLight(0xffd9a0, 240, 42, 1.6);
    dawnKey.position.set(cave.poolCenter.x + 5, 9, cave.poolCenter.z + 5);
    const dawnFill = new THREE.PointLight(0x8fb4c8, 90, 46, 1.7);
    dawnFill.position.set(cave.poolCenter.x - 7, 13, cave.poolCenter.z - 6);
    this.group.add(dawnKey, dawnFill);

    // ---------- 水下太阳（竖井照明） ----------
    this.sunLight = new THREE.SpotLight(0xd6efe6, 950, 65, 0.62, 0.65, 1.35);
    this.sunLight.position.copy(SUN_DIR).multiplyScalar(26);
    this.sunLight.position.add(new THREE.Vector3(cave.poolCenter.x, 0, cave.poolCenter.z));
    this.sunLight.target.position.set(cave.poolCenter.x - 2, -14, cave.poolCenter.z + 4);
    this.group.add(this.sunLight, this.sunLight.target);

    // ---------- 支援船 ----------
    this.buildBoat();
    this.boat.position.copy(this.boatPos);
    this.group.add(this.boat);

    // ---------- 体积光锥 ----------
    const mkBeam = (
      topR: number, botR: number, h: number, color: number, intensity: number,
    ): THREE.Mesh => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.beamMats.push(mat);
      const geo = new THREE.CylinderGeometry(topR, botR, h, q.beamSegs, 6, true);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 6;
      return mesh;
    };

    // 天光井主束 ×4（细窄光柱，从水面斜插，站在旁边看得见）
    const beamTilt = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).multiplyScalar(-0.4);
    const b1 = mkBeam(1.5, 3.0, 17, 0x9fdbd2, 0.5);
    b1.position.set(cave.poolCenter.x - 1, -8, cave.poolCenter.z + 0.5);
    b1.rotation.set(beamTilt.z, 0, -beamTilt.x);
    const b2 = mkBeam(0.6, 1.5, 16, 0xbfe8da, 0.42);
    b2.position.set(cave.poolCenter.x - 3.2, -8.5, cave.poolCenter.z + 2.6);
    b2.rotation.set(beamTilt.z * 1.3, 0.4, -beamTilt.x * 1.3);
    const b3 = mkBeam(0.42, 1.1, 15, 0xd0f0e2, 0.4);
    b3.position.set(cave.poolCenter.x + 2.6, -9, cave.poolCenter.z - 1.8);
    b3.rotation.set(beamTilt.z * 0.8, 1.7, -beamTilt.x * 0.8);
    const b4 = mkBeam(0.8, 1.9, 16, 0xaee2d4, 0.36);
    b4.position.set(cave.poolCenter.x + 1.4, -8.5, cave.poolCenter.z + 3.2);
    b4.rotation.set(beamTilt.z * 1.1, 2.6, -beamTilt.x * 1.1);
    this.group.add(b1, b2, b3, b4);

    // 光之厅裂隙束
    const crack = cave.crackPoint;
    const beamH = 20;
    const hb = mkBeam(0.9, 2.6, beamH, 0x8fd8c8, 0.4);
    hb.position.set(crack.x, crack.y - beamH / 2 + 1.5, crack.z);
    this.group.add(hb);
    // 裂隙口的冷光源（照亮光之厅中央）
    const crackLight = new THREE.PointLight(0x9fdbd2, 95, 40, 1.4);
    crackLight.position.set(crack.x, crack.y - 4, crack.z);
    cave.zoneLights.push(crackLight);
    this.group.add(crackLight);

    // ---------- god-ray 面片（补充层次） ----------
    this.rayMat = new THREE.MeshBasicMaterial({
      map: shaftTexture(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < q.godRays; i++) {
      const h = 10 + Math.random() * 7;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.5 + Math.random() * 1.3, h), this.rayMat);
      plane.position.set(
        cave.poolCenter.x + (Math.random() - 0.5) * 8,
        -3 - Math.random() * 5,
        cave.poolCenter.z + (Math.random() - 0.5) * 8,
      );
      plane.rotation.set((Math.random() - 0.5) * 0.22, Math.random() * Math.PI, (Math.random() - 0.5) * 0.16);
      this.rays.push(plane);
      this.group.add(plane);
    }

    // ---------- 焦散覆盖层（竖井壁） ----------
    this.caustics = causticFrames(q.causticFrames, q.causticSize);
    this.buildCausticShell(cave);
  }

  /** 焦散壳：与主管同参数的贴壁内衬（加法混合动画帧） */
  private buildCausticShell(cave: Cave): void {
    const shaftEnd = cave.zoneRange('gallery').t0 * 1.15;
    const geo = cave.buildShellGeometry(shaftEnd, 0.06);
    const mat = new THREE.MeshBasicMaterial({
      map: this.caustics[0],
      color: 0x9fd8c8,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.causticMesh = new THREE.Mesh(geo, mat);
    this.causticMesh.renderOrder = 3;
    this.group.add(this.causticMesh);
  }

  /** 支援船「露水号」：木质小艇 + 舷梯 + 潜水旗 */
  private buildBoat(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x7a4a2c, roughness: 0.72 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.85 });
    const white = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6 });

    // 船体：中段箱体 + 前后锥艏艉
    const mid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 3.2), hullMat);
    mid.position.y = -0.12;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 4), hullMat);
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    bow.scale.set(1.0, 1, 0.44);
    bow.position.set(0, -0.12, -2.35);
    const stern = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.5), darkMat);
    stern.position.set(0, -0.1, 1.8);
    // 底漆（水下可见的暗色船底）
    const keel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 3.6), darkMat);
    keel.position.y = -0.48;
    // 舷缘
    const gw1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 3.4), white);
    gw1.position.set(0.82, 0.32, 0);
    const gw2 = gw1.clone();
    gw2.position.x = -0.82;
    // 坐板
    const bench1 = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.4), white);
    bench1.position.set(0, 0.2, 0.6);
    const bench2 = bench1.clone();
    bench2.position.z = -0.7;
    // 舷外机
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.3), darkMat);
    motor.position.set(0, 0.34, 2.1);
    // 舷梯（登船点）
    const ladder = new THREE.Group();
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, metalness: 0.7, roughness: 0.3 });
    for (const sx of [-0.18, 0.18]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), railMat);
      rail.position.set(sx, -0.45, 0);
      ladder.add(rail);
    }
    for (let i = 0; i < 4; i++) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 6), railMat);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, -1.05 + i * 0.36, 0);
      ladder.add(rung);
    }
    ladder.position.set(-0.95, 0.15, 0.4);
    // 潜水旗（红底白斜杠）
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.3, 5), railMat);
    pole.position.set(0.6, 0.95, 1.6);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xb62a1c, roughness: 0.7, side: THREE.DoubleSide }),
    );
    flag.position.set(0.83, 1.42, 1.6);
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7, side: THREE.DoubleSide }),
    );
    stripe.position.set(0.83, 1.42, 1.605);
    stripe.rotation.z = -0.62;
    this.boat.add(mid, bow, stern, keel, gw1, gw2, bench1, bench2, motor, ladder, pole, flag, stripe);
  }

  update(dt: number, time: number): void {
    this.waterMat.uniforms.uTime.value = time;
    for (const m of this.beamMats) m.uniforms.uTime.value = time;
    this.rayMat.opacity = 0.42 + Math.sin(time * 0.4) * 0.1 + Math.sin(time * 1.7) * 0.04;

    // 焦散帧循环（~11fps）
    this.causticTimer += dt;
    if (this.causticTimer > 0.09) {
      this.causticTimer = 0;
      this.causticIdx = (this.causticIdx + 1) % this.caustics.length;
      (this.causticMesh.material as THREE.MeshBasicMaterial).map = this.caustics[this.causticIdx];
    }
    // 太阳光微颤（水面折射感）
    this.sunLight.intensity = 950 + Math.sin(time * 1.9) * 90 + Math.sin(time * 4.7) * 45;

    // 船体轻摇
    this.boat.position.y = this.boatPos.y + Math.sin(time * 0.8) * 0.05;
    this.boat.rotation.z = Math.sin(time * 0.66) * 0.03;
    this.boat.rotation.x = Math.sin(time * 0.5 + 1) * 0.02;
  }
}
