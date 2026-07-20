import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

declare const process: {
  env: {
    BUNNYLAND_3D_BASE?: string;
    BUNNYLAND_API_PROXY?: string;
  };
};

const apiProxyTarget = process.env.BUNNYLAND_API_PROXY || 'http://127.0.0.1:8765';

export default defineConfig({
  base: process.env.BUNNYLAND_3D_BASE || '/',
  plugins: [preact()],
  server: {
    proxy: {
      '/api': {
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, '') || '/',
        target: apiProxyTarget,
      },
    },
  },
  build: {
    // Three.js core is intentionally lazy and budgeted by scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      input: {
        index: 'index.html',
        admin: 'admin.html',
        player: 'player.html',
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
});
