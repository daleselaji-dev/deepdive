import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLEFILE=1 时产出单文件 HTML（release/DeepDive-web.html 备用发行物）
const single = process.env.SINGLEFILE === '1';

export default defineConfig({
  base: './',
  plugins: single ? [viteSingleFile()] : [],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    outDir: single ? 'dist-single' : 'dist',
  },
  server: {
    host: true,
  },
});
