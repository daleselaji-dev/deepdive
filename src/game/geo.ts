import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 有机几何辅助（M4-L2 去方块感）：
 * 巨石 / 滴水石（石笋·石钟乳）中高模程序化生成——共享确定性 3D 噪声，
 * 替代低细分 Icosahedron / Cone 的「大棱角」剪影。
 */

const hash3 = (x: number, y: number, z: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** 三线性插值 3D 值噪声（周期性无关，直接采样空间坐标） */
export function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
  const c00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
  const c10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
  const c01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
  const c11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w);
}

/** 分形 3D 噪声（oct 倍频） */
export function fbm3(x: number, y: number, z: number, oct = 3): number {
  let n = 0, amp = 0.55, f = 1;
  for (let o = 0; o < oct; o++) {
    n += vnoise3(x * f, y * f, z * f) * amp;
    amp *= 0.5;
    f *= 2.05;
  }
  return n;
}

/**
 * 有机巨石：细分二十面体焊接顶点后做「域扭曲 fbm」位移。
 * 低频决定大形体（非对称鹅卵形），中频叠棱脊，高频给表面颗粒。
 * 注意事项（踩坑记录）：
 * ① 必须先删 UV 再焊接——否则 UV 接缝阻断顶点合并 → 法线硬棱贯穿岩面；
 * ② 位移后最大半径归一回 1——塌方窄缝等布点按单位半径预算，噪声超径会堵路；
 * ③ 焊接后重建球面 UV 并平铺 2 次——裂隙纹理不至于放大成「铅笔涂鸦」。
 */
export function boulderGeometry(seed: number, detail = 2): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  let maxR = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const bx = v.x * 1.5 + seed * 7.31;
    const by = v.y * 1.5 + seed * 3.77;
    const bz = v.z * 1.5 + seed * 5.13;
    // 域扭曲：先用低频场推挤采样点，破坏球体对称性
    const warp = fbm3(bx + 5.2, by + 1.3, bz + 2.8, 2) * 1.3;
    const macro = fbm3(bx + warp, by + warp * 0.7, bz + warp, 3);
    const micro = fbm3(v.x * 5.5 + seed * 11, v.y * 5.5, v.z * 5.5, 2);
    const r = 1 + (macro - 0.55) * 0.72 + (micro - 0.55) * 0.16;
    maxR = Math.max(maxR, r);
    p.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  const inv = 1 / maxR;
  const uvs = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * inv, p.getY(i) * inv, p.getZ(i) * inv);
    v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    uvs[i * 2] = (Math.atan2(v.z, v.x) / (Math.PI * 2) + 0.5) * 2;
    uvs[i * 2 + 1] = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) / Math.PI + 0.5) * 2;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 滴水石（石笋/石钟乳通用）：归一化高 1、底半径 ~0.28，基座在 y=0、尖端朝 +y。
 * Lathe 滴形轮廓（幂次收细 + 裙边褶皱）+ 角向噪声位移 + 轻微轴弯，
 * 替代 7 段圆锥的「铅笔尖」感。石钟乳由调用侧绕 X 轴旋 π 倒挂。
 */
export function dripstoneGeometry(seed: number, radial = 14, rings = 20): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= rings; i++) {
    const k = i / rings; // 0=基座 1=尖端
    let r = Math.pow(1 - k, 1.32) * 0.28 + 0.012;
    // 裙边褶皱：滴水沉积的环状鼓包（越靠基座越明显）
    r *= 1 + (vnoise3(k * 6.5 + seed * 13.7, seed * 3.1, 0) - 0.5) * 0.5 * (1 - k * 0.6);
    pts.push(new THREE.Vector2(r, k));
  }
  let geo: THREE.BufferGeometry = new THREE.LatheGeometry(pts, radial);
  geo.deleteAttribute('uv'); // 同 boulder：先焊接再重建柱面 UV，避免接缝法线硬棱
  geo = mergeVertices(geo, 1e-4);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  // 轴向轻弯：真实滴水石常因气流/水流偏斜
  const bendX = (vnoise3(seed * 17.3, 0.5, 0.5) - 0.5) * 0.16;
  const bendZ = (vnoise3(seed * 23.9, 1.5, 0.5) - 0.5) * 0.16;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = v.y;
    const ang = Math.atan2(v.z, v.x);
    // 角向棱沟：竖直方向的流水蚀沟
    const flute = vnoise3(Math.cos(ang) * 2.2 + seed * 5, Math.sin(ang) * 2.2, k * 3.5) - 0.5;
    const rad = Math.sqrt(v.x * v.x + v.z * v.z);
    const nr = Math.max(0.004, rad * (1 + flute * 0.34));
    const scale = rad > 1e-6 ? nr / rad : 1;
    p.setXYZ(
      i,
      v.x * scale + bendX * k * k,
      v.y,
      v.z * scale + bendZ * k * k,
    );
  }
  // 柱面 UV：u 平铺 2 次、v 放缓——竖直拉丝会让层理读成「木纹板条」
  const uvs = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ang = Math.atan2(p.getZ(i), p.getX(i));
    uvs[i * 2] = (ang / (Math.PI * 2) + 0.5) * 2;
    uvs[i * 2 + 1] = p.getY(i) * 0.85;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}
