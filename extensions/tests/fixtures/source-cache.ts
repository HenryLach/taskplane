/**
 * Shared source file cache for source-based tests.
 *
 * Many test files read the same large source files (task-runner.ts at 162K,
 * extension.ts at 115K, etc.) via readFileSync. With --pool=threads, this
 * cache is shared across all test threads, eliminating redundant disk reads.
 *
 * Usage:
 *   import { readSource } from "./fixtures/source-cache.ts";
 *   const src = readSource("taskplane/engine.ts");
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionsRoot = join(__dirname, "..", "..");

const cache = new Map<string, string>();

/**
 * Read a source file relative to the extensions/ directory.
 * Results are cached in memory — subsequent calls return the cached string.
 *
 * @param relPath - Relative path from extensions/ (e.g., "taskplane/engine.ts" or "task-runner.ts")
 * @returns File contents as string (CRLF normalized to LF)
 */
export function readSource(relPath: string): string {
	if (!cache.has(relPath)) {
		const content = readFileSync(join(extensionsRoot, relPath), "utf-8").replace(/\r\n/g, "\n");
		cache.set(relPath, content);
	}
	return cache.get(relPath)!;
}
