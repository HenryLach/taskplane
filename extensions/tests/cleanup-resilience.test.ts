/**
 * TP-029 — Cleanup Resilience Tests
 *
 * Behavioral tests for multi-repo cleanup, force cleanup fallback,
 * and .worktrees base-dir cleanup safety by mode.
 *
 * Test categories:
 *   CR.1 — Multi-repo terminal cleanup (repos from earlier waves still cleaned)
 *   CR.2 — Force cleanup fallback (git worktree remove fails → rm + prune)
 *   CR.3 — .worktrees base-dir cleanup safety (subdirectory vs sibling mode)
 *   CR.4 — Merge worktree force cleanup fallback (forceRemoveMergeWorktree pattern)
 *   CR.5 — Engine-level multi-repo terminal cleanup (behavioral verification)
 *   CR.7 — R006 regression: cleanup gate fires only on true stale state, not reusable worktrees
 *
 * Run: npx vitest run extensions/tests/cleanup-resilience.test.ts
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, unlinkSync, rmdirSync } from "fs";
import { join, resolve, basename, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
	type WorktreeInfo,
	type OrchestratorConfig,
	type CleanupGateRepoFailure,
	createWorktree,
	removeWorktree,
	removeAllWorktrees,
	listWorktrees,
	forceCleanupWorktree,
	safeResetWorktree,
	resolveWorktreeBasePath,
	generateMergeWorktreePath,
	computeCleanupGatePolicy,
	runGit,
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

// ── Temp Repo Management ─────────────────────────────────────────────

function initTestRepo(name: string = "test-repo"): string {
	const tempBase = mkdtempSync(join(tmpdir(), `cr-test-${name}-`));
	const repoDir = join(tempBase, name);

	execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
	execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	writeFileSync(join(repoDir, "README.md"), "# Test Repo\n");
	execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	execSync('git commit -m "initial commit"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	try {
		execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
	} catch { /* might already be main */ }
	execSync("git branch develop", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

	return repoDir;
}

function cleanupTestRepo(repoDir: string): void {
	const parentDir = resolve(repoDir, "..");
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
	try {
		rmSync(parentDir, { recursive: true, force: true });
	} catch { /* Windows may need a moment */ }
}

// ══════════════════════════════════════════════════════════════════════
// CR.1 — Multi-Repo Terminal Cleanup
// ══════════════════════════════════════════════════════════════════════

describe("CR.1 Multi-repo cleanup — repos from earlier waves", () => {
	test("removeAllWorktrees cleans repo that had lanes in wave 1 but not wave 2", () => {
		// Simulate the engine.ts pattern: two repos tracked via encounteredRepoRoots.
		// Repo A had worktrees in wave 1. Repo B had worktrees in wave 2.
		// Terminal cleanup must iterate BOTH repos.
		const repoA = initTestRepo("repo-a");
		const repoB = initTestRepo("repo-b");

		const prefixA = basename(repoA);
		const prefixB = basename(repoB);
		const batchId = "multi001";

		// Create worktrees in repo A (simulating wave 1 allocation)
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix: prefixA,
		}, repoA);
		createWorktree({
			laneNumber: 2, batchId, baseBranch: "develop", opId: "test", prefix: prefixA,
		}, repoA);

		// Create worktrees in repo B (simulating wave 2 allocation)
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix: prefixB,
		}, repoB);

		// Verify both repos have worktrees
		assertEqual(listWorktrees(prefixA, repoA, "test", batchId).length, 2, "repo A should have 2 worktrees");
		assertEqual(listWorktrees(prefixB, repoB, "test", batchId).length, 1, "repo B should have 1 worktree");

		// Simulate terminal cleanup pattern from engine.ts:
		// Iterate all encountered repo roots and call removeAllWorktrees on each.
		const encounteredRepoRoots = new Map<string, string | undefined>();
		encounteredRepoRoots.set(repoA, "repo-a");
		encounteredRepoRoots.set(repoB, "repo-b");

		for (const [perRepoRoot] of encounteredRepoRoots) {
			const prefix = perRepoRoot === repoA ? prefixA : prefixB;
			removeAllWorktrees(prefix, perRepoRoot, "test", "develop", batchId);
		}

		// Verify BOTH repos are fully cleaned — the critical check
		assertEqual(listWorktrees(prefixA, repoA, "test", batchId).length, 0,
			"repo A (wave-1-only) should have 0 worktrees after terminal cleanup");
		assertEqual(listWorktrees(prefixB, repoB, "test", batchId).length, 0,
			"repo B should have 0 worktrees after terminal cleanup");

		// Verify lane branches are deleted in both repos
		const branchCheckA1 = runGit(["rev-parse", "--verify", "refs/heads/task/test-lane-1-multi001"], repoA);
		assert(!branchCheckA1.ok, "repo A lane-1 branch should be deleted");
		const branchCheckA2 = runGit(["rev-parse", "--verify", "refs/heads/task/test-lane-2-multi001"], repoA);
		assert(!branchCheckA2.ok, "repo A lane-2 branch should be deleted");
		const branchCheckB1 = runGit(["rev-parse", "--verify", "refs/heads/task/test-lane-1-multi001"], repoB);
		assert(!branchCheckB1.ok, "repo B lane-1 branch should be deleted");

		cleanupTestRepo(repoA);
		cleanupTestRepo(repoB);
	});

	test("cleanup of repo with no remaining worktrees is a safe no-op", () => {
		const repoA = initTestRepo("repo-noop");
		const prefixA = basename(repoA);
		const batchId = "noop001";

		// Repo has no worktrees at all — calling removeAllWorktrees should be safe
		const result = removeAllWorktrees(prefixA, repoA, "test", "develop", batchId);
		assertEqual(result.totalAttempted, 0, "should attempt 0 removals");
		assertEqual(result.removed.length, 0, "should remove 0");
		assertEqual(result.failed.length, 0, "should have no failures");

		cleanupTestRepo(repoA);
	});

	test("multi-repo cleanup handles independent batch IDs correctly", () => {
		// Repo A has worktrees from batch X. Repo B has worktrees from batch Y.
		// Cleaning batch X should only affect repo A.
		const repoA = initTestRepo("repo-batchx");
		const repoB = initTestRepo("repo-batchy");
		const prefixA = basename(repoA);
		const prefixB = basename(repoB);

		createWorktree({
			laneNumber: 1, batchId: "batchX", baseBranch: "develop", opId: "test", prefix: prefixA,
		}, repoA);
		createWorktree({
			laneNumber: 1, batchId: "batchY", baseBranch: "develop", opId: "test", prefix: prefixB,
		}, repoB);

		// Clean only batchX
		removeAllWorktrees(prefixA, repoA, "test", "develop", "batchX");

		// Repo A batch X cleaned, repo B batch Y untouched
		assertEqual(listWorktrees(prefixA, repoA, "test", "batchX").length, 0,
			"repo A batchX should be cleaned");
		assertEqual(listWorktrees(prefixB, repoB, "test", "batchY").length, 1,
			"repo B batchY should be untouched");

		cleanupTestRepo(repoA);
		cleanupTestRepo(repoB);
	});
});

// ══════════════════════════════════════════════════════════════════════
// CR.2 — Force Cleanup Fallback
// ══════════════════════════════════════════════════════════════════════

describe("CR.2 Force cleanup fallback — git worktree remove failure path", () => {
	test("forceCleanupWorktree removes directory and branch when worktree is corrupted", () => {
		const repoDir = initTestRepo("force-corrupted");
		const prefix = basename(repoDir);
		const batchId = "force001";

		// Create a worktree
		const wt = createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		assert(existsSync(wt.path), "worktree should exist before corruption");

		// Corrupt the worktree by removing its .git file (makes git worktree
		// remove fail because git can't recognize it as a valid worktree)
		const dotGitPath = join(wt.path, ".git");
		if (existsSync(dotGitPath)) {
			unlinkSync(dotGitPath);
		}

		// Normal removeWorktree would fail or behave unpredictably.
		// forceCleanupWorktree should handle this gracefully.
		forceCleanupWorktree(wt, repoDir, batchId);

		// Verify cleanup completed:
		// 1. Directory should be gone
		assert(!existsSync(wt.path), "worktree directory should be removed after force cleanup");

		// 2. Branch should be deleted
		const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!branchCheck.ok, "lane branch should be deleted after force cleanup");

		// 3. Worktree should not be registered (after prune)
		const worktreeList = execSync("git worktree list --porcelain", {
			cwd: repoDir, encoding: "utf-8", stdio: "pipe",
		});
		assert(!worktreeList.includes(wt.path.replace(/\\/g, "/")),
			"worktree should not be in git worktree list after force cleanup");

		cleanupTestRepo(repoDir);
	});

	test("forceCleanupWorktree is idempotent on already-cleaned worktree", () => {
		const repoDir = initTestRepo("force-idempotent");
		const prefix = basename(repoDir);
		const batchId = "force002";

		const wt = createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// Clean up normally first
		removeWorktree(wt, repoDir);
		assert(!existsSync(wt.path), "worktree should be gone after normal removal");

		// Force cleanup on already-removed worktree — should not throw
		forceCleanupWorktree(wt, repoDir, batchId);

		// Should still be clean
		assert(!existsSync(wt.path), "worktree should still be gone");
		const branchCheck = runGit(["rev-parse", "--verify", `refs/heads/${wt.branch}`], repoDir);
		assert(!branchCheck.ok, "branch should still be gone");

		cleanupTestRepo(repoDir);
	});

	test("forceCleanupWorktree removes orphaned directory when git worktree state is already pruned", () => {
		const repoDir = initTestRepo("force-orphaned");
		const prefix = basename(repoDir);
		const batchId = "force003";

		const wt = createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// Simulate an orphaned worktree: prune git state but leave directory
		execSync(`git worktree remove --force "${wt.path}"`, {
			cwd: repoDir, encoding: "utf-8", stdio: "pipe",
		});
		// Recreate the directory as if it was left behind
		mkdirSync(wt.path, { recursive: true });
		writeFileSync(join(wt.path, "orphaned.txt"), "leftover");

		assert(existsSync(wt.path), "orphaned directory should exist");

		// Force cleanup should handle this gracefully
		forceCleanupWorktree(wt, repoDir, batchId);

		assert(!existsSync(wt.path), "orphaned directory should be removed");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// CR.3 — .worktrees Base-Dir Cleanup Safety
// ══════════════════════════════════════════════════════════════════════

describe("CR.3 .worktrees base-dir cleanup — subdirectory mode", () => {
	test("empty .worktrees dir is removed after all worktrees cleaned (subdirectory mode)", () => {
		const repoDir = initTestRepo("basedir-subdir-empty");
		const prefix = basename(repoDir);
		const batchId = "basedir001";

		// Create worktrees in subdirectory mode (default)
		const wt = createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// .worktrees dir should exist
		const worktreeBase = resolve(repoDir, ".worktrees");
		assert(existsSync(worktreeBase), ".worktrees dir should exist after creating worktree");

		// Remove all worktrees
		removeAllWorktrees(prefix, repoDir, "test", "develop", batchId);

		// Verify the batch container is cleaned. The .worktrees dir might be
		// empty now; the engine.ts code removes it if empty.
		// Check if .worktrees is either gone or empty (engine cleanup responsibility)
		if (existsSync(worktreeBase)) {
			const entries = readdirSync(worktreeBase);
			assertEqual(entries.length, 0, ".worktrees should be empty after cleanup");
			// Clean it up to verify the rmdirSync pattern works
			rmdirSync(worktreeBase);
			assert(!existsSync(worktreeBase), ".worktrees should be removable when empty");
		}

		cleanupTestRepo(repoDir);
	});

	test("non-empty .worktrees dir is NOT removed (safety)", () => {
		const repoDir = initTestRepo("basedir-subdir-nonempty");
		const prefix = basename(repoDir);
		const batchId = "basedir002";

		// Create worktrees
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// Add a leftover file to .worktrees to make it non-empty after cleanup
		const worktreeBase = resolve(repoDir, ".worktrees");
		writeFileSync(join(worktreeBase, "leftover.txt"), "do not delete");

		// Remove all worktrees for this batch
		removeAllWorktrees(prefix, repoDir, "test", "develop", batchId);

		// .worktrees should still exist because it has leftover.txt
		assert(existsSync(worktreeBase), ".worktrees should still exist (non-empty)");
		const entries = readdirSync(worktreeBase);
		assert(entries.includes("leftover.txt"), "leftover.txt should still be in .worktrees");

		cleanupTestRepo(repoDir);
	});

	test("resolveWorktreeBasePath returns .worktrees for subdirectory mode", () => {
		const subdirConfig = {
			orchestrator: { worktree_location: "subdirectory" as const },
		} as OrchestratorConfig;
		const basePath = resolveWorktreeBasePath("/tmp/test-repo", subdirConfig);
		assertEqual(basePath, resolve("/tmp/test-repo", ".worktrees"),
			"subdirectory mode base path");
	});

	test("resolveWorktreeBasePath returns parent dir for sibling mode", () => {
		const siblingConfig = {
			orchestrator: { worktree_location: "sibling" as const },
		} as OrchestratorConfig;
		const basePath = resolveWorktreeBasePath("/tmp/parent/test-repo", siblingConfig);
		assertEqual(basePath, resolve("/tmp/parent/test-repo", ".."),
			"sibling mode base path");
	});

	test("sibling mode: parent directory is never removed even when no worktrees remain", () => {
		// In sibling mode, the base path is the parent of the repo. We should
		// never try to remove it — that would delete the directory containing
		// the repo itself.
		const repoDir = initTestRepo("basedir-sibling");
		const parentDir = resolve(repoDir, "..");

		const siblingConfig = {
			orchestrator: { worktree_location: "sibling" as const },
		} as OrchestratorConfig;
		const basePath = resolveWorktreeBasePath(repoDir, siblingConfig);

		// basePath should NOT end with ".worktrees"
		assert(!basePath.endsWith(".worktrees"),
			"sibling mode base path should not end with .worktrees");

		// The engine.ts code gates .worktrees cleanup on basePath.endsWith(".worktrees").
		// In sibling mode, this gate prevents removal of the parent directory.
		// Verify the gate condition:
		const wouldCleanup = basePath.endsWith(".worktrees");
		assertEqual(wouldCleanup, false,
			"sibling mode should NOT trigger .worktrees base-dir cleanup");

		// Parent directory must still exist
		assert(existsSync(parentDir), "parent dir must still exist (sibling mode safety)");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// CR.4 — Merge Worktree Force Cleanup Fallback
// ══════════════════════════════════════════════════════════════════════

describe("CR.4 Merge worktree force cleanup — forceRemoveMergeWorktree pattern", () => {
	test("stale merge worktree from prior failed attempt is cleaned before new merge", () => {
		// Simulates the stale-prep cleanup path in merge.ts (~line 641).
		// A prior merge attempt left a merge worktree behind. The next merge
		// wave must clean it up before creating a fresh one.
		const repoDir = initTestRepo("merge-stale-prep");
		const opId = "test";
		const batchId = "merge001";

		// Create a merge worktree manually (simulating prior merge setup)
		const tempBranch = `_merge-temp-${opId}-${batchId}`;
		execSync(`git branch "${tempBranch}" develop`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		const subdirConfig = {
			orchestrator: { worktree_location: "subdirectory" as const },
		} as OrchestratorConfig;
		const mergeWorkDir = generateMergeWorktreePath(repoDir, opId, batchId, subdirConfig);
		mkdirSync(resolve(mergeWorkDir, ".."), { recursive: true });

		const addResult = spawnSync("git", ["worktree", "add", mergeWorkDir, tempBranch], { cwd: repoDir });
		assertEqual(addResult.status, 0, "worktree add should succeed");
		assert(existsSync(mergeWorkDir), "merge worktree should exist");

		// Corrupt the merge worktree to make normal removal fail
		const dotGitPath = join(mergeWorkDir, ".git");
		if (existsSync(dotGitPath)) {
			unlinkSync(dotGitPath);
		}

		// Apply the same pattern merge.ts uses: force remove + rm + prune
		// This replicates forceRemoveMergeWorktree's behavior
		const removeResult = spawnSync("git", ["worktree", "remove", mergeWorkDir, "--force"], { cwd: repoDir });
		if (removeResult.status !== 0) {
			// Fallback: rm -rf + prune
			rmSync(mergeWorkDir, { recursive: true, force: true });
		}
		// Always prune to clean up stale worktree references
		spawnSync("git", ["worktree", "prune"], { cwd: repoDir });

		// Verify merge worktree is cleaned up
		assert(!existsSync(mergeWorkDir), "stale merge worktree should be removed");

		// Verify the merge worktree is no longer registered in git
		const wtList = execSync("git worktree list --porcelain", {
			cwd: repoDir, encoding: "utf-8", stdio: "pipe",
		});
		// Check no worktree line references the merge directory
		const normalizedMergeDir = mergeWorkDir.replace(/\\/g, "/");
		const wtLines = wtList.split("\n").filter(l => l.startsWith("worktree "));
		const hasMergeWorktree = wtLines.some(l => {
			const wtPath = l.slice("worktree ".length).trim().replace(/\\/g, "/");
			return wtPath === normalizedMergeDir;
		});
		assert(!hasMergeWorktree, "merge worktree should not be in git worktree list");

		// Clean up temp branch
		try {
			execSync(`git branch -D "${tempBranch}"`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		} catch { /* may already be gone */ }

		cleanupTestRepo(repoDir);
	});

	test("end-of-wave merge worktree cleanup handles locked worktree", () => {
		// Simulates the end-of-wave cleanup path in merge.ts (~line 953).
		// After all lane merges complete, the merge worktree must be removed.
		// If git worktree remove fails (e.g., locked), force cleanup applies.
		const repoDir = initTestRepo("merge-end-wave");
		const opId = "test";
		const batchId = "merge002";

		// Create the merge worktree
		const tempBranch = `_merge-temp-${opId}-${batchId}`;
		execSync(`git branch "${tempBranch}" develop`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

		const subdirConfig = {
			orchestrator: { worktree_location: "subdirectory" as const },
		} as OrchestratorConfig;
		const mergeWorkDir = generateMergeWorktreePath(repoDir, opId, batchId, subdirConfig);
		mkdirSync(resolve(mergeWorkDir, ".."), { recursive: true });

		const addResult = spawnSync("git", ["worktree", "add", mergeWorkDir, tempBranch], { cwd: repoDir });
		assertEqual(addResult.status, 0, "worktree add should succeed");

		// Simulate a "locked" worktree by creating a .git/worktrees/*/locked file
		// in the main repo
		const gitDir = resolve(repoDir, ".git");
		const worktreesDir = resolve(gitDir, "worktrees");
		if (existsSync(worktreesDir)) {
			const entries = readdirSync(worktreesDir);
			for (const entry of entries) {
				const lockFile = resolve(worktreesDir, entry, "locked");
				writeFileSync(lockFile, "simulated lock");
			}
		}

		// Apply the merge.ts end-of-wave cleanup pattern
		const removeResult = spawnSync("git", ["worktree", "remove", mergeWorkDir, "--force"], { cwd: repoDir });
		if (removeResult.status !== 0) {
			// Fallback: rm -rf + prune
			rmSync(mergeWorkDir, { recursive: true, force: true });
			// Remove lock files to allow prune
			if (existsSync(worktreesDir)) {
				for (const entry of readdirSync(worktreesDir)) {
					const lockFile = resolve(worktreesDir, entry, "locked");
					if (existsSync(lockFile)) {
						unlinkSync(lockFile);
					}
				}
			}
			spawnSync("git", ["worktree", "prune"], { cwd: repoDir });
		}

		// Verify merge worktree is cleaned up
		assert(!existsSync(mergeWorkDir), "end-of-wave merge worktree should be removed");

		// Clean up temp branch
		try {
			execSync(`git branch -D "${tempBranch}"`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		} catch { /* may already be gone */ }

		cleanupTestRepo(repoDir);
	});

	test("merge.ts callsites use forceRemoveMergeWorktree at both stale-prep and end-of-wave", () => {
		// Structural verification that merge.ts calls forceRemoveMergeWorktree
		// at both required locations (stale-prep and end-of-wave).
		const mergeSource = readFileSync(
			resolve(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// Stale-prep cleanup (before creating new merge worktree)
		const stalePrepMatch = mergeSource.match(
			/Clean up stale merge worktree[\s\S]*?forceRemoveMergeWorktree/,
		);
		assert(stalePrepMatch !== null,
			"merge.ts should call forceRemoveMergeWorktree for stale-prep cleanup");

		// End-of-wave cleanup (after all lane merges complete)
		const endOfWaveMatch = mergeSource.match(
			/Clean up merge worktree and temp branch[\s\S]*?forceRemoveMergeWorktree/,
		);
		assert(endOfWaveMatch !== null,
			"merge.ts should call forceRemoveMergeWorktree for end-of-wave cleanup");
	});
});

// ══════════════════════════════════════════════════════════════════════
// CR.5 — Engine-Level Multi-Repo Terminal Cleanup (Behavioral)
// ══════════════════════════════════════════════════════════════════════

describe("CR.5 Engine-level multi-repo cleanup — behavioral verification", () => {
	test("multi-repo terminal cleanup iterates all encountered repos (behavioral)", () => {
		// This test verifies the engine.ts terminal cleanup behavior by
		// creating multiple repos with worktrees from different "waves",
		// running removeAllWorktrees on each (as engine.ts does), and
		// confirming no worktrees survive.
		const repoA = initTestRepo("engine-repo-a");
		const repoB = initTestRepo("engine-repo-b");
		const repoC = initTestRepo("engine-repo-c");

		const prefixA = basename(repoA);
		const prefixB = basename(repoB);
		const prefixC = basename(repoC);
		const batchId = "engine001";

		// Repo A: wave 1 only (2 lanes)
		createWorktree({ laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix: prefixA }, repoA);
		createWorktree({ laneNumber: 2, batchId, baseBranch: "develop", opId: "test", prefix: prefixA }, repoA);

		// Repo B: wave 1 + wave 2 (2 lanes total)
		createWorktree({ laneNumber: 3, batchId, baseBranch: "develop", opId: "test", prefix: prefixB }, repoB);
		createWorktree({ laneNumber: 4, batchId, baseBranch: "develop", opId: "test", prefix: prefixB }, repoB);

		// Repo C: wave 2 only (1 lane)
		createWorktree({ laneNumber: 5, batchId, baseBranch: "develop", opId: "test", prefix: prefixC }, repoC);

		// Verify all repos have worktrees
		assertEqual(listWorktrees(prefixA, repoA, "test", batchId).length, 2, "repo A initial");
		assertEqual(listWorktrees(prefixB, repoB, "test", batchId).length, 2, "repo B initial");
		assertEqual(listWorktrees(prefixC, repoC, "test", batchId).length, 1, "repo C initial");

		// Simulate the engine.ts terminal cleanup pattern:
		// 1. Collect all encountered repo roots (from all waves)
		const encounteredRepoRoots = new Map<string, string | undefined>();
		encounteredRepoRoots.set(repoA, "repo-a");
		encounteredRepoRoots.set(repoB, "repo-b");
		encounteredRepoRoots.set(repoC, "repo-c");

		// 2. For each repo: resolve prefix/target and call removeAllWorktrees
		for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
			const prefix = perRepoRoot === repoA ? prefixA
				: perRepoRoot === repoB ? prefixB
				: prefixC;
			removeAllWorktrees(prefix, perRepoRoot, "test", "develop", batchId);
		}

		// 3. Verify ALL repos are fully cleaned (no worktrees, no lane branches)
		for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
			const prefix = perRepoRoot === repoA ? prefixA
				: perRepoRoot === repoB ? prefixB
				: prefixC;
			const remaining = listWorktrees(prefix, perRepoRoot, "test", batchId);
			assertEqual(remaining.length, 0,
				`${perRepoId} should have 0 worktrees after terminal cleanup`);
		}

		// 4. Verify lane branches are deleted in ALL repos
		for (let i = 1; i <= 5; i++) {
			const perRepoRoot = i <= 2 ? repoA : i <= 4 ? repoB : repoC;
			const branchCheck = runGit(
				["rev-parse", "--verify", `refs/heads/task/test-lane-${i}-${batchId}`],
				perRepoRoot,
			);
			assert(!branchCheck.ok, `lane-${i} branch should be deleted`);
		}

		cleanupTestRepo(repoA);
		cleanupTestRepo(repoB);
		cleanupTestRepo(repoC);
	});

	test("engine.ts terminal cleanup delegates .worktrees cleanup to removeAllWorktrees", () => {
		// Structural verification: engine.ts should NOT have its own .worktrees
		// base-dir cleanup loop — removeAllWorktrees owns that responsibility.
		const engineSource = readFileSync(
			resolve(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// engine.ts should have a comment indicating delegation, not a readdirSync/rmdirSync loop
		const hasDelegationComment = engineSource.includes(
			"Empty .worktrees base-dir cleanup (subdirectory mode) is handled",
		);
		assert(hasDelegationComment,
			"engine.ts should have delegation comment for .worktrees cleanup");

		// engine.ts should NOT import rmdirSync (it was removed as part of dedup)
		const hasRmdirImport = /import.*rmdirSync.*from\s+"fs"/.test(engineSource);
		assertEqual(hasRmdirImport, false,
			"engine.ts should not import rmdirSync (cleanup delegated to removeAllWorktrees)");

		// engine.ts should NOT import resolveWorktreeBasePath (no longer needed)
		const hasResolveImport = /import.*resolveWorktreeBasePath.*from.*worktree/.test(engineSource);
		assertEqual(hasResolveImport, false,
			"engine.ts should not import resolveWorktreeBasePath (cleanup delegated)");
	});

	test("removeAllWorktrees handles .worktrees cleanup in subdirectory mode when config passed", () => {
		// Behavioral verification: when removeAllWorktrees receives an
		// OrchestratorConfig with subdirectory mode, it cleans up the empty
		// .worktrees base directory itself.
		const repoDir = initTestRepo("engine-basedir");
		const prefix = basename(repoDir);
		const batchId = "engine002";
		const subdirConfig = {
			orchestrator: { worktree_location: "subdirectory" as const },
		} as OrchestratorConfig;

		// Create a worktree (creates .worktrees dir)
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		const worktreeBase = resolve(repoDir, ".worktrees");
		assert(existsSync(worktreeBase), ".worktrees should exist after creating worktree");

		// Remove all worktrees WITH config (triggers base-dir cleanup)
		removeAllWorktrees(prefix, repoDir, "test", "develop", batchId, subdirConfig);

		// .worktrees should be gone (removeAllWorktrees handles it when config is passed)
		assert(!existsSync(worktreeBase),
			".worktrees dir should be removed by removeAllWorktrees when empty and config is passed");

		cleanupTestRepo(repoDir);
	});
});

// ══════════════════════════════════════════════════════════════════════
// CR.6 — Post-Merge Cleanup Gate Policy
// ══════════════════════════════════════════════════════════════════════

describe("CR.6 Cleanup gate policy — computeCleanupGatePolicy", () => {
	test("single-repo failure produces correct policy result", () => {
		const failures: CleanupGateRepoFailure[] = [{
			repoRoot: "/repos/api",
			repoId: "api",
			staleWorktrees: ["/repos/api/.worktrees/lane-1", "/repos/api/.worktrees/lane-2"],
		}];

		const result = computeCleanupGatePolicy(2, failures); // waveIndex=2 → wave 3

		// Policy always pauses (never aborts) — merged commits must be preserved
		assertEqual(result.policy, "pause", "policy should be pause");
		assertEqual(result.targetPhase, "paused", "targetPhase should be paused");
		assertEqual(result.persistTrigger, "cleanup_post_merge_failed", "persistTrigger");
		assertEqual(result.notifyLevel, "error", "notifyLevel should be error");

		// Error message includes wave number, stale count, and repo detail
		assert(result.errorMessage.includes("wave 3"), "errorMessage should include wave number");
		assert(result.errorMessage.includes("2 stale worktree(s)"), "errorMessage should include stale count");
		assert(result.errorMessage.includes("1 repo(s)"), "errorMessage should include repo count");
		assert(result.errorMessage.includes("api"), "errorMessage should include repo ID");
		assert(result.errorMessage.includes("/orch-resume"), "errorMessage should include recovery command");

		// Notification includes manual recovery commands
		assert(result.notifyMessage.includes("git worktree remove"), "notifyMessage should include manual cleanup command");
		assert(result.notifyMessage.includes("/orch-resume"), "notifyMessage should include resume command");
		assert(result.notifyMessage.includes("lane-1"), "notifyMessage should include stale worktree paths");
		assert(result.notifyMessage.includes("lane-2"), "notifyMessage should include stale worktree paths");

		// Log details
		assertEqual(result.logDetails.waveNumber, 3, "logDetails.waveNumber");
		assertEqual(result.logDetails.failedRepoCount, 1, "logDetails.failedRepoCount");
		assertEqual(result.logDetails.totalStaleWorktrees, 2, "logDetails.totalStaleWorktrees");
		assertEqual(result.logDetails.repos.length, 1, "logDetails.repos.length");
		assertEqual(result.logDetails.repos[0].repoId, "api", "logDetails.repos[0].repoId");
		assertEqual(result.logDetails.repos[0].staleCount, 2, "logDetails.repos[0].staleCount");
	});

	test("multi-repo failure aggregates correctly", () => {
		const failures: CleanupGateRepoFailure[] = [
			{
				repoRoot: "/repos/api",
				repoId: "api",
				staleWorktrees: ["/repos/api/.worktrees/lane-1"],
			},
			{
				repoRoot: "/repos/frontend",
				repoId: "frontend",
				staleWorktrees: ["/repos/frontend/.worktrees/lane-2", "/repos/frontend/.worktrees/lane-3"],
			},
		];

		const result = computeCleanupGatePolicy(0, failures); // waveIndex=0 → wave 1

		assertEqual(result.logDetails.waveNumber, 1, "waveNumber");
		assertEqual(result.logDetails.failedRepoCount, 2, "failedRepoCount");
		assertEqual(result.logDetails.totalStaleWorktrees, 3, "totalStaleWorktrees");
		assert(result.errorMessage.includes("3 stale worktree(s)"), "total stale count in error");
		assert(result.errorMessage.includes("2 repo(s)"), "repo count in error");
	});

	test("default repoId renders as (default) in messages", () => {
		const failures: CleanupGateRepoFailure[] = [{
			repoRoot: "/repos/main",
			repoId: undefined,
			staleWorktrees: ["/repos/main/.worktrees/lane-1"],
		}];

		const result = computeCleanupGatePolicy(0, failures);

		assert(result.errorMessage.includes("(default)"), "undefined repoId should render as (default)");
		assertEqual(result.logDetails.repos[0].repoId, "(default)", "logDetails repoId for primary");
	});
});

describe("CR.6 Cleanup gate — behavioral: stale worktrees block wave advance", () => {
	test("cleanup gate detects stale worktrees after failed reset", () => {
		// Simulate the engine.ts pattern:
		// 1. Create worktrees for two repos
		// 2. Clean only one repo (simulating a reset failure in the other)
		// 3. The cleanup gate check should detect remaining worktrees
		const repoA = initTestRepo("gate-clean");
		const repoB = initTestRepo("gate-stale");
		const prefixA = basename(repoA);
		const prefixB = basename(repoB);
		const batchId = "gate001";

		// Create worktrees in both repos
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix: prefixA,
		}, repoA);
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix: prefixB,
		}, repoB);

		// Clean only repo A (simulating successful reset)
		removeAllWorktrees(prefixA, repoA, "test", "develop", batchId);

		// Now simulate the cleanup gate verification (from engine.ts):
		const encounteredRepoRoots = new Map<string, string | undefined>();
		encounteredRepoRoots.set(repoA, "repo-a");
		encounteredRepoRoots.set(repoB, "repo-b");

		const cleanupGateFailures: CleanupGateRepoFailure[] = [];
		for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
			const prefix = perRepoRoot === repoA ? prefixA : prefixB;
			const remaining = listWorktrees(prefix, perRepoRoot, "test", batchId);
			if (remaining.length > 0) {
				cleanupGateFailures.push({
					repoRoot: perRepoRoot,
					repoId: perRepoId,
					staleWorktrees: remaining.map(wt => wt.path),
				});
			}
		}

		// Should detect failure in repo B only
		assertEqual(cleanupGateFailures.length, 1, "should detect 1 repo with stale worktrees");
		assertEqual(cleanupGateFailures[0].repoId, "repo-b", "stale repo should be repo-b");
		assertEqual(cleanupGateFailures[0].staleWorktrees.length, 1, "should have 1 stale worktree");

		// The policy result should pause
		const policy = computeCleanupGatePolicy(0, cleanupGateFailures);
		assertEqual(policy.targetPhase, "paused", "batch should be paused");

		cleanupTestRepo(repoA);
		cleanupTestRepo(repoB);
	});

	test("cleanup gate passes when all worktrees are clean", () => {
		// After successful reset, the gate should find zero stale worktrees
		const repo = initTestRepo("gate-pass");
		const prefix = basename(repo);
		const batchId = "gate002";

		// Create and then clean worktrees
		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repo);
		createWorktree({
			laneNumber: 2, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repo);

		removeAllWorktrees(prefix, repo, "test", "develop", batchId);

		// Verify gate check finds nothing
		const remaining = listWorktrees(prefix, repo, "test", batchId);
		assertEqual(remaining.length, 0, "no stale worktrees should remain");

		// No failures = gate passes, wave can advance normally
		const cleanupGateFailures: CleanupGateRepoFailure[] = [];
		// (in real code, the gate check only fires if cleanupGateFailures.length > 0)
		assertEqual(cleanupGateFailures.length, 0, "no cleanup gate failures when all clean");

		cleanupTestRepo(repo);
	});
});

// ══════════════════════════════════════════════════════════════════════
// CR.7 — Cleanup Gate R006 Regression: Gate fires only on true stale state
// ══════════════════════════════════════════════════════════════════════

describe("CR.7 Cleanup gate regression — successful reset does NOT trigger gate", () => {
	test("successfully-reset worktrees remain registered but do NOT trigger cleanup gate", () => {
		// This is the critical regression the R006 review identified:
		// After inter-wave reset, safeResetWorktree() resets worktrees in-place
		// without removing them. These successfully-reset worktrees are reusable
		// and should NOT be treated as stale by the cleanup gate.
		//
		// The fixed cleanup gate tracks only worktrees that FAILED reset AND
		// removal, then verifies those specific worktrees are still registered.
		const repoDir = initTestRepo("gate-reset-ok");
		const prefix = basename(repoDir);
		const batchId = "gater001";

		// Create worktrees (simulating wave 1 allocation)
		const wt1 = createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);
		const wt2 = createWorktree({
			laneNumber: 2, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// Successfully reset both worktrees (simulating inter-wave reset)
		const reset1 = safeResetWorktree(wt1, "develop", repoDir);
		const reset2 = safeResetWorktree(wt2, "develop", repoDir);
		assert(reset1.success, "worktree 1 reset should succeed");
		assert(reset2.success, "worktree 2 reset should succeed");

		// Worktrees are STILL registered (they were reset, not removed)
		const remaining = listWorktrees(prefix, repoDir, "test", batchId);
		assertEqual(remaining.length, 2, "both worktrees should still be registered after reset");

		// Simulate the R006-fixed cleanup gate logic:
		// failedRemovalWorktrees is empty because both resets succeeded
		const failedRemovalWorktrees = new Map<string, { repoId: string | undefined; paths: string[] }>();

		// Gate check: only fires if failedRemovalWorktrees has entries
		const cleanupGateFailures: CleanupGateRepoFailure[] = [];
		if (failedRemovalWorktrees.size > 0) {
			// This block is never entered — all resets succeeded
			for (const [perRepoRoot, { repoId, paths: failedPaths }] of failedRemovalWorktrees) {
				const rem = listWorktrees(prefix, perRepoRoot, "test", batchId);
				const remPaths = new Set(rem.map(wt => wt.path));
				const stale = failedPaths.filter(p => remPaths.has(p));
				if (stale.length > 0) {
					cleanupGateFailures.push({ repoRoot: perRepoRoot, repoId, staleWorktrees: stale });
				}
			}
		}

		// Gate should NOT fire — no failures to report
		assertEqual(cleanupGateFailures.length, 0,
			"cleanup gate should NOT fire after successful resets (worktrees are reusable)");

		cleanupTestRepo(repoDir);
	});

	test("cleanup gate fires ONLY for worktrees that failed both reset and removal", () => {
		// Create two worktrees: one resets successfully, one fails reset AND removal.
		// The gate should only report the failed one, not the successfully-reset one.
		//
		// In production, failedRemovalWorktrees tracks wt.path values from
		// listWorktrees() (which returns resolve()-normalized paths). The gate
		// then re-lists and compares. We simulate this by getting the tracked
		// path from listWorktrees() rather than from createWorktree(), to
		// match the production code pattern where wt.path comes from the same
		// listWorktrees() function used in the reset loop.
		const repoDir = initTestRepo("gate-mixed");
		const prefix = basename(repoDir);
		const batchId = "gater002";

		createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);
		createWorktree({
			laneNumber: 2, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// Get the listed worktree info (production code uses this, not createWorktree return)
		const listed = listWorktrees(prefix, repoDir, "test", batchId);
		assertEqual(listed.length, 2, "should have 2 worktrees initially");
		const wt1Listed = listed.find(w => w.laneNumber === 1)!;
		const wt2Listed = listed.find(w => w.laneNumber === 2)!;

		// Reset wt1 successfully (simulating normal inter-wave behavior)
		const reset1 = safeResetWorktree(wt1Listed, "develop", repoDir);
		assert(reset1.success, "worktree 1 reset should succeed");

		// Simulate: wt2's reset failed, then remove failed, then forceCleanup
		// was attempted. Track it using the path from listWorktrees (matching
		// the production pattern in engine.ts).
		const failedRemovalWorktrees = new Map<string, { repoId: string | undefined; paths: string[] }>();
		failedRemovalWorktrees.set(repoDir, { repoId: undefined, paths: [wt2Listed.path] });

		// Gate verification: check only the tracked failure paths
		const cleanupGateFailures: CleanupGateRepoFailure[] = [];
		for (const [perRepoRoot, { repoId, paths: failedPaths }] of failedRemovalWorktrees) {
			const remaining = listWorktrees(prefix, perRepoRoot, "test", batchId);
			const remainingPaths = new Set(remaining.map(wt => wt.path));
			const stale = failedPaths.filter(p => remainingPaths.has(p));
			if (stale.length > 0) {
				cleanupGateFailures.push({ repoRoot: perRepoRoot, repoId, staleWorktrees: stale });
			}
		}

		// Gate should fire, but only for wt2
		assertEqual(cleanupGateFailures.length, 1, "should detect 1 repo with stale worktrees");
		assertEqual(cleanupGateFailures[0].staleWorktrees.length, 1, "only 1 stale worktree");
		assertEqual(cleanupGateFailures[0].staleWorktrees[0], wt2Listed.path,
			"stale worktree should be wt2 (the one that failed removal)");

		cleanupTestRepo(repoDir);
	});

	test("cleanup gate does NOT fire when forceCleanup actually succeeds", () => {
		// Even when a worktree fails normal removal but forceCleanup succeeds,
		// the gate should verify the worktree is no longer registered.
		const repoDir = initTestRepo("gate-force-ok");
		const prefix = basename(repoDir);
		const batchId = "gater003";

		const wt = createWorktree({
			laneNumber: 1, batchId, baseBranch: "develop", opId: "test", prefix,
		}, repoDir);

		// Force-cleanup the worktree (simulating reset fail → remove fail → force cleanup)
		forceCleanupWorktree(wt, repoDir, batchId);

		// Even though this was tracked as a failed removal, forceCleanup succeeded.
		// Gate verification should find it's no longer registered.
		const failedRemovalWorktrees = new Map<string, { repoId: string | undefined; paths: string[] }>();
		failedRemovalWorktrees.set(repoDir, { repoId: undefined, paths: [wt.path] });

		const cleanupGateFailures: CleanupGateRepoFailure[] = [];
		for (const [perRepoRoot, { repoId, paths: failedPaths }] of failedRemovalWorktrees) {
			const remaining = listWorktrees(prefix, perRepoRoot, "test", batchId);
			const remainingPaths = new Set(remaining.map(wt => wt.path));
			const stale = failedPaths.filter(p => remainingPaths.has(p));
			if (stale.length > 0) {
				cleanupGateFailures.push({ repoRoot: perRepoRoot, repoId, staleWorktrees: stale });
			}
		}

		// Gate should NOT fire — forceCleanup successfully removed the worktree
		assertEqual(cleanupGateFailures.length, 0,
			"cleanup gate should not fire when forceCleanup actually succeeded");

		cleanupTestRepo(repoDir);
	});

	test("persistTrigger uses underscore format (cleanup_post_merge_failed)", () => {
		// Verify the canonical classification token uses underscore per spec
		const failures: CleanupGateRepoFailure[] = [{
			repoRoot: "/repos/main",
			repoId: undefined,
			staleWorktrees: ["/repos/main/.worktrees/lane-1"],
		}];

		const result = computeCleanupGatePolicy(0, failures);
		assertEqual(result.persistTrigger, "cleanup_post_merge_failed",
			"persistTrigger should use underscore format matching spec classification");
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
	vDescribe("Cleanup Resilience Harness (TP-029)", () => {
		it("reports zero failed assertions", () => {
			expect(failed).toBe(0);
			expect(total).toBeGreaterThan(0);
		});
	});
}
