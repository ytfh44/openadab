import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for OpenAdab desktop e2e visual tests.
 *
 * Runs screenshot tests against the Vite dev server (renderer only).
 * For full Electron integration tests, point `testDir` to a separate
 * Electron-specific config that uses `electron.launch()`.
 *
 * Screenshots are saved to `e2e/screenshots/` for visual verification.
 */
export default defineConfig({
  testDir: '.',
  snapshotPathTemplate: 'screenshots/{testFileName}-{arg}{ext}',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'on',
    video: 'off',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium-desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'chromium-narrow-900',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 900, height: 800 },
      },
    },
    {
      name: 'chromium-mobile-599',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 599, height: 960 },
      },
    },
  ],
  webServer: {
    command: 'npx vite --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
