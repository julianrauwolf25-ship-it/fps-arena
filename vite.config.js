import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: {
    outDir:    '../dist',
    emptyOutDir: true,
  },
  server: {
    // In dev, proxy WebSocket traffic to the Node game server running on 3000
    proxy: {
      '/health': 'http://localhost:3000',
      // WebSocket upgrade for the dev proxy
      '/': {
        target: 'ws://localhost:3000',
        ws:     true,
      },
    },
  },
});
