import * as THREE from 'three';
import type { QualityProfile } from './quality';
import type { Cave } from './Cave';
import { causticFrames, particleSprite, shaftTexture, skyTexture, sunSprite, woodTexture } from './textures';

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
  a *= 1.0 - smoothstep(-0.15, 0.05, vWorldPos.y); // 光锥不许捅出水面
  a *= 1.0 - smoothstep(0.1, 0.6, cameraPosition.y); // 水上视角不叠画水下光锥
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
  // 双频波法线（低频大涌 + 高频细纹）
  vec3 n = normalize(vec3(
    sin(p.x * 0.9 + uTime * 0.7) * 0.22 + sin(p.x * 2.3 - uTime * 1.1) * 0.10 + sin(p.y * 1.7 + uTime * 0.9) * 0.08,
    1.0,
    sin(p.y * 1.1 + uTime * 0.8) * 0.22 + sin(p.y * 2.7 - uTime * 1.3) * 0.10 + sin(p.x * 1.9 - uTime * 0.7) * 0.08
  ));
  if (!gl_FrontFacing) {
    // ---- 水下仰视：Snell 窗（窗内=明亮天空+太阳爆点，窗外=全反射暗镜面） ----
    vec3 vd = normalize(vWorldPos - cameraPosition);
    float up = dot(vd, vec3(0.0, 1.0, 0.0));
    // 波动让窗口边缘呼吸、破碎
    float wob = (n.x + n.z) * 0.55;
    float snell = smoothstep(0.30, 0.74, up + wob);
    // 窗内：折射后的天空——朝太阳方向更亮更暖
    vec3 vr = normalize(vd + n * 0.5);
    float toSun = max(0.0, dot(vr, uSunDir));
    float sunDisk = pow(toSun, 180.0) * 3.2 + pow(toSun, 40.0) * 1.6;
    float sunHalo = pow(toSun, 5.0);
    vec3 skyIn = mix(vec3(0.10, 0.34, 0.40), vec3(0.72, 0.98, 0.92), sunHalo * 0.85)
      + vec3(0.9, 0.8, 0.5) * pow(toSun, 12.0) * 0.55;
    // 窗外：全反射暗镜面（不是死黑），带微弱波光
    vec3 mirror = vec3(0.030, 0.075, 0.080)
      + vec3(0.05, 0.12, 0.12) * pow(max(0.0, n.x * 2.2 + n.z * 1.8), 2.0);
    // 波峰亮线（sparkle）
    float sparkle = pow(max(0.0, sin(p.x * 13.0 + uTime * 1.7) * sin(p.y * 11.0 - uTime * 1.3)), 10.0)
      * pow(max(0.0, sin((p.x - p.y) * 7.0 + uTime * 0.9)), 4.0);
    vec3 col = mix(mirror, skyIn, snell)
      + vec3(1.0, 0.96, 0.80) * sunDisk * smoothstep(0.1, 0.5, snell)
      + vec3(0.55, 0.72, 0.66) * sparkle * (0.10 + snell * 0.45);
    gl_FragColor = vec4(col, 0.985);
  } else {
    // ---- 水上俯视：天空反射（暖带只留掠射角一线，主体是青玉镜面） ----
    vec3 vd = normalize(vWorldPos - cameraPosition);
    vec3 rd = reflect(vd, n);
    float horiz = smoothstep(-0.06, 0.14, rd.y);
    // 掠射角反射崖壁（暗绿），高角反射天空（青）；金色只沿太阳方位铺一条光路
    vec3 base = mix(vec3(0.05, 0.12, 0.13), vec3(0.10, 0.22, 0.26), horiz);
    float toSunH = pow(max(0.0, dot(normalize(vec3(rd.x, 0.3, rd.z)), uSunDir)), 3.5);
    vec3 sky = base + vec3(0.55, 0.36, 0.15) * toSunH * (1.0 - horiz * 0.55);
    float sunspec = pow(max(0.0, dot(rd, uSunDir)), 70.0);
    float glitter = pow(max(0.0, dot(rd, uSunDir)), 16.0)
      * pow(max(0.0, sin(p.x * 9.0 + uTime * 1.4) * sin(p.y * 8.0 - uTime * 1.1)), 6.0);
    float ripple = 0.5 + 0.5 * sin(p.x * 4.0 + uTime * 1.6) * sin(p.y * 3.4 - uTime * 1.2);
    vec3 col = sky * (0.60 + ripple * 0.12)
      + vec3(1.0, 0.85, 0.55) * sunspec * 2.2
      + vec3(1.0, 0.90, 0.62) * glitter * 1.4;
    gl_FragColor = vec4(col, 0.93);
  }
}
`;

export class WaterWorld {
  readonly group = new THREE.Group();
  readonly sunDir = SUN_DIR.clone();
  readonly boat = new THREE.Group();
  readonly boatPos = new THREE.Vector3(-4.2, 0.0, 0.6);
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
    const water = new THREE.Mesh(new THREE.CircleGeometry(12.5, 56), this.waterMat);
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
      new THREE.SpriteMaterial({ map: sunSprite(), color: 0xffe9c0, transparent: true, fog: false, depthWrite: false }),
    );
    sun.position.copy(SUN_DIR).multiplyScalar(190);
    sun.scale.setScalar(44);
    this.group.add(sun);

    // ---------- 峭壁环 + 丛林剪影 + 垂根 ----------
    const cliffMat = new THREE.MeshStandardMaterial({
      map: cave.rock.map,
      normalMap: cave.rock.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      color: 0x8d978c,
      roughness: 0.92,
      side: THREE.BackSide,
    });
    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 7.4, 9.2, 40, 3, true), cliffMat);
    cliff.position.set(cave.poolCenter.x, 3.5, cave.poolCenter.z);
    this.group.add(cliff);

    const jungleMat = new THREE.MeshBasicMaterial({ color: 0x060d08, fog: false });
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      const h = 3 + Math.abs(Math.sin(i * 13.7)) * 6;
      const tree = new THREE.Mesh(new THREE.ConeGeometry(1.2 + Math.sin(i * 7.1) * 0.6, h, 5), jungleMat);
      tree.position.set(
        cave.poolCenter.x + Math.cos(ang) * (9.2 + Math.sin(i * 3.3) * 1.4),
        7.9 + h * 0.5,
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
        7.8 - len / 2,
        cave.poolCenter.z + Math.sin(ang) * (6.6 + Math.cos(i * 4.7) * 0.8),
      );
      root.rotation.z = Math.sin(i * 3.3) * 0.1;
      this.group.add(root);
    }

    // ---------- 地表光照（距离受限点光，不污染洞内） ----------
    const dawnKey = new THREE.PointLight(0xffe4b8, 190, 42, 1.6);
    dawnKey.position.set(cave.poolCenter.x + 5, 9, cave.poolCenter.z + 5);
    const dawnFill = new THREE.PointLight(0xa8c8d8, 110, 46, 1.7);
    dawnFill.position.set(cave.poolCenter.x - 7, 13, cave.poolCenter.z - 6);
    // 崖壁内环晨光（照亮 BackSide 峭壁，水面镜头不再是黑带）
    const rim1 = new THREE.PointLight(0xffd9a8, 95, 32, 1.6);
    rim1.position.set(cave.poolCenter.x - 5, 4.5, cave.poolCenter.z + 4);
    const rim2 = new THREE.PointLight(0xc8d8d2, 62, 30, 1.6);
    rim2.position.set(cave.poolCenter.x + 4, 5.5, cave.poolCenter.z - 5);
    // 井口下方上照散射（水面反射回来的天光——洞壁悬垂不再死黑）
    const bounce = new THREE.PointLight(0x2e5a5c, 40, 22, 1.5);
    bounce.position.set(cave.poolCenter.x, -6, cave.poolCenter.z);
    // 船后崖壁补光（水面镜头背景不再是黑幕）
    const rim3 = new THREE.PointLight(0xd8b888, 60, 26, 1.6);
    rim3.position.set(cave.poolCenter.x + 6, 5, cave.poolCenter.z + 6);
    this.group.add(dawnKey, dawnFill, rim1, rim2, rim3, bounce);

    // ---------- 水下太阳（竖井照明） ----------
    this.sunLight = new THREE.SpotLight(0xd6efe6, 460, 65, 0.72, 0.75, 1.35);
    this.sunLight.position.copy(SUN_DIR).multiplyScalar(26);
    this.sunLight.position.add(new THREE.Vector3(cave.poolCenter.x, 0, cave.poolCenter.z));
    this.sunLight.target.position.set(cave.poolCenter.x - 2, -14, cave.poolCenter.z + 4);
    this.group.add(this.sunLight, this.sunLight.target);

    // ---------- 支援船 ----------
    this.buildBoat();
    this.boat.scale.setScalar(0.9); // 船底剪影在 Snell 窗里是点缀，不是遮挡
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

    // 天光井光柱簇：1 宽主幕 + 5 细束，全部沿折射后太阳方向倾斜（从下仰望时向太阳收束）
    const beamTilt = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).multiplyScalar(-0.32);
    const beamDefs: [number, number, number, number, number, number, number, number][] = [
      // [topR, botR, h, color, intensity, x, y, z]
      [2.4, 4.6, 24, 0x9fdbd2, 0.34, -0.6, -11, 0.8],
      [0.7, 1.7, 22, 0xc8f0e0, 0.5, -3.0, -11.5, 2.4],
      [0.5, 1.2, 20, 0xd0f0e2, 0.48, 2.6, -11.5, -1.6],
      [0.9, 2.1, 22, 0xaee2d4, 0.42, 1.4, -11, 3.0],
      [0.4, 1.0, 18, 0xd8f4e6, 0.44, -1.8, -10, -2.2],
      [0.55, 1.4, 21, 0xbfe8da, 0.4, 3.4, -11, 1.2],
    ];
    for (let bi = 0; bi < beamDefs.length; bi++) {
      const [tr, br2, h, col, its, bx, by, bz] = beamDefs[bi];
      const beam = mkBeam(tr, br2, h, col, its);
      beam.position.set(cave.poolCenter.x + bx, by, cave.poolCenter.z + bz);
      beam.rotation.set(beamTilt.z * (0.8 + bi * 0.12), bi * 1.1, -beamTilt.x * (0.8 + bi * 0.12));
      this.group.add(beam);
    }

    // 光之厅裂隙束
    const crack = cave.crackPoint;
    const beamH = 20;
    const hb = mkBeam(0.9, 2.6, beamH, 0x8fd8c8, 0.5);
    hb.position.set(crack.x, crack.y - beamH / 2 + 1.5, crack.z);
    this.group.add(hb);
    // 裂隙口的冷光源（照亮光之厅中央）
    const crackLight = new THREE.PointLight(0x9fdbd2, 95, 40, 1.4);
    crackLight.position.set(crack.x, crack.y - 4, crack.z);
    cave.zoneLights.push(crackLight);
    this.group.add(crackLight);
    // 裂隙口光晕：让镂空处读作"燃烧的天窗"而非平面蓝块
    const glowTex = particleSprite();
    for (const [scale, op] of [[7, 0.55], [14, 0.22]] as [number, number][]) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xcff2e4,
        transparent: true,
        opacity: op,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      halo.scale.setScalar(scale);
      halo.position.set(crack.x, crack.y - 0.6, crack.z);
      this.group.add(halo);
    }

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
        -h / 2 - 0.4 - Math.random() * 3, // 面片顶端压在水面以下
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
      color: 0x86b8ac,
      transparent: true,
      opacity: 0.17,
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
    const wood = woodTexture();
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(2, 1);
    const hullMat = new THREE.MeshStandardMaterial({ map: wood, color: 0xb98a5e, roughness: 0.78 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1512, roughness: 0.85 });
    const white = new THREE.MeshStandardMaterial({ map: wood, color: 0xc9c2b0, roughness: 0.7 });

    // 船体：中段箱体 + 前后锥艏艉（浅吃水——小艇水下体量必须薄）
    const mid = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 3.2), hullMat);
    mid.position.y = 0.04;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.6, 4), hullMat);
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    bow.scale.set(1.0, 1, 0.38);
    bow.position.set(0, 0.02, -2.0);
    const stern = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.56, 0.5), darkMat);
    stern.position.set(0, 0.04, 1.8);
    // 圆滑船底（水下仰望的剪影主体：拉长扁椭球 + 尾舵鳍）——不能是方块
    const bilgeMat = new THREE.MeshStandardMaterial({ color: 0x232e2a, roughness: 0.5, metalness: 0.15 });
    const keel = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), bilgeMat);
    keel.scale.set(0.84, 0.2, 2.1);
    keel.position.y = -0.18;
    const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.7), bilgeMat);
    skeg.position.set(0, -0.4, 1.5);
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
    // 桅灯：清晨水面上的一粒暖光（回程时导航地标）
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.9, 5), railMat);
    lampPole.position.set(-0.5, 0.75, -1.7);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x584018, emissive: 0xffc86a, emissiveIntensity: 3.2 }),
    );
    bulb.position.set(-0.5, 1.24, -1.7);
    const lampLight = new THREE.PointLight(0xffc86a, 4.5, 9, 1.7);
    lampLight.position.copy(bulb.position);
    this.boat.add(mid, bow, stern, keel, skeg, gw1, gw2, bench1, bench2, motor, ladder, pole, flag, stripe, lampPole, bulb, lampLight);
  }

  update(dt: number, time: number): void {
    this.waterMat.uniforms.uTime.value = time;
    for (const m of this.beamMats) m.uniforms.uTime.value = time;
    this.rayMat.opacity = 0.42 + Math.sin(time * 0.4) * 0.1 + Math.sin(time * 1.7) * 0.02;

    // 焦散帧循环（~11fps）
    this.causticTimer += dt;
    if (this.causticTimer > 0.09) {
      this.causticTimer = 0;
      this.causticIdx = (this.causticIdx + 1) % this.caustics.length;
      (this.causticMesh.material as THREE.MeshBasicMaterial).map = this.caustics[this.causticIdx];
    }
    // 太阳光微颤（水面折射感；幅度收敛避免闪烁不适）
    this.sunLight.intensity = 460 + Math.sin(time * 1.1) * 9 + Math.sin(time * 2.3) * 4;

    // 船体轻摇
    this.boat.position.y = this.boatPos.y + Math.sin(time * 0.8) * 0.05;
    this.boat.rotation.z = Math.sin(time * 0.66) * 0.03;
    this.boat.rotation.x = Math.sin(time * 0.5 + 1) * 0.02;
  }
}
