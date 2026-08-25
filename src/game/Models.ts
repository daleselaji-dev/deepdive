import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import fishUrl from '../assets/models/barramundi.glb?url';

/**
 * 统一模型库（docs/WORKFLOW.md §3.4）：
 * - 外部 GLB（CC0/CC-BY，见 docs/ASSETS_ATTRIBUTION.md）经 vite 内联为 data URI，
 *   GLTFLoader 解码后统一坐标约定：+Z 前进、原点居中、长度归一为 1。
 * - 任何加载失败自动回退**程序化中模**（放样鱼体 + 鳍 + 眼，观感远高于三角锥）。
 */

export interface MeshAsset {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  source: 'gltf' | 'procedural';
}

export class Models {
  /** 主力鱼模型（银汉鱼群/盲鱼/巡游大鱼共用几何） */
  readonly fish: Promise<MeshAsset>;

  constructor() {
    this.fish = loadGlbMesh(fishUrl, { forwardFlip: true }).catch((e) => {
      console.warn('[Models] 鱼 GLB 加载失败，启用程序化中模 fallback：', e);
      return proceduralFish();
    });
  }
}

/** 加载 GLB 中第一个网格，烘焙世界变换并归一（+Z 前进 / 原点居中 / 长度 1） */
async function loadGlbMesh(url: string, opts: { forwardFlip?: boolean }): Promise<MeshAsset> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
  });
  if (!mesh) throw new Error('GLB 中没有网格');
  const found = mesh as THREE.Mesh;
  const geometry = found.geometry.clone();
  geometry.applyMatrix4(found.matrixWorld);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  const len = Math.max(size.x, size.y, size.z) || 1;
  geometry.scale(1 / len, 1 / len, 1 / len);
  // Barramundi 头部朝 -Z：翻转到本仓库约定的 +Z 前进
  if (opts.forwardFlip) geometry.rotateY(Math.PI);
  geometry.computeVertexNormals();
  const material = (Array.isArray(found.material) ? found.material[0] : found.material) as THREE.MeshStandardMaterial;
  return { geometry, material, source: 'gltf' };
}

/**
 * 程序化鱼中模 fallback：
 * 纺锤形放样躯干（椭圆截面）+ 尾鳍/背鳍/腹鳍面片 + 眼球，合并为单几何。
 */
function proceduralFish(): MeshAsset {
  const parts: THREE.BufferGeometry[] = [];

  // ---- 躯干：LatheGeometry 纺锤形，再压扁成椭圆截面 ----
  const profile: THREE.Vector2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const k = i / N; // 0 尾 → 1 头
    // 纺锤剖面：前 1/3 最宽，尾部收细
    const r = 0.015 + Math.sin(Math.pow(k, 0.72) * Math.PI) * 0.115;
    profile.push(new THREE.Vector2(Math.max(0.004, r), k - 0.5));
  }
  const body = new THREE.LatheGeometry(profile, 20);
  body.rotateX(-Math.PI / 2); // 放样轴 Y → Z（头朝 +Z）
  body.scale(0.55, 1, 1); // 侧扁
  parts.push(body);

  // ---- 尾鳍：扇形面片 ----
  const tail = new THREE.CircleGeometry(0.16, 7, Math.PI * 0.72, Math.PI * 0.56);
  tail.rotateY(Math.PI / 2);
  tail.scale(1, 1.15, 1.4);
  tail.translate(0, 0, -0.52);
  parts.push(tail);

  // ---- 背鳍 ----
  const dorsal = new THREE.CircleGeometry(0.1, 5, Math.PI * 0.15, Math.PI * 0.7);
  dorsal.rotateY(Math.PI / 2);
  dorsal.scale(1, 1.2, 2.2);
  dorsal.translate(0, 0.1, 0.05);
  parts.push(dorsal);

  // ---- 腹鳍 ×2 ----
  for (const s of [-1, 1]) {
    const fin = new THREE.CircleGeometry(0.06, 4, -Math.PI * 0.6, Math.PI * 0.5);
    fin.rotateY(Math.PI / 2);
    fin.rotateZ(s * 0.9);
    fin.translate(s * 0.045, -0.07, 0.12);
    parts.push(fin);
  }

  // ---- 眼球 ×2 ----
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.018, 8, 6);
    eye.translate(s * 0.042, 0.03, 0.36);
    parts.push(eye);
  }

  // 面片部分需要双面；合并后统一用 DoubleSide 材质
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  merged.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xb8c8c2,
    metalness: 0.55,
    roughness: 0.35,
    emissive: 0x1c2a28,
    side: THREE.DoubleSide,
  });
  return { geometry: merged, material, source: 'procedural' };
}
