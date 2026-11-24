import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard is built into ui/dist and served by the local simulator server (server/server.mjs).
// `npm run dev:ui` runs Vite with a proxy to that server for live editing.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', assetsDir: 'app', emptyOutDir: true, chunkSizeWarningLimit: 6000 },
  server: { port: 5173, proxy: { '/ws': { target: 'ws://127.0.0.1:5317', ws: true }, '/api': 'http://127.0.0.1:5317', '/assets/biobuzz': 'http://127.0.0.1:5317', '/assets/field': 'http://127.0.0.1:5317' } },
});
