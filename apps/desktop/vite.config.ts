import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Vite configuration for the Electron renderer process.
 *
 * The renderer is built as a single-page React application served
 * in dev mode via Vite's HMR dev server, and loaded as static files
 * by Electron's BrowserWindow in production.
 */
export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  plugins: [react()],
  base: './',
  build: {
    outDir: resolve(__dirname, 'renderer', 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
