/**
 * 单通道后处理合成：
 * 水下扭曲 / 径向色偏 / 深水色分级 / 晕影（缺氧隧道视觉收缩）/ 胶片颗粒 /
 * 惊吓闪光 / 白光吞没 / 淡入淡出。低端档位可关闭昂贵效果。
 */
import * as THREE from 'three';
import type { QualitySettings } from '../core/quality';

export class PostFX {
  private rt: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(private renderer: THREE.WebGLRenderer, quality: QualitySettings) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: quality.rtSamples,
    });

    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uTime: { value: 0 },
        uFade: { value: 1 },       // 1 = 全黑
        uWhite: { value: 0 },      // 白光吞没
        uFlash: { value: 0 },      // 惊吓闪光
        uClose: { value: 0 },      // 缺氧隧道视觉 0..1
        uDistort: { value: quality.postDistortion ? 1 : 0 },
        uAberr: { value: quality.postAberration ? 1 : 0 },
        uGrain: { value: 0.055 },
        uGradeDepth: { value: 0.4 }, // 深水色分级强度
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime, uFade, uWhite, uFlash, uClose, uDistort, uAberr, uGrain, uGradeDepth;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
            vec2 off = c * r2 * 0.05 * uAberr;
            col.r = texture2D(tDiffuse, uv + off).r;
            col.g = texture2D(tDiffuse, uv).g;
            col.b = texture2D(tDiffuse, uv - off).b;
          } else {
            col = texture2D(tDiffuse, uv).rgb;
          }

          // 深水色分级：暗部染蓝青、红衰减
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          vec3 graded = pow(max(col, 0.0), vec3(1.06, 1.0, 0.93));
          graded = mix(graded, graded * vec3(0.74, 0.96, 1.1), uGradeDepth * 0.65);
          graded += vec3(0.003, 0.009, 0.016) * uGradeDepth * (1.0 - lum);
          col = graded;

          // 晕影 + 缺氧收缩
          float l = length(c);
          float vig = 1.0 - smoothstep(0.42, 0.86, l);
          float tunnel = 1.0 - smoothstep(0.04 + (1.0 - uClose) * 0.62, 0.16 + (1.0 - uClose) * 0.9, l);
          col *= mix(0.24, 1.0, vig);
          col *= mix(1.0, tunnel, uClose);

          // 惊吓闪光（冷白）与白光吞没（生物之光：青白）
          col = mix(col, vec3(0.92, 0.95, 1.0), uFlash);
          col = mix(col, vec3(0.78, 0.93, 1.0), uWhite);

          // 胶片颗粒
          float g = hash(vUv * 617.0 + fract(uTime * 13.71) * 431.0) - 0.5;
          col += g * uGrain * (0.55 + (1.0 - lum) * 0.8);

          col *= (1.0 - uFade);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  get uniforms() { return this.mat.uniforms; }

  applyQuality(q: QualitySettings) {
    this.mat.uniforms.uDistort.value = q.postDistortion ? 1 : 0;
    this.mat.uniforms.uAberr.value = q.postAberration ? 1 : 0;
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.rt.setSize(Math.max(1, Math.floor(w * pixelRatio)), Math.max(1, Math.floor(h * pixelRatio)));
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    this.mat.uniforms.uTime.value = time;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
