/** 悬浮微粒（相机周围循环体，受手电光锥调制）与气泡池。 */
import * as THREE from 'three';

const SILT_BOX = 26;

export class Silt {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  constructor(count: number, color = new THREE.Color(0.32, 0.42, 0.48)) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * SILT_BOX;
      pos[i * 3 + 1] = (Math.random() - 0.5) * SILT_BOX;
      pos[i * 3 + 2] = (Math.random() - 0.5) * SILT_BOX;
      seed[i] = Math.random() * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uLightDir: { value: new THREE.Vector3(0, 0, -1) },
        uLamp: { value: 1 },
        uAmbient: { value: 0.3 },
        uColor: { value: color },
        uSize: { value: 24 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uLightDir;
        uniform float uLamp;
        uniform float uAmbient;
        uniform float uSize;
        attribute float aSeed;
        varying float vA;
        void main() {
          vec3 p = position;
          p += vec3(
            sin(uTime * 0.11 + aSeed * 17.0),
            cos(uTime * 0.09 + aSeed * 23.0) - uTime * 0.014,
            sin(uTime * 0.07 + aSeed * 31.0)
          ) * 0.6;
          vec3 rel = mod(p - uCenter + ${(SILT_BOX / 2).toFixed(1)}, ${SILT_BOX.toFixed(1)}) - ${(SILT_BOX / 2).toFixed(1)};
          vec3 wp = uCenter + rel;
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          float d = max(0.6, -mv.z);
          float cone = smoothstep(0.80, 0.97, dot(normalize(rel + 0.0001), uLightDir));
          float lit = uAmbient + uLamp * cone * smoothstep(15.0, 2.5, d);
          vA = smoothstep(13.0, 5.0, d) * (0.3 + 0.7 * fract(aSeed * 7.31)) * lit * 0.4;
          gl_PointSize = uSize * (0.9 + fract(aSeed * 3.7)) / d;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(c)) * vA;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 15;
  }

  update(time: number, center: THREE.Vector3, lightDirWorld: THREE.Vector3, lamp: number, ambient: number) {
    this.mat.uniforms.uTime.value = time;
    (this.mat.uniforms.uCenter.value as THREE.Vector3).copy(center);
    (this.mat.uniforms.uLightDir.value as THREE.Vector3).copy(lightDirWorld);
    this.mat.uniforms.uLamp.value = lamp;
    this.mat.uniforms.uAmbient.value = ambient;
  }

  setColor(c: THREE.ColorRepresentation) {
    (this.mat.uniforms.uColor.value as THREE.Color).set(c);
  }
}

interface Bubble {
  alive: boolean;
  life: number;
  maxLife: number;
  vel: number;
  phase: number;
}

export class BubblePool {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private bubbles: Bubble[] = [];
  private posArr: Float32Array;
  private alphaArr: Float32Array;
  private sizeArr: Float32Array;
  private cursor = 0;

  constructor(private capacity = 160) {
    this.geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(capacity * 3);
    this.alphaArr = new Float32Array(capacity);
    this.sizeArr = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.bubbles.push({ alive: false, life: 0, maxLife: 1, vel: 0, phase: 0 });
      this.posArr[i * 3 + 1] = -9999;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 620 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(0.4, -mv.z);
          gl_PointSize = uScale * aSize / d;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r = length(c);
          if (r > 1.0) discard;
          float body = smoothstep(1.0, 0.82, r);
          float rim = smoothstep(0.5, 0.95, r);
          float spec = smoothstep(0.4, 0.0, length(c - vec2(-0.3, -0.35)));
          vec3 col = vec3(0.45, 0.62, 0.72) * 0.3 + rim * vec3(0.35, 0.45, 0.5) + spec * vec3(0.55);
          gl_FragColor = vec4(col, body * (0.18 + rim * 0.4) * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
  }

  burst(origin: THREE.Vector3, count: number, spread = 0.25) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const b = this.bubbles[i];
      b.alive = true;
      b.life = 0;
      b.maxLife = 1.6 + Math.random() * 1.4;
      b.vel = 0.5 + Math.random() * 0.7;
      b.phase = Math.random() * Math.PI * 2;
      this.posArr[i * 3] = origin.x + (Math.random() - 0.5) * spread;
      this.posArr[i * 3 + 1] = origin.y + (Math.random() - 0.5) * spread * 0.5;
      this.posArr[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
      this.sizeArr[i] = 0.012 + Math.random() * 0.03;
      this.alphaArr[i] = 1;
    }
  }

  update(dt: number, time: number) {
    for (let i = 0; i < this.capacity; i++) {
      const b = this.bubbles[i];
      if (!b.alive) continue;
      b.life += dt;
      if (b.life >= b.maxLife) {
        b.alive = false;
        this.alphaArr[i] = 0;
        this.posArr[i * 3 + 1] = -9999;
        continue;
      }
      this.posArr[i * 3 + 1] += b.vel * dt;
      this.posArr[i * 3] += Math.sin(time * 3 + b.phase) * 0.16 * dt;
      this.posArr[i * 3 + 2] += Math.cos(time * 2.6 + b.phase) * 0.12 * dt;
      this.sizeArr[i] += dt * 0.0035;
      const k = b.life / b.maxLife;
      this.alphaArr[i] = k < 0.1 ? k / 0.1 : 1 - Math.pow((k - 0.1) / 0.9, 2);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}
