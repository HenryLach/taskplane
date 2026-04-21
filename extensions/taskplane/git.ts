/**
 * Git command runner
 * @module orch/git
 */
import { execFileSync } from "child_process";

export interface GitSubmoduleStatus {
	path: string;
	state: "ok" | "uninitialized" | "drifted" | "conflict";
	commit: string;
	description?: string;
}


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

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** List submodule paths declared in .gitmodules. */
export function listConfiguredSubmodulePaths(cwd: string): string[] {
	const result = runGit(["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"], cwd);
	if (!result.ok || !result.stdout.trim()) return [];

	const paths: string[] = [];
	for (const line of result.stdout.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const value = trimmed.replace(/^submodule\.[^.]+\.path\s+/, "").trim();
		if (value) paths.push(value);
	}

	return uniqueSorted(paths);
}

/** List gitlink entries tracked by the current repository. */
export function listGitlinkPaths(cwd: string): string[] {
	const result = runGit(["ls-files", "--stage"], cwd);
	if (!result.ok || !result.stdout.trim()) return [];

	const paths: string[] = [];
	for (const line of result.stdout.split(/\r?\n/)) {
		const match = line.match(/^160000\s+[0-9a-f]+\s+\d+\t(.+)$/i);
		if (match?.[1]) {
			paths.push(match[1]);
		}
	}

	return uniqueSorted(paths);
}

function parseSubmoduleStatusLine(line: string): GitSubmoduleStatus | undefined {
	if (!line) return undefined;
	const prefix = line[0];
	const trimmed = line.slice(1).trim();
	if (!trimmed) return undefined;

	const firstSpace = trimmed.indexOf(" ");
	if (firstSpace <= 0) return undefined;

	const commit = trimmed.slice(0, firstSpace).trim();
	let pathAndDescription = trimmed.slice(firstSpace + 1).trim();
	let description: string | undefined;

	const descriptionMatch = pathAndDescription.match(/^(.*)\s+\((.*)\)$/);
	if (descriptionMatch) {
		pathAndDescription = descriptionMatch[1].trim();
		description = descriptionMatch[2].trim();
	}

	if (!pathAndDescription) return undefined;

	const state =
		prefix === "-" ? "uninitialized" :
		prefix === "+" ? "drifted" :
		prefix === "U" ? "conflict" :
		"ok";

	return {
		path: pathAndDescription,
		state,
		commit,
		...(description ? { description } : {}),
	};
}

/** List recursive submodule status entries for the repository. */
export function listSubmoduleStatus(cwd: string): GitSubmoduleStatus[] {
	const result = runGit(["submodule", "status", "--recursive"], cwd);
	if (!result.ok || !result.stdout.trim()) return [];

	const statuses = result.stdout
		.split(/\r?\n/)
		.map(parseSubmoduleStatusLine)
		.filter((entry): entry is GitSubmoduleStatus => !!entry);

	return statuses.sort((left, right) => left.path.localeCompare(right.path));
}

