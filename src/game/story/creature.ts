/**
 * 深海生物：苍白的脸 + 蛇形躯干。
 * 两种形态：scare（近距离惊吓）与 awe（巨大、平静、生物荧光——竹节虫式点睛）。
 */
import * as THREE from 'three';
import { Simplex3 } from '../../core/noise';
import { makeGlowSprite } from '../../render/volumetric';

function skinMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xdfe6e4) },
      uRimColor: { value: new THREE.Color(0x9fd8e8) },
      uLamp: { value: 1 },
      uGlow: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uRimColor;
      uniform float uLamp;
      uniform float uGlow;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        vec3 vd = normalize(-vP);
        float ndl = clamp(dot(n, vd), 0.0, 1.0);
        float wrap = ndl * 0.5 + 0.5;
        float dist = length(vP);
        float atten = clamp(uLamp * 12.0 / (1.0 + dist * dist * 0.09), 0.0, 0.9);
        atten = max(atten, uGlow * 0.32);
        vec3 base = uColor * (0.02 + 0.98 * wrap * wrap * wrap) * atten;
        float fres = pow(1.0 - abs(dot(n, vd)), 2.2);
        vec3 rim = uRimColor * fres * (0.3 * atten + uGlow * (2.2 + 0.5 * sin(uTime * 1.7)));
        vec3 glow = uRimColor * uGlow * 0.16 * (0.8 + 0.2 * sin(uTime * 0.9 + vP.y));
        gl_FragColor = vec4(base + rim + glow, 1.0);
      }
    `,
  });
}

export class Creature {
  readonly group = new THREE.Group();
  private skin = skinMaterial();
  private segments: THREE.Mesh[] = [];
  private glowLight: THREE.PointLight;
  private spots: THREE.Sprite[] = [];
  private lungeT = -1;
  private baseZ = 0;

  constructor(seed = 77) {
    const noise = new Simplex3(seed);

    // 头 / 脸
    const headGeo = new THREE.SphereGeometry(0.5, 48, 40);
    const pos = headGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = noise.fbm(v.x * 2.2, v.y * 2.2, v.z * 2.2, 3);
      // 颧骨与眼窝的凹陷
      const socket =
        Math.exp(-v.clone().sub(new THREE.Vector3(0.17, 0.1, 0.42)).lengthSq() * 22) +
        Math.exp(-v.clone().sub(new THREE.Vector3(-0.17, 0.1, 0.42)).lengthSq() * 22);
      const d = 1 + n * 0.07 - socket * 0.13;
      pos.setXYZ(i, v.x * d, v.y * d, v.z * d);
    }
    headGeo.computeVertexNormals();
    const head = new THREE.Mesh(headGeo, this.skin);
    head.scale.set(0.85, 1.14, 0.94);
    this.group.add(head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x010204 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), eyeMat);
      eye.position.set(sx * 0.155, 0.115, 0.395);
      eye.scale.set(1, 1.25, 0.6);
      this.group.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), eyeMat);
    mouth.position.set(0, -0.22, 0.43);
    mouth.scale.set(1.5, 0.55, 0.4);
    this.group.add(mouth);

    // 蛇形躯干
    for (let i = 0; i < 9; i++) {
      const r = 0.36 * Math.pow(1 - i / 10, 0.85);
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 18), this.skin);
      seg.position.set(0, -0.06 * i, -0.5 - i * 0.52);
      seg.scale.set(1, 1.15, 1.5);
      this.group.add(seg);
      this.segments.push(seg);
    }

    // 生物荧光斑点（awe 形态）
    for (let i = 0; i < 26; i++) {
      const s = makeGlowSprite(0x86e2ff, 0.34, 0);
      const k = Math.random();
      s.position.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5 - 0.05 * k * 9,
        -0.3 - k * 4.8
      );
      this.group.add(s);
      this.spots.push(s);
    }

    this.glowLight = new THREE.PointLight(0x6fd4ff, 0, 24, 1.6);
    this.group.add(this.glowLight);
    this.group.visible = false;
  }

  setLamp(x: number) { this.skin.uniforms.uLamp.value = x; }

  /** 惊吓形态：贴脸，随后扑近。 */
  poseScare(camera: THREE.Camera) {
    this.group.visible = true;
    this.group.scale.setScalar(1);
    this.skin.uniforms.uGlow.value = 0;
    this.glowLight.intensity = 0;
    for (const s of this.spots) (s.material as THREE.SpriteMaterial).opacity = 0;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    this.group.position.copy(camPos).addScaledVector(dir, 1.35);
    this.group.position.y += 0.12;
    this.group.lookAt(camPos);
    this.baseZ = 0;
    this.lungeT = 0;
  }

  /** 敬畏形态：巨大、发光、缓慢。 */
  poseAwe(position: THREE.Vector3, lookAt: THREE.Vector3) {
    this.group.visible = true;
    this.group.scale.setScalar(6.5);
    this.group.position.copy(position);
    this.group.lookAt(lookAt);
    this.skin.uniforms.uGlow.value = 1;
    this.glowLight.intensity = 32;
    this.lungeT = -1;
    for (const s of this.spots) (s.material as THREE.SpriteMaterial).opacity = 1;
  }

  hide() { this.group.visible = false; }

  update(dt: number, time: number) {
    if (!this.group.visible) return;
    this.skin.uniforms.uTime.value = time;
    // 躯干摆动
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      seg.position.x = Math.sin(time * 1.15 + i * 0.65) * 0.1 * (i / 4);
      seg.position.y = -0.06 * i + Math.cos(time * 0.8 + i * 0.5) * 0.05 * (i / 5);
    }
    // 惊吓扑近
    if (this.lungeT >= 0) {
      this.lungeT += dt;
      const k = Math.min(1, this.lungeT / 0.8);
      const ease = k * k;
      this.group.translateZ((0.55 * ease - this.baseZ));
      this.baseZ = 0.55 * ease;
      this.group.rotation.z = Math.sin(time * 22) * 0.02 * (1 - k);
    }
    // 荧光斑点脉动
    if (this.skin.uniforms.uGlow.value > 0) {
      for (let i = 0; i < this.spots.length; i++) {
        const m = this.spots[i].material as THREE.SpriteMaterial;
        m.opacity = 0.6 + 0.4 * Math.sin(time * 1.3 + i * 1.7);
      }
      this.glowLight.intensity = 30 + 9 * Math.sin(time * 0.8);
    }
  }
}
