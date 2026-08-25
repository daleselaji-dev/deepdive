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
    const get = url.startsWith('https') ? https.get : http.get;
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

function main() {
  console.log('→ Building web assets…');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });

  const demoDir = path.join(root, 'demo');
  rmrf(demoDir);
  fs.cpSync(path.join(root, 'dist'), demoDir, { recursive: true });
  console.log('→ Synced dist → demo/');

  const cacheDir = path.join(root, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const zipElectron = path.join(cacheDir, `electron-v${electronVersion}-win32-x64.zip`);
  const electronUrl = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-win32-x64.zip`;

  const run = async () => {
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

    // Rename electron.exe → DeepDive.exe
    const electronExe = path.join(appDir, 'electron.exe');
    const targetExe = path.join(appDir, `${appName}.exe`);
    if (fs.existsSync(electronExe)) fs.renameSync(electronExe, targetExe);

    // Remove default LICENSE etc. noise is fine to keep
    const resourcesApp = path.join(appDir, 'resources', 'app');
    rmrf(path.join(appDir, 'resources', 'default_app.asar'));
    fs.mkdirSync(resourcesApp, { recursive: true });

    // Minimal package for the packaged app
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

    // Strip unused Chromium extras to stay under GitHub's 100MB file limit
    const locales = path.join(appDir, 'locales');
    if (fs.existsSync(locales)) {
      for (const f of fs.readdirSync(locales)) {
        if (!/^en(-US)?\.pak$/i.test(f) && !/^zh(-CN)?\.pak$/i.test(f)) {
          fs.unlinkSync(path.join(locales, f));
        }
      }
    }
    for (const extra of [
      'LICENSES.chromium.html',
      'vk_swiftshader.dll',
      'vk_swiftshader_icd.json',
      'vulkan-1.dll',
      'chrome_200_percent.pak',
      'ffmpeg.dll', // no video playback in prototype
    ]) {
      const p = path.join(appDir, extra);
      if (fs.existsSync(p)) fs.rmSync(p, { force: true });
    }

    const zipName = `${appName}-win32-x64.zip`;
    const zipPath = path.join(outDir, zipName);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    console.log('→ Zipping…');
    execSync(`cd "${outDir}" && zip -r -9 "${zipName}" "${path.basename(appDir)}"`, {
      stdio: 'inherit',
    });

    const size = fs.statSync(zipPath).size;
    console.log(`→ ${zipName}: ${(size / 1024 / 1024).toFixed(1)} MB`);
    console.log('→ EXE path:', targetExe);
    console.log('Done.');
  };

  return run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
