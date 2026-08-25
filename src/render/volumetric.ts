/** 加性体积光锥与程序化辉光 sprite（手电光束、入口光柱、指引灯）。 */
import * as THREE from 'three';

export interface ConeOpts {
  length: number;
  radius: number;
  color: THREE.ColorRepresentation;
  intensity: number;
}

/** 顶点在原点、沿 -Z 展开的体积光锥。 */
export function makeLightCone(opts: ConeOpts): THREE.Mesh {
  const geo = new THREE.ConeGeometry(opts.radius, opts.length, 24, 10, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, -opts.length / 2);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(opts.color) },
      uIntensity: { value: opts.intensity },
      uLength: { value: opts.length },
    },
    vertexShader: /* glsl */ `
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        vObj = position;
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosV = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uLength;
      varying vec3 vObj;
      varying vec3 vNormalV;
      varying vec3 vPosV;
      void main() {
        float ax = clamp(-vObj.z / uLength, 0.0, 1.0);
        float axial = pow(1.0 - ax, 1.6) * smoothstep(0.0, 0.08, ax);
        vec3 vd = normalize(-vPosV);
        float edge = abs(dot(vd, vNormalV));
        float fres = pow(edge, 1.4);
        float n = sin(vObj.x * 2.4 + uTime * 0.7) * sin(vObj.y * 2.1 - uTime * 0.5)
                * sin(vObj.z * 1.3 + uTime * 0.9);
        float dust = 0.82 + 0.18 * n;
        float a = axial * fres * dust * uIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return mesh;
}

export function tickCone(mesh: THREE.Mesh, time: number, intensity?: number) {
  const m = mesh.material as THREE.ShaderMaterial;
  m.uniforms.uTime.value = time;
  if (intensity !== undefined) m.uniforms.uIntensity.value = intensity;
}

let glowTexCache: THREE.Texture | null = null;

/** 径向渐变辉光纹理（Canvas 程序生成）。 */
export function glowTexture(): THREE.Texture {
  if (glowTexCache) return glowTexCache;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTexCache = tex;
  return tex;
}

export function makeGlowSprite(color: THREE.ColorRepresentation, scale: number, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(scale);
  s.renderOrder = 25;
  return s;
}
