/**
 * Path Resolver — Consolidated npm global root detection and package/tool path resolution.
 *
 * This module is the single source of truth for resolving paths to globally-installed
 * npm packages (taskplane and the pi coding agent CLI). It was created to eliminate
 * three duplicate implementations that previously existed in execution.ts, agent-host.ts,
 * and agent-bridge-extension.ts.
 *
 * ## Why this module exists
 *
 * macOS-specific bugs (#472, #474) were caused by hardcoded path lists that missed
 * Homebrew (`/opt/homebrew`) and contained ESM-unsafe `require()` calls. Each fix had
 * to be applied to multiple files, risking future drift. A single module eliminates that.
 *
 * ## Platform coverage
 *
 * - **Windows** — npm global root is typically `%APPDATA%\npm\node_modules` or a custom
 *   prefix. Static fallbacks cover both the APPDATA env var path and the HOME-relative
 *   equivalent (`AppData\Roaming\npm\node_modules`).
 *
 * - **macOS** — Multiple valid npm setups are covered:
 *   - System Node via Homebrew: `/opt/homebrew/lib/node_modules`
 *   - System Node (legacy): `/usr/local/lib/node_modules`
 *   - nvm, volta, or custom prefix: resolved dynamically via `npm root -g`
 *   - Custom global prefix: `~/.npm-global/lib/node_modules`
 *
 * - **Linux** — System Node (`/usr/local/lib/node_modules`), nvm, volta, and custom
 *   prefixes are all covered dynamically via `npm root -g`.
 *
 * ## Resolution strategy
 *
 * `npm root -g` is the **primary** resolution path because it covers every npm setup
 * (nvm, Homebrew, volta, pnpm global, and any custom `--prefix`) with a single call.
 * Static fallbacks exist only for environments where `npm` is not on PATH, which is
 * uncommon but can happen in certain CI containers or restricted environments.
 *
 * The `npm root -g` result is module-level cached because:
 *   1. It is called from multiple callsites per process.
 *   2. The result never changes within a process lifetime.
 *   3. Spawning a subprocess on every call would be expensive.
 *
 * @module taskplane/path-resolver
 * @since TP-157
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";

// ── Module-level cache ──────────────────────────────────────────────

/**
 * Cached result of `npm root -g`.
 * `null` = not yet resolved; `""` = resolution failed.
 */
let _npmGlobalRoot: string | null = null;

// ── Exported functions ──────────────────────────────────────────────

/**
 * Get the global npm root directory via `npm root -g`.
 *
 * The result is cached at module level for the process lifetime, so repeated
 * calls are free after the first.
 *
 * @returns Absolute path to the npm global `node_modules` directory,
 *          or `""` if the call fails (npm not on PATH, subprocess error, etc.).
 *          Never throws.
 *
 * @platform Windows — `shell: true` is required because `npm` resolves to
 *           `npm.cmd`, a Windows batch script that cannot be spawned without a shell.
 */
export function getNpmGlobalRoot(): string {
	if (_npmGlobalRoot !== null) return _npmGlobalRoot;
	try {
		const result = spawnSync("npm", ["root", "-g"], {
			encoding: "utf-8",
			timeout: 5000,
			// shell: true is mandatory on Windows — npm resolves to npm.cmd
			shell: true,
		});
		_npmGlobalRoot = result.stdout?.trim() || "";
	} catch {
		_npmGlobalRoot = "";
	}
	return _npmGlobalRoot;
}

/**
 * Resolve the absolute path to the Pi coding agent CLI entrypoint (`cli.js`).
 *
 * The Pi CLI is installed as `@mariozechner/pi-coding-agent`. On Windows, invoking
 * `pi` directly executes a `.CMD` shim that cannot be spawned with `shell: false`.
 * This function locates the underlying `dist/cli.js` so callers can spawn it with
 * `node` directly, without a shell intermediary.
 *
 * Resolution order:
 *   1. `npm root -g` result (dynamic — covers all setups: nvm, Homebrew, volta, etc.)
 *   2. `%APPDATA%\npm\node_modules\...` (Windows, APPDATA env var)
 *   3. `%USERPROFILE%\AppData\Roaming\npm\node_modules\...` (Windows, HOME-relative)
 *   4. `~/.npm-global/lib/node_modules/...` (macOS/Linux custom global prefix)
 *   5. `/usr/local/lib/node_modules/...` (macOS system Node, Linux)
 *   6. `/opt/homebrew/lib/node_modules/...` (macOS Homebrew)
 *
 * @returns Absolute path to `@mariozechner/pi-coding-agent/dist/cli.js`
 * @throws  {Error} If the CLI entrypoint cannot be found in any known location.
 *          The error message includes the `npm root -g` value for diagnosis.
 */
export function resolvePiCliPath(): string {
	const relPath = join("@mariozechner", "pi-coding-agent", "dist", "cli.js");
	const candidates: string[] = [];

	// 1. Dynamic: npm root -g (covers nvm, Homebrew, volta, custom npm prefix, etc.)
	const npmRoot = getNpmGlobalRoot();
	if (npmRoot) candidates.push(join(npmRoot, relPath));

	// 2-3. Static Windows fallbacks
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (process.env.APPDATA) {
		candidates.push(join(process.env.APPDATA, "npm", "node_modules", relPath));
	}
	if (home) {
		candidates.push(join(home, "AppData", "Roaming", "npm", "node_modules", relPath));
		// 4. macOS/Linux custom global prefix
		candidates.push(join(home, ".npm-global", "lib", "node_modules", relPath));
	}
	// 5. macOS system Node / Linux
	candidates.push(join("/usr", "local", "lib", "node_modules", relPath));
	// 6. macOS Homebrew
	candidates.push(join("/opt", "homebrew", "lib", "node_modules", relPath));

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	throw new Error(
		"Cannot find Pi CLI entrypoint (@mariozechner/pi-coding-agent/dist/cli.js). " +
		"Ensure the pi coding agent is installed globally via 'npm install -g @mariozechner/pi-coding-agent'. " +
		`npm root -g returned: ${npmRoot || "(empty — npm may not be on PATH)"}`,
	);
}

/**
 * Resolve the path to a file within the taskplane npm package.
 *
 * This handles both local development (running from the taskplane repo itself)
 * and the installed-package case (taskplane installed globally via npm).
 *
 * Resolution order:
 *   1. `join(repoRoot, relPath)` — local development (taskplane's own repo)
 *   2. `npm root -g` result: `{npmGlobalRoot}/taskplane/{relPath}` (dynamic, all setups)
 *   3. `{APPDATA}/npm/node_modules/taskplane/{relPath}` (Windows)
 *   4. `{HOME}/AppData/Roaming/npm/node_modules/taskplane/{relPath}` (Windows alt)
 *   5. `{HOME}/.npm-global/lib/node_modules/taskplane/{relPath}` (macOS/Linux custom prefix)
 *   6. `/usr/local/lib/node_modules/taskplane/{relPath}` (macOS system Node, Linux)
 *   7. `/opt/homebrew/lib/node_modules/taskplane/{relPath}` (macOS Homebrew)
 *   8. Peer of pi's package (adjacent to `process.argv[1]`)
 *
 * @param repoRoot - Absolute path to the project root (used for local dev check)
 * @param relPath  - Relative path within the taskplane package, e.g.
 *                   `"extensions/task-runner.ts"` or `"templates/agents/task-worker.md"`
 * @returns Absolute path to the resolved file. If not found in any location,
 *          returns the local path (`join(repoRoot, relPath)`) as a fallback — callers
 *          will fail at use time with a clear "file not found" error.
 */
export function resolveTaskplanePackageFile(repoRoot: string, relPath: string): string {
	// 1. Local development — taskplane's own repo
	const localPath = join(resolve(repoRoot), relPath);
	if (existsSync(localPath)) return localPath;

	const candidates: string[] = [];

	// 2. Dynamic: npm root -g (covers ALL npm setups: nvm, Homebrew, volta, etc.)
	const npmRoot = getNpmGlobalRoot();
	if (npmRoot) {
		candidates.push(join(npmRoot, "taskplane", relPath));
	}

	// 3-7. Well-known static paths
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (process.env.APPDATA) {
		candidates.push(join(process.env.APPDATA, "npm", "node_modules", "taskplane", relPath));
	}
	if (home) {
		candidates.push(join(home, "AppData", "Roaming", "npm", "node_modules", "taskplane", relPath));
		candidates.push(join(home, ".npm-global", "lib", "node_modules", "taskplane", relPath));
	}
	candidates.push(join("/usr", "local", "lib", "node_modules", "taskplane", relPath));
	candidates.push(join("/opt", "homebrew", "lib", "node_modules", "taskplane", relPath));

	// 8. Peer of pi's package (look adjacent to pi's CLI entrypoint).
	// pi is at: <npmRoot>/@mariozechner/pi-coding-agent/dist/cli.js
	// so piPkgDir = <npmRoot>/@mariozechner/pi-coding-agent  (resolve up 2 levels from cli.js)
	// then go up TWO more levels to reach <npmRoot>, then into taskplane/
	try {
		const piPath = process.argv[1] || "";
		const piPkgDir = resolve(piPath, "..", ".."); // <npmRoot>/@mariozechner/pi-coding-agent
		const npmRootFromPi = resolve(piPkgDir, "..", ".."); // <npmRoot>
		candidates.push(join(npmRootFromPi, "taskplane", relPath));
	} catch { /* ignore — process.argv[1] may be undefined in test contexts */ }

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	// Fallback: return the local path. Callers will fail with a clear error at use time.
	return localPath;
}

/**
 * Resolve the path to a taskplane agent template file.
 *
 * Convenience wrapper around {@link resolveTaskplanePackageFile} for the
 * common case of locating a file in `templates/agents/`.
 *
 * Used by `loadBaseAgentPrompt` (execution.ts) and `loadReviewerPrompt`
 * (agent-bridge-extension.ts) to locate the base agent prompt templates
 * that ship with the taskplane package.
 *
 * @param agentName - Agent template name without extension, e.g. `"task-worker"`,
 *                    `"task-reviewer"`, `"task-merger"`
 * @returns Absolute path to `templates/agents/{agentName}.md` within the
 *          resolved taskplane package root.
 *
 * @example
 * ```ts
 * const templatePath = resolveTaskplaneAgentTemplate("task-worker");
 * // → "/usr/local/lib/node_modules/taskplane/templates/agents/task-worker.md"
 * //   (or local dev path, or any other resolved location)
 * ```
 */
export function resolveTaskplaneAgentTemplate(agentName: string): string {
	return resolveTaskplanePackageFile(
		process.cwd(),
		join("templates", "agents", `${agentName}.md`),
	);
}
