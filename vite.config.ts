import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui',
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
