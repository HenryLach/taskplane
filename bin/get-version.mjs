/**
 * `getVersion` — capture a CLI's version string with stdout-precedence,
 * stderr-fallback, and null-on-failure semantics.
 *
 * Extracted from the inline `getVersion()` in `bin/taskplane.mjs` so it
 * can be unit-tested without subprocessing the whole CLI.
 *
 * Behavior:
 *   - Spawns `${cmd} ${flag}` with shell:true and stdio:['ignore','pipe','pipe']
 *   - Returns null if `spawnSync` itself throws (e.g., command not found)
 *   - Returns null if the subprocess errored OR exited with non-zero status
 *     (matches the prior `execSync`-throws-on-failure contract)
 *   - On success, returns stdout if non-empty, else stderr (some CLIs
 *     notably `pi` print version output to stderr)
 *   - Returns null if both streams are empty
 *
 * @since TP-189-C (extracted) / TP-185 follow-up (original fix scope)
 *
 * @param {string} cmd — command name (or already-formed token sequence)
 * @param {string} [flag="--version"] — flag appended to cmd
 * @returns {string | null} trimmed version string, or null on any failure
 */

import { spawnSync } from "node:child_process";

export function getVersion(cmd, flag = "--version") {
	let result;
	try {
		// shell:true matches the prior execSync behavior — accepts a
		// space-joined command string and resolves via PATH lookup.
		result = spawnSync(`${cmd} ${flag}`, [], {
			shell: true,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		return null;
	}
	// Match prior contract: any non-success path → null.
	// `execSync` previously threw on either spawn failure or non-zero exit,
	// and the caller's catch returned null. Replicate that here so a CLI
	// that exits 1 with shell error text in stderr (e.g., "command not
	// found") does NOT surface as a fake version string.
	if (!result || result.error || result.status !== 0) return null;
	const stdout = (result.stdout ?? "").toString().trim();
	const stderr = (result.stderr ?? "").toString().trim();
	if (stdout) return stdout;
	if (stderr) return stderr;
	return null;
}
