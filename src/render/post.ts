/**
 * 后处理合成管线：
 * 场景 → 线性 HDR RT → [Bloom：soft-knee 阈值提取 → 1/4 分辨率双向高斯 ×N] →
 * 合成通道（水下扭曲 / 径向色偏 / 手动 ACES / 深水色分级 / 晕影（缺氧收缩）/
 * 胶片颗粒 / 惊吓闪光 / 白光吞没 / 淡入淡出）。低端档位可关闭昂贵效果。
 */
import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';

const BLOOM_SCALE = 4; // Bloom 工作分辨率 = 主 RT / 4

function fullscreenQuad(mat: THREE.ShaderMaterial): THREE.Scene {
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  return scene;
}

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class PostFX {
  private rt: THREE.WebGLRenderTarget;
  private rtBright: THREE.WebGLRenderTarget;
  private rtBlurA: THREE.WebGLRenderTarget;
  private rtBlurB: THREE.WebGLRenderTarget;
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private sceneComposite: THREE.Scene;
  private sceneBright: THREE.Scene;
  private sceneBlur: THREE.Scene;
  private bloomIters: number;

  constructor(private renderer: THREE.WebGLRenderer, quality: QualitySettings) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(size.x * pr));
    const h = Math.max(1, Math.floor(size.y * pr));
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: quality.rtSamples,
    });
    const bw = Math.max(1, Math.floor(w / BLOOM_SCALE));
    const bh = Math.max(1, Math.floor(h / BLOOM_SCALE));
    const bloomOpts = {
      type: THREE.HalfFloatType as THREE.TextureDataType,
      minFilter: THREE.LinearFilter as THREE.MinificationTextureFilter,
      magFilter: THREE.LinearFilter as THREE.MagnificationTextureFilter,
    };
    this.rtBright = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.rtBlurA = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.rtBlurB = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.bloomIters = quality.bloomIters;

    // ---- 亮度提取（soft-knee 阈值，线性 HDR 输入）----
    this.brightMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: this.rt.texture },
        uThreshold: { value: 0.82 },
        uKnee: { value: 0.55 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform float uThreshold, uKnee;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb;
          // 防 NaN/inf 扩散
          c = clamp(c, vec3(0.0), vec3(48.0));
          if (!(c.r <= 48.0)) c = vec3(0.0);
          float lum = max(max(c.r, c.g), c.b);
          float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
          soft = soft * soft / (4.0 * uKnee + 1e-4);
          float w = max(soft, lum - uThreshold) / max(lum, 1e-4);
          gl_FragColor = vec4(c * clamp(w, 0.0, 1.0), 1.0);
        }
      `,
    });
    this.sceneBright = fullscreenQuad(this.brightMat);

    // ---- 可分离高斯（9 tap，方向由 uDir 控制）----
    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tSrc: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1 / bw, 1 / bh) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uDir, uTexel;
        varying vec2 vUv;
        void main() {
          vec2 d = uDir * uTexel;
          vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
          c += (texture2D(tSrc, vUv + d * 1.3846).rgb + texture2D(tSrc, vUv - d * 1.3846).rgb) * 0.3162162;
          c += (texture2D(tSrc, vUv + d * 3.2308).rgb + texture2D(tSrc, vUv - d * 3.2308).rgb) * 0.0702703;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.sceneBlur = fullscreenQuad(this.blurMat);

    // ---- 最终合成 ----
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBloom: { value: this.rtBlurA.texture },
        uBloom: { value: quality.bloomIters > 0 ? 1 : 0 },
        uBloomStrength: { value: 0.85 },
        uTime: { value: 0 },
        uFade: { value: 1 },       // 1 = 全黑
        uWhite: { value: 0 },      // 白光吞没
        uFlash: { value: 0 },      // 惊吓闪光
        uClose: { value: 0 },      // 缺氧隧道视觉 0..1
        uDistort: { value: quality.postDistortion ? 1 : 0 },
        uAberr: { value: quality.postAberration ? 1 : 0 },
        uGrain: { value: 0.028 },
        uGradeDepth: { value: 0.4 }, // 深水色分级强度
        uExposure: { value: 1.15 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float uBloom, uBloomStrength;
        uniform float uTime, uFade, uWhite, uFlash, uClose, uDistort, uAberr, uGrain, uGradeDepth, uExposure;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // RT 中为线性 HDR（three 不对离屏目标做 tone mapping），此处手动 ACES
        vec3 aces(vec3 x) {
          x *= uExposure;
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
          vec2 uv = vUv;
          vec2 c = uv - 0.5;
          float r2 = dot(c, c);

          if (uDistort > 0.001) {
            uv.x += sin(uv.y * 22.0 + uTime * 1.35) * 0.0016 * uDistort * (1.0 + r2 * 2.0);
            uv.y += cos(uv.x * 19.0 - uTime * 1.1) * 0.0013 * uDistort;
          }

          vec3 col;
          if (uAberr > 0.001) {
            vec2 off = c * r2 * 0.03 * uAberr;
            col.r = texture2D(tDiffuse, uv + off).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, uv - off).b;
          } else {
            col = texture2D(tDiffuse, uv).rgb;
          }

          // Bloom 在线性 HDR 空间叠加
          if (uBloom > 0.5) {
            col += texture2D(tBloom, uv).rgb * uBloomStrength;
          }

          // 色调映射 + 转显示空间，再做全部分级（避免线性空间暗部被 sRGB 放大）
          col = aces(max(col, 0.0));
          col = pow(col, vec3(1.0 / 2.2));

          // 深水色分级：暗部染蓝青、红衰减
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          vec3 graded = pow(max(col, 0.0), vec3(1.08, 1.0, 0.94));
          graded = mix(graded, graded * vec3(0.72, 0.96, 1.1), uGradeDepth * 0.65);
          graded += vec3(0.004, 0.012, 0.02) * uGradeDepth * (1.0 - lum);
          col = graded;

          // 晕影 + 缺氧收缩
          float l = length(c);
          float vig = 1.0 - smoothstep(0.42, 0.86, l);
          float tunnel = 1.0 - smoothstep(0.04 + (1.0 - uClose) * 0.62, 0.16 + (1.0 - uClose) * 0.9, l);
          col *= mix(0.32, 1.0, vig);
          col *= mix(1.0, tunnel, uClose);

          // 惊吓闪光（冷白）与白光吞没（生物之光：青白）
          col = mix(col, vec3(0.92, 0.95, 1.0), uFlash);
          col = mix(col, vec3(0.78, 0.93, 1.0), uWhite);

          // 胶片颗粒
          float g = hash(vUv * 617.0 + fract(uTime * 13.71) * 431.0) - 0.5;
          col += g * uGrain * (0.4 + (1.0 - lum) * 0.45);

          col *= (1.0 - uFade);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sceneComposite = fullscreenQuad(this.mat);
  }

  get uniforms() { return this.mat.uniforms; }

  applyQuality(q: QualitySettings) {
    this.mat.uniforms.uDistort.value = q.postDistortion ? 1 : 0;
    this.mat.uniforms.uAberr.value = q.postAberration ? 1 : 0;
    this.bloomIters = q.bloomIters;
    this.mat.uniforms.uBloom.value = q.bloomIters > 0 ? 1 : 0;
  }

  setSize(w: number, h: number, pixelRatio: number) {
    const rw = Math.max(1, Math.floor(w * pixelRatio));
    const rh = Math.max(1, Math.floor(h * pixelRatio));
    this.rt.setSize(rw, rh);
    const bw = Math.max(1, Math.floor(rw / BLOOM_SCALE));
    const bh = Math.max(1, Math.floor(rh / BLOOM_SCALE));
    this.rtBright.setSize(bw, bh);
    this.rtBlurA.setSize(bw, bh);
    this.rtBlurB.setSize(bw, bh);
    (this.blurMat.uniforms.uTexel.value as THREE.Vector2).set(1 / bw, 1 / bh);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    this.mat.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);

    if (this.bloomIters > 0) {
      // 提取亮部
      this.renderer.setRenderTarget(this.rtBright);
      this.renderer.render(this.sceneBright, this.quadCam);
      // N × (H → V) 高斯
      let src = this.rtBright;
      for (let i = 0; i < this.bloomIters; i++) {
        this.blurMat.uniforms.tSrc.value = src.texture;
        (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(1 + i, 0);
        this.renderer.setRenderTarget(this.rtBlurB);
        this.renderer.render(this.sceneBlur, this.quadCam);
        this.blurMat.uniforms.tSrc.value = this.rtBlurB.texture;
        (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 1 + i);
        this.renderer.setRenderTarget(this.rtBlurA);
        this.renderer.render(this.sceneBlur, this.quadCam);
        src = this.rtBlurA;
      }
      this.mat.uniforms.tBloom.value = this.rtBlurA.texture;
    }

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.sceneComposite, this.quadCam);
  }
}
