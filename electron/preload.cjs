/** Preload kept minimal — game runs entirely in the renderer. */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('deepdiveDesktop', {
  isDesktop: true,
  platform: process.platform,
});
