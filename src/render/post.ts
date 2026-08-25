/**
 * 后处理合成管线：
 * 场景 → 线性 HDR RT →（亮通提取 → 1/4 分辨率两轮可分离高斯 → 泛光）→
 * 合成通道：水下扭曲 / 径向色偏 / 泛光 / 手动 ACES / 双模式色分级（深水·红房间）/
 * 晕影（缺氧收缩）/ 胶片颗粒 / 惊吓闪光 / 白光吞没 / 淡入淡出。
 * 低端档位可关闭昂贵效果（泛光整段跳过）。
 */
import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';

const BLOOM_DOWNSCALE = 4;

export class PostFX {
  private rt: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private bloomOn: boolean;

  constructor(private renderer: THREE.WebGLRenderer, quality: QualitySettings) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: quality.rtSamples,
    });
    const bw = Math.max(1, Math.floor((size.x * pr) / BLOOM_DOWNSCALE));
    const bh = Math.max(1, Math.floor((size.y * pr) / BLOOM_DOWNSCALE));
    const bloomOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this.bloomA = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.bloomB = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.bloomOn = quality.bloom;

    this.brightMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tInput: { value: this.rt.texture },
        uThresh: { value: 0.5 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tInput;
        uniform float uThresh;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tInput, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c * smoothstep(uThresh, uThresh + 0.6, l), 1.0);
        }
      `,
    });

    this.blurMat = new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tInput: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1 / bw, 1 / bh) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tInput;
        uniform vec2 uDir;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec2 d = uDir * uTexel;
          vec3 c = texture2D(tInput, vUv).rgb * 0.227027;
          c += (texture2D(tInput, vUv + d * 1.3846).rgb + texture2D(tInput, vUv - d * 1.3846).rgb) * 0.3162162;
          c += (texture2D(tInput, vUv + d * 3.2308).rgb + texture2D(tInput, vUv - d * 3.2308).rgb) * 0.0702703;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });

    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        tBloom: { value: this.bloomA.texture },
        uTime: { value: 0 },
        uFade: { value: 1 },       // 1 = 全黑
        uWhite: { value: 0 },      // 白光吞没
        uFlash: { value: 0 },      // 惊吓闪光
        uClose: { value: 0 },      // 缺氧隧道视觉 0..1
        uDistort: { value: quality.postDistortion ? 1 : 0 },
        uAberr: { value: quality.postAberration ? 1 : 0 },
        uBloom: { value: quality.bloom ? quality.bloomStrength : 0 },
        uGrain: { value: 0.028 },
        uGradeDepth: { value: 0.4 }, // 深水色分级强度
        uGradeMode: { value: 0 },    // 0 = 深水, 1 = 红房间（红金分级）
        uSat: { value: 1.06 },
        uExposure: { value: 1.15 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBloom;
        uniform float uTime, uFade, uWhite, uFlash, uClose, uDistort, uAberr, uBloom,
                      uGrain, uGradeDepth, uGradeMode, uSat, uExposure;
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

          // 泛光（线性域相加，随后一起过 tone mapping → 高光自然融化）
          if (uBloom > 0.001) {
            col += texture2D(tBloom, uv).rgb * uBloom;
          }

          // 色调映射 + 转显示空间，再做全部分级（避免线性空间暗部被 sRGB 放大）
          col = aces(max(col, 0.0));
          col = pow(col, vec3(1.0 / 2.2));

          float lum = dot(col, vec3(0.299, 0.587, 0.114));

          // 深水色分级：暗部染蓝青、红衰减；split-tone 亮部微暖
          vec3 gw = pow(max(col, 0.0), vec3(1.08, 1.0, 0.94));
          gw = mix(gw, gw * vec3(0.72, 0.96, 1.1), uGradeDepth * 0.65);
          gw += vec3(0.004, 0.012, 0.02) * uGradeDepth * (1.0 - lum);
          gw = mix(gw, gw * vec3(1.05, 1.0, 0.94), uGradeDepth * 0.35 * smoothstep(0.55, 1.0, lum));

          // 红房间分级：红金亮部、深绯暗部，保留帷幔品红
          vec3 gr = pow(max(col, 0.0), vec3(0.97, 1.01, 1.03));
          gr *= vec3(1.07, 0.97, 0.99);
          gr += vec3(0.03, 0.003, 0.01) * (1.0 - lum);

          col = mix(gw, gr, uGradeMode);
          col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uSat);

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
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  get uniforms() { return this.mat.uniforms; }

  applyQuality(q: QualitySettings) {
    this.mat.uniforms.uDistort.value = q.postDistortion ? 1 : 0;
    this.mat.uniforms.uAberr.value = q.postAberration ? 1 : 0;
    this.bloomOn = q.bloom;
    this.mat.uniforms.uBloom.value = q.bloom ? q.bloomStrength : 0;
  }

  setSize(w: number, h: number, pixelRatio: number) {
    const pw = Math.max(1, Math.floor(w * pixelRatio));
    const ph = Math.max(1, Math.floor(h * pixelRatio));
    this.rt.setSize(pw, ph);
    const bw = Math.max(1, Math.floor(pw / BLOOM_DOWNSCALE));
    const bh = Math.max(1, Math.floor(ph / BLOOM_DOWNSCALE));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    (this.blurMat.uniforms.uTexel.value as THREE.Vector2).set(1 / bw, 1 / bh);
  }

  /** 用当前 quad 材质向目标 RT 画一次全屏。 */
  private blit(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    this.mat.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);

    if (this.bloomOn) {
      this.brightMat.uniforms.tInput.value = this.rt.texture;
      this.blit(this.brightMat, this.bloomA);
      // 两轮可分离高斯（宽半径柔光）
      for (let i = 0; i < 2; i++) {
        this.blurMat.uniforms.tInput.value = this.bloomA.texture;
        (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(1 + i, 0);
        this.blit(this.blurMat, this.bloomB);
        this.blurMat.uniforms.tInput.value = this.bloomB.texture;
        (this.blurMat.uniforms.uDir.value as THREE.Vector2).set(0, 1 + i);
        this.blit(this.blurMat, this.bloomA);
      }
      this.mat.uniforms.tBloom.value = this.bloomA.texture;
    }

    this.blit(this.mat, null);
  }
}

const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
