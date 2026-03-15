/**
 * Worktree CRUD, bulk ops, branch protection, preflight
 * @module orch/worktree
 */
import { existsSync, readdirSync, realpathSync, rmSync } from "fs";
import { execSync } from "child_process";
import { join, basename, resolve } from "path";

import { execLog } from "./execution.ts";
import { runGit } from "./git.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG, WorktreeError } from "./types.ts";
import type { BulkWorktreeError, CreateLaneWorktreesResult, CreateWorktreeOptions, OrchestratorConfig, PreflightCheck, PreflightResult, RemoveAllWorktreesResult, RemoveWorktreeOutcome, RemoveWorktreeResult, WorktreeInfo } from "./types.ts";

// ── Worktree Helpers ─────────────────────────────────────────────────

/**
 * Generate branch name per §4.4 naming convention.
 * Format: task/lane-{N}-{batchId}
 *
 * @param laneNumber - Lane number (1-indexed)
 * @param batchId    - Batch ID timestamp (e.g. "20260308T111750")
 */
export function generateBranchName(laneNumber: number, batchId: string): string {
	return `task/lane-${laneNumber}-${batchId}`;
}

/**
 * Resolve the base directory where worktrees are created, based on config.
 *
 * Two modes (from `worktree_location` config):
 *   "sibling"      → resolve(repoRoot, "..")   — worktrees sit next to the repo
 *   "subdirectory"  → resolve(repoRoot, ".worktrees") — worktrees inside the repo (gitignored)
 *
 * The returned path is the parent directory; individual worktree dirs are
 * created as children (e.g., `<base>/{prefix}-1` → `<base>/taskplane-wt-1`).
 *
 * @param repoRoot - Absolute path to the main repository root
 * @param config   - Orchestrator config (reads `worktree_location`)
 */
export function resolveWorktreeBasePath(
	repoRoot: string,
	config: OrchestratorConfig,
): string {
	const location = config.orchestrator.worktree_location;
	if (location === "sibling") {
		return resolve(repoRoot, "..");
	}
	// Default to subdirectory for any non-"sibling" value (including "subdirectory")
	return resolve(repoRoot, ".worktrees");
}

/**
 * Generate worktree path based on config's worktree_location setting.
 *
 * Naming rule: basename = {prefix}-{N}
 *   Sibling mode:      ../{prefix}-{N}        (e.g. ../taskplane-wt-1)
 *   Subdirectory mode: .worktrees/{prefix}-{N} (e.g. .worktrees/taskplane-wt-1)
 *
 * Uses path.resolve() for Windows path normalization (R002 requirement).
 *
 * @param prefix     - Directory prefix (e.g. "taskplane-wt")
 * @param laneNumber - Lane number (1-indexed)
 * @param repoRoot   - Absolute path to the main repository root
 * @param config     - Orchestrator config (optional; defaults to subdirectory mode)
 */
export function generateWorktreePath(
	prefix: string,
	laneNumber: number,
	repoRoot: string,
	config?: OrchestratorConfig,
): string {
	const effectiveConfig = config || DEFAULT_ORCHESTRATOR_CONFIG;
	const basePath = resolveWorktreeBasePath(repoRoot, effectiveConfig);
	return resolve(basePath, `${prefix}-${laneNumber}`);
}

/**
 * Parse `git worktree list --porcelain` output into structured entries.
 *
 * Porcelain output format (one block per worktree, separated by blank lines):
 *   worktree /absolute/path
 *   HEAD <sha>
 *   branch refs/heads/<name>
 *   [detached]
 *
 * @param cwd - Directory to run git from (must be in a git repo)
 */
export interface ParsedWorktreeEntry {
	path: string;
	head: string;
	branch: string | null; // null if detached HEAD
	bare: boolean;
}

export function parseWorktreeList(cwd: string): ParsedWorktreeEntry[] {
	const result = runGit(["worktree", "list", "--porcelain"], cwd);
	if (!result.ok) return [];

	const entries: ParsedWorktreeEntry[] = [];
	const blocks = result.stdout.split(/\n\n+/);

	for (const block of blocks) {
		if (!block.trim()) continue;

		const lines = block.trim().split("\n");
		let path = "";
		let head = "";
		let branch: string | null = null;
		let bare = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				path = line.slice("worktree ".length).trim();
			} else if (line.startsWith("HEAD ")) {
				head = line.slice("HEAD ".length).trim();
			} else if (line.startsWith("branch ")) {
				// "branch refs/heads/develop" → "develop"
				const ref = line.slice("branch ".length).trim();
				branch = ref.replace(/^refs\/heads\//, "");
			} else if (line.trim() === "bare") {
				bare = true;
			}
		}

		if (path) {
			entries.push({ path, head, branch, bare });
		}
	}

	return entries;
}

/**
 * Normalize a filesystem path for reliable comparison on Windows.
 *
 * On Windows, paths may contain 8.3 short names (e.g., `HENRYL~1` instead
 * of `HenryLach`). Node's `resolve()` does NOT expand these, but git
 * always reports full long names. This causes path comparison failures.
 *
 * Uses `fs.realpathSync.native()` to expand 8.3 names when the path exists,
 * falls back to `resolve()` for non-existent paths (e.g., pre-creation checks).
 *
 * All comparisons are also lowercased and slash-normalized.
 */
export function normalizePath(p: string): string {
	let expanded: string;
	try {
		// realpathSync.native expands 8.3 short names on Windows
		expanded = realpathSync.native(resolve(p));
	} catch {
		// Path doesn't exist yet — fall back to resolve()
		expanded = resolve(p);
	}
	return expanded.replace(/\\/g, "/").toLowerCase();
}

/**
 * Check if a given path is already registered as a git worktree.
 * Uses `git worktree list --porcelain` for reliable detection.
 *
 * Path comparison is case-insensitive, slash-normalized, and expands
 * Windows 8.3 short names (e.g., HENRYL~1 → HenryLach) for reliable
 * matching against git's long-name output.
 */
export function isRegisteredWorktree(targetPath: string, cwd: string): boolean {
	const entries = parseWorktreeList(cwd);
	const normalized = normalizePath(targetPath);
	return entries.some(
		(e) => normalizePath(e.path) === normalized,
	);
}


// ── Worktree CRUD Operations ─────────────────────────────────────────

/**
 * Create a new git worktree for a lane.
 *
 * Executes `git worktree add -b <branch> <path> <baseBranch>` from the
 * main repository root. This creates a new branch based on baseBranch
 * and checks it out in the worktree directory.
 *
 * Pre-checks (R002 requirements):
 * 1. Validates baseBranch exists (`git rev-parse --verify`)
 * 2. Checks target path is not already a registered worktree
 * 3. Checks target path is not a non-empty non-worktree directory
 *
 * Post-creation verification:
 * - Branch points to baseBranch HEAD commit
 * - Correct branch is checked out in the worktree
 *
 * @param opts     - Creation options (laneNumber, batchId, baseBranch, prefix)
 * @param repoRoot - Absolute path to the main repository root
 * @returns        - WorktreeInfo on success
 * @throws         - WorktreeError with stable error code on failure
 */
export function createWorktree(opts: CreateWorktreeOptions, repoRoot: string): WorktreeInfo {
	const { laneNumber, batchId, baseBranch, prefix, config } = opts;

	const branch = generateBranchName(laneNumber, batchId);
	const worktreePath = generateWorktreePath(prefix, laneNumber, repoRoot, config);

	// ── Pre-check 1: Validate base branch exists ─────────────────
	const baseBranchCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${baseBranch}`],
		repoRoot,
	);
	if (!baseBranchCheck.ok) {
		throw new WorktreeError(
			"WORKTREE_INVALID_BASE",
			`Base branch "${baseBranch}" does not exist locally. ` +
			`Verify the branch exists: git branch --list ${baseBranch}`,
		);
	}
	const baseBranchHead = baseBranchCheck.stdout.trim();

	// ── Pre-check 2: Check if path is already a registered worktree
	if (isRegisteredWorktree(worktreePath, repoRoot)) {
		throw new WorktreeError(
			"WORKTREE_PATH_IS_WORKTREE",
			`Path "${worktreePath}" is already registered as a git worktree. ` +
			`Remove it first: git worktree remove "${worktreePath}"`,
		);
	}

	// ── Pre-check 3: Check if path exists and is non-empty (non-worktree dir)
	if (existsSync(worktreePath)) {
		try {
			const entries = readdirSync(worktreePath);
			if (entries.length > 0) {
				throw new WorktreeError(
					"WORKTREE_PATH_NOT_EMPTY",
					`Path "${worktreePath}" exists and is not empty. ` +
					`It is not a registered git worktree. Remove or rename it before creating a worktree here.`,
				);
			}
		} catch (err) {
			if (err instanceof WorktreeError) throw err;
			// If we can't read the path (e.g., it's a file not a directory), error
			throw new WorktreeError(
				"WORKTREE_PATH_NOT_EMPTY",
				`Path "${worktreePath}" exists but cannot be read as a directory.`,
			);
		}
	}

	// ── Pre-check 4: Check if branch already exists ──────────────
	const branchCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${branch}`],
		repoRoot,
	);
	if (branchCheck.ok) {
		throw new WorktreeError(
			"WORKTREE_BRANCH_EXISTS",
			`Branch "${branch}" already exists. ` +
			`This may indicate a stale worktree from a previous batch. ` +
			`Delete it: git branch -D ${branch}`,
		);
	}

	// ── Create worktree ──────────────────────────────────────────
	const createResult = runGit(
		["worktree", "add", "-b", branch, worktreePath, baseBranch],
		repoRoot,
	);
	if (!createResult.ok) {
		throw new WorktreeError(
			"WORKTREE_GIT_ERROR",
			`Failed to create worktree at "${worktreePath}" on branch "${branch}" ` +
			`from "${baseBranch}": ${createResult.stderr}`,
		);
	}

	// ── Post-creation verification (R002 requirements) ───────────
	// Verify 1: Correct branch is checked out
	const headBranchResult = runGit(
		["rev-parse", "--abbrev-ref", "HEAD"],
		worktreePath,
	);
	if (!headBranchResult.ok || headBranchResult.stdout !== branch) {
		throw new WorktreeError(
			"WORKTREE_VERIFY_FAILED",
			`Verification failed: expected branch "${branch}" checked out ` +
			`in worktree, but got "${headBranchResult.stdout || "(unknown)"}".`,
		);
	}

	// Verify 2: Branch points to baseBranch HEAD commit
	const headCommitResult = runGit(["rev-parse", "HEAD"], worktreePath);
	if (!headCommitResult.ok || headCommitResult.stdout !== baseBranchHead) {
		throw new WorktreeError(
			"WORKTREE_VERIFY_FAILED",
			`Verification failed: worktree HEAD (${headCommitResult.stdout?.slice(0, 8) || "?"}) ` +
			`does not match baseBranch "${baseBranch}" HEAD (${baseBranchHead.slice(0, 8)}).`,
		);
	}

	return {
		path: resolve(worktreePath),
		branch,
		laneNumber,
	};
}

/**
 * Reset an existing worktree to point at a new target branch/commit.
 *
 * Used after a wave merge to update a lane's worktree to the latest
 * develop HEAD, or any other target branch. The existing lane branch
 * name is preserved — only its target commit changes.
 *
 * Strategy: `git checkout -B <laneBranch> <targetBranch>` inside the worktree.
 * This repoints the existing lane branch to the target commit and checks it out.
 *
 * Precondition checks (R003 requirements):
 * 1. Worktree path exists on disk
 * 2. Path is a registered git worktree (via parseWorktreeList)
 * 3. Target branch resolves (git rev-parse --verify)
 * 4. Working tree is clean (git status --porcelain returns empty)
 *
 * Post-reset verification:
 * - HEAD equals targetBranch commit
 * - Current branch equals worktree.branch (lane branch preserved)
 *
 * Idempotency: Resetting to the same target commit succeeds (no-op semantically).
 *
 * @param worktree     - WorktreeInfo returned by createWorktree()
 * @param targetBranch - Branch name to reset to (e.g. "develop")
 * @param repoRoot     - Absolute path to the main repository root
 * @returns            - Updated WorktreeInfo (same branch/laneNumber, same path)
 * @throws             - WorktreeError with stable error code on failure
 */
export function resetWorktree(
	worktree: WorktreeInfo,
	targetBranch: string,
	repoRoot: string,
): WorktreeInfo {
	const { path: worktreePath, branch, laneNumber } = worktree;

	// ── Pre-check 1: Worktree path exists on disk ────────────────
	if (!existsSync(worktreePath)) {
		throw new WorktreeError(
			"WORKTREE_NOT_FOUND",
			`Worktree path "${worktreePath}" does not exist on disk. ` +
			`It may have been removed externally.`,
		);
	}

	// ── Pre-check 2: Path is a registered git worktree ───────────
	if (!isRegisteredWorktree(worktreePath, repoRoot)) {
		throw new WorktreeError(
			"WORKTREE_NOT_REGISTERED",
			`Path "${worktreePath}" exists but is not a registered git worktree. ` +
			`It may have been removed from git tracking. Check: git worktree list`,
		);
	}

	// ── Pre-check 3: Target branch resolves ──────────────────────
	const targetCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${targetBranch}`],
		repoRoot,
	);
	if (!targetCheck.ok) {
		throw new WorktreeError(
			"WORKTREE_INVALID_BASE",
			`Target branch "${targetBranch}" does not exist locally. ` +
			`Verify the branch exists: git branch --list ${targetBranch}`,
		);
	}
	const targetCommit = targetCheck.stdout.trim();

	// ── Pre-check 4: Working tree is clean ───────────────────────
	const statusCheck = runGit(["status", "--porcelain"], worktreePath);
	if (!statusCheck.ok) {
		throw new WorktreeError(
			"WORKTREE_GIT_ERROR",
			`Failed to check working tree status in "${worktreePath}": ${statusCheck.stderr}`,
		);
	}
	if (statusCheck.stdout.length > 0) {
		throw new WorktreeError(
			"WORKTREE_DIRTY",
			`Worktree at "${worktreePath}" has uncommitted changes. ` +
			`Workers must commit or discard all changes before a reset can proceed. ` +
			`Dirty files:\n${statusCheck.stdout}`,
		);
	}

	// ── Reset: git checkout -B <laneBranch> <targetBranch> ───────
	const resetResult = runGit(
		["checkout", "-B", branch, targetBranch],
		worktreePath,
	);
	if (!resetResult.ok) {
		throw new WorktreeError(
			"WORKTREE_RESET_FAILED",
			`Failed to reset worktree at "${worktreePath}" ` +
			`(branch "${branch}" → "${targetBranch}"): ${resetResult.stderr}`,
		);
	}

	// ── Post-reset verification ──────────────────────────────────
	// Verify 1: Current branch equals expected lane branch
	const headBranchResult = runGit(
		["rev-parse", "--abbrev-ref", "HEAD"],
		worktreePath,
	);
	if (!headBranchResult.ok || headBranchResult.stdout !== branch) {
		throw new WorktreeError(
			"WORKTREE_VERIFY_FAILED",
			`Post-reset verification failed: expected branch "${branch}" ` +
			`checked out, but got "${headBranchResult.stdout || "(unknown)"}".`,
		);
	}

	// Verify 2: HEAD equals targetBranch commit
	const headCommitResult = runGit(["rev-parse", "HEAD"], worktreePath);
	if (!headCommitResult.ok || headCommitResult.stdout !== targetCommit) {
		throw new WorktreeError(
			"WORKTREE_VERIFY_FAILED",
			`Post-reset verification failed: worktree HEAD ` +
			`(${headCommitResult.stdout?.slice(0, 8) || "?"}) does not match ` +
			`target "${targetBranch}" commit (${targetCommit.slice(0, 8)}).`,
		);
	}

	// Return updated WorktreeInfo (branch and laneNumber preserved)
	return {
		path: resolve(worktreePath),
		branch,
		laneNumber,
	};
}

/**
 * Sleep for a given number of milliseconds (synchronous busy-wait).
 *
 * Uses execSync("ping") on Windows / ("sleep") on Unix as a synchronous
 * sleep mechanism since this module uses synchronous git operations.
 * The busy-wait is acceptable because retry waits are bounded (max 16s)
 * and this function is only called during cleanup, not hot paths.
 *
 * @param ms - Milliseconds to sleep
 */
export function sleepSync(ms: number): void {
	const seconds = Math.ceil(ms / 1000);
	try {
		// Cross-platform synchronous sleep
		if (process.platform === "win32") {
			execSync(`ping -n ${seconds + 1} 127.0.0.1 > nul`, { stdio: "ignore", timeout: ms + 5000 });
		} else {
			execSync(`sleep ${seconds}`, { stdio: "ignore", timeout: ms + 5000 });
		}
	} catch {
		// Timeout or error — acceptable, we just needed a delay
	}
}

/**
 * Determine if a git worktree remove error is retriable.
 *
 * Retriable errors are typically filesystem/lock issues on Windows
 * where another process (antivirus, IDE, explorer) holds file handles.
 *
 * Terminal (non-retriable) errors are git usage errors like
 * "not a valid worktree" or missing arguments.
 *
 * @param stderr - Error output from git worktree remove
 * @returns true if the error is likely transient and worth retrying
 */
export function isRetriableRemoveError(stderr: string): boolean {
	const lower = stderr.toLowerCase();
	// Windows file locking patterns
	if (lower.includes("cannot lock") || lower.includes("unable to access")) return true;
	if (lower.includes("permission denied")) return true;
	if (lower.includes("device or resource busy")) return true;
	if (lower.includes("the process cannot access")) return true;
	if (lower.includes("used by another process")) return true;
	if (lower.includes("directory not empty")) return true;
	if (lower.includes("failed to remove")) return true;
	// Generic I/O errors that may be transient
	if (lower.includes("i/o error")) return true;
	if (lower.includes("input/output error")) return true;
	return false;
}

/**
 * Remove a git worktree and clean up its associated branch.
 *
 * Executes `git worktree remove --force <path>` from the main repository
 * root, then handles branch cleanup based on merge status.
 *
 * Branch protection (when targetBranch is provided):
 * - If branch has unmerged commits vs targetBranch → preserves as `saved/<branch>`
 *   instead of deleting. Returns `{ branchPreserved: true, savedBranch: "saved/..." }`
 * - If fully merged or no new commits → deletes normally
 * - If targetBranch is missing or git error → skips deletion (safe default)
 *
 * Idempotent behavior:
 * - If path is already missing AND branch is already gone → returns
 *   `{ removed: false, alreadyRemoved: true, branchDeleted: true }`
 * - If path is already missing BUT branch has unmerged commits → preserves branch,
 *   returns `{ removed: false, alreadyRemoved: true, branchPreserved: true }`
 *
 * Retry policy (Windows file locking):
 * - Up to 5 retries with exponential backoff: 1s, 2s, 4s, 8s, 16s
 * - Only retriable errors (filesystem/lock) trigger retries
 * - Terminal git errors (invalid worktree, bad args) fail immediately
 * - Branch deletion is not retried (single attempt)
 *
 * Post-removal verification:
 * - Path no longer exists on disk
 * - Path no longer registered via `git worktree list --porcelain`
 *
 * @param worktree     - WorktreeInfo returned by createWorktree()
 * @param repoRoot     - Absolute path to the main repository root
 * @param targetBranch - Optional target branch for unmerged commit detection (e.g. "develop")
 * @returns RemoveWorktreeResult with status flags
 * @throws WorktreeError with WORKTREE_REMOVE_RETRY_EXHAUSTED if all retries fail
 * @throws WorktreeError with WORKTREE_REMOVE_FAILED for terminal (non-retriable) errors
 * @throws WorktreeError with WORKTREE_BRANCH_DELETE_FAILED if branch cleanup fails
 */
export function removeWorktree(
	worktree: WorktreeInfo,
	repoRoot: string,
	targetBranch?: string,
): RemoveWorktreeResult {
	const { path: worktreePath, branch } = worktree;

	const pathExists = existsSync(worktreePath);
	const isRegistered = isRegisteredWorktree(worktreePath, repoRoot);

	// ── Handle already-removed states ────────────────────────────
	if (!pathExists && !isRegistered) {
		// Path is gone and not registered. Clean up stale branch if any.
		const branchResult = ensureBranchDeleted(branch, repoRoot, worktreePath, targetBranch);
		return {
			removed: false,
			alreadyRemoved: true,
			branchDeleted: branchResult.deleted,
			branchPreserved: branchResult.preserved,
			savedBranch: branchResult.savedBranch,
			unmergedCount: branchResult.unmergedCount,
		};
	}

	// If path is missing but still registered in git, prune first
	if (!pathExists && isRegistered) {
		// `git worktree prune` removes stale worktree entries
		runGit(["worktree", "prune"], repoRoot);
		const branchResult = ensureBranchDeleted(branch, repoRoot, worktreePath, targetBranch);
		return {
			removed: false,
			alreadyRemoved: true,
			branchDeleted: branchResult.deleted,
			branchPreserved: branchResult.preserved,
			savedBranch: branchResult.savedBranch,
			unmergedCount: branchResult.unmergedCount,
		};
	}

	// ── Attempt removal with retry/backoff ───────────────────────
	const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
	const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // first attempt + retries

	let lastError = "";

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const removeResult = runGit(
			["worktree", "remove", "--force", worktreePath],
			repoRoot,
		);

		if (removeResult.ok) {
			// Successful removal — proceed to branch cleanup
			break;
		}

		lastError = removeResult.stderr;

		// Check if error is terminal (non-retriable)
		if (!isRetriableRemoveError(lastError)) {
			throw new WorktreeError(
				"WORKTREE_REMOVE_FAILED",
				`Failed to remove worktree at "${worktreePath}" ` +
				`(terminal error, not retried): ${lastError}`,
			);
		}

		// If we've exhausted all retries, throw
		if (attempt >= MAX_ATTEMPTS) {
			throw new WorktreeError(
				"WORKTREE_REMOVE_RETRY_EXHAUSTED",
				`Failed to remove worktree at "${worktreePath}" after ` +
				`${MAX_ATTEMPTS} attempts. Last error: ${lastError}. ` +
				`This is likely a Windows file locking issue. ` +
				`Close any programs accessing "${worktreePath}" and try again.`,
			);
		}

		// Wait before retrying (exponential backoff)
		const delayMs = RETRY_DELAYS_MS[attempt - 1];
		sleepSync(delayMs);
	}

	// ── Post-removal verification ────────────────────────────────
	if (existsSync(worktreePath)) {
		throw new WorktreeError(
			"WORKTREE_VERIFY_FAILED",
			`Post-removal verification failed: path "${worktreePath}" ` +
			`still exists on disk after successful git worktree remove.`,
		);
	}

	if (isRegisteredWorktree(worktreePath, repoRoot)) {
		// Try pruning stale entries
		runGit(["worktree", "prune"], repoRoot);
		if (isRegisteredWorktree(worktreePath, repoRoot)) {
			throw new WorktreeError(
				"WORKTREE_VERIFY_FAILED",
				`Post-removal verification failed: path "${worktreePath}" ` +
				`is still registered as a git worktree after removal and prune.`,
			);
		}
	}

	// ── Branch cleanup (single attempt, fail loud if still present) ─
	const branchResult = ensureBranchDeleted(branch, repoRoot, worktreePath, targetBranch);

	return {
		removed: true,
		alreadyRemoved: false,
		branchDeleted: branchResult.deleted,
		branchPreserved: branchResult.preserved,
		savedBranch: branchResult.savedBranch,
		unmergedCount: branchResult.unmergedCount,
	};
}

/**
 * Result of ensureBranchDeleted — either deleted or preserved.
 */
export interface EnsureBranchDeletedResult {
	/** Whether the branch was deleted */
	deleted: boolean;
	/** Whether the branch was preserved (unmerged commits) */
	preserved: boolean;
	/** Saved branch name (if preserved) */
	savedBranch?: string;
	/** Number of unmerged commits (if preserved) */
	unmergedCount?: number;
}

/**
 * Ensure a lane branch is deleted — or preserved if it has unmerged commits.
 *
 * When `targetBranch` is provided, checks for unmerged commits first:
 * - If unmerged: preserves via `saved/<branch>` ref instead of deleting
 * - If fully merged or no unmerged: deletes normally
 *
 * When `targetBranch` is omitted (backward compat), deletes unconditionally
 * using deleteBranchBestEffort() with the original fail-loud semantics.
 *
 * Upgrades a persistent deletion failure into a hard WorktreeError so
 * callers cannot silently proceed with stale lane branches.
 */
export function ensureBranchDeleted(
	branch: string,
	repoRoot: string,
	worktreePath: string,
	targetBranch?: string,
): EnsureBranchDeletedResult {
	// If targetBranch provided, check for unmerged commits before deleting
	if (targetBranch) {
		const preserveResult = preserveBranch(branch, targetBranch, repoRoot);

		switch (preserveResult.action) {
			case "preserved":
			case "already-preserved": {
				// Branch had unmerged commits — saved ref exists, now delete the original
				// This implements rename semantics: create saved + delete original
				const sourceDeleted = deleteBranchBestEffort(branch, repoRoot);
				return {
					deleted: sourceDeleted,
					preserved: true,
					savedBranch: preserveResult.savedBranch,
					unmergedCount: preserveResult.unmergedCount,
				};
			}

			case "fully-merged":
			case "no-branch":
				// Safe to delete — fall through to deletion below
				break;

			case "error":
				// Preservation check failed — log but still try to preserve by skipping deletion
				// This is the safe default: don't delete if we can't verify merge status
				return {
					deleted: false,
					preserved: false,
				};
		}
	}

	// No unmerged commits (or no targetBranch) — delete normally
	const branchDeleted = deleteBranchBestEffort(branch, repoRoot);
	if (!branchDeleted) {
		throw new WorktreeError(
			"WORKTREE_BRANCH_DELETE_FAILED",
			`Worktree "${worktreePath}" was removed, but failed to delete lane branch ` +
			`"${branch}". Delete it manually: git branch -D ${branch}`,
		);
	}
	return { deleted: true, preserved: false };
}

/**
 * Delete a branch with best-effort semantics.
 *
 * Uses `git branch -D` (force delete) since lane branches are ephemeral
 * and may not have been merged anywhere.
 *
 * "Branch not found" is treated as idempotent success (returns true).
 *
 * @param branch   - Branch name to delete
 * @param repoRoot - Repository root directory
 * @returns true if branch was deleted or was already absent
 */
export function deleteBranchBestEffort(branch: string, repoRoot: string): boolean {
	// Check if branch exists first
	const branchCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${branch}`],
		repoRoot,
	);

	if (!branchCheck.ok) {
		// Branch doesn't exist — idempotent success
		return true;
	}

	// Force delete (lane branches are ephemeral, may not be merged)
	const deleteResult = runGit(["branch", "-D", branch], repoRoot);

	if (deleteResult.ok) {
		return true;
	}

	// If delete failed but branch is now gone (race condition), treat as success
	const recheckResult = runGit(
		["rev-parse", "--verify", `refs/heads/${branch}`],
		repoRoot,
	);
	if (!recheckResult.ok) {
		return true;
	}

	// Branch still exists and delete failed — return false
	return false;
}


// ── Branch Protection Helpers ────────────────────────────────────────

/** Typed error codes for unmerged commit checks */
export type UnmergedCommitsErrorCode =
	| "BRANCH_NOT_FOUND"
	| "TARGET_BRANCH_MISSING"
	| "UNMERGED_COUNT_FAILED"
	| "UNMERGED_COUNT_PARSE_FAILED";

/**
 * Result of checking for unmerged commits on a branch.
 */
export interface UnmergedCommitsResult {
	/** Whether the check succeeded (git command ran without error) */
	ok: boolean;
	/** Number of commits on `branch` not reachable from `targetBranch` */
	count: number;
	/** Typed error code if check failed */
	code?: UnmergedCommitsErrorCode;
	/** Error message if check failed */
	error?: string;
}

/**
 * Check if a branch has commits not reachable from a target branch.
 *
 * Uses `git rev-list --count <targetBranch>..<branch>` which is
 * Windows-safe (no shell pipes). Returns the count of unmerged commits.
 *
 * Pure logic with git dependency — designed so the git call can be
 * tested in integration tests with real repos, while the decision
 * logic is tested via the count result.
 *
 * @param branch       - Branch to check for unmerged commits
 * @param targetBranch - Target branch to compare against (e.g. "develop")
 * @param repoRoot     - Repository root directory
 * @returns UnmergedCommitsResult with count and status
 */
export function hasUnmergedCommits(
	branch: string,
	targetBranch: string,
	repoRoot: string,
): UnmergedCommitsResult {
	// Verify branch exists
	const branchCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${branch}`],
		repoRoot,
	);
	if (!branchCheck.ok) {
		return { ok: false, count: 0, code: "BRANCH_NOT_FOUND", error: `Branch "${branch}" does not exist` };
	}

	// Verify target branch exists
	const targetCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${targetBranch}`],
		repoRoot,
	);
	if (!targetCheck.ok) {
		return { ok: false, count: 0, code: "TARGET_BRANCH_MISSING", error: `Target branch "${targetBranch}" does not exist` };
	}

	// Count commits on branch not reachable from target
	const countResult = runGit(
		["rev-list", "--count", `${targetBranch}..${branch}`],
		repoRoot,
	);
	if (!countResult.ok) {
		return { ok: false, count: 0, code: "UNMERGED_COUNT_FAILED", error: `Failed to count unmerged commits: ${countResult.stderr}` };
	}

	const count = parseInt(countResult.stdout.trim(), 10);
	if (isNaN(count)) {
		return { ok: false, count: 0, code: "UNMERGED_COUNT_PARSE_FAILED", error: `Failed to parse commit count: "${countResult.stdout}"` };
	}

	return { ok: true, count };
}

/**
 * Compute the saved branch name for a given original branch.
 *
 * Pure function — no side effects. Maps a branch name to its saved
 * counterpart under the `saved/` namespace.
 *
 * Examples:
 *   "task/lane-1-20260308T111750" → "saved/task/lane-1-20260308T111750"
 *   "feature/my-branch"          → "saved/feature/my-branch"
 *
 * @param originalBranch - The branch name to compute a saved name for
 * @returns The saved branch name (always prefixed with "saved/")
 */
export function computeSavedBranchName(originalBranch: string): string {
	return `saved/${originalBranch}`;
}

/**
 * Result of saved branch collision resolution.
 */
export interface SavedBranchResolution {
	/** The action to take */
	action: "create" | "keep-existing" | "create-suffixed";
	/** The final saved branch name to use */
	savedName: string;
}

/**
 * Resolve a collision when a saved branch name already exists.
 *
 * Decision table:
 *   - saved ref absent              → action: "create", use savedName
 *   - saved ref exists, same SHA    → action: "keep-existing", use existing savedName
 *   - saved ref exists, different SHA → action: "create-suffixed", append timestamp
 *
 * Pure function — no side effects. All git state is passed in as parameters.
 *
 * @param savedName   - The desired saved branch name (e.g. "saved/task/lane-1-...")
 * @param existingSHA - SHA of existing saved branch (empty string if absent)
 * @param newSHA      - SHA of the branch being preserved
 * @param timestamp   - ISO timestamp for suffix (injectable for testability)
 * @returns SavedBranchResolution with action and final name
 */
export function resolveSavedBranchCollision(
	savedName: string,
	existingSHA: string,
	newSHA: string,
	timestamp?: string,
): SavedBranchResolution {
	// Saved ref doesn't exist — create it
	if (!existingSHA) {
		return { action: "create", savedName };
	}

	// Same SHA — no-op, keep existing
	if (existingSHA === newSHA) {
		return { action: "keep-existing", savedName };
	}

	// Different SHA — create with timestamp suffix
	const ts = timestamp || new Date().toISOString().replace(/[:.]/g, "-");
	return { action: "create-suffixed", savedName: `${savedName}-${ts}` };
}

/** Typed error codes for branch preservation */
export type PreserveBranchErrorCode =
	| "TARGET_BRANCH_MISSING"
	| "UNMERGED_COUNT_FAILED"
	| "SAVED_BRANCH_CREATE_FAILED"
	| "UNKNOWN_RESOLUTION";

/**
 * Result of a branch preservation attempt.
 */
export interface PreserveBranchResult {
	/** Whether the branch was preserved (or was already preserved / fully merged) */
	ok: boolean;
	/** What action was taken */
	action: "preserved" | "already-preserved" | "fully-merged" | "no-branch" | "error";
	/** The saved branch name (if preserved) */
	savedBranch?: string;
	/** Number of unmerged commits (if checked) */
	unmergedCount?: number;
	/** Typed error code (if action is "error") */
	code?: PreserveBranchErrorCode;
	/** Error message (if action is "error") */
	error?: string;
}

/**
 * Preserve a branch by creating a saved ref if it has unmerged commits.
 *
 * Orchestrates: hasUnmergedCommits → computeSavedBranchName →
 * resolveSavedBranchCollision → git branch create/rename.
 *
 * Idempotent: if the saved ref already exists at the same SHA, it's a no-op.
 * If the target branch doesn't exist, logs warning and returns gracefully.
 *
 * @param branch       - Branch to check and potentially preserve
 * @param targetBranch - Target branch to compare against (e.g. "develop")
 * @param repoRoot     - Repository root directory
 * @returns PreserveBranchResult describing what was done
 */
export function preserveBranch(
	branch: string,
	targetBranch: string,
	repoRoot: string,
): PreserveBranchResult {
	// Check if branch exists
	const branchCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${branch}`],
		repoRoot,
	);
	if (!branchCheck.ok) {
		return { ok: true, action: "no-branch" };
	}
	const branchSHA = branchCheck.stdout.trim();

	// Check for unmerged commits
	const unmergedResult = hasUnmergedCommits(branch, targetBranch, repoRoot);
	if (!unmergedResult.ok) {
		// Target branch missing or git error — skip preservation gracefully
		// Map unmerged error codes to preserve error codes
		const preserveCode: PreserveBranchErrorCode =
			unmergedResult.code === "TARGET_BRANCH_MISSING" ? "TARGET_BRANCH_MISSING" : "UNMERGED_COUNT_FAILED";
		return {
			ok: false,
			action: "error",
			code: preserveCode,
			error: unmergedResult.error,
		};
	}

	if (unmergedResult.count === 0) {
		return { ok: true, action: "fully-merged", unmergedCount: 0 };
	}

	// Branch has unmerged commits — compute saved name
	const savedName = computeSavedBranchName(branch);

	// Check for collision
	const existingCheck = runGit(
		["rev-parse", "--verify", `refs/heads/${savedName}`],
		repoRoot,
	);
	const existingSHA = existingCheck.ok ? existingCheck.stdout.trim() : "";

	const resolution = resolveSavedBranchCollision(savedName, existingSHA, branchSHA);

	switch (resolution.action) {
		case "keep-existing":
			return {
				ok: true,
				action: "already-preserved",
				savedBranch: resolution.savedName,
				unmergedCount: unmergedResult.count,
			};

		case "create":
		case "create-suffixed": {
			// Create saved branch at same SHA
			const createResult = runGit(
				["branch", resolution.savedName, branchSHA],
				repoRoot,
			);
			if (!createResult.ok) {
				return {
					ok: false,
					action: "error",
					code: "SAVED_BRANCH_CREATE_FAILED",
					error: `Failed to create saved branch "${resolution.savedName}": ${createResult.stderr}`,
					unmergedCount: unmergedResult.count,
				};
			}
			return {
				ok: true,
				action: "preserved",
				savedBranch: resolution.savedName,
				unmergedCount: unmergedResult.count,
			};
		}

		default:
			return { ok: false, action: "error", code: "UNKNOWN_RESOLUTION", error: `Unknown resolution action` };
	}
}


// ── Bulk Worktree Operations ─────────────────────────────────────────

/**
 * List all orchestrator worktrees matching a prefix pattern.
 *
 * Parses `git worktree list --porcelain` via parseWorktreeList() and filters
 * entries whose path basename matches `{prefix}-{N}` (where N is a number).
 *
 * Naming invariant: basename = {prefix}-{N}. The prefix comes from config
 * (e.g. "taskplane-wt"), and the lane number is appended with a single
 * dash separator. No extra `-wt-` infix is added.
 *
 * Lane number is extracted from the path basename pattern. Entries with
 * malformed/partial data (missing path, unparseable lane number) are
 * silently skipped — they are not orchestrator worktrees.
 *
 * @param prefix   - Worktree directory prefix (e.g. "taskplane-wt")
 *                   Full basename pattern: `{prefix}-{N}` (e.g. "taskplane-wt-1")
 * @param repoRoot - Absolute path to the main repository root
 * @returns        - WorktreeInfo[] sorted by laneNumber (ascending)
 */
export function listWorktrees(prefix: string, repoRoot: string): WorktreeInfo[] {
	const entries = parseWorktreeList(repoRoot);
	const results: WorktreeInfo[] = [];

	// Build regex pattern to match the worktree basename.
	// Naming invariant: basename = {prefix}-{N} where N is one or more digits.
	// Example: prefix "taskplane-wt" matches "taskplane-wt-1", "taskplane-wt-2", etc.
	const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);

	for (const entry of entries) {
		if (!entry.path) continue;

		// Extract basename from the worktree path
		const entryBasename = basename(resolve(entry.path));
		const match = entryBasename.match(pattern);
		if (!match) continue;

		const laneNumber = parseInt(match[1], 10);
		if (isNaN(laneNumber) || laneNumber < 1) continue;

		results.push({
			path: resolve(entry.path),
			branch: entry.branch || "",
			laneNumber,
		});
	}

	// Sort by laneNumber ascending (deterministic output)
	results.sort((a, b) => a.laneNumber - b.laneNumber);

	return results;
}

/**
 * Escape special regex characters in a string for safe use in RegExp constructor.
 */
export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create multiple lane worktrees in a single batch.
 *
 * Creates `count` worktrees sequentially (lanes 1..count). Git worktree
 * operations are not safe to parallelize (shared lock file), so sequential
 * creation is the correct approach.
 *
 * Partial failure rollback:
 * - If lane K fails after lanes 1..(K-1) succeeded, ALL previously-created
 *   worktrees are rolled back via removeWorktree().
 * - Rollback is best-effort: individual rollback failures are collected in
 *   `rollbackErrors` but do not prevent other rollbacks from proceeding.
 * - On successful rollback, `worktrees` is empty (clean slate).
 *
 * @param count    - Number of worktrees to create (1-indexed: lane 1..count)
 * @param batchId  - Batch ID timestamp for branch naming
 * @param config   - Orchestrator config (prefix extracted from it)
 * @param repoRoot - Absolute path to the main repository root
 * @param baseBranch - Branch to base worktrees on (captured at batch start)
 * @returns        - CreateLaneWorktreesResult with success flag and details
 */
export function createLaneWorktrees(
	count: number,
	batchId: string,
	config: OrchestratorConfig,
	repoRoot: string,
	baseBranch: string,
): CreateLaneWorktreesResult {
	const prefix = config.orchestrator.worktree_prefix;
	const created: WorktreeInfo[] = [];
	const errors: BulkWorktreeError[] = [];

	for (let lane = 1; lane <= count; lane++) {
		try {
			const wt = createWorktree(
				{ laneNumber: lane, batchId, baseBranch, prefix, config },
				repoRoot,
			);
			created.push(wt);
		} catch (err: unknown) {
			const wtErr = err instanceof WorktreeError ? err : null;
			errors.push({
				laneNumber: lane,
				code: wtErr?.code || "UNKNOWN",
				message: wtErr?.message || String(err),
			});

			// Rollback all previously-created worktrees
			const rollbackErrors: BulkWorktreeError[] = [];
			for (const wt of created) {
				try {
					removeWorktree(wt, repoRoot);
				} catch (rbErr: unknown) {
					const rbWtErr = rbErr instanceof WorktreeError ? rbErr : null;
					rollbackErrors.push({
						laneNumber: wt.laneNumber,
						code: rbWtErr?.code || "UNKNOWN",
						message: rbWtErr?.message || String(rbErr),
					});
				}
			}

			return {
				success: false,
				worktrees: [],
				errors,
				rolledBack: rollbackErrors.length === 0,
				rollbackErrors,
			};
		}
	}

	// All created successfully
	// Sort by laneNumber (should already be in order, but enforce)
	created.sort((a, b) => a.laneNumber - b.laneNumber);

	return {
		success: true,
		worktrees: created,
		errors: [],
		rolledBack: false,
		rollbackErrors: [],
	};
}

/**
 * Ensure required lane worktrees exist for the current wave.
 *
 * Reuses existing worktrees when present (multi-wave behavior), resetting
 * them to the base branch HEAD before use, and only creates missing lanes.
 * If creation of a missing lane fails, newly-created lanes in this call are
 * rolled back.
 *
 * This prevents wave 2+ allocation from failing on WORKTREE_PATH_IS_WORKTREE
 * while still supporting wave growth (e.g., 1 lane in wave 1, 3 lanes in wave 2).
 */
export function ensureLaneWorktrees(
	laneNumbers: number[],
	batchId: string,
	config: OrchestratorConfig,
	repoRoot: string,
	baseBranch: string,
): CreateLaneWorktreesResult {
	const prefix = config.orchestrator.worktree_prefix;

	const existing = listWorktrees(prefix, repoRoot);
	const existingByLane = new Map<number, WorktreeInfo>();
	for (const wt of existing) {
		existingByLane.set(wt.laneNumber, wt);
	}

	const needed = [...new Set(laneNumbers)].sort((a, b) => a - b);
	const selected: WorktreeInfo[] = [];
	const createdNow: WorktreeInfo[] = [];
	const errors: BulkWorktreeError[] = [];

	for (const lane of needed) {
		const reused = existingByLane.get(lane);
		if (reused) {
			// Reused worktrees must be reset to base branch HEAD before use.
			// This covers normal multi-wave reuse and stale leftovers from prior batches.
			const resetResult = safeResetWorktree(reused, baseBranch, repoRoot);
			if (resetResult.success) {
				selected.push(reused);
				continue;
			}

			// Reset failed: remove and recreate this lane worktree.
			try {
				removeWorktree(reused, repoRoot);
			} catch {
				// Best effort — creation below may still fail with a clear error.
			}
		}

		try {
			const wt = createWorktree(
				{ laneNumber: lane, batchId, baseBranch, prefix, config },
				repoRoot,
			);
			createdNow.push(wt);
			selected.push(wt);
		} catch (err: unknown) {
			const wtErr = err instanceof WorktreeError ? err : null;
			errors.push({
				laneNumber: lane,
				code: wtErr?.code || "UNKNOWN",
				message: wtErr?.message || String(err),
			});

			const rollbackErrors: BulkWorktreeError[] = [];
			for (const wt of createdNow) {
				try {
					removeWorktree(wt, repoRoot);
				} catch (rbErr: unknown) {
					const rbWtErr = rbErr instanceof WorktreeError ? rbErr : null;
					rollbackErrors.push({
						laneNumber: wt.laneNumber,
						code: rbWtErr?.code || "UNKNOWN",
						message: rbWtErr?.message || String(rbErr),
					});
				}
			}

			return {
				success: false,
				worktrees: [],
				errors,
				rolledBack: rollbackErrors.length === 0,
				rollbackErrors,
			};
		}
	}

	selected.sort((a, b) => a.laneNumber - b.laneNumber);
	return {
		success: true,
		worktrees: selected,
		errors: [],
		rolledBack: false,
		rollbackErrors: [],
	};
}

/**
 * Remove all orchestrator worktrees matching a prefix.
 *
 * Uses listWorktrees() to discover matching worktrees, then removes each
 * one via removeWorktree(). Best-effort: continues on per-worktree errors
 * (does not fail-fast).
 *
 * When `targetBranch` is provided, branches with unmerged commits are
 * preserved as `saved/<branch>` refs instead of being force-deleted.
 *
 * @param prefix       - Worktree directory prefix (e.g. "taskplane-wt")
 * @param repoRoot     - Absolute path to the main repository root
 * @param targetBranch - Optional target branch for unmerged commit detection (e.g. "develop")
 * @returns            - RemoveAllWorktreesResult with per-worktree outcomes
 */
export function removeAllWorktrees(
	prefix: string,
	repoRoot: string,
	targetBranch?: string,
): RemoveAllWorktreesResult {
	const worktrees = listWorktrees(prefix, repoRoot);
	const outcomes: RemoveWorktreeOutcome[] = [];
	const removed: WorktreeInfo[] = [];
	const failed: RemoveWorktreeOutcome[] = [];
	const preserved: Array<{ branch: string; savedBranch: string; laneNumber: number; unmergedCount?: number }> = [];

	for (const wt of worktrees) {
		try {
			const result = removeWorktree(wt, repoRoot, targetBranch);
			const outcome: RemoveWorktreeOutcome = {
				worktree: wt,
				result,
				error: null,
			};
			outcomes.push(outcome);
			removed.push(wt);

			// Track preserved branches for caller logging
			if (result.branchPreserved && result.savedBranch) {
				preserved.push({
					branch: wt.branch,
					savedBranch: result.savedBranch,
					laneNumber: wt.laneNumber,
					unmergedCount: result.unmergedCount,
				});
			}
		} catch (err: unknown) {
			const wtErr = err instanceof WorktreeError ? err : null;
			const bulkErr: BulkWorktreeError = {
				laneNumber: wt.laneNumber,
				code: wtErr?.code || "UNKNOWN",
				message: wtErr?.message || String(err),
			};
			const outcome: RemoveWorktreeOutcome = {
				worktree: wt,
				result: null,
				error: bulkErr,
			};
			outcomes.push(outcome);
			failed.push(outcome);
		}
	}

	return {
		totalAttempted: worktrees.length,
		removed,
		failed,
		outcomes,
		preserved,
	};
}

/**
 * Execute a command synchronously and return { ok, stdout }.
 * Returns ok=false on any error (non-zero exit, command not found, etc.).
 */
export function execCheck(command: string): { ok: boolean; stdout: string } {
	try {
		const stdout = execSync(command, {
			encoding: "utf-8",
			timeout: 10_000,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return { ok: true, stdout };
	} catch {
		return { ok: false, stdout: "" };
	}
}

/**
 * Parse a version string like "git version 2.43.0.windows.1" or "tmux 3.3a"
 * into a comparable [major, minor] tuple. Returns [0, 0] on parse failure.
 */
export function parseVersion(raw: string): [number, number] {
	const match = raw.match(/(\d+)\.(\d+)/);
	if (!match) return [0, 0];
	return [parseInt(match[1], 10), parseInt(match[2], 10)];
}

/**
 * Check if actual version meets minimum required version.
 */
export function meetsMinVersion(actual: [number, number], minimum: [number, number]): boolean {
	if (actual[0] > minimum[0]) return true;
	if (actual[0] === minimum[0] && actual[1] >= minimum[1]) return true;
	return false;
}

/**
 * Run preflight checks for all orchestrator dependencies.
 *
 * Required checks (fail blocks execution):
 *   - git version >= 2.15
 *   - git worktree support
 *   - pi availability
 *
 * Conditional checks (warn if spawn_mode is "subprocess", fail if "tmux"):
 *   - tmux version >= 2.6
 *   - tmux functional (can create/destroy sessions)
 */
export function runPreflight(config: OrchestratorConfig): PreflightResult {
	const checks: PreflightCheck[] = [];
	const tmuxRequired = config.orchestrator.spawn_mode === "tmux";

	// ── Git version ──────────────────────────────────────────────
	const gitResult = execCheck("git --version");
	if (gitResult.ok) {
		const version = parseVersion(gitResult.stdout);
		const versionStr = `${version[0]}.${version[1]}`;
		if (meetsMinVersion(version, [2, 15])) {
			checks.push({
				name: "git",
				status: "pass",
				message: `Git ${versionStr} available`,
			});
		} else {
			checks.push({
				name: "git",
				status: "fail",
				message: `Git ${versionStr} found, but 2.15+ required for worktree support`,
				hint: "Upgrade Git: https://git-scm.com/downloads",
			});
		}
	} else {
		checks.push({
			name: "git",
			status: "fail",
			message: "Git not found",
			hint: "Install Git: https://git-scm.com/downloads",
		});
	}

	// ── Git worktree support ─────────────────────────────────────
	const worktreeResult = execCheck("git worktree list");
	checks.push({
		name: "git-worktree",
		status: worktreeResult.ok ? "pass" : "fail",
		message: worktreeResult.ok
			? "Worktree support available"
			: "Git worktree not available",
		hint: worktreeResult.ok ? undefined : "Upgrade Git to 2.15+",
	});

	// ── TMUX availability and version ────────────────────────────
	const tmuxResult = execCheck("tmux -V");
	if (tmuxResult.ok) {
		const version = parseVersion(tmuxResult.stdout);
		const versionStr = `${version[0]}.${version[1]}`;
		if (meetsMinVersion(version, [2, 6])) {
			checks.push({
				name: "tmux",
				status: "pass",
				message: `TMUX ${versionStr} available`,
			});
		} else {
			checks.push({
				name: "tmux",
				status: tmuxRequired ? "fail" : "warn",
				message: `TMUX ${versionStr} found, but 2.6+ required`,
				hint: "Upgrade TMUX: https://github.com/tmux/tmux/wiki/Installing",
			});
		}
	} else {
		checks.push({
			name: "tmux",
			status: tmuxRequired ? "fail" : "warn",
			message: "TMUX not found",
			hint: tmuxRequired
				? "Install TMUX (required for tmux spawn_mode):\n" +
				  "  Linux: sudo apt install tmux\n" +
				  "  macOS: brew install tmux\n" +
				  "  Windows (MSYS2): pacman -S tmux\n" +
				  "  Or set spawn_mode: subprocess in .pi/task-orchestrator.yaml"
				: "TMUX not required for subprocess spawn_mode. Install for drill-down observability:\n" +
				  "  Linux: sudo apt install tmux | macOS: brew install tmux",
		});
	}

	// ── TMUX functional (only if tmux was found) ─────────────────
	if (tmuxResult.ok) {
		const testSession = "orch-preflight-test";
		const tmuxFunctional = execCheck(`tmux new-session -d -s ${testSession} "exit 0"`);
		if (tmuxFunctional.ok) {
			// Clean up test session
			execCheck(`tmux kill-session -t ${testSession}`);
			checks.push({
				name: "tmux-functional",
				status: "pass",
				message: "TMUX can create sessions",
			});
		} else {
			checks.push({
				name: "tmux-functional",
				status: tmuxRequired ? "fail" : "warn",
				message: "TMUX installed but cannot create sessions",
				hint: "Check TMUX server status. Try: tmux new-session -d -s test 'echo ok'",
			});
		}
	} else {
		checks.push({
			name: "tmux-functional",
			status: tmuxRequired ? "fail" : "warn",
			message: "Skipped — TMUX not installed",
		});
	}

	// ── Pi availability ──────────────────────────────────────────
	const piResult = execCheck("pi --version");
	if (piResult.ok) {
		checks.push({
			name: "pi",
			status: "pass",
			message: `Pi ${piResult.stdout || "available"}`,
		});
	} else {
		checks.push({
			name: "pi",
			status: "fail",
			message: "Pi not found",
			hint: "Install Pi: npm install -g @mariozechner/pi-coding-agent",
		});
	}

	return {
		passed: checks.every((c) => c.status !== "fail"),
		checks,
	};
}

/**
 * Format preflight results as a readable string for display.
 */
export function formatPreflightResults(result: PreflightResult): string {
	const lines: string[] = ["Preflight Check:"];

	for (const check of result.checks) {
		const icon =
			check.status === "pass" ? "✅" :
			check.status === "warn" ? "⚠️ " :
			"❌";
		const nameCol = check.name.padEnd(18);
		lines.push(`  ${icon} ${nameCol} ${check.message}`);
		if (check.hint && check.status !== "pass") {
			// Indent hint lines under the check
			for (const hintLine of check.hint.split("\n")) {
				lines.push(`      ${" ".repeat(18)} ${hintLine}`);
			}
		}
	}

	lines.push("");
	if (result.passed) {
		lines.push("All required checks passed.");
	} else {
		const failedNames = result.checks
			.filter((c) => c.status === "fail")
			.map((c) => c.name)
			.join(", ");
		lines.push(`❌ Preflight FAILED: ${failedNames}`);
		lines.push("Fix the issues above before running the orchestrator.");
	}

	return lines.join("\n");
}


// ── Worktree Reset with Safety ───────────────────────────────────────

/**
 * Reset a worktree with safety handling for dirty trees.
 *
 * For failed/stalled tasks, the worktree may have uncommitted changes.
 * This function first tries a clean reset, and if that fails due to dirty
 * tree, force-cleans it before resetting.
 *
 * @param worktree     - WorktreeInfo to reset
 * @param targetBranch - Branch to reset to (e.g., "develop")
 * @param repoRoot     - Main repository root
 * @returns { success: boolean, error?: string }
 */
export function safeResetWorktree(
	worktree: WorktreeInfo,
	targetBranch: string,
	repoRoot: string,
): { success: boolean; error?: string } {
	try {
		resetWorktree(worktree, targetBranch, repoRoot);
		return { success: true };
	} catch (err: unknown) {
		// If it's a dirty worktree, force clean and retry
		if (err instanceof WorktreeError && err.code === "WORKTREE_DIRTY") {
			execLog("reset", `lane-${worktree.laneNumber}`, "worktree dirty — force cleaning", {
				path: worktree.path,
			});

			// Force discard all changes
			const checkoutResult = runGit(["checkout", "--", "."], worktree.path);
			if (!checkoutResult.ok) {
				return {
					success: false,
					error: `git checkout -- . failed: ${checkoutResult.stderr}`,
				};
			}

			// Remove untracked files.
			// git clean may warn about files it can't delete (e.g., Windows reserved
			// names like "nul", "con", "aux") but still clean everything else.
			// We treat this as non-fatal: check porcelain status afterward instead
			// of failing on the exit code.
			const cleanResult = runGit(["clean", "-fd"], worktree.path);
			if (!cleanResult.ok) {
				execLog("reset", `lane-${worktree.laneNumber}`, "git clean -fd returned non-zero (may be partial)", {
					stderr: cleanResult.stderr.slice(0, 200),
				});
			}

			// Check if the worktree is clean enough to proceed.
			// If git status --porcelain shows no tracked changes, the reset can work
			// even if some untracked files couldn't be deleted.
			const statusCheck = runGit(["status", "--porcelain"], worktree.path);
			if (statusCheck.ok && statusCheck.stdout.length > 0) {
				// Still dirty after cleaning — check if only untracked files remain
				const lines = statusCheck.stdout.split("\n").filter(l => l.trim());
				const onlyUntracked = lines.every(l => l.startsWith("??"));
				if (!onlyUntracked) {
					return {
						success: false,
						error: `Worktree still dirty after clean: ${statusCheck.stdout.slice(0, 200)}`,
					};
				}
				// Only untracked files remain (e.g., undeletable "nul") — safe to proceed
				execLog("reset", `lane-${worktree.laneNumber}`, "untracked files remain after clean (non-blocking)", {
					files: lines.map(l => l.slice(3)).join(", "),
				});
			}

			// Retry reset after cleaning
			try {
				resetWorktree(worktree, targetBranch, repoRoot);
				return { success: true };
			} catch (retryErr: unknown) {
				return {
					success: false,
					error: `Reset failed after clean: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
				};
			}
		}

		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}


// ── Force Cleanup ────────────────────────────────────────────────────

/**
 * Last-resort worktree cleanup: force-remove the directory and prune git state.
 *
 * Used when both `safeResetWorktree()` and `removeWorktree()` fail — typically
 * because undeletable files (e.g., Windows reserved names like "nul", "con")
 * block `git clean` and `git worktree remove`, leaving git in an inconsistent state.
 *
 * Recovery steps:
 * 1. Force-remove the worktree directory (`rm -rf` equivalent)
 * 2. Prune stale git worktree references (`git worktree prune`)
 * 3. Delete the lane branch if it exists (`git branch -D`)
 *
 * This allows the next wave to recreate the worktree from scratch.
 *
 * @param worktree - WorktreeInfo for the failed worktree
 * @param repoRoot - Main repository root
 * @param batchId  - Batch ID for logging context
 */
export function forceCleanupWorktree(
	worktree: WorktreeInfo,
	repoRoot: string,
	batchId: string,
): void {
	const { path: worktreePath, branch, laneNumber } = worktree;

	// Step 1: Force-remove the directory
	if (existsSync(worktreePath)) {
		try {
			// On Windows, undeletable reserved-name files (nul, con, aux) need
			// special handling. Try rmSync first, then fall back to OS-specific
			// removal for stubborn files.
			rmSync(worktreePath, { recursive: true, force: true });
			execLog("cleanup", `lane-${laneNumber}`, `force-removed worktree directory`, { path: worktreePath });
		} catch (rmErr: unknown) {
			// If Node's rmSync fails (e.g., Windows reserved names), try platform-specific
			const rmMsg = rmErr instanceof Error ? rmErr.message : String(rmErr);
			execLog("cleanup", `lane-${laneNumber}`, `rmSync failed, trying OS-level removal`, { error: rmMsg });

			try {
				if (process.platform === "win32") {
					// rd /s /q handles Windows reserved names that Node.js cannot delete
					execSync(`rd /s /q "${worktreePath}"`, { stdio: "pipe", timeout: 30_000 });
				} else {
					execSync(`rm -rf "${worktreePath}"`, { stdio: "pipe", timeout: 30_000 });
				}
				execLog("cleanup", `lane-${laneNumber}`, `OS-level removal succeeded`, { path: worktreePath });
			} catch (osErr: unknown) {
				const osMsg = osErr instanceof Error ? osErr.message : String(osErr);
				execLog("cleanup", `lane-${laneNumber}`, `OS-level removal also failed — manual cleanup needed`, {
					path: worktreePath,
					error: osMsg,
				});
			}
		}
	}

	// Step 2: Prune stale worktree references
	runGit(["worktree", "prune"], repoRoot);
	execLog("cleanup", `lane-${laneNumber}`, `pruned stale worktree references`);

	// Step 3: Delete the lane branch if it still exists
	const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${branch}`], repoRoot);
	if (branchCheck.ok) {
		const deleteResult = runGit(["branch", "-D", branch], repoRoot);
		if (deleteResult.ok) {
			execLog("cleanup", `lane-${laneNumber}`, `deleted stale lane branch`, { branch });
		} else {
			execLog("cleanup", `lane-${laneNumber}`, `could not delete lane branch`, {
				branch,
				error: deleteResult.stderr,
			});
		}
	}
}

