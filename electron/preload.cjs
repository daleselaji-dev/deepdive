/** Preload 保持最小——游戏完全运行在渲染进程。 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('deepdiveDesktop', {
  isDesktop: true,
  platform: process.platform,
});
