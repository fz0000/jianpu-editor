import { defineConfig } from 'vite';

export default defineConfig({
  base: '/jianpu-editor/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
