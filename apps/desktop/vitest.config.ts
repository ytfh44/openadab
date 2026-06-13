import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for Electron main-process and shared code tests.
 *
 * Tests run in a Node environment (not jsdom) since main-process code
 * imports from `node:child_process`, `node:fs/promises`, etc.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
});
