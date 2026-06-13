/**
 * Project store — manages project root selection, OpenAdab project
 * detection, and the recent-projects list persisted to the Electron
 * `userData` directory.
 *
 * Pure helpers (`detectProject`, `readProjectConfig`,
 * `loadRecentProjects`, `saveRecentProjects`, `addRecentProject`)
 * can be unit-tested without an Electron runtime. Electron-specific
 * functions use dynamic imports to avoid requiring the `electron`
 * module during test execution.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { ProjectInfo, RecentProject } from '../shared/ipc-types.js';
import type { BrowserWindow } from 'electron';

// ─── Constants ─────────────────────────────────────────────

/** YAML config file path relative to the project root. */
const CONFIG_PATH = 'adab/config.yaml';

/** Recent-projects filename inside `app.getPath('userData')`. */
const RECENT_PROJECTS_FILENAME = 'recent-projects.json';

/** Maximum number of recent projects to retain. */
const MAX_RECENT = 20;

// ─── Project Detection ────────────────────────────────────

/**
 * Shape of values read from `adab/config.yaml`.  Only the fields
 * consumed by the desktop app are typed; extra keys pass through
 * as `unknown`.
 */
interface ProjectConfig {
  title?: string;
  language?: string;
  schema?: string;
  host?: string;
  [key: string]: unknown;
}

/**
 * Check whether `projectRoot` contains a valid OpenAdab project
 * (i.e. `adab/config.yaml` exists and is readable).
 */
export function isOpenAdabProject(projectRoot: string): boolean {
  return existsSync(join(projectRoot, CONFIG_PATH));
}

/**
 * Read and parse `adab/config.yaml` from the given project root.
 *
 * @returns The parsed config object, or `null` when the file is
 *   missing or unparseable.
 */
export function readProjectConfig(
  projectRoot: string,
): ProjectConfig | null {
  const configPath = join(projectRoot, CONFIG_PATH);
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return parseYaml(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

/**
 * Detect an OpenAdab project and return its {@link ProjectInfo}.
 *
 * Returns `null` when `projectRoot` does not contain
 * `adab/config.yaml`.
 */
export function detectProject(projectRoot: string): ProjectInfo | null {
  if (!isOpenAdabProject(projectRoot)) {
    return null;
  }
  const resolved = resolve(projectRoot);
  const config = readProjectConfig(resolved);
  return {
    projectRoot: resolved,
    title: config?.title,
    language: config?.language,
    activeSchema: config?.schema as string | undefined,
    host: config?.host as string | undefined,
    config: config ?? undefined,
  };
}

// ─── Recent Projects ──────────────────────────────────────

/**
 * Return the filesystem path to the recent-projects JSON file
 * inside the Electron `userData` directory.
 *
 * Uses a dynamic import so the `electron` module is only required
 * at runtime, which keeps pure-function unit tests isolated.
 */
export async function recentProjectsPath(): Promise<string> {
  const { app } = await import('electron');
  return join(app.getPath('userData'), RECENT_PROJECTS_FILENAME);
}

/**
 * Load the recent-projects list from disk.
 *
 * Returns an empty array when the file does not exist or is
 * corrupted.
 */
export function loadRecentProjects(filePath: string): RecentProject[] {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is RecentProject =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as RecentProject).projectRoot === 'string' &&
        typeof (p as RecentProject).lastOpenedAt === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Persist the recent-projects list to disk, creating parent
 * directories as needed.
 */
export function saveRecentProjects(
  filePath: string,
  projects: RecentProject[],
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(projects, null, 2), 'utf-8');
}

/**
 * Add or update a project entry in the recent list, bumping it to
 * the front and enforcing the maximum length.
 *
 * @returns The updated list (already persisted).
 */
export function addRecentProject(
  filePath: string,
  projectRoot: string,
  title?: string,
): RecentProject[] {
  const projects = loadRecentProjects(filePath);
  const existing = projects.findIndex(
    (p) => resolve(p.projectRoot) === resolve(projectRoot),
  );
  if (existing !== -1) {
    projects.splice(existing, 1);
  }

  const entry: RecentProject = {
    projectRoot,
    title,
    lastOpenedAt: new Date().toISOString(),
  };

  projects.unshift(entry);

  const trimmed = projects.slice(0, MAX_RECENT);
  saveRecentProjects(filePath, trimmed);
  return trimmed;
}

// ─── Project Dialog ───────────────────────────────────────

/**
 * Open a native directory-picker dialog and return the selected
 * path, or `null` when the user cancels.
 */
export async function showOpenProjectDialog(
  parentWindow: BrowserWindow | null,
): Promise<string | null> {
  const { dialog } = await import('electron');
  const options = {
    title: 'Select OpenAdab Project Directory',
    properties: ['openDirectory' as const],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0]!;
}
