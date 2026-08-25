/**
 * 在 Linux/macOS 上（无需 Wine）打包 Windows 便携版 DEEPDIVE：
 * 下载官方 Electron win32-x64 → 注入 Vite dist + 桌面壳 → electron.exe 改名 DeepDive.exe →
 * 裁剪 locales / 非必需文件（保留 ffmpeg.dll，缺它 Windows 无法启动）→
 * 压缩为 release/DeepDive-win32-x64.zip（必须 < GitHub 100MB 硬限制）。
 *
 * 用法：npm run package:win
 * 可用 ELECTRON_VERSION 环境变量覆盖 Electron 版本。
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');
const { createWriteStream } = require('fs');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'release');
const appName = 'DeepDive';
// PR #3 已在 Windows 实机验证可启动的版本；如需更新用 ELECTRON_VERSION 覆盖
const electronVersion = process.env.ELECTRON_VERSION || '33.4.11';

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const follow = (u) => {
      const lib = u.startsWith('https') ? https : http;
      lib
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            follow(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed ${res.statusCode} for ${u}`));
            res.resume();
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        })
        .on('error', reject);
    };
    follow(url);
  });
}

async function main() {
  console.log('→ 构建网页资源…');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });

  const cacheDir = path.join(root, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipElectron = path.join(cacheDir, `electron-v${electronVersion}-win32-x64.zip`);
  const electronUrl = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-win32-x64.zip`;

  if (!fs.existsSync(zipElectron) || fs.statSync(zipElectron).size < 1_000_000) {
    console.log('→ 下载 Electron', electronVersion, 'win32-x64…');
    await download(electronUrl, zipElectron);
  } else {
    console.log('→ 使用缓存的 Electron zip');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const appDir = path.join(outDir, `${appName}-win32-x64`);
  rmrf(appDir);
  fs.mkdirSync(appDir, { recursive: true });

  console.log('→ 解压 Electron…');
  execSync(`unzip -q -o "${zipElectron}" -d "${appDir}"`, { stdio: 'inherit' });

  const electronExe = path.join(appDir, 'electron.exe');
  const targetExe = path.join(appDir, `${appName}.exe`);
  if (fs.existsSync(electronExe)) fs.renameSync(electronExe, targetExe);

  rmrf(path.join(appDir, 'resources', 'default_app.asar'));
  const resourcesApp = path.join(appDir, 'resources', 'app');
  fs.mkdirSync(resourcesApp, { recursive: true });

  fs.writeFileSync(
    path.join(resourcesApp, 'package.json'),
    JSON.stringify(
      {
        name: 'deepdive',
        version: require(path.join(root, 'package.json')).version,
        main: 'electron/main.cjs',
      },
      null,
      2,
    ),
  );

  fs.cpSync(path.join(root, 'electron'), path.join(resourcesApp, 'electron'), { recursive: true });
  fs.cpSync(path.join(root, 'dist'), path.join(resourcesApp, 'dist'), { recursive: true });

  // 只保留中英 locale
  const locales = path.join(appDir, 'locales');
  if (fs.existsSync(locales)) {
    for (const f of fs.readdirSync(locales)) {
      if (!/^en(-US)?\.pak$/i.test(f) && !/^zh(-CN)?\.pak$/i.test(f)) {
        fs.unlinkSync(path.join(locales, f));
      }
    }
  }

  // 裁剪体积大的非必需文件；ffmpeg.dll 必须保留（缺它 Windows 无法启动）
  for (const extra of [
    'LICENSES.chromium.html',
    'vk_swiftshader.dll',
    'vk_swiftshader_icd.json',
    'vulkan-1.dll',
    'chrome_200_percent.pak',
  ]) {
    const p = path.join(appDir, extra);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  if (!fs.existsSync(path.join(appDir, 'ffmpeg.dll'))) {
    throw new Error('ffmpeg.dll missing — Electron will fail to start on Windows');
  }

  fs.writeFileSync(
    path.join(appDir, '使用说明.txt'),
    [
      'DEEP DIVE ·《蓝井》',
      '',
      '1. 双击 DeepDive.exe 启动（请完整解压本文件夹，勿只复制 exe）',
      '2. 若 Windows 提示"已保护你的电脑"：点击「更多信息」→「仍要运行」',
      '3. 建议戴耳机，点击「开始调查 — 故事模式」',
      '',
      '操作：WASD 游动 · 鼠标视角 · Space/Shift 升降',
      '      F 手电（有电量）· E 查看线索 · N 侦探笔记 · Esc 暂停',
      '',
      '跟着线绳走。线绳是回家的路。',
      '',
    ].join('\r\n'),
  );

  const zipName = `${appName}-win32-x64.zip`;
  const zipPath = path.join(outDir, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  console.log('→ 压缩…');
  execSync(`cd "${outDir}" && zip -r -9 -q "${zipName}" "${path.basename(appDir)}"`, {
    stdio: 'inherit',
  });
  rmrf(appDir); // 只保留 zip 进仓库

  const size = fs.statSync(zipPath).size;
  console.log(`→ ${zipName}: ${(size / 1024 / 1024).toFixed(1)} MB (GitHub 上限 100)`);
  if (size >= 100 * 1024 * 1024) {
    throw new Error(`Zip ${size} exceeds GitHub 100MB hard limit`);
  }
  console.log('完成。EXE 位于 zip 内:', `${appName}-win32-x64/${appName}.exe`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
