/**
 * Build a Windows portable DEEPDIVE package from Linux without Wine.
 * Downloads official Electron win32-x64, injects the Vite dist + shell, zips it.
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
const electronVersion = require(path.join(root, 'node_modules/electron/package.json')).version;

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

function syncDemo() {
  const demoDir = path.join(root, 'demo');
  rmrf(demoDir);
  fs.mkdirSync(demoDir, { recursive: true });
  // Single-file build → one HTML that works via file:// double-click
  const html = path.join(root, 'dist', 'index.html');
  fs.copyFileSync(html, path.join(demoDir, 'index.html'));
  // Friendly launcher name
  fs.copyFileSync(html, path.join(demoDir, 'DEEPDIVE.html'));
  fs.writeFileSync(
    path.join(demoDir, 'README.txt'),
    [
      'DEEPDIVE 深潜 — 浏览器预览',
      '',
      '直接双击 DEEPDIVE.html（或 index.html）即可游玩。',
      '无需安装 Node，也不需要本地服务器。',
      '',
      '建议使用 Chrome / Edge，戴耳机。',
      '',
    ].join('\r\n'),
  );
  console.log('→ Synced single-file demo → demo/DEEPDIVE.html');
}

async function main() {
  console.log('→ Building web assets…');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  syncDemo();

  const cacheDir = path.join(root, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipElectron = path.join(cacheDir, `electron-v${electronVersion}-win32-x64.zip`);
  const electronUrl = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-win32-x64.zip`;

  if (!fs.existsSync(zipElectron) || fs.statSync(zipElectron).size < 1_000_000) {
    console.log('→ Downloading Electron', electronVersion, 'win32-x64…');
    await download(electronUrl, zipElectron);
  } else {
    console.log('→ Using cached Electron zip');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const appDir = path.join(outDir, `${appName}-win32-x64`);
  rmrf(appDir);
  fs.mkdirSync(appDir, { recursive: true });

  console.log('→ Extracting Electron…');
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

  // Browser fallback next to the exe (does not need Electron)
  fs.copyFileSync(path.join(root, 'dist', 'index.html'), path.join(appDir, 'DEEPDIVE-网页备用.html'));

  // Keep only en/zh locales
  const locales = path.join(appDir, 'locales');
  if (fs.existsSync(locales)) {
    for (const f of fs.readdirSync(locales)) {
      if (!/^en(-US)?\.pak$/i.test(f) && !/^zh(-CN)?\.pak$/i.test(f)) {
        fs.unlinkSync(path.join(locales, f));
      }
    }
  }

  // Strip bulky non-essentials BUT KEEP ffmpeg.dll (required to launch on Windows)
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

  // Write a plain-text how-to next to the exe
  fs.writeFileSync(
    path.join(appDir, '使用说明.txt'),
    [
      'DEEPDIVE 深潜',
      '',
      '1. 双击 DeepDive.exe 启动（请完整解压本文件夹，勿只复制 exe）',
      '2. 若 Windows 提示“已保护你的电脑”：点击「更多信息」→「仍要运行」',
      '3. 建议戴耳机，点击「开始下潜」',
      '4. 若 exe 仍无法打开：用 Chrome/Edge 双击「DEEPDIVE-网页备用.html」',
      '',
      '操作：WASD 移动 · 鼠标视角 · Shift 加速',
      '',
    ].join('\r\n'),
  );

  const zipName = `${appName}-win32-x64.zip`;
  const zipPath = path.join(outDir, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  console.log('→ Zipping…');
  execSync(`cd "${outDir}" && zip -r -9 "${zipName}" "${path.basename(appDir)}"`, {
    stdio: 'inherit',
  });

  const size = fs.statSync(zipPath).size;
  console.log(`→ ${zipName}: ${(size / 1024 / 1024).toFixed(1)} MB (limit 100)`);
  if (size >= 100 * 1024 * 1024) {
    throw new Error(`Zip ${size} exceeds GitHub 100MB hard limit`);
  }
  console.log('→ EXE path:', targetExe);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
