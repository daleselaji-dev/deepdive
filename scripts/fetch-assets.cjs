/**
 * 外部模型资产下载与压缩管线（docs/WORKFLOW.md §3.4、docs/ASSETS_ATTRIBUTION.md）。
 *
 * 压缩产物已提交进 `src/assets/models/`，构建离线可复现——本脚本仅在
 * 需要重新拉取/升级资产时手动运行：node scripts/fetch-assets.cjs
 *
 * 每个资产给出多个镜像；全部失败时保留现有文件并提示（游戏侧有程序化 fallback）。
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'src', 'assets', 'models');
const tmpDir = path.join(root, '.cache', 'assets');

/** 资产清单：授权与作者以 docs/ASSETS_ATTRIBUTION.md 为准 */
const ASSETS = [
  {
    name: 'barramundi.glb',
    license: 'CC0 1.0（公有领域）· Microsoft 捐赠给 Khronos glTF 样例库',
    mirrors: [
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BarramundiFish/glTF-Binary/BarramundiFish.glb',
      'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/BarramundiFish/glTF-Binary/BarramundiFish.glb',
      'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BarramundiFish/glTF-Binary/BarramundiFish.glb',
    ],
    // 贴图 256 + WebP；不量化（几何仅 ~2.2k 顶点，避免烘焙精度问题）
    optimize: (src, dst) =>
      `npx gltf-transform optimize "${src}" "${dst}" --compress false --texture-compress webp --texture-size 256 --simplify false`,
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const follow = (u, depth) => {
      if (depth > 5) return reject(new Error('重定向过深'));
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            follow(res.headers.location, depth + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        })
        .on('error', reject);
    };
    follow(url, 0);
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const asset of ASSETS) {
    const raw = path.join(tmpDir, `raw-${asset.name}`);
    const dst = path.join(outDir, asset.name);
    let ok = false;
    for (const url of asset.mirrors) {
      try {
        console.log(`→ 下载 ${asset.name} ← ${url}`);
        await download(url, raw);
        if (fs.statSync(raw).size < 10_000) throw new Error('文件过小，疑似失败页');
        ok = true;
        break;
      } catch (e) {
        console.warn(`  镜像失败：${e.message}`);
      }
    }
    if (!ok) {
      console.error(`✗ ${asset.name} 所有镜像失败——保留现有文件（游戏侧有程序化 fallback）`);
      continue;
    }
    console.log(`→ 压缩 ${asset.name}（授权：${asset.license}）`);
    execSync(asset.optimize(raw, dst), { cwd: root, stdio: 'inherit' });
    const kb = (fs.statSync(dst).size / 1024).toFixed(1);
    console.log(`✓ ${asset.name} → ${kb} KB`);
  }
  // 体积红线：模型合计 ≤ 1.5MB（docs/WORKFLOW.md §3.4）
  const total = fs
    .readdirSync(outDir)
    .reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`模型合计 ${(total / 1024 / 1024).toFixed(2)} MB（红线 1.5MB）`);
  if (total > 1.5 * 1024 * 1024) throw new Error('模型总体积超出红线');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
