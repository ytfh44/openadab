#!/usr/bin/env node
/**
 * OpenAdab CLI entry point.
 *
 * Re-exports the full CLI (with all commands registered) from the
 * Commander-based CLI wrapper. This module is compiled to dist/index.js
 * which the package.json `bin` field points to.
 */
import { createProgram, run } from './cli/index.js';

export { createProgram, run };

run();
