/**
 * 洞壁增强材质：MeshStandardMaterial + onBeforeCompile 注入。
 * - 三平面细节法线扰动（打碎低模平面感）
 * - 湿岩高光（roughness 随噪声变化）
 * - 沉积岩层色带 + 方解石晶脉
 * - 入口浅水段动画焦散（阳光透过水面的网纹）
 * - 生物发光廊道段的翡翠生物膜 + 以玩家为中心的涟漪光波
 * 细节纹理为完全平铺的程序化多倍频值噪声（无缝、无二进制资产）。
 */
import * as THREE from 'three';

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 962287)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 周期化值噪声：格点按 freq 取模 → 完美平铺。 */
function periodicValueNoise(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq, y = v * freq;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const w = (ix: number, iy: number) =>
    hash2(((ix % freq) + freq) % freq, ((iy % freq) + freq) % freq, seed);
  const a = w(x0, y0), b = w(x0 + 1, y0), c = w(x0, y0 + 1), d = w(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function tileableFbm(u: number, v: number, seed: number, octaves = 4, base = 6): number {
  let sum = 0, amp = 0.5, norm = 0, f = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValueNoise(u, v, f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

let detailTexCache: THREE.DataTexture | null = null;

/** R: 高频凹凸高度 / G: 中低频（晶脉、湿度）/ B: 斑块（生物膜）。 */
export function caveDetailTexture(): THREE.DataTexture {
  if (detailTexCache) return detailTexCache;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const u = x / S, v = y / S;
      const h = tileableFbm(u, v, 911, 5, 8);
      const g = tileableFbm(u, v, 412, 4, 3);
      const b = tileableFbm(u, v, 733, 3, 5);
      data[i] = Math.round(h * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  detailTexCache = tex;
  return tex;
}

export interface CaveMaterialHandle {
  material: THREE.MeshStandardMaterial;
  setQuality(detail: boolean, caustics: boolean): void;
  tick(time: number, playerPos: THREE.Vector3): void;
}

export function makeCaveMaterial(detail: boolean, caustics: boolean): CaveMaterialHandle {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.05,
    side: THREE.FrontSide,
  });

  const uniforms = {
    uTime: { value: 0 },
    uPlayerPos: { value: new THREE.Vector3() },
    uDetailTex: { value: caveDetailTexture() },
  };

  const applyDefines = (d: boolean, c: boolean) => {
    const defines: Record<string, string> = {};
    if (d) defines.CAVE_DETAIL = '1';
    if (c) defines.CAVE_CAUSTICS = '1';
    mat.defines = defines;
    mat.needsUpdate = true;
  };
  applyDefines(detail, caustics);

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        attribute float aU;
        varying float vCaveU;
        varying vec3 vWP;
        varying vec3 vWN;`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vCaveU = aU;
        vWP = (modelMatrix * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * normal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform float uTime;
        uniform vec3 uPlayerPos;
        uniform sampler2D uDetailTex;
        varying float vCaveU;
        varying vec3 vWP;
        varying vec3 vWN;
        vec3 caveTriW(vec3 n) {
          vec3 w = pow(abs(n), vec3(3.0));
          return w / (w.x + w.y + w.z + 1e-5);
        }
        vec4 caveTriTex(sampler2D t, vec3 p, vec3 w) {
          return texture2D(t, p.yz) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
        }
        #ifdef CAVE_CAUSTICS
        float caveCaustic(vec2 q, float t) {
          vec2 i = q;
          float c = 0.0;
          const float inten = 0.045;
          for (int n = 0; n < 3; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / max(0.15, length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten))));
          }
          c = clamp(1.17 - pow(c / 3.0, 1.4), -1.1, 1.17);
          return clamp(pow(abs(c), 7.0), 0.0, 1.6);
        }
        #endif`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        #ifdef CAVE_DETAIL
        {
          vec3 w = caveTriW(vWN);
          float h = caveTriTex(uDetailTex, vWP * 0.55, w).r;
          vec2 dH = vec2(dFdx(h), dFdy(h)) * 1.7;
          vec3 sp = -vViewPosition;
          vec3 sx = dFdx(sp), sy = dFdy(sp);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          normal = normalize(abs(det) * normal - grad);
        }
        #endif
        #include <normal_fragment_maps>`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        #ifdef CAVE_DETAIL
        {
          vec3 w = caveTriW(vWN);
          float rn = caveTriTex(uDetailTex, vWP * 0.13, w).g;
          roughnessFactor = clamp(mix(0.48, 1.0, rn), 0.35, 1.0);
        }
        #endif`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          vec3 w = caveTriW(vWN);
          float band = sin(vWP.y * 1.9 + caveTriTex(uDetailTex, vWP * 0.021, w).g * 5.0);
          diffuseColor.rgb *= mix(vec3(1.05, 0.99, 0.92), vec3(0.9, 0.985, 1.06),
                                  smoothstep(-0.6, 0.6, band));
          #ifdef CAVE_DETAIL
          float vv = caveTriTex(uDetailTex, vWP * 0.045, w).g;
          float vein = 1.0 - smoothstep(0.0, 0.025, abs(vv - 0.58));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.85), vein * 0.4);
          #endif
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 w = caveTriW(vWN);
          #ifdef CAVE_CAUSTICS
          float cmask = smoothstep(-24.0, -7.0, vWP.y) * (0.35 + 0.65 * clamp(vWN.y, 0.0, 1.0));
          if (cmask > 0.003) {
            float ca = caveCaustic(vWP.xz * 0.35 + vWP.y * 0.06, uTime * 0.7);
            totalEmissiveRadiance += vec3(0.35, 0.62, 0.7) * ca * cmask * 0.4;
          }
          #endif
          float gband = smoothstep(0.548, 0.565, vCaveU) * (1.0 - smoothstep(0.628, 0.648, vCaveU));
          if (gband > 0.003) {
            float bfilm = smoothstep(0.56, 0.78, caveTriTex(uDetailTex, vWP * 0.32, w).b);
            float d = length(vWP - uPlayerPos);
            float wave = (sin(d * 1.05 - uTime * 2.4) * 0.5 + 0.5) * exp(-d * 0.085);
            totalEmissiveRadiance += vec3(0.12, 0.85, 0.62) * bfilm * gband * (0.08 + 1.7 * wave);
            totalEmissiveRadiance += vec3(0.35, 0.6, 0.9) * bfilm * gband * 0.05;
          }
        }`);
  };

  return {
    material: mat,
    setQuality: applyDefines,
    tick(time, playerPos) {
      uniforms.uTime.value = time;
      uniforms.uPlayerPos.value.copy(playerPos);
    },
  };
}
