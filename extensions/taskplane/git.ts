/**
 * Git command runner
 * @module orch/git
 */
import { execFileSync } from "child_process";


// ── Git Command Runner ───────────────────────────────────────────────

/**
 * Run a git command synchronously with consistent error handling.
 *
 * @param args - Array of git subcommand arguments (e.g. ["worktree", "add", ...])
 * @param cwd  - Working directory to run the command in (defaults to process.cwd())
 * @returns    - { ok, stdout, stderr }
 */
export function runGit(
	args: string[],
	cwd?: string,
): { ok: boolean; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync("git", args, {
			encoding: "utf-8",
			timeout: 30_000,
			cwd: cwd || process.cwd(),
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return { ok: true, stdout, stderr: "" };
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; message?: string };
		return {
			ok: false,
			stdout: (e.stdout ?? "").toString().trim(),
			stderr: (e.stderr ?? e.message ?? "unknown error").toString().trim(),
		};
	}
}

