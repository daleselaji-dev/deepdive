/**
 * DEEPDIVE desktop shell — always prefers built dist when present.
 * Do NOT rely solely on app.isPackaged: binary rename / unpack layouts differ.
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
const hasDist = fs.existsSync(distIndex);

// Avoid GPU sandbox crashes on some Windows setups (keeps WebGL / hardware GL)
app.commandLine.appendSwitch('disable-gpu-sandbox');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#02080c',
    title: 'DEEPDIVE · 深潜',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dialog.showErrorBox(
      'DEEPDIVE 加载失败',
      `无法打开游戏页面。\n\nURL: ${url}\n错误 ${code}: ${desc}\n\n请确认 release 包完整（含 resources/app/dist）。`,
    );
  });

  // Dev server only when explicitly requested; otherwise always load built dist.
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (hasDist) {
    win.loadFile(distIndex);
  } else {
    dialog.showErrorBox(
      'DEEPDIVE 缺少游戏资源',
      `未找到:\n${distIndex}\n\n请先执行 npm run build，或重新解压完整的 DeepDive-win32-x64.zip。`,
    );
    app.quit();
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
