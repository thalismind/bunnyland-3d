import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        player: 'player.html',
      },
    },
    outDir: 'dist',
    sourcemap: true,
  },
});
