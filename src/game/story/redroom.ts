/**
 * 红房间：红色帷幔（顶点波动 shader）、之字形地板（Canvas 程序纹理）、
 * 镜面反射（镜像帷幔 + 半透明地板）、背对的潜水服身影。
 */
import * as THREE from 'three';
import { makeGlowSprite } from '../../render/volumetric';

function curtainMaterial(dim = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uDim: { value: dim },
      uPhase: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = sin(uv.x * 5.0 + uTime * 0.6 + uPhase) * 0.16
                   + sin(uv.x * 11.0 - uTime * 0.4 + uPhase * 2.0) * 0.06;
        p += normal * sway * (1.0 - uv.y * 0.85);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDim;
      uniform float uPhase;
      varying vec2 vUv;
      void main() {
        float f = sin(vUv.x * 46.0 + sin(vUv.x * 13.0 + uPhase) * 2.2 + uTime * 0.25) * 0.5 + 0.5;
        float folds = 0.35 + 0.65 * pow(f, 1.7);
        float vert = 0.55 + 0.55 * sin(vUv.y * 3.14159);
        vec3 col = vec3(0.5, 0.015, 0.05) * folds * vert;
        col += vec3(0.16, 0.0, 0.02) * pow(1.0 - vUv.y, 2.0);
        gl_FragColor = vec4(col * uDim, 1.0);
      }
    `,
  });
}

function chevronTexture(): THREE.Texture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e4d8';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#0a0a0c';
  const bands = 4;
  const bh = s / bands;
  const teeth = 6;
  const tw = s / teeth;
  for (let b = 0; b < bands; b++) {
    g.beginPath();
    const y0 = b * bh;
    g.moveTo(0, y0);
    for (let i = 0; i <= teeth; i++) {
      g.lineTo(i * tw + tw / 2, y0 + bh / 2);
      g.lineTo((i + 1) * tw, y0);
    }
    for (let i = teeth; i >= 0; i--) {
      g.lineTo((i + 1) * tw, y0 + bh / 2);
      g.lineTo(i * tw + tw / 2, y0 + bh);
    }
    g.closePath();
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class RedRoom {
  readonly scene = new THREE.Scene();
  readonly figure = new THREE.Group();
  readonly figurePos = new THREE.Vector3(0, 0, -9);
  private curtainMats: THREE.ShaderMaterial[] = [];
  private head: THREE.Group;
  private turnAmount = 0;
  private turnTarget = 0;
  private spot: THREE.SpotLight;

  constructor() {
    this.scene.fog = new THREE.FogExp2(0x0a0002, 0.052);
    this.scene.background = new THREE.Color(0x0a0002);

    // 帷幔环（正立 + 镜像）
    const R = 13, PANELS = 26;
    for (const mirror of [false, true]) {
      const dim = mirror ? 0.32 : 1;
      const mat = curtainMaterial(dim);
      this.curtainMats.push(mat);
      for (let i = 0; i < PANELS; i++) {
        const a = (i / PANELS) * Math.PI * 2;
        const geo = new THREE.PlaneGeometry(3.5, 7.5, 24, 4);
        const mesh = new THREE.Mesh(geo, mat.clone());
        (mesh.material as THREE.ShaderMaterial).uniforms.uPhase.value = i * 1.37;
        this.curtainMats.push(mesh.material as THREE.ShaderMaterial);
        mesh.position.set(Math.sin(a) * R, mirror ? -3.75 : 3.75, Math.cos(a) * R);
        if (mirror) mesh.scale.y = -1;
        mesh.lookAt(0, mesh.position.y, 0);
        mesh.renderOrder = mirror ? 1 : 3;
        this.scene.add(mesh);
      }
    }

    // 之字形地板（半透明 → 显露镜像）
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({
        map: chevronTexture(),
        roughness: 0.36,
        metalness: 0.05,
        transparent: true,
        opacity: 0.9,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = 2;
    this.scene.add(floor);

    // 顶光 + 环境
    this.spot = new THREE.SpotLight(0xffe8d0, 1400, 40, 0.55, 0.6, 1.5);
    this.spot.position.set(0, 11, -4);
    this.spot.target.position.copy(this.figurePos);
    this.scene.add(this.spot, this.spot.target);
    this.scene.add(new THREE.AmbientLight(0x3d0208, 1.6));

    // 身影脚下的镜像辉光
    const gl = makeGlowSprite(0xff4a4a, 3.2, 0.16);
    gl.position.set(this.figurePos.x, 0.05, this.figurePos.z);
    this.scene.add(gl);

    this.head = this.buildFigure();
    this.figure.position.copy(this.figurePos);
    this.figure.rotation.y = Math.PI; // 背对入口（入口在 +z）
    this.scene.add(this.figure);
  }

  private buildFigure(): THREE.Group {
    const suit = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.42, metalness: 0.4 });
    const mk = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, suit);
      m.position.set(x, y, z);
      this.figure.add(m);
      return m;
    };
    // 腿 / 躯干 / 手臂
    mk(new THREE.CapsuleGeometry(0.11, 0.72, 6, 12), -0.14, 0.55, 0);
    mk(new THREE.CapsuleGeometry(0.11, 0.72, 6, 12), 0.14, 0.55, 0);
    mk(new THREE.CapsuleGeometry(0.24, 0.55, 6, 14), 0, 1.28, 0);
    mk(new THREE.CapsuleGeometry(0.075, 0.6, 6, 10), -0.34, 1.25, 0);
    mk(new THREE.CapsuleGeometry(0.075, 0.6, 6, 10), 0.34, 1.25, 0);
    // 背上的气瓶
    const tank = mk(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 14), 0, 1.42, 0.24);
    tank.rotation.x = 0.06;

    // 头（转身时显露苍白的脸）
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.86, 0);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 18), suit);
    headGroup.add(helmet);
    const faceMat = new THREE.MeshStandardMaterial({
      color: 0xe6ebe8, roughness: 0.55, emissive: 0x223034, emissiveIntensity: 0.25,
    });
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 18), faceMat);
    face.position.z = 0.045;
    face.scale.set(0.82, 1.05, 0.85);
    headGroup.add(face);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x020204 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), eyeMat);
      eye.position.set(sx * 0.05, 0.03, 0.155);
      headGroup.add(eye);
    }
    this.figure.add(headGroup);
    return headGroup;
  }

  /** 0 = 背对；1 = 完全转身面向玩家。 */
  turnTo(x: number) { this.turnTarget = x; }

  dimLights(x: number) {
    this.spot.intensity = 1400 * x;
  }

  update(dt: number, time: number) {
    for (const m of this.curtainMats) m.uniforms.uTime.value = time;
    this.turnAmount += (this.turnTarget - this.turnAmount) * Math.min(1, dt * 0.8);
    this.figure.rotation.y = Math.PI * (1 - this.turnAmount);
    this.head.rotation.y = Math.sin(time * 0.4) * 0.04;
    this.figure.position.y = Math.sin(time * 0.7) * 0.012;
  }
}
