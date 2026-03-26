/**
 * Thin entry point for the engine worker thread.
 *
 * Node's Worker constructor rejects .ts files inside node_modules when
 * --experimental-strip-types is active (the default in Node v25+).
 * This .mjs wrapper avoids the restriction — Node loads .mjs files
 * without TypeScript processing, then --experimental-transform-types
 * (passed via execArgv) handles subsequent .ts imports.
 */
import "./engine-worker.ts";
