import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        manualChunks: {
          // Stable vendor: React + router. Cached across deploys that don't
          // touch React/Router. ~140 KB raw / ~45 KB gzip.
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          // Icon set used across every authed page. ~30 KB raw.
          'lucide':       ['lucide-react'],
        },
      },
    },
  },
});
