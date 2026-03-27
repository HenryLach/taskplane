/**
 * Fork entry point for the engine child process.
 *
 * Node v25 blocks .ts files inside node_modules regardless of flags.
 * This .mjs file loads cleanly (no TypeScript processing needed), then
 * uses jiti to import engine-worker.ts — bypassing Node's restriction.
 *
 * jiti is the same TypeScript runtime loader that Pi uses to load
 * extensions. It transforms .ts files itself, independent of Node's
 * --experimental-strip-types support.
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url);
await jiti.import(join(__dirname, "engine-worker.ts"));
