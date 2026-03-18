/**
 * Worktree Lifecycle Tests — TS-005
 *
 * Comprehensive test suite for git worktree CRUD operations.
 * Tests run against disposable temp repos — no side effects on the main repo.
 *
 * Run: npx tsx extensions/tests/worktree-lifecycle.test.ts
 *
 * Test categories:
 *   5.1 — Unit tests for parsing & classification helpers
 *   5.2 — Integration tests for createWorktree
 *   5.3 — Integration tests for resetWorktree
 *   5.4 — Integration tests for removeWorktree
 *   5.4b — Integration tests for branch protection (removeWorktree with targetBranch)
 *   5.4c — Integration tests for preserveBranch collision handling
 *   5.4d — Integration tests for hasUnmergedCommits
 *   5.5 — Integration tests for create + remove lifecycle
 *   5.6 — Integration tests for bulk operations
 */

import { execSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve, basename } from "path";
import { tmpdir } from "os";

import {
	// Types
	type WorktreeInfo,
	type CreateWorktreeOptions,
	type ParsedWorktreeEntry,

	// Error class
	WorktreeError,

	// Git runner
	runGit,

	// Pure helpers
	generateBranchName,
	generateWorktreePath,
	parseWorktreeList,
	isRegisteredWorktree,
	escapeRegex,
	isRetriableRemoveError,

	// CRUD operations
	createWorktree,
	resetWorktree,
	removeWorktree,

	// Bulk operations
	listWorktrees,
	createLaneWorktrees,
	removeAllWorktrees,

	// Branch protection
	hasUnmergedCommits,
	preserveBranch,
} from "../task-orchestrator.ts";

const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

// ── Test Harness ─────────────────────────────────────────────────────

interface TestResult {
	name: string;
	passed: boolean;
	error?: string;
	duration: number;
}

const results: TestResult[] = [];
let currentCategory = "";

function describe(category: string, fn: () => void): void {
	currentCategory = category;
	console.log(`\n━━━ ${category} ━━━`);
	fn();
	currentCategory = "";
}

function test(name: string, fn: () => void): void {
	const start = Date.now();
	try {
		fn();
		const duration = Date.now() - start;
		results.push({ name: `${currentCategory} > ${name}`, passed: true, duration });
		console.log(`  ✅ ${name} (${duration}ms)`);
	} catch (err: unknown) {
		const duration = Date.now() - start;
		const message = err instanceof Error ? err.message : String(err);
		results.push({ name: `${currentCategory} > ${name}`, passed: false, error: message, duration });
		console.log(`  ❌ ${name} (${duration}ms)`);
		console.log(`     Error: ${message}`);
	}
}

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
	if (actual !== expected) {
		throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function assertThrows(fn: () => void, expectedCode?: string): WorktreeError {
	try {
		fn();
		throw new Error("Expected function to throw, but it did not");
	} catch (err: unknown) {
		if (err instanceof WorktreeError) {
			if (expectedCode && err.code !== expectedCode) {
				throw new Error(`Expected error code ${expectedCode}, got ${err.code}: ${err.message}`);
			}
			return err;
		}
		if (err instanceof Error && err.message === "Expected function to throw, but it did not") {
			throw err;
		}
		throw new Error(`Expected WorktreeError but got: ${err}`);
	}
}

// ── Temp Repo Management ─────────────────────────────────────────────

/**
 * Create a disposable git repo in a temp directory with:
 * - An initial commit on "main"
 * - A "develop" branch pointing to the same commit
 * Returns the absolute path to the repo root.
 */
function initTestRepo(name: string = "test-repo"): string {
	const tempBase = mkdtempSync(join(tmpdir(), `wt-test-${name}-`));
	const repoDir = join(tempBase, name);

	execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	// Create initial commit
	writeFileSync(join(repoDir, "README.md"), "# Test Repo\n");
	execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	execSync('git commit -m "initial commit"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	// Rename default branch to main if needed and create develop
	try {
		execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	} catch { /* might already be main */ }
	execSync("git branch develop", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	return repoDir;
}

/**
 * Add a commit to the given branch in the repo.
 * Returns the commit SHA.
 */
function addCommit(repoDir: string, branch: string, filename: string, content: string): string {
	// If we're not on the right branch, check it out
	const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
		cwd: repoDir, encoding: "utf-8", stdio: "pipe",
	}).trim();

	if (currentBranch !== branch) {
		execSync(`git checkout ${branch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	}

	writeFileSync(join(repoDir, filename), content);
	execSync(`git add "${filename}"`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	execSync(`git commit -m "add ${filename}"`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	const sha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();

	// Switch back to main/develop to keep worktree paths free
	if (currentBranch !== branch) {
		execSync(`git checkout ${currentBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	}

	return sha;
}

/**
 * Clean up a test repo and all its sibling worktree directories.
 */
function cleanupTestRepo(repoDir: string): void {
	const parentDir = resolve(repoDir, "..");

	// First, remove any worktrees registered with this repo
	try {
		const worktrees = execSync("git worktree list --porcelain", {
			cwd: repoDir, encoding: "utf-8", stdio: "pipe",
		});

		for (const line of worktrees.split("\n")) {
			if (line.startsWith("worktree ") && !line.includes(repoDir)) {
				const wtPath = line.slice("worktree ".length).trim();
				try {
					execSync(`git worktree remove --force "${wtPath}"`, {
						cwd: repoDir, encoding: "utf-8", stdio: "pipe",
					});
				} catch { /* ignore */ }
			}
		}
	} catch { /* repo might already be gone */ }

	// Then remove the parent temp directory
	try {
		rmSync(parentDir, { recursive: true, force: true });
	} catch { /* Windows may need a moment */ }
}

/**
 * Get the HEAD commit SHA for a branch.
 */
function getCommitSha(repoDir: string, branch: string): string {
	return execSync(`git rev-parse refs/heads/${branch}`, {
		cwd: repoDir, encoding: "utf-8", stdio: "pipe",
	}).trim();
}

// ══════════════════════════════════════════════════════════════════════
// 5.1 — Unit Tests: Parsing & Classification Helpers
// ══════════════════════════════════════════════════════════════════════

describe("5.1 generateBranchName", () => {
	test("format matches task/{opId}-lane-{N}-{batchId}", () => {
		const result = generateBranchName(1, "20260308T111750", "henrylach");
		assertEqual(result, "task/henrylach-lane-1-20260308T111750", "branch name");
	});

	test("handles multi-digit lane numbers with opId", () => {
		const result = generateBranchName(12, "batch42", "ci-runner");
		assertEqual(result, "task/ci-runner-lane-12-batch42", "branch name");
	});

	test("uses default fallback opId", () => {
		const result = generateBranchName(1, "20260308T111750", "op");
		assertEqual(result, "task/op-lane-1-20260308T111750", "branch name");
	});
});

describe("5.1 generateWorktreePath", () => {
	test("defaults to subdirectory mode (.worktrees) with opId", () => {
		const result = generateWorktreePath("myprefix", 3, "/tmp/test-repo", "henrylach");
		const expected = resolve("/tmp/test-repo", ".worktrees", "myprefix-henrylach-3");
		assertEqual(result, expected, "worktree path");
	});

	test("sibling mode places worktree adjacent to repo root with opId", () => {
		const siblingConfig = { orchestrator: { worktree_location: "sibling" as const } };
		const repoRoot = "/some/path/repo";
		const result = generateWorktreePath("pfx", 1, repoRoot, "op", siblingConfig);
		const expected = resolve(repoRoot, "..", "pfx-op-1");
		assertEqual(result, expected, "sibling worktree path");
	});
});

describe("5.1 escapeRegex", () => {
	test("escapes special regex characters", () => {
		assertEqual(escapeRegex("a.b*c+d"), "a\\.b\\*c\\+d", "escaped string");
	});

	test("leaves plain strings unchanged", () => {
		assertEqual(escapeRegex("taskplane"), "taskplane", "plain string");
	});

	test("escapes brackets and pipes", () => {
		assertEqual(escapeRegex("[test]|other"), "\\[test\\]\\|other", "brackets/pipes");
	});
});

describe("5.1 isRetriableRemoveError", () => {
	test("returns true for 'cannot lock'", () => {
		assert(isRetriableRemoveError("fatal: cannot lock ref"), "should be retriable");
	});

	test("returns true for 'permission denied'", () => {
		assert(isRetriableRemoveError("error: Permission denied"), "should be retriable");
	});

	test("returns true for 'device or resource busy'", () => {
		assert(isRetriableRemoveError("device or resource busy"), "should be retriable");
	});

	test("returns true for 'used by another process' (Windows)", () => {
		assert(isRetriableRemoveError("The process cannot access the file because it is used by another process"), "should be retriable");
	});

	test("returns true for 'directory not empty'", () => {
		assert(isRetriableRemoveError("failed to remove: directory not empty"), "should be retriable");
	});

	test("returns true for 'i/o error'", () => {
		assert(isRetriableRemoveError("I/O error on read"), "should be retriable");
	});

	test("returns false for terminal git errors", () => {
		assert(!isRetriableRemoveError("fatal: not a valid worktree"), "should NOT be retriable");
	});

	test("returns false for usage errors", () => {
		assert(!isRetriableRemoveError("usage: git worktree remove <path>"), "should NOT be retriable");
	});

	test("returns false for empty string", () => {
		assert(!isRetriableRemoveError(""), "empty string should NOT be retriable");
	});
});

describe("5.1 parseWorktreeList", () => {
	let repoDir: string;

	test("parses main worktree entry from real repo", () => {
		repoDir = initTestRepo("parse-test");
		const entries = parseWorktreeList(repoDir);
		assert(entries.length >= 1, `expected at least 1 entry, got ${entries.length}`);
		assert(entries[0].path.length > 0, "path should not be empty");
		assert(entries[0].head.length === 40, `HEAD should be 40-char SHA, got: ${entries[0].head}`);
		cleanupTestRepo(repoDir);
	});

	test("parses worktree with checked-out branch", () => {
		repoDir = initTestRepo("parse-branch");
		const entries = parseWorktreeList(repoDir);
		// The main worktree should have a branch
		const mainEntry = entries[0];
		assert(mainEntry.branch !== null, "main worktree should have a branch");
		assert(mainEntry.branch === "main", `expected branch 'main', got '${mainEntry.branch}'`);
		cleanupTestRepo(repoDir);
	});

	test("returns empty array for non-git directory", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "wt-nongit-"));
		const entries = parseWorktreeList(tempDir);
		assertEqual(entries.length, 0, "non-git should return empty");
		rmSync(tempDir, { recursive: true, force: true });
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.2 — Integration Tests: createWorktree
// ══════════════════════════════════════════════════════════════════════

describe("5.2 createWorktree — happy path", () => {
	let repoDir: string;

	test("creates worktree with correct directory, branch, and .git file", () => {
		repoDir = initTestRepo("create-happy");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "test001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Directory exists
		assert(existsSync(wt.path), `worktree dir should exist: ${wt.path}`);

		// .git is a file (not directory) — this is how worktrees work
		const dotGitPath = join(wt.path, ".git");
		assert(existsSync(dotGitPath), ".git should exist in worktree");
		const stat = statSync(dotGitPath);
		assert(stat.isFile(), ".git should be a file in a worktree, not a directory");

		// Branch exists and matches
		assertEqual(wt.branch, "task/test-lane-1-test001", "branch name");
		assertEqual(wt.laneNumber, 1, "lane number");

		// Correct branch is checked out
		const headBranch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: wt.path, encoding: "utf-8", stdio: "pipe",
		}).trim();
		assertEqual(headBranch, "task/test-lane-1-test001", "checked out branch");

		// Branch points to develop HEAD
		const wtHead = execSync("git rev-parse HEAD", { cwd: wt.path, encoding: "utf-8", stdio: "pipe" }).trim();
		const devHead = getCommitSha(repoDir, "develop");
		assertEqual(wtHead, devHead, "worktree HEAD should match develop HEAD");

		cleanupTestRepo(repoDir);
	});

	test("handles worktree paths containing spaces", () => {
		repoDir = initTestRepo("create-space-path");

		const wt = createWorktree({
			laneNumber: 2,
			batchId: "space001",
			baseBranch: "develop",
			opId: "test",
			prefix: `${basename(repoDir)} with space`,
		}, repoDir);

		assert(existsSync(wt.path), `worktree dir should exist: ${wt.path}`);
		// New batch-scoped path: {basePath}/test-space001/lane-2
		assert(wt.path.includes("test-space001"), "worktree path should include batch container");
		assert(wt.path.endsWith(`lane-2`), "worktree path should end with lane-2");

		// Verify the worktree is fully functional with spaced paths
		const headBranch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: wt.path, encoding: "utf-8", stdio: "pipe",
		}).trim();
		assertEqual(headBranch, "task/test-lane-2-space001", "checked out branch in spaced path worktree");

		const removeResult = removeWorktree(wt, repoDir);
		assertEqual(removeResult.removed, true, "spaced-path worktree should remove cleanly");

		cleanupTestRepo(repoDir);
	});
});

describe("5.2 createWorktree — error paths", () => {
	let repoDir: string;

	test("WORKTREE_INVALID_BASE for nonexistent base branch", () => {
		repoDir = initTestRepo("create-invalid-base");
		const err = assertThrows(() => {
			createWorktree({
				laneNumber: 1,
				batchId: "test002",
				baseBranch: "nonexistent-branch",
				opId: "test",
				prefix: basename(repoDir),
			}, repoDir);
		}, "WORKTREE_INVALID_BASE");
		assert(err.message.includes("nonexistent-branch"), "error should mention branch name");
		cleanupTestRepo(repoDir);
	});

	test("WORKTREE_PATH_IS_WORKTREE for existing worktree at same path", () => {
		repoDir = initTestRepo("create-collision");
		// Create first worktree — this occupies {basePath}/test-test003/lane-1
		const wt1 = createWorktree({
			laneNumber: 1,
			batchId: "test003",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Try creating at the same path by using the same opId/batchId/laneNumber
		// but a different branch trick: delete the branch first so pre-check 4
		// won't fire, leaving pre-check 2 (path collision) to trigger.
		// Actually, same params produce both same path AND same branch name, so
		// pre-check 2 fires first (path is already a registered worktree).
		const err = assertThrows(() => {
			createWorktree({
				laneNumber: 1,
				batchId: "test003",
				baseBranch: "develop",
				opId: "test",
				prefix: basename(repoDir),
			}, repoDir);
		}, "WORKTREE_PATH_IS_WORKTREE");
		assert(err.message.includes("already registered"), "error should mention registration");

		cleanupTestRepo(repoDir);
	});

	test("WORKTREE_BRANCH_EXISTS for duplicate branch name", () => {
		repoDir = initTestRepo("create-dup-branch");
		// Create first worktree
		createWorktree({
			laneNumber: 1,
			batchId: "test005",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Try creating at different lane but same batchId (different path, same branch format)
		// Actually we need same branch name. Create a branch manually that matches lane-2's pattern
		execSync("git branch task/test-lane-2-test005", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		const err = assertThrows(() => {
			createWorktree({
				laneNumber: 2,
				batchId: "test005",
				baseBranch: "develop",
				opId: "test",
				prefix: basename(repoDir),
			}, repoDir);
		}, "WORKTREE_BRANCH_EXISTS");
		assert(err.message.includes("task/test-lane-2-test005"), "error should mention branch");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.3 — Integration Tests: resetWorktree
// ══════════════════════════════════════════════════════════════════════

describe("5.3 resetWorktree — happy path", () => {
	let repoDir: string;

	test("repoints branch to target commit, preserves lane branch name", () => {
		repoDir = initTestRepo("reset-happy");

		// Create worktree based on develop
		const wt = createWorktree({
			laneNumber: 1,
			batchId: "reset001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		const developHead1 = getCommitSha(repoDir, "develop");

		// Add a new commit to develop (advance it)
		addCommit(repoDir, "develop", "new-file.txt", "new content");
		const developHead2 = getCommitSha(repoDir, "develop");

		assert(developHead1 !== developHead2, "develop should have advanced");

		// Reset worktree to new develop HEAD
		const updated = resetWorktree(wt, "develop", repoDir);

		// Branch name preserved
		assertEqual(updated.branch, "task/test-lane-1-reset001", "branch should be preserved");
		assertEqual(updated.laneNumber, 1, "lane number preserved");

		// HEAD matches new develop
		const wtHead = execSync("git rev-parse HEAD", { cwd: updated.path, encoding: "utf-8", stdio: "pipe" }).trim();
		assertEqual(wtHead, developHead2, "worktree HEAD should match new develop HEAD");

		cleanupTestRepo(repoDir);
	});

	test("idempotent: resetting to same commit succeeds", () => {
		repoDir = initTestRepo("reset-idempotent");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "reset002",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Reset to same branch (same commit)
		const updated = resetWorktree(wt, "develop", repoDir);

		assertEqual(updated.branch, wt.branch, "branch unchanged");
		const wtHead = execSync("git rev-parse HEAD", { cwd: updated.path, encoding: "utf-8", stdio: "pipe" }).trim();
		const devHead = getCommitSha(repoDir, "develop");
		assertEqual(wtHead, devHead, "HEAD still matches develop");

		cleanupTestRepo(repoDir);
	});
});

describe("5.3 resetWorktree — error paths", () => {
	let repoDir: string;

	test("WORKTREE_DIRTY for uncommitted changes", () => {
		repoDir = initTestRepo("reset-dirty");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "reset003",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Create a dirty file in worktree
		writeFileSync(join(wt.path, "dirty.txt"), "uncommitted content");

		const err = assertThrows(() => {
			resetWorktree(wt, "develop", repoDir);
		}, "WORKTREE_DIRTY");
		assert(err.message.includes("uncommitted"), "error should mention uncommitted changes");

		cleanupTestRepo(repoDir);
	});

	test("WORKTREE_INVALID_BASE for nonexistent target branch", () => {
		repoDir = initTestRepo("reset-invalid");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "reset004",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		const err = assertThrows(() => {
			resetWorktree(wt, "nonexistent-target", repoDir);
		}, "WORKTREE_INVALID_BASE");

		cleanupTestRepo(repoDir);
	});

	test("WORKTREE_NOT_FOUND for nonexistent worktree path", () => {
		repoDir = initTestRepo("reset-notfound");

		const fakeWt: WorktreeInfo = {
			path: resolve(repoDir, "..", "nonexistent-wt"),
			branch: "task/test-lane-99-fake",
			laneNumber: 99,
		};

		const err = assertThrows(() => {
			resetWorktree(fakeWt, "develop", repoDir);
		}, "WORKTREE_NOT_FOUND");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.4 — Integration Tests: removeWorktree
// ══════════════════════════════════════════════════════════════════════

describe("5.4 removeWorktree — happy path", () => {
	let repoDir: string;

	test("removes worktree directory and deletes branch", () => {
		repoDir = initTestRepo("remove-happy");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "rem001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		assert(existsSync(wt.path), "worktree should exist before removal");

		const result = removeWorktree(wt, repoDir);

		assertEqual(result.removed, true, "removed flag");
		assertEqual(result.alreadyRemoved, false, "alreadyRemoved flag");
		assertEqual(result.branchDeleted, true, "branchDeleted flag");

		// Verify path no longer exists
		assert(!existsSync(wt.path), "worktree dir should not exist after removal");

		// Verify branch no longer exists
		const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!branchCheck.ok, "branch should not exist after removal");

		// Verify not registered
		assert(!isRegisteredWorktree(wt.path, repoDir), "should not be registered after removal");

		cleanupTestRepo(repoDir);
	});
});

describe("5.4 removeWorktree — idempotent", () => {
	let repoDir: string;

	test("already-removed returns alreadyRemoved=true (path + branch both missing)", () => {
		repoDir = initTestRepo("remove-idempotent");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "rem002",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Remove once
		removeWorktree(wt, repoDir);

		// Remove again — should be idempotent
		const result2 = removeWorktree(wt, repoDir);
		assertEqual(result2.removed, false, "should not report removed on 2nd call");
		assertEqual(result2.alreadyRemoved, true, "should report alreadyRemoved on 2nd call");
		assertEqual(result2.branchDeleted, true, "branchDeleted should be true (already gone)");

		cleanupTestRepo(repoDir);
	});

	test("stale branch cleanup: path missing but branch exists", () => {
		repoDir = initTestRepo("remove-stale-branch");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "rem003",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Manually remove path but leave branch
		execSync(`git worktree remove --force "${wt.path}"`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		// Branch should still exist
		const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(branchCheck.ok, "branch should still exist after worktree remove");

		// Now call our removeWorktree — it should clean up the stale branch
		const result = removeWorktree(wt, repoDir);
		assertEqual(result.alreadyRemoved, true, "should report alreadyRemoved");
		assertEqual(result.branchDeleted, true, "should have cleaned up stale branch");

		// Verify branch is gone
		const branchCheck2 = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!branchCheck2.ok, "branch should be gone after cleanup");

		cleanupTestRepo(repoDir);
	});
});

describe("5.4 removeWorktree — unmerged branch", () => {
	let repoDir: string;

	test("force-deletes unmerged branch", () => {
		repoDir = initTestRepo("remove-unmerged");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "rem004",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Add a commit to the worktree branch (making it diverge/unmerged)
		writeFileSync(join(wt.path, "wt-only.txt"), "worktree-only content");
		execSync("git add -A", { cwd: wt.path, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "worktree-only commit"', { cwd: wt.path, encoding: "utf-8", stdio: "pipe" });

		// Remove — should still succeed with force-delete
		const result = removeWorktree(wt, repoDir);
		assertEqual(result.removed, true, "should be removed");
		assertEqual(result.branchDeleted, true, "unmerged branch should be force-deleted");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.4b — Integration Tests: Branch Protection (removeWorktree with targetBranch)
// ══════════════════════════════════════════════════════════════════════

describe("5.4b removeWorktree — branch protection with targetBranch", () => {
	let repoDir: string;

	test("preserves branch with unmerged commits when targetBranch provided", () => {
		repoDir = initTestRepo("remove-preserve");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "pres001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Add unmerged commit to worktree branch
		writeFileSync(join(wt.path, "unmerged.txt"), "unmerged content");
		execSync("git add -A", { cwd: wt.path, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "unmerged commit"', { cwd: wt.path, encoding: "utf-8", stdio: "pipe" });

		// Remove with targetBranch — should preserve
		const result = removeWorktree(wt, repoDir, "develop");

		assertEqual(result.removed, true, "worktree dir should be removed");
		assertEqual(result.branchPreserved, true, "branch should be preserved");
		assert(result.savedBranch !== undefined, "savedBranch should be set");
		assert(result.savedBranch!.startsWith("saved/"), "savedBranch should start with saved/");
		assert(result.unmergedCount! > 0, "unmergedCount should be > 0");

		// Verify saved branch exists
		const savedCheck = runGit(["rev-parse", "--verify", `refs/heads/${result.savedBranch}`], repoDir);
		assert(savedCheck.ok, "saved branch should exist in repo");

		// Verify original branch is deleted (rename semantics: create saved + delete original)
		const origCheck = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!origCheck.ok, "original branch should be deleted after preservation");

		cleanupTestRepo(repoDir);
	});

	test("deletes fully-merged branch normally when targetBranch provided", () => {
		repoDir = initTestRepo("remove-merged");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "merge001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// No extra commits on worktree branch — it's fully merged into develop

		// Remove with targetBranch — should delete normally
		const result = removeWorktree(wt, repoDir, "develop");

		assertEqual(result.removed, true, "worktree should be removed");
		assertEqual(result.branchDeleted, true, "branch should be deleted");
		assertEqual(result.branchPreserved, false, "branch should NOT be preserved");
		assertEqual(result.savedBranch, undefined, "no savedBranch needed");

		// Verify branch is gone
		const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!branchCheck.ok, "branch should not exist after removal");

		cleanupTestRepo(repoDir);
	});

	test("idempotent: second removeWorktree succeeds after preservation", () => {
		repoDir = initTestRepo("remove-idempotent-pres");

		const wt = createWorktree({
			laneNumber: 1,
			batchId: "idem001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Add unmerged commit
		writeFileSync(join(wt.path, "unmerged.txt"), "unmerged");
		execSync("git add -A", { cwd: wt.path, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "unmerged"', { cwd: wt.path, encoding: "utf-8", stdio: "pipe" });

		// First remove — preserves
		const result1 = removeWorktree(wt, repoDir, "develop");
		assertEqual(result1.removed, true, "first remove should succeed");
		assertEqual(result1.branchPreserved, true, "first remove should preserve");

		// Second remove — should be idempotent
		const result2 = removeWorktree(wt, repoDir, "develop");
		assertEqual(result2.alreadyRemoved, true, "second remove should report alreadyRemoved");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.4c — Integration Tests: preserveBranch collision & edge cases
// ══════════════════════════════════════════════════════════════════════

describe("5.4c preserveBranch — collision handling", () => {
	let repoDir: string;

	test("same SHA collision → keep-existing (no-op)", () => {
		repoDir = initTestRepo("preserve-same-sha");

		// Create a branch with a commit
		execSync("git checkout -b feature/test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		writeFileSync(join(repoDir, "feature.txt"), "feature content");
		execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "feature commit"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync("git checkout main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		// First preservation — should create saved/feature/test
		const result1 = preserveBranch("feature/test", "develop", repoDir);
		assertEqual(result1.ok, true, "first preserve should succeed");
		assertEqual(result1.action, "preserved", "first preserve should create saved branch");
		assert(result1.savedBranch !== undefined, "savedBranch should be set");

		// Second preservation of same branch at same SHA → keep-existing
		const result2 = preserveBranch("feature/test", "develop", repoDir);
		assertEqual(result2.ok, true, "second preserve should succeed");
		assertEqual(result2.action, "already-preserved", "second preserve should keep existing");

		cleanupTestRepo(repoDir);
	});

	test("different SHA collision → create-suffixed", () => {
		repoDir = initTestRepo("preserve-diff-sha");

		// Create a branch with a commit
		execSync("git checkout -b feature/test2", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		writeFileSync(join(repoDir, "feature2.txt"), "v1");
		execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "v1"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync("git checkout main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		// First preservation
		const result1 = preserveBranch("feature/test2", "develop", repoDir);
		assertEqual(result1.ok, true, "first preserve succeeds");
		assertEqual(result1.action, "preserved", "creates saved branch");

		// Add another commit to the branch (changing its SHA)
		execSync("git checkout feature/test2", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		writeFileSync(join(repoDir, "feature2.txt"), "v2");
		execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "v2"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync("git checkout main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		// Second preservation — different SHA → create-suffixed
		const result2 = preserveBranch("feature/test2", "develop", repoDir);
		assertEqual(result2.ok, true, "second preserve succeeds");
		assertEqual(result2.action, "preserved", "creates new suffixed saved branch");
		assert(result2.savedBranch !== result1.savedBranch, "suffixed name differs from original");
		assert(result2.savedBranch!.startsWith("saved/feature/test2-"), "suffixed branch has timestamp");

		cleanupTestRepo(repoDir);
	});

	test("target branch missing → returns error gracefully (no crash)", () => {
		repoDir = initTestRepo("preserve-no-target");

		// Create a branch with a commit
		execSync("git checkout -b feature/test3", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		writeFileSync(join(repoDir, "feature3.txt"), "content");
		execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "commit"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync("git checkout main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		// Preserve against non-existent target branch
		const result = preserveBranch("feature/test3", "nonexistent-target", repoDir);
		assertEqual(result.ok, false, "should report failure");
		assertEqual(result.action, "error", "action should be error");
		assertEqual(result.code, "TARGET_BRANCH_MISSING", "error code should be TARGET_BRANCH_MISSING");
		// Critical: no exception was thrown
		assert(true, "no crash — function returned gracefully");

		cleanupTestRepo(repoDir);
	});

	test("branch doesn't exist → returns no-branch", () => {
		repoDir = initTestRepo("preserve-no-branch");

		const result = preserveBranch("nonexistent-branch", "develop", repoDir);
		assertEqual(result.ok, true, "should succeed");
		assertEqual(result.action, "no-branch", "action should be no-branch");

		cleanupTestRepo(repoDir);
	});

	test("fully merged branch → returns fully-merged", () => {
		repoDir = initTestRepo("preserve-merged");

		// develop branch already exists at same commit as main

		const result = preserveBranch("develop", "main", repoDir);
		assertEqual(result.ok, true, "should succeed");
		assertEqual(result.action, "fully-merged", "action should be fully-merged");
		assertEqual(result.unmergedCount, 0, "no unmerged commits");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.4d — Integration Tests: hasUnmergedCommits
// ══════════════════════════════════════════════════════════════════════

describe("5.4d hasUnmergedCommits — integration", () => {
	let repoDir: string;

	test("returns count=0 for branch at same commit as target", () => {
		repoDir = initTestRepo("unmerged-zero");

		const result = hasUnmergedCommits("develop", "main", repoDir);
		assertEqual(result.ok, true, "check should succeed");
		assertEqual(result.count, 0, "no unmerged commits");

		cleanupTestRepo(repoDir);
	});

	test("returns count > 0 for branch with unique commits", () => {
		repoDir = initTestRepo("unmerged-positive");

		// Add a commit to develop
		execSync("git checkout develop", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		writeFileSync(join(repoDir, "dev-only.txt"), "content");
		execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync('git commit -m "dev commit"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		execSync("git checkout main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		const result = hasUnmergedCommits("develop", "main", repoDir);
		assertEqual(result.ok, true, "check should succeed");
		assertEqual(result.count, 1, "1 unmerged commit");

		cleanupTestRepo(repoDir);
	});

	test("returns BRANCH_NOT_FOUND for nonexistent branch", () => {
		repoDir = initTestRepo("unmerged-no-branch");

		const result = hasUnmergedCommits("nonexistent", "main", repoDir);
		assertEqual(result.ok, false, "check should fail");
		assertEqual(result.code, "BRANCH_NOT_FOUND", "error code");

		cleanupTestRepo(repoDir);
	});

	test("returns TARGET_BRANCH_MISSING for nonexistent target", () => {
		repoDir = initTestRepo("unmerged-no-target");

		const result = hasUnmergedCommits("develop", "nonexistent-target", repoDir);
		assertEqual(result.ok, false, "check should fail");
		assertEqual(result.code, "TARGET_BRANCH_MISSING", "error code");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.5 — Integration Tests: Full create + remove lifecycle
// ══════════════════════════════════════════════════════════════════════

describe("5.5 Full lifecycle: create → verify → remove → verify", () => {
	let repoDir: string;

	test("complete create/remove cycle leaves no artifacts", () => {
		repoDir = initTestRepo("lifecycle");

		// Create
		const wt = createWorktree({
			laneNumber: 1,
			batchId: "life001",
			baseBranch: "develop",
			opId: "test",
			prefix: basename(repoDir),
		}, repoDir);

		// Verify creation artifacts
		assert(existsSync(wt.path), "worktree dir should exist");
		assert(isRegisteredWorktree(wt.path, repoDir), "should be registered");
		const branchCheck1 = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(branchCheck1.ok, "branch should exist after creation");

		// Remove
		const result = removeWorktree(wt, repoDir);
		assertEqual(result.removed, true, "should be removed");

		// Verify all artifacts are gone
		assert(!existsSync(wt.path), "worktree dir should not exist");
		assert(!isRegisteredWorktree(wt.path, repoDir), "should not be registered");
		const branchCheck2 = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!branchCheck2.ok, "branch should not exist after removal");

		// Verify main repo unaffected
		const mainBranch = runGit(["rev-parse", "--verify", "refs/heads/main"], repoDir);
		assert(mainBranch.ok, "main branch should still exist");
		const devBranch = runGit(["rev-parse", "--verify", "refs/heads/develop"], repoDir);
		assert(devBranch.ok, "develop branch should still exist");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.6 — Integration Tests: Bulk Operations
// ══════════════════════════════════════════════════════════════════════

describe("5.6 listWorktrees — prefix filtering", () => {
	let repoDir: string;

	test("filters by prefix, returns sorted by laneNumber", () => {
		repoDir = initTestRepo("list-filter");
		const prefix = basename(repoDir);

		// Create 3 worktrees
		const wt1 = createWorktree({ laneNumber: 1, batchId: "list001", baseBranch: "develop", opId: "test", prefix }, repoDir);
		const wt2 = createWorktree({ laneNumber: 2, batchId: "list001", baseBranch: "develop", opId: "test", prefix }, repoDir);
		const wt3 = createWorktree({ laneNumber: 3, batchId: "list001", baseBranch: "develop", opId: "test", prefix }, repoDir);

		const found = listWorktrees(prefix, repoDir, "test");

		assertEqual(found.length, 3, "should find 3 worktrees");
		assertEqual(found[0].laneNumber, 1, "first should be lane 1");
		assertEqual(found[1].laneNumber, 2, "second should be lane 2");
		assertEqual(found[2].laneNumber, 3, "third should be lane 3");

		cleanupTestRepo(repoDir);
	});

	test("ignores non-orchestrator worktrees", () => {
		repoDir = initTestRepo("list-ignore");
		const prefix = basename(repoDir);

		// Create one orchestrator worktree
		createWorktree({ laneNumber: 1, batchId: "list002", baseBranch: "develop", opId: "test", prefix }, repoDir);

		// Create a non-orchestrator worktree manually (different naming)
		const otherPath = resolve(repoDir, "..", "random-worktree");
		execSync(`git worktree add -b other-branch "${otherPath}" develop`, {
			cwd: repoDir, encoding: "utf-8", stdio: "pipe",
		});

		const found = listWorktrees(prefix, repoDir, "test");
		assertEqual(found.length, 1, "should only find 1 orchestrator worktree");
		assertEqual(found[0].laneNumber, 1, "should be lane 1");

		// Cleanup non-orchestrator worktree
		execSync(`git worktree remove --force "${otherPath}"`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		cleanupTestRepo(repoDir);
	});

	test("returns empty array when no worktrees match prefix", () => {
		repoDir = initTestRepo("list-empty");

		const found = listWorktrees("nonexistent-prefix", repoDir, "test");
		assertEqual(found.length, 0, "should find 0 worktrees");

		cleanupTestRepo(repoDir);
	});
});

describe("5.6 createLaneWorktrees — bulk creation", () => {
	let repoDir: string;

	test("creates N=3 worktrees with correct naming", () => {
		repoDir = initTestRepo("bulk-create");
		const prefix = basename(repoDir);

		// Build a config with the test prefix
		const config = {
			orchestrator: {
				max_lanes: 3,
				worktree_location: "sibling" as const,
				worktree_prefix: prefix,
				batch_id_format: "timestamp" as const,
				spawn_mode: "tmux" as const,
				tmux_prefix: "orch",
				operator_id: "test",
			},
			dependencies: { source: "prompt" as const, cache: true },
			assignment: { strategy: "affinity-first" as const, size_weights: { S: 1, M: 2, L: 4 } },
			pre_warm: { auto_detect: true, commands: {}, always: [] },
			merge: { model: "", tools: "", verify: [], order: "fewest-files-first" as const },
			failure: { on_task_failure: "skip-dependents" as const, on_merge_failure: "pause" as const, stall_timeout: 30, max_worker_minutes: 30, abort_grace_period: 60 },
			monitoring: { poll_interval: 5 },
		};

		const result = createLaneWorktrees(3, "bulk001", config, repoDir, "develop");

		assertEqual(result.success, true, "should succeed");
		assertEqual(result.worktrees.length, 3, "should have 3 worktrees");
		assertEqual(result.errors.length, 0, "should have no errors");

		// Verify naming
		for (let i = 0; i < 3; i++) {
			assertEqual(result.worktrees[i].laneNumber, i + 1, `lane ${i + 1} number`);
			assertEqual(result.worktrees[i].branch, `task/test-lane-${i + 1}-bulk001`, `lane ${i + 1} branch`);
			assert(existsSync(result.worktrees[i].path), `lane ${i + 1} dir should exist`);
		}

		cleanupTestRepo(repoDir);
	});

	test("rolls back on partial failure", () => {
		repoDir = initTestRepo("bulk-rollback");
		const prefix = basename(repoDir);

		// Pre-create a branch that will conflict with lane 2
		execSync("git branch task/test-lane-2-bulkfail", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		const config = {
			orchestrator: {
				max_lanes: 3,
				worktree_location: "sibling" as const,
				worktree_prefix: prefix,
				batch_id_format: "timestamp" as const,
				spawn_mode: "tmux" as const,
				tmux_prefix: "orch",
				operator_id: "test",
			},
			dependencies: { source: "prompt" as const, cache: true },
			assignment: { strategy: "affinity-first" as const, size_weights: { S: 1, M: 2, L: 4 } },
			pre_warm: { auto_detect: true, commands: {}, always: [] },
			merge: { model: "", tools: "", verify: [], order: "fewest-files-first" as const },
			failure: { on_task_failure: "skip-dependents" as const, on_merge_failure: "pause" as const, stall_timeout: 30, max_worker_minutes: 30, abort_grace_period: 60 },
			monitoring: { poll_interval: 5 },
		};

		const result = createLaneWorktrees(3, "bulkfail", config, repoDir, "develop");

		assertEqual(result.success, false, "should fail");
		assert(result.errors.length > 0, "should have errors");
		assertEqual(result.errors[0].laneNumber, 2, "lane 2 should fail");
		assertEqual(result.errors[0].code, "WORKTREE_BRANCH_EXISTS", "error code should be WORKTREE_BRANCH_EXISTS");
		assertEqual(result.worktrees.length, 0, "no worktrees after rollback");
		assertEqual(result.rolledBack, true, "should have rolled back");

		// Verify lane 1 worktree was cleaned up
		const lane1Path = generateWorktreePath(prefix, 1, repoDir, "test");
		assert(!existsSync(lane1Path), "lane 1 dir should be cleaned up after rollback");

		cleanupTestRepo(repoDir);
	});
});

describe("5.6 removeAllWorktrees — bulk removal", () => {
	let repoDir: string;

	test("removes all matching worktrees", () => {
		repoDir = initTestRepo("bulk-remove");
		const prefix = basename(repoDir);

		// Create 3 worktrees
		createWorktree({ laneNumber: 1, batchId: "rmall001", baseBranch: "develop", opId: "test", prefix }, repoDir);
		createWorktree({ laneNumber: 2, batchId: "rmall001", baseBranch: "develop", opId: "test", prefix }, repoDir);
		createWorktree({ laneNumber: 3, batchId: "rmall001", baseBranch: "develop", opId: "test", prefix }, repoDir);

		// Verify they exist
		assertEqual(listWorktrees(prefix, repoDir, "test").length, 3, "should have 3 before removal");

		// Remove all
		const result = removeAllWorktrees(prefix, repoDir, "test");

		assertEqual(result.totalAttempted, 3, "should attempt 3");
		assertEqual(result.removed.length, 3, "should remove 3");
		assertEqual(result.failed.length, 0, "should have no failures");

		// Verify none left
		assertEqual(listWorktrees(prefix, repoDir, "test").length, 0, "should have 0 after removal");

		cleanupTestRepo(repoDir);
	});

	test("handles empty prefix match gracefully", () => {
		repoDir = initTestRepo("bulk-remove-empty");

		const result = removeAllWorktrees("nonexistent-prefix-xyz", repoDir, "test");

		assertEqual(result.totalAttempted, 0, "should attempt 0");
		assertEqual(result.removed.length, 0, "should remove 0");
		assertEqual(result.failed.length, 0, "should have no failures");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// Test Runner
// ══════════════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(60));
console.log("Test Results Summary");
console.log("═".repeat(60));

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;
const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

console.log(`\n  Total:  ${total}`);
console.log(`  Passed: ${passed} ✅`);
console.log(`  Failed: ${failed} ${failed > 0 ? "❌" : ""}`);
console.log(`  Duration: ${totalDuration}ms`);

if (failed > 0) {
	console.log("\nFailed tests:");
	for (const r of results.filter((r) => !r.passed)) {
		console.log(`  ❌ ${r.name}`);
		console.log(`     ${r.error}`);
	}
	if (isVitest) {
		throw new Error(`${failed} test(s) failed`);
	}
	process.exit(1);
} else {
	console.log("\n✅ All tests passed!");
	if (!isVitest) {
		process.exit(0);
	}
}

// Register a Vitest suite so this harness is recognized as a test file.
if (isVitest) {
	const { describe: vDescribe, it, expect } = await import("vitest");
	vDescribe("Worktree Lifecycle Harness", () => {
		it("reports zero failed assertions", () => {
			expect(failed).toBe(0);
			expect(total).toBeGreaterThan(0);
		});
	});
}
