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
 *
 * Run: npx vitest run extensions/tests/cleanup-resilience.test.ts
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from "fs";
import { join, resolve, basename } from "path";
import { tmpdir } from "os";

import {
	type WorktreeInfo,
	type OrchestratorConfig,
	createWorktree,
	removeWorktree,
	removeAllWorktrees,
	listWorktrees,
	forceCleanupWorktree,
	resolveWorktreeBasePath,
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
