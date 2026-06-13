import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Vite plugin that removes crossorigin from script tags in the build output.
 *
 * Electron loads the renderer from file:// protocol with sandbox: true
 * and webSecurity: true. Scripts with the crossorigin attribute trigger
 * CORS checks, but file:// responses lack CORS headers, causing the
 * script to fail loading --> white screen.  This plugin strips the attribute.
 */
function stripCrossoriginPlugin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html: string): string {
      return html.replace(/\s+crossorigin(?:=[^\s>]*)?/g, '');
    },
  };
}

/**
 * Vite configuration for the Electron renderer process.
 *
 * The renderer is built as a single-page React application served
 * in dev mode via Vite's HMR dev server, and loaded as static files
 * by Electron's BrowserWindow in production.
 */
export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  plugins: [react(), stripCrossoriginPlugin()],
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
