/**
 * Git command runner
 * @module orch/git
 */
import { execFileSync } from "child_process";

// ── Branch Helpers ───────────────────────────────────────────────────

/**
 * Get the current branch name (the branch checked out in the given directory).
 *
 * Uses `git rev-parse --abbrev-ref HEAD`. Returns the branch name or null
 * if HEAD is detached or git fails.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 */
export function getCurrentBranch(cwd?: string): string | null {
	const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	if (!result.ok || !result.stdout.trim() || result.stdout.trim() === "HEAD") {
		return null;
	}
	return result.stdout.trim();
}

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

/**
 * Run a git command with custom environment variables.
 *
 * Used by TP-169 to create commits on the orch branch without
 * modifying HEAD, via GIT_INDEX_FILE for alternate index manipulation.
 *
 * @param args  - Git command arguments
 * @param cwd   - Working directory
 * @param env   - Additional environment variables to set
 */
export function runGitWithEnv(
	args: string[],
	cwd: string,
	env: Record<string, string>,
): { ok: boolean; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync("git", args, {
			encoding: "utf-8",
			timeout: 30_000,
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...env },
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

/**
 * Truthful description of an orch branch relative to its base, for completion
 * messaging. Never claims "merged" unless the branch is verifiably ahead;
 * a failed comparison is `unknown`, not "nothing to integrate".
 *
 *   - `ahead`   : N commit(s) ahead of base (integration has something to take)
 *   - `empty`   : branch exists but is not ahead of base (nothing merged)
 *   - `missing` : branch does not exist
 *   - `unknown` : git comparison failed (detail carries the error)
 */
export function describeOrchBranchState(
	orchBranch: string,
	baseBranch: string,
	repoRoot: string,
): { kind: "ahead" | "empty" | "missing" | "unknown"; aheadBy: number | null; detail: string } {
	if (!orchBranch) return { kind: "missing", aheadBy: null, detail: "no orch branch recorded" };
	const exists = runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${orchBranch}`], repoRoot);
	if (!exists.ok)
		return { kind: "missing", aheadBy: null, detail: `branch ${orchBranch} does not exist` };
	if (!baseBranch) return { kind: "unknown", aheadBy: null, detail: "no base branch recorded" };
	const count = runGit(["rev-list", "--count", `${baseBranch}..${orchBranch}`], repoRoot);
	if (!count.ok) {
		return {
			kind: "unknown",
			aheadBy: null,
			detail: `could not compare ${orchBranch} to ${baseBranch} (${(count.stderr || "git error").trim().slice(0, 120)})`,
		};
	}
	const n = Number.parseInt(count.stdout.trim(), 10);
	if (!Number.isFinite(n))
		return { kind: "unknown", aheadBy: null, detail: "unparseable rev-list output" };
	return n > 0
		? { kind: "ahead", aheadBy: n, detail: `${n} commit(s) ahead of ${baseBranch}` }
		: { kind: "empty", aheadBy: 0, detail: `not ahead of ${baseBranch} (nothing was merged)` };
}

/**
 * Aggregate `describeOrchBranchState` across every repo root a batch touched
 * (workspace mode: primary + member repos). A batch whose only successful work
 * landed in a secondary repo must not read "nothing to integrate" because the
 * primary orch branch is empty (Sage review).
 */
export function describeOrchBranchStateAcrossRepos(
	orchBranch: string,
	baseBranch: string,
	repoRoots: Iterable<string>,
): { kind: "ahead" | "empty" | "missing" | "unknown"; detail: string } {
	const per: Array<{ root: string; state: ReturnType<typeof describeOrchBranchState> }> = [];
	for (const root of new Set(repoRoots))
		per.push({ root, state: describeOrchBranchState(orchBranch, baseBranch, root) });
	if (per.length === 0) return { kind: "missing", detail: "no repo roots" };
	if (per.length === 1) return { kind: per[0].state.kind, detail: per[0].state.detail };
	const ahead = per.filter((p) => p.state.kind === "ahead");
	const unknown = per.filter((p) => p.state.kind === "unknown");
	const label = (root: string) => root.split(/[\/]/).filter(Boolean).pop() ?? root;
	if (ahead.length > 0) {
		return {
			kind: "ahead",
			detail:
				ahead.map((p) => `${label(p.root)}: ${p.state.detail}`).join("; ") +
				(unknown.length > 0 ? `; ${unknown.length} repo(s) unverifiable` : ""),
		};
	}
	if (unknown.length > 0)
		return {
			kind: "unknown",
			detail: unknown.map((p) => `${label(p.root)}: ${p.state.detail}`).join("; "),
		};
	return {
		kind: "empty",
		detail: `not ahead of ${baseBranch} in any of ${per.length} repos (nothing was merged)`,
	};
}
