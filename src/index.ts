#!/usr/bin/env node
/**
 * OpenAdab CLI entry point.
 *
 * Re-exports the full CLI (with all commands registered) from the
 * Commander-based CLI wrapper. This module is compiled to dist/index.js
 * which the package.json `bin` field points to.
 */
import { createProgram, run } from './cli/index.js';
import { isMain } from './utils/is-main.js';

export { createProgram, run };

if (isMain(import.meta.url)) {
  void run();
}
