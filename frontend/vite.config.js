import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const release = JSON.parse(readFileSync(new URL('./src/release.json', import.meta.url), 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: new URL('.', import.meta.url), encoding: 'utf8' }).trim();

export default defineConfig({
  plugins: [react()],
  define: { __RELEASE_VERSION__: JSON.stringify(release.version), __RELEASE_DATE__: JSON.stringify(release.label), __SOURCE_COMMIT__: JSON.stringify(sourceCommit) },
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
        manualChunks(id) {
          // Stable vendor: React + router. Cached across deploys that don't
          // touch React/Router. ~140 KB raw / ~45 KB gzip.
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/react-router-dom/')
          ) {
            return 'react-vendor';
          }
          // Icon set used across every authed page. ~30 KB raw.
          if (id.includes('/node_modules/lucide-react/')) return 'lucide';
        },
      },
    },
  },
});
