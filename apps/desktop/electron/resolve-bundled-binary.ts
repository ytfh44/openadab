/**
 * Bundled binary resolution for packaged Electron apps.
 *
 * In an electron-builder NSIS installation, the layout is:
 *
 *   $INSTDIR/
 *     OpenAdab.exe                  (electron stub)
 *     resources/
 *       app/                        (asar or loose app files)
 *       download-opencode.ps1       (extraResources)
 *     opencode.exe                  (downloaded by NSIS installer)
 *     opencode-version.txt          (version marker)
 *
 * `process.resourcesPath` points to `$INSTDIR/resources`, so the
 * installation root is `dirname(process.resourcesPath)`.
 *
 * This module provides helpers that search for bundled binaries in
 * deterministic locations, handling paths that may contain spaces,
 * non-ASCII characters, or surrogate pairs (including environments
 * where the Windows username or install path uses CJK or emoji).
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Return the installation root directory of the packaged app.
 *
 * When the app is NOT packaged (dev mode), this returns `undefined`.
 * Otherwise it returns `dirname(process.resourcesPath)`, which for
 * electron-builder NSIS installs is the directory containing
 * `OpenAdab.exe` and any bundled companion binaries.
 */
export function getInstallRoot(): string | undefined {
  if (!process.resourcesPath) return undefined;
  return dirname(process.resourcesPath);
}

/**
 * Search for a binary by name across one or more directories.
 *
 * On Windows, the `.exe`, `.cmd`, and `.bat` extensions are appended
 * automatically when `includePlatformExtensions` is true (the default).
 *
 * @param binaryName - Base name without extension (e.g. `"opencode"`).
 * @param searchDirs  - Ordered list of directories to scan.
 * @param includePlatformExtensions - Append `.exe`/`.cmd`/`.bat` on win32.
 * @returns The absolute path of the first match, or `undefined`.
 */
export function findBinary(
  binaryName: string,
  searchDirs: string[],
  includePlatformExtensions = true,
): string | undefined {
  const names = includePlatformExtensions && process.platform === "win32"
    ? [`${binaryName}.exe`, `${binaryName}.cmd`, `${binaryName}.bat`, binaryName]
    : [binaryName];

  for (const dir of searchDirs) {
    for (const name of names) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }

  return undefined;
}

/**
 * Ordered search directories for a bundled binary in a packaged app.
 *
 * Priority (first match wins):
 * 1. Installation root (alongside OpenAdab.exe)
 * 2. `resources/cli/<name>` (convention for bundled CLIs)
 * 3. `resources/<name>` (flat extraResources)
 *
 * @param installRoot - Result of `getInstallRoot()`, or `undefined`.
 */
export function getBundledSearchDirs(
  installRoot: string | undefined,
): string[] {
  const dirs: string[] = [];
  if (installRoot) {
    dirs.push(installRoot);
  }
  if (process.resourcesPath) {
    dirs.push(
      resolve(process.resourcesPath, "cli"),
      process.resourcesPath,
    );
  }
  return dirs;
}
