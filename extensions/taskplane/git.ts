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

export interface SubmoduleStatusPreview {
	path: string;
	statusLines: string[];
	lineCount: number;
	truncated: boolean;
	dirty: boolean;
	error?: string;
}

export interface SubmoduleStatusSnapshot {
	capturedAt: number;
	worktreePath: string;
	totalSubmodules: number;
	dirtySubmodules: number;
	entries: SubmoduleStatusPreview[];
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

export function captureSubmoduleStatusSnapshot(
	cwd: string,
	maxLinesPerSubmodule = 12,
): SubmoduleStatusSnapshot {
	const submodulePaths = uniqueSorted([
		...listGitlinkPaths(cwd),
		...listConfiguredSubmodulePaths(cwd),
	]);
	const entries: SubmoduleStatusPreview[] = [];
	let dirtySubmodules = 0;

	for (const submodulePath of submodulePaths) {
		const absolutePath = join(cwd, submodulePath);
		if (!existsSync(absolutePath)) {
			entries.push({
				path: submodulePath,
				statusLines: [],
				lineCount: 0,
				truncated: false,
				dirty: false,
				error: "submodule path does not exist on disk",
			});
			continue;
		}

		const statusResult = runGit(["status", "--porcelain"], absolutePath);
		if (!statusResult.ok) {
			entries.push({
				path: submodulePath,
				statusLines: [],
				lineCount: 0,
				truncated: false,
				dirty: false,
				error: statusResult.stderr || statusResult.stdout || "git status failed",
			});
			continue;
		}

		// Build a set of known submodule paths for gitlink-only dirty detection.
		// When the parent repo stages a gitlink change, every shared-worktree
		// submodule reports "M <other-submodule-path>" as dirty — these are
		// transient index artifacts from checkpointing, not real code changes.
		const knownSubmodulePaths = new Set(submodulePaths);
		// Filter out task-plane artifact paths (and gitlink-only state) before counting as dirty
		const filteredStdout = filterArtifactStatusLines(statusResult.stdout, knownSubmodulePaths);
		const lines = filteredStdout
			.split(/\r?\n/)
			.map((line) => line.trimEnd())
			.filter(Boolean);
		const dirty = lines.length > 0;
		if (dirty) dirtySubmodules += 1;

		entries.push({
			path: submodulePath,
			statusLines: lines.slice(0, maxLinesPerSubmodule),
			lineCount: lines.length,
			truncated: lines.length > maxLinesPerSubmodule,
			dirty,
		});
	}

	return {
		capturedAt: Date.now(),
		worktreePath: cwd,
		totalSubmodules: submodulePaths.length,
		dirtySubmodules,
		entries,
	};
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

/**
 * Check whether a specific commit is reachable from a submodule's remote.
 *
 * Strategy:
 * 1. Direct match against origin/HEAD via ls-remote (always points to latest tip).
 * 2. Named branch/tag tips via ls-remote + merge-base ancestry check.
 * 3. If fetch was done before calling, also try local tracking refs as fallback.
 *
 * This handles forked submodules where commits exist on origin but may not be
 * reachable from the branch names that ls-remote returns in a stale worktree.
 */
function checkSubmoduleCommitReachable(cwd: string, remoteName: string, commit: string): boolean {
	// Fast path: direct match against origin/HEAD — always available after fetch.
	const headResult = runGit(["ls-remote", remoteName, "HEAD"], cwd);
	if (headResult.ok && headResult.stdout.trim()) {
		const headSha = headResult.stdout
			.split(/\r?\n/)
			.map((line) => line.trim().split(/[\t]+/)[0] ?? "")
			[0];
		if (headSha === commit) return true;
	}

	// Check all named branch and tag tips.
	const refsResult = runGit(["ls-remote", remoteName, "refs/heads/*", "refs/tags/*"], cwd);
	if (!refsResult.ok || !refsResult.stdout.trim()) {
		// Fallback: if we have a local tracking ref for origin/HEAD, use merge-base.
		const mbResult = runGit(["merge-base", "--is-ancestor", commit, `${remoteName}/HEAD`], cwd);
		if (mbResult.ok) return true;
		return false;
	}

	const remoteTips = uniqueSorted(
		refsResult.stdout
			.split(/\r?\n/)
			.map((line) => line.trim().split(/[\s]+/)[0] ?? "")
			.filter((sha) => /^[0-9a-f]{40}$/i.test(sha)),
	);

	for (const tip of remoteTips) {
		if (tip === commit) return true;
		const ancestorResult = runGit(["merge-base", "--is-ancestor", commit, tip], cwd);
		if (ancestorResult.ok) return true;
	}

	// Final fallback: check against origin/HEAD as a local ref.
	if (runGit(["merge-base", "--is-ancestor", commit, `${remoteName}/HEAD`], cwd).ok) return true;

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
 * Check if a git status porcelain line refers to a task-plane artifact path
 * that should be excluded from unsafe-submodule detection. These paths are
 * expected to change during task execution and don't represent lost submodule work.
 *
 * Matches patterns like:
 *   .pi/tasks/.../STATUS.md
 *   .pi/tasks/.../.DONE
 *   .pi/orch-logs/...
 *   .reviewer-state.json (task review artifacts)
 */
function isArtifactStatusLine(line: string, submodulePaths: Set<string>): boolean {
	// Extract the file path from porcelain format (e.g., "M .pi/tasks/foo/STATUS.md")
	const parts = line.trim().split(/[\t ]+/);
	if (parts.length < 2) return false;
	const filePath = parts[1]; // path starts after status codes
	// Check if the file is a known task-plane artifact location
	return (
		filePath.startsWith(".pi/tasks/") ||
		filePath.startsWith(".pi/orch-logs/") ||
		filePath === ".reviewer-state.json" ||
		filePath.endsWith("/.DONE") ||
		filePath.endsWith("/STATUS.md") ||
		filePath.endsWith("/CONTEXT.md") ||
		// Gitlink-only dirty state: line points to another known submodule.
		// During checkpointing, the parent repo's index update bleeds into every
		// shared-worktree submodule as "M <other-submodule-path>" — this is an
		// expected transient artifact, not real code changes inside that submodule.
		submodulePaths.has(filePath) ||
		// Transient Python build artifacts — these are created by Python tooling
		// during task execution and should not block checkpointing.
		filePath.includes("__pycache__") ||
		filePath.includes(".pytest_cache") ||
		filePath.includes(".mypy_cache") ||
		filePath.includes("node_modules") ||
		filePath.includes("build/") ||
		filePath.includes("dist/") ||
		filePath.endsWith(".pyc") ||
		filePath.endsWith(".egg-info")
	);
}

/**
 * Filter git status porcelain output to exclude task-plane artifact paths
 * and gitlink-only dirty states.
 *
 * Gitlink-only dirty state: when the parent repo stages a gitlink change,
 * every shared-worktree submodule reports "M <other-submodule-path>" as dirty.
 * These are transient index-level artifacts, not actual code changes inside
 * the submodule. Filter them out to avoid false positives during checkpointing.
 */
function filterArtifactStatusLines(rawOutput: string, submodulePaths: Set<string>): string {
	return rawOutput
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line && !isArtifactStatusLine(line, submodulePaths))
		.join("\n");
}

/**
 * Detect submodule states that cannot be safely checkpointed in the superproject.
 *
 * Blocking cases:
 * - submodule worktree still has uncommitted code changes (excluding task artifacts)
 * - submodule HEAD differs from the recorded gitlink commit, but that HEAD is
 *   not reachable from the submodule's preferred remote
 */
/**
 * Resolve the superproject's root .gitignore path from a submodule's cwd.
 * Walks up the directory tree from cwd to find the repository root, then
 * returns the path to .gitignore at that level.
 *
 * @param submoduleCwd - The current working directory of the submodule
 * @returns Path to the superproject's root .gitignore, or null if not found
 */
function resolveSuperprojectGitignore(submoduleCwd: string): string | null {
	// Use git rev-parse to find the repository root from the submodule's cwd
	const result = runGit(["rev-parse", "--show-toplevel"], submoduleCwd);
	if (!result.ok || !result.stdout.trim()) return null;

	const repoRoot = result.stdout.trim();
	const gitignorePath = join(repoRoot, ".gitignore");
	return existsSync(gitignorePath) ? gitignorePath : null;
}

/**
 * Check if a path matches any pattern in the given .gitignore file.
 * Uses git check-ignore with the -f flag to force reading from the specified file.
 *
 * @param filePath - The file path to check (relative to cwd)
 * @param gitignorePath - Path to the .gitignore file
 * @param cwd - The current working directory
 * @returns true if the path is ignored, false otherwise
 */
function checkIgnoreInFile(filePath: string, gitignorePath: string, cwd: string): boolean {
	// Use git check-ignore with -f to force reading from the specified file
	const result = runGit(["check-ignore", "-f", gitignorePath, "--no-index", filePath], cwd);
	return result.ok && result.stdout.trim() !== "";
}

/**
 * Filter git status porcelain output to remove paths that are ignored by .gitignore.
 * Uses `git check-ignore --no-index` — respects ALL .gitignore rules at every level,
 * avoiding the need to hardcode artifact patterns like __pycache__ or node_modules.
 *
 * Additionally checks the superproject's root .gitignore when called from a submodule,
 * ensuring that patterns like __pycache__/ defined in the root are properly applied
 * to paths within submodules.
 */
function filterGitIgnoredStatusLines(statusOutput: string, cwd: string): string {
	// Resolve the superproject's root .gitignore once (cached for all checks)
	const superprojectGitignore = resolveSuperprojectGitignore(cwd);

	return statusOutput
		.split(/\r?\n/)
		.filter((line) => {
			if (!line.trim()) return false;
			const parts = line.trimStart().split(/[\t ]+/);
			if (parts.length < 2) return true; // Keep lines we can't parse
			const filePath = parts[1];

			// Skip gitignored paths — these are transient artifacts the submodule maintainers don't want tracked.
			try {
				const checkResult = runGit(["check-ignore", "--no-index", filePath], cwd);
				if (checkResult.ok && checkResult.stdout.trim()) {
					return false; // Path is ignored → skip it
				}
			} catch { /* fall through — keep line if check fails */ }

			// Additional check: if we have a superproject .gitignore, also check against it.
			// This handles cases where patterns like __pycache__/ are defined in the root
			// but not in the submodule's local .gitignore.
			if (superprojectGitignore) {
				if (checkIgnoreInFile(filePath, superprojectGitignore, cwd)) {
					return false; // Path is ignored by superproject .gitignore → skip it
				}
			}

			return true;
		})
		.join("\n");
}

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
			// Build a set of known submodule paths for gitlink-only dirty detection.
			// During checkpointing, parent repo index updates bleed into every
			// shared-worktree submodule as "M <other-submodule-path>" — this is an
			// expected transient artifact, not actual code changes inside that submodule.
			const knownSubmodulePaths = new Set(submodulePaths);
			// Apply gitignore-aware filtering FIRST (respects submodule .gitignore at every level),
			// then apply artifact pattern filtering as a safety net for paths not caught by gitignore.
			const ignoredFiltered = filterGitIgnoredStatusLines(dirtyStatus.stdout, absolutePath);
			const filteredStatus = filterArtifactStatusLines(ignoredFiltered, knownSubmodulePaths);
			if (filteredStatus.trim()) {
				findings.push({
					path: submodulePath,
					kind: "dirty-worktree",
				});
			}
			continue;
		}

		const headResult = runGit(["rev-parse", "HEAD"], absolutePath);
		if (!headResult.ok || !headResult.stdout.trim()) continue;
		const headCommit = headResult.stdout.trim();
		const indexCommit = readGitlinkCommit(cwd, submodulePath);
		if (!indexCommit || indexCommit === headCommit) continue;

		const remoteName = resolvePreferredRemote(absolutePath);
		if (!remoteName || !checkSubmoduleCommitReachable(absolutePath, remoteName, headCommit)) {
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

		// Determine the remote to check against.
		const remoteName = existsSync(absolutePath) ? resolvePreferredRemote(absolutePath) : null;
		const submoduleGitDir = resolveSubmoduleGitDir(cwd, submodulePath);
		const gitDirRemoteName = submoduleGitDir ? resolvePreferredRemoteFromGitDir(submoduleGitDir) : null;
		const resolvedRemoteName = remoteName ?? gitDirRemoteName;

		// In merge worktrees the submodule may have stale local refs. Fetch fresh
		// state from origin before checking reachability so that ls-remote results
		// and merge-base object lookups can succeed.
		runGit(["fetch", resolvedRemoteName, "--quiet"], absolutePath);

		const reachable = checkSubmoduleCommitReachable(
			absolutePath,
			resolvedRemoteName ?? "origin",
			gitlinkCommit,
		);

		if (!reachable) {
			findings.push({
				path: submodulePath,
				gitlinkCommit,
				...(resolvedRemoteName ? { remoteName: resolvedRemoteName } : {}),
			});
		}
	}
	return findings.sort((left, right) => left.path.localeCompare(right.path));
}

