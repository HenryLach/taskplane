/**
 * Custom Node.js module-resolution hook that redirects the two pi-package
 * aliases to their local mock implementations.
 *
 * Replaces the `resolve.alias` entries in vitest.config.ts.
 *
 * Usage (register style, Node.js ≥ v20.6):
 *   node --experimental-strip-types --no-warnings \
 *        --import ./tests/loader.mjs --test tests/*.test.ts
 *
 * This file uses `module.register()` to install the resolve hook from a
 * separate hooks module (loader-hooks.mjs).
 */

import { register } from "node:module";

register("./loader-hooks.mjs", import.meta.url);
