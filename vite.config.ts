import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLEFILE=1 时产出内联单文件 dist/index.html（用于 EXE 内嵌与 file:// 双击网页版）
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: process.env.SINGLEFILE || mode === 'singlefile' ? [viteSingleFile()] : [],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
  },
}));
