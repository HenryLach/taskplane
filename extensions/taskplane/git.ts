/**
 * Git command runner
 * @module orch/git
 */
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export interface GitSubmoduleStatus {
	path: string;
	state: "ok" | "uninitialized" | "drifted" | "conflict";
	commit: string;
	description?: string;
}

export interface UnsafeSubmoduleState {
	path: string;
	kind: "dirty-worktree" | "unpublished-commit";
	headCommit?: string;
	indexCommit?: string;
	remoteName?: string;
}

export interface UnreachableGitlinkState {
	path: string;
	gitlinkCommit: string;
	remoteName?: string;
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

function runGitWithDir(
	gitDir: string,
	args: string[],
): { ok: boolean; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync("git", ["--git-dir", gitDir, ...args], {
			encoding: "utf-8",
			timeout: 30_000,
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

function readGitlinkCommit(cwd: string, submodulePath: string): string | null {
	const result = runGit(["ls-files", "--stage", "--", submodulePath], cwd);
	if (!result.ok || !result.stdout.trim()) return null;
	const line = result.stdout.split(/\r?\n/).find(Boolean)?.trim();
	const match = line?.match(/^160000\s+([0-9a-f]+)\s+\d+\t/i);
	return match?.[1] ?? null;
}

function resolveSubmoduleGitDir(cwd: string, submodulePath: string): string | null {
	const commonDirResult = runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
	if (!commonDirResult.ok || !commonDirResult.stdout.trim()) return null;
	const gitDir = join(commonDirResult.stdout.trim(), "modules", ...submodulePath.split("/"));
	return existsSync(gitDir) ? gitDir : null;
}

function ensureSubmoduleCheckout(cwd: string, submodulePath: string): void {
	const absolutePath = join(cwd, submodulePath);
	const repoCheck = existsSync(absolutePath)
		? runGit(["rev-parse", "--is-inside-work-tree"], absolutePath)
		: { ok: false, stdout: "", stderr: "" };
	if (repoCheck.ok && repoCheck.stdout.trim() === "true") return;
	runGit(["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--", submodulePath], cwd);
}

function resolvePreferredRemote(cwd: string): string | null {
	const result = runGit(["remote"], cwd);
	if (!result.ok || !result.stdout.trim()) return null;
	const remotes = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (remotes.includes("origin")) return "origin";
	return remotes[0] ?? null;
}

function resolvePreferredRemoteFromGitDir(gitDir: string): string | null {
	const result = runGitWithDir(gitDir, ["remote"]);
	if (!result.ok || !result.stdout.trim()) return null;
	const remotes = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (remotes.includes("origin")) return "origin";
	return remotes[0] ?? null;
}

function isCommitReachableOnRemote(cwd: string, remoteName: string, commit: string): boolean {
	const refsResult = runGit(["ls-remote", remoteName, "refs/heads/*", "refs/tags/*"], cwd);
	if (!refsResult.ok || !refsResult.stdout.trim()) return false;

	const remoteTips = uniqueSorted(
		refsResult.stdout
			.split(/\r?\n/)
			.map((line) => line.trim().split(/\s+/)[0] ?? "")
			.filter((sha) => /^[0-9a-f]{40}$/i.test(sha)),
	);

	for (const tip of remoteTips) {
		if (tip === commit) return true;
		const ancestorResult = runGit(["merge-base", "--is-ancestor", commit, tip], cwd);
		if (ancestorResult.ok) return true;
	}

	return false;
}

function isCommitReachableOnRemoteFromGitDir(gitDir: string, remoteName: string, commit: string): boolean {
	const refsResult = runGitWithDir(gitDir, ["ls-remote", remoteName, "refs/heads/*", "refs/tags/*"]);
	if (!refsResult.ok || !refsResult.stdout.trim()) return false;

	const remoteTips = uniqueSorted(
		refsResult.stdout
			.split(/\r?\n/)
			.map((line) => line.trim().split(/\s+/)[0] ?? "")
			.filter((sha) => /^[0-9a-f]{40}$/i.test(sha)),
	);

	for (const tip of remoteTips) {
		if (tip === commit) return true;
		const ancestorResult = runGitWithDir(gitDir, ["merge-base", "--is-ancestor", commit, tip]);
		if (ancestorResult.ok) return true;
	}

	return false;
}

/**
 * Detect submodule states that cannot be safely checkpointed in the superproject.
 *
 * Blocking cases:
 * - submodule worktree still has uncommitted changes
 * - submodule HEAD differs from the recorded gitlink commit, but that HEAD is
 *   not reachable from the submodule's preferred remote
 */
export function detectUnsafeSubmoduleStates(cwd: string): UnsafeSubmoduleState[] {
	const submodulePaths = uniqueSorted([
		...listGitlinkPaths(cwd),
		...listConfiguredSubmodulePaths(cwd),
	]);
	const findings: UnsafeSubmoduleState[] = [];

	for (const submodulePath of submodulePaths) {
		const absolutePath = join(cwd, submodulePath);
		if (!existsSync(absolutePath)) continue;

		const dirtyStatus = runGit(["status", "--porcelain"], absolutePath);
		if (dirtyStatus.ok && dirtyStatus.stdout.trim()) {
			findings.push({
				path: submodulePath,
				kind: "dirty-worktree",
			});
			continue;
		}

		const headResult = runGit(["rev-parse", "HEAD"], absolutePath);
		if (!headResult.ok || !headResult.stdout.trim()) continue;
		const headCommit = headResult.stdout.trim();
		const indexCommit = readGitlinkCommit(cwd, submodulePath);
		if (!indexCommit || indexCommit === headCommit) continue;

		const remoteName = resolvePreferredRemote(absolutePath);
		if (!remoteName || !isCommitReachableOnRemote(absolutePath, remoteName, headCommit)) {
			findings.push({
				path: submodulePath,
				kind: "unpublished-commit",
				headCommit,
				indexCommit,
				...(remoteName ? { remoteName } : {}),
			});
		}
	}

	return findings.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Detect gitlinks in the current superproject index whose target commit is not
 * reachable from the submodule's preferred remote.
 *
 * Used as a merge-time backstop: even if an unsafe submodule gitlink reaches the
 * merge worktree via a legacy or manual path, Taskplane can still refuse to
 * advance the branch to a commit that downstream clones cannot fetch.
 */
export function detectUnreachableGitlinks(cwd: string): UnreachableGitlinkState[] {
	const findings: UnreachableGitlinkState[] = [];
	for (const submodulePath of listGitlinkPaths(cwd)) {
		const gitlinkCommit = readGitlinkCommit(cwd, submodulePath);
		if (!gitlinkCommit) continue;
		ensureSubmoduleCheckout(cwd, submodulePath);
		const absolutePath = join(cwd, submodulePath);
		const remoteName = existsSync(absolutePath) ? resolvePreferredRemote(absolutePath) : null;
		const submoduleGitDir = resolveSubmoduleGitDir(cwd, submodulePath);
		const gitDirRemoteName = submoduleGitDir ? resolvePreferredRemoteFromGitDir(submoduleGitDir) : null;
		const resolvedRemoteName = remoteName ?? gitDirRemoteName;
		const reachable = remoteName
			? isCommitReachableOnRemote(absolutePath, remoteName, gitlinkCommit)
			: (submoduleGitDir && gitDirRemoteName
				? isCommitReachableOnRemoteFromGitDir(submoduleGitDir, gitDirRemoteName, gitlinkCommit)
				: false);
		if (!resolvedRemoteName || !reachable) {
			findings.push({
				path: submodulePath,
				gitlinkCommit,
				...(resolvedRemoteName ? { remoteName: resolvedRemoteName } : {}),
			});
		}
	}
	return findings.sort((left, right) => left.path.localeCompare(right.path));
}

