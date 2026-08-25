import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  server: { host: true },
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
