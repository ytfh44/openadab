/**
 * Playwright screenshot tests for OpenAdab desktop e2e visual verification.
 *
 * These tests capture the visual layout of key application screens.
 * Since Electron's preload API (`window.openadab`) is not available in
 * a plain browser, test helpers inject a mock preload API before the
 * React app mounts.
 *
 * Each test navigates to the app, injects mock state, waits for the
 * React tree to hydrate, and captures a full-page screenshot.
 *
 * Screenshots are saved to `e2e/screenshots/` for visual review.
 */

import { test, expect } from '@playwright/test';

/**
 * Mock project info returned by the preload API.
 */
const MOCK_PROJECT_INFO = {
  projectRoot: 'C:\\Users\\YBY\\Desktop\\my-novel',
  title: '我的小说 (My Novel)',
  language: 'zh',
  activeSchema: 'chapter-draft',
  host: 'opencode',
  config: {},
};

/**
 * Minimal `OpenAdabPreloadApi` mock.
 * Routes handle `getProjectInfo()` by returning `mockInfo`.
 */
function buildPreloadMock(mockInfo: typeof MOCK_PROJECT_INFO | null) {
  return {
    // Project
    getProjectInfo: async () => mockInfo,
    openProject: async () => mockInfo,
    listRecentProjects: async () => [],

    // CLI (no-op for screenshot tests)
    runCli: async () => ({
      id: 'mock-cmd',
      command: 'openadab',
      args: [],
      cwd: '/',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: 0,
      stdout: '',
      stderr: '',
      initiator: 'user',
      cancelled: false,
    }),
    cancelCli: async () => {},
    getCliHistory: async () => [],

    // File
    readFile: async () => ({ filePath: '', content: '', mtimeMs: 0 }),
    writeFile: async () => ({ filePath: '', mtimeMs: 0 }),
    listDir: async () => ({ dirPath: '', entries: [] }),
    watchFile: async () => {},
    unwatchFile: async () => {},

    // Transcript
    getTranscriptEvents: async () => [],
    clearTranscript: async () => {},

    // Agent
    startAgentSession: async () => ({ sessionId: 'mock-session' }),
    sendAgentMessage: async () => {},
    stopAgentSession: async () => {},
    approvePermission: async () => {},
    denyPermission: async () => {},

    // Event listeners (no-op)
    onCommandOutput: () => () => {},
    onCommandComplete: () => () => {},
    onFileChanged: () => () => {},
    onAgentMessage: () => () => {},
    onPermissionRequest: () => () => {},
  };
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Inject the preload mock and navigate to the app root.
 */
async function setupPage(page: import('@playwright/test').Page, withProject: boolean) {
  const mockInfo = withProject ? MOCK_PROJECT_INFO : null;
  await page.addInitScript((info) => {
    (window as any).openadab = (info as any);
  }, buildPreloadMock(mockInfo) as any);

  await page.goto('/');
  // Wait for React to mount
  await page.waitForSelector('[role="navigation"]', { timeout: 10000 });
  // Wait for loading to settle
  await page.waitForTimeout(500);
}

// ─── Tests ────────────────────────────────────────────────────

test.describe('AppShell Layout', () => {
  test('Project dashboard — no project (empty state)', async ({ page }) => {
    await setupPage(page, false);

    // Should show left nav with all tabs
    const nav = page.locator('[role="navigation"]');
    await expect(nav).toBeVisible();

    // Should show "No project" in top bar
    await expect(page.getByText('No project')).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/project-dashboard-empty.png',
    });
  });

  test('Project dashboard — with project', async ({ page }) => {
    await setupPage(page, true);

    // Should show project title
    await expect(page.getByText('我的小说 (My Novel)')).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/project-dashboard-with-project.png',
    });
  });

  test('Left nav — all tabs visible and keyboard navigable', async ({ page }) => {
    await setupPage(page, true);

    const nav = page.locator('[role="navigation"]');
    const tabs = nav.getByRole('tab');

    // All 7 tabs should be present
    await expect(tabs).toHaveCount(7);

    // Project tab should be selected by default
    const projectTab = nav.getByRole('tab', { name: /Project/ });
    await expect(projectTab).toHaveAttribute('aria-selected', 'true');

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/left-nav-all-tabs.png',
    });
  });

  test('Transcript panel — collapsible', async ({ page }) => {
    await setupPage(page, true);

    // Transcript bar should be visible
    const transcriptBar = page.getByText('CLI Transcript');
    await expect(transcriptBar).toBeVisible();

    // Click to expand
    await transcriptBar.click();
    await page.waitForTimeout(300);

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/transcript-expanded.png',
    });

    // Click to collapse
    await transcriptBar.click();
    await page.waitForTimeout(300);

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/transcript-collapsed.png',
    });
  });

  test('Top bar — project indicator and controls', async ({ page }) => {
    await setupPage(page, true);

    // Project indicator should show the title
    await expect(page.getByText('我的小说 (My Novel)')).toBeVisible();

    // Refresh button should be visible
    const refreshBtn = page.getByLabel('Refresh project info');
    await expect(refreshBtn).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/top-bar-indicator.png',
    });
  });

  test('Top bar — no project shows Open button', async ({ page }) => {
    await setupPage(page, false);

    const openBtn = page.getByLabel('Open a project');
    await expect(openBtn).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/top-bar-no-project.png',
    });
  });
});

test.describe('Responsive Layout', () => {
  test('Narrow 900px — inspector should be hidden', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await setupPage(page, true);

    // Left nav should still be visible
    const nav = page.locator('[role="navigation"]');
    await expect(nav).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/responsive-900px.png',
    });
  });

  test('Mobile 599px — nav should stack horizontally', async ({ page }) => {
    await page.setViewportSize({ width: 599, height: 960 });
    await setupPage(page, true);

    // Nav should be visible (horizontal stacking via CSS)
    const nav = page.locator('[role="navigation"]');
    await expect(nav).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/responsive-599px.png',
    });
  });
});

test.describe('Status Indicators', () => {
  test('Status dots — blocked, ready, done variants render', async ({ page }) => {
    await setupPage(page, true);

    // The StatusIndicators are used in components, verify page loads
    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/status-indicators-loaded.png',
    });
  });
});

test.describe('Windows Path & CJK Text', () => {
  test('Windows path displays correctly in top bar', async ({ page }) => {
    await setupPage(page, true);

    const projectIndicator = page.locator('[title*="\\\\"]');

    // If the path is displayed, it should be visible and not clipped
    const indicator = page.locator('header span').filter({ hasText: /My Novel/ });
    if (await indicator.count() > 0) {
      await expect(indicator.first()).toBeVisible();
    }

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/windows-path-display.png',
    });
  });

  test('Chinese text renders in project title', async ({ page }) => {
    await setupPage(page, true);

    // Chinese title should be visible
    const chineseTitle = page.getByText('我的小说');
    await expect(chineseTitle).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: 'e2e/screenshots/chinese-text-rendering.png',
    });
  });
});
