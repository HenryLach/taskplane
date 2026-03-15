/**
 * Execution Path Resolution Tests — TP-003 Step 2
 *
 * Regression coverage for resolveCanonicalTaskPaths and resolveTaskDonePath.
 * Tests both monorepo (task folder inside repo root) and polyrepo/workspace
 * (task folder outside repo root) path resolution, including archive fallback.
 *
 * Uses real temp directory fixtures (no mocking of existsSync).
 *
 * Run: npx tsx extensions/tests/execution-path-resolution.test.ts
 *   or: npx vitest run extensions/tests/execution-path-resolution.test.ts
 *
 * Test categories:
 *   1 — resolveCanonicalTaskPaths: monorepo (task folder inside repo root)
 *   2 — resolveCanonicalTaskPaths: external (task folder outside repo root)
 *   3 — resolveCanonicalTaskPaths: archive fallback
 *   4 — resolveTaskDonePath: delegation correctness
 *   5 — Edge cases (trailing slashes, backslashes, boundary paths)
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

import {
	resolveCanonicalTaskPaths,
	resolveTaskDonePath,
} from "../task-orchestrator.ts";

const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

// ── Test Helpers ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  ✗ ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  ✗ ${msg}`);
	}
}

/** Normalize path for comparison (resolve + forward slashes). */
function norm(p: string): string {
	return resolve(p).replace(/\\/g, "/");
}

// ── Fixture Setup / Teardown ─────────────────────────────────────────

let fixtureRoot: string;

function setupFixtures(): void {
	fixtureRoot = mkdtempSync(join(tmpdir(), "tp003-path-resolution-"));
}

function teardownFixtures(): void {
	if (fixtureRoot) {
		rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

// ═══════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════

function runAllTests(): void {
	setupFixtures();
	try {
		runMonorepoTests();
		runExternalTests();
		runArchiveFallbackTests();
		runDelegationTests();
		runEdgeCaseTests();
	} finally {
		teardownFixtures();
	}

	// ── Summary ──────────────────────────────────────────────────────
	console.log("\n══════════════════════════════════════");
	console.log(`  Results: ${passed} passed, ${failed} failed`);
	if (failures.length > 0) {
		console.log("\n  Failed:");
		for (const f of failures) {
			console.log(`    • ${f}`);
		}
	}
	console.log("══════════════════════════════════════\n");

	if (failed > 0) throw new Error(`${failed} test(s) failed`);
}

// ═══════════════════════════════════════════════════════════════════════
// 1: Monorepo — task folder inside repo root
// ═══════════════════════════════════════════════════════════════════════

function runMonorepoTests(): void {
	console.log("\n─── 1: resolveCanonicalTaskPaths — monorepo (inside repo root) ───");

	// Layout:
	//   fixtureRoot/repo/              ← repoRoot
	//   fixtureRoot/repo/tasks/TP-001/ ← taskFolder (inside repo)
	//   fixtureRoot/worktree/          ← worktreePath
	//
	// Expected: taskFolderResolved = fixtureRoot/worktree/tasks/TP-001/

	const repoRoot = join(fixtureRoot, "mono-repo");
	const worktreePath = join(fixtureRoot, "mono-worktree");
	const taskFolder = join(repoRoot, "tasks", "TP-001");

	mkdirSync(taskFolder, { recursive: true });
	mkdirSync(worktreePath, { recursive: true });

	// Create worktree mirror of the task folder (simulating git worktree)
	const expectedFolder = join(worktreePath, "tasks", "TP-001");
	mkdirSync(expectedFolder, { recursive: true });

	{
		console.log("  ▸ 1.1 no files exist — returns worktree-translated primary paths");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(expectedFolder),
			"1.1 taskFolderResolved is in worktree");
		assertEqual(norm(result.donePath), norm(join(expectedFolder, ".DONE")),
			"1.1 donePath is in worktree");
		assertEqual(norm(result.statusPath), norm(join(expectedFolder, "STATUS.md")),
			"1.1 statusPath is in worktree");
	}

	{
		console.log("  ▸ 1.2 STATUS.md exists in worktree — returns primary paths");
		writeFileSync(join(expectedFolder, "STATUS.md"), "# Status\n");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(expectedFolder),
			"1.2 taskFolderResolved is in worktree");
		assertEqual(norm(result.donePath), norm(join(expectedFolder, ".DONE")),
			"1.2 donePath points to worktree .DONE");
		assertEqual(norm(result.statusPath), norm(join(expectedFolder, "STATUS.md")),
			"1.2 statusPath points to worktree STATUS.md");
		rmSync(join(expectedFolder, "STATUS.md"));
	}

	{
		console.log("  ▸ 1.3 .DONE exists in worktree — returns primary paths");
		writeFileSync(join(expectedFolder, ".DONE"), "done\n");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(expectedFolder),
			"1.3 taskFolderResolved is in worktree");
		assert(norm(result.donePath).endsWith(".DONE"),
			"1.3 donePath ends with .DONE");
		rmSync(join(expectedFolder, ".DONE"));
	}

	{
		console.log("  ▸ 1.4 nested task folder preserves relative path");
		const deepTaskFolder = join(repoRoot, "project", "tasks", "TP-002");
		const deepWorktreeFolder = join(worktreePath, "project", "tasks", "TP-002");
		mkdirSync(deepTaskFolder, { recursive: true });
		mkdirSync(deepWorktreeFolder, { recursive: true });

		const result = resolveCanonicalTaskPaths(deepTaskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(deepWorktreeFolder),
			"1.4 deeply nested task folder resolves correctly in worktree");
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 2: External — task folder outside repo root (workspace/polyrepo mode)
// ═══════════════════════════════════════════════════════════════════════

function runExternalTests(): void {
	console.log("\n─── 2: resolveCanonicalTaskPaths — external (outside repo root) ───");

	// Layout:
	//   fixtureRoot/ext-docs-repo/tasks/TP-010/ ← taskFolder (external)
	//   fixtureRoot/ext-service-repo/            ← repoRoot (execution repo)
	//   fixtureRoot/ext-worktree/                ← worktreePath
	//
	// Expected: taskFolderResolved = fixtureRoot/ext-docs-repo/tasks/TP-010/
	// (absolute, NOT joined under worktree)

	const repoRoot = join(fixtureRoot, "ext-service-repo");
	const worktreePath = join(fixtureRoot, "ext-worktree");
	const taskFolder = join(fixtureRoot, "ext-docs-repo", "tasks", "TP-010");

	mkdirSync(repoRoot, { recursive: true });
	mkdirSync(worktreePath, { recursive: true });
	mkdirSync(taskFolder, { recursive: true });

	{
		console.log("  ▸ 2.1 no files exist — returns absolute task folder path (not worktree)");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"2.1 taskFolderResolved is absolute (external)");
		assertEqual(norm(result.donePath), norm(join(taskFolder, ".DONE")),
			"2.1 donePath is absolute (external)");
		assertEqual(norm(result.statusPath), norm(join(taskFolder, "STATUS.md")),
			"2.1 statusPath is absolute (external)");
	}

	{
		console.log("  ▸ 2.2 taskFolderResolved must NOT be under worktree");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assert(!norm(result.taskFolderResolved).startsWith(norm(worktreePath) + "/"),
			"2.2 external task folder is NOT translated to worktree path");
	}

	{
		console.log("  ▸ 2.3 taskFolderResolved must NOT be under repoRoot");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assert(!norm(result.taskFolderResolved).startsWith(norm(repoRoot) + "/"),
			"2.3 external task folder is NOT under repoRoot");
	}

	{
		console.log("  ▸ 2.4 STATUS.md exists in external task folder — returns primary paths");
		writeFileSync(join(taskFolder, "STATUS.md"), "# Status\n");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"2.4 taskFolderResolved is absolute (external, with STATUS.md)");
		rmSync(join(taskFolder, "STATUS.md"));
	}

	{
		console.log("  ▸ 2.5 .DONE exists in external task folder — returns primary paths");
		writeFileSync(join(taskFolder, ".DONE"), "done\n");
		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"2.5 taskFolderResolved is absolute (external, with .DONE)");
		assertEqual(norm(result.donePath), norm(join(taskFolder, ".DONE")),
			"2.5 donePath points to external .DONE");
		rmSync(join(taskFolder, ".DONE"));
	}

	{
		console.log("  ▸ 2.6 different worktree paths don't affect external resolution");
		const altWorktree = join(fixtureRoot, "ext-alt-worktree");
		mkdirSync(altWorktree, { recursive: true });
		const result1 = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		const result2 = resolveCanonicalTaskPaths(taskFolder, altWorktree, repoRoot);
		assertEqual(norm(result1.taskFolderResolved), norm(result2.taskFolderResolved),
			"2.6 external resolution is worktree-independent");
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 3: Archive fallback for both monorepo and external task folders
// ═══════════════════════════════════════════════════════════════════════

function runArchiveFallbackTests(): void {
	console.log("\n─── 3: resolveCanonicalTaskPaths — archive fallback ───");

	// 3.1 Monorepo archive fallback
	{
		console.log("  ▸ 3.1 monorepo: archived task folder detected");
		const repoRoot = join(fixtureRoot, "arch-mono-repo");
		const worktreePath = join(fixtureRoot, "arch-mono-wt");
		const taskFolder = join(repoRoot, "tasks", "TP-ARCH-1");

		mkdirSync(taskFolder, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });

		// Primary path in worktree does NOT exist
		// Archive path in worktree DOES exist with .DONE
		const archiveInWorktree = join(worktreePath, "tasks", "archive", "TP-ARCH-1");
		mkdirSync(archiveInWorktree, { recursive: true });
		writeFileSync(join(archiveInWorktree, ".DONE"), "done\n");

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(archiveInWorktree),
			"3.1 monorepo archive: taskFolderResolved points to archive");
		assertEqual(norm(result.donePath), norm(join(archiveInWorktree, ".DONE")),
			"3.1 monorepo archive: donePath points to archive .DONE");
		assertEqual(norm(result.statusPath), norm(join(archiveInWorktree, "STATUS.md")),
			"3.1 monorepo archive: statusPath points to archive STATUS.md");
	}

	// 3.2 External archive fallback
	{
		console.log("  ▸ 3.2 external: archived task folder detected");
		const repoRoot = join(fixtureRoot, "arch-ext-repo");
		const worktreePath = join(fixtureRoot, "arch-ext-wt");
		const taskFolder = join(fixtureRoot, "arch-ext-docs", "tasks", "TP-ARCH-2");

		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
		mkdirSync(taskFolder, { recursive: true });

		// Archive location for external task folder
		const archiveExternal = join(fixtureRoot, "arch-ext-docs", "tasks", "archive", "TP-ARCH-2");
		mkdirSync(archiveExternal, { recursive: true });
		writeFileSync(join(archiveExternal, "STATUS.md"), "# Archived\n");

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(archiveExternal),
			"3.2 external archive: taskFolderResolved points to archive");
		assertEqual(norm(result.statusPath), norm(join(archiveExternal, "STATUS.md")),
			"3.2 external archive: statusPath points to archive STATUS.md");
	}

	// 3.3 No archive exists — returns primary paths
	{
		console.log("  ▸ 3.3 no archive exists — returns primary paths (not archive)");
		const repoRoot = join(fixtureRoot, "arch-noarch-repo");
		const worktreePath = join(fixtureRoot, "arch-noarch-wt");
		const taskFolder = join(fixtureRoot, "arch-noarch-docs", "tasks", "TP-NOARCH");

		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
		mkdirSync(taskFolder, { recursive: true });

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assert(!norm(result.taskFolderResolved).includes("archive"),
			"3.3 taskFolderResolved does not include 'archive' when no archive exists");
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"3.3 taskFolderResolved is the original external path");
	}

	// 3.4 Primary exists AND archive exists — primary takes precedence
	{
		console.log("  ▸ 3.4 primary exists alongside archive — primary takes precedence");
		const repoRoot = join(fixtureRoot, "arch-both-repo");
		const worktreePath = join(fixtureRoot, "arch-both-wt");
		const taskFolder = join(fixtureRoot, "arch-both-docs", "tasks", "TP-BOTH");

		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
		mkdirSync(taskFolder, { recursive: true });

		// Primary has STATUS.md
		writeFileSync(join(taskFolder, "STATUS.md"), "# Primary\n");
		// Archive also has .DONE
		const archiveFolder = join(fixtureRoot, "arch-both-docs", "tasks", "archive", "TP-BOTH");
		mkdirSync(archiveFolder, { recursive: true });
		writeFileSync(join(archiveFolder, ".DONE"), "done\n");

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"3.4 primary takes precedence over archive");
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 4: resolveTaskDonePath — delegation correctness
// ═══════════════════════════════════════════════════════════════════════

function runDelegationTests(): void {
	console.log("\n─── 4: resolveTaskDonePath — delegation ───");

	const repoRoot = join(fixtureRoot, "deleg-repo");
	const worktreePath = join(fixtureRoot, "deleg-wt");

	mkdirSync(repoRoot, { recursive: true });
	mkdirSync(worktreePath, { recursive: true });

	{
		console.log("  ▸ 4.1 monorepo: resolveTaskDonePath matches resolveCanonicalTaskPaths.donePath");
		const taskFolder = join(repoRoot, "tasks", "TP-D1");
		mkdirSync(taskFolder, { recursive: true });
		const wtMirror = join(worktreePath, "tasks", "TP-D1");
		mkdirSync(wtMirror, { recursive: true });

		const canonical = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		const donePath = resolveTaskDonePath(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(donePath), norm(canonical.donePath),
			"4.1 resolveTaskDonePath == resolveCanonicalTaskPaths.donePath (monorepo)");
	}

	{
		console.log("  ▸ 4.2 external: resolveTaskDonePath matches resolveCanonicalTaskPaths.donePath");
		const taskFolder = join(fixtureRoot, "deleg-ext-docs", "tasks", "TP-D2");
		mkdirSync(taskFolder, { recursive: true });

		const canonical = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		const donePath = resolveTaskDonePath(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(donePath), norm(canonical.donePath),
			"4.2 resolveTaskDonePath == resolveCanonicalTaskPaths.donePath (external)");
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 5: Edge cases
// ═══════════════════════════════════════════════════════════════════════

function runEdgeCaseTests(): void {
	console.log("\n─── 5: Edge cases ───");

	{
		console.log("  ▸ 5.1 task folder equal to repo root — treated as inside (boundary)");
		// If taskFolder === repoRoot, startsWith(repoRootNorm + "/") is false
		// so it should take the external path (case 2)
		const repoRoot = join(fixtureRoot, "edge-root");
		const worktreePath = join(fixtureRoot, "edge-wt");
		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });

		const result = resolveCanonicalTaskPaths(repoRoot, worktreePath, repoRoot);
		// repoRoot does NOT start with repoRoot + "/" so it's case 2 (external)
		assertEqual(norm(result.taskFolderResolved), norm(repoRoot),
			"5.1 task folder == repo root: treated as external (exact match, no trailing slash)");
	}

	{
		console.log("  ▸ 5.2 task folder is sibling of repo root — external");
		const repoRoot = join(fixtureRoot, "edge-sibling-repo");
		const worktreePath = join(fixtureRoot, "edge-sibling-wt");
		const taskFolder = join(fixtureRoot, "edge-sibling-tasks", "TP-SIB");
		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
		mkdirSync(taskFolder, { recursive: true });

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"5.2 sibling of repo root is external");
		assert(!norm(result.taskFolderResolved).startsWith(norm(worktreePath) + "/"),
			"5.2 sibling task folder not mapped to worktree");
	}

	{
		console.log("  ▸ 5.3 repo root prefix overlap — not confused by similar names");
		// E.g., repoRoot = /tmp/foo, taskFolder = /tmp/foobar/tasks/T1
		// "foobar".startsWith("foo/") is false, so should be external
		const repoRoot = join(fixtureRoot, "edge-prefix");
		const worktreePath = join(fixtureRoot, "edge-prefix-wt");
		const taskFolder = join(fixtureRoot, "edge-prefix-extended", "tasks", "TP-PRE");
		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(worktreePath, { recursive: true });
		mkdirSync(taskFolder, { recursive: true });

		const result = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
		assertEqual(norm(result.taskFolderResolved), norm(taskFolder),
			"5.3 prefix overlap: not confused by repoRoot being prefix of different path");
	}

	{
		console.log("  ▸ 5.4 Windows-style backslash paths handled correctly");
		// On Windows, resolve() normalizes backslashes. Verify the function
		// handles mixed-separator input.
		const repoRoot = join(fixtureRoot, "edge-win-repo");
		const worktreePath = join(fixtureRoot, "edge-win-wt");
		const taskFolder = join(repoRoot, "tasks", "TP-WIN");
		mkdirSync(taskFolder, { recursive: true });
		const wtMirror = join(worktreePath, "tasks", "TP-WIN");
		mkdirSync(wtMirror, { recursive: true });

		// Use backslash-style paths (if on Windows this is natural; on unix resolve() normalizes anyway)
		const backslashTask = taskFolder.replace(/\//g, "\\");
		const backslashRepo = repoRoot.replace(/\//g, "\\");
		const backslashWt = worktreePath.replace(/\//g, "\\");

		const result = resolveCanonicalTaskPaths(backslashTask, backslashWt, backslashRepo);
		assertEqual(norm(result.taskFolderResolved), norm(wtMirror),
			"5.4 backslash paths: monorepo resolution works with backslash input");
	}

	{
		console.log("  ▸ 5.5 monorepo: multiple lanes resolve to different worktrees");
		// Same task folder, same repo root, different worktrees → different resolved paths
		const repoRoot = join(fixtureRoot, "edge-lanes-repo");
		const wt1 = join(fixtureRoot, "edge-lanes-wt-1");
		const wt2 = join(fixtureRoot, "edge-lanes-wt-2");
		const taskFolder = join(repoRoot, "tasks", "TP-LANE");
		mkdirSync(taskFolder, { recursive: true });
		mkdirSync(join(wt1, "tasks", "TP-LANE"), { recursive: true });
		mkdirSync(join(wt2, "tasks", "TP-LANE"), { recursive: true });

		const r1 = resolveCanonicalTaskPaths(taskFolder, wt1, repoRoot);
		const r2 = resolveCanonicalTaskPaths(taskFolder, wt2, repoRoot);
		assert(norm(r1.taskFolderResolved) !== norm(r2.taskFolderResolved),
			"5.5 different worktrees produce different resolved paths (monorepo)");
		assertEqual(norm(r1.taskFolderResolved), norm(join(wt1, "tasks", "TP-LANE")),
			"5.5 lane 1 maps to wt1");
		assertEqual(norm(r2.taskFolderResolved), norm(join(wt2, "tasks", "TP-LANE")),
			"5.5 lane 2 maps to wt2");
	}

	{
		console.log("  ▸ 5.6 external: multiple lanes all resolve to same canonical path");
		// Same external task folder, different worktrees → same resolved path
		const repoRoot = join(fixtureRoot, "edge-ext-lanes-repo");
		const wt1 = join(fixtureRoot, "edge-ext-lanes-wt-1");
		const wt2 = join(fixtureRoot, "edge-ext-lanes-wt-2");
		const taskFolder = join(fixtureRoot, "edge-ext-lanes-docs", "tasks", "TP-EXTL");
		mkdirSync(repoRoot, { recursive: true });
		mkdirSync(wt1, { recursive: true });
		mkdirSync(wt2, { recursive: true });
		mkdirSync(taskFolder, { recursive: true });

		const r1 = resolveCanonicalTaskPaths(taskFolder, wt1, repoRoot);
		const r2 = resolveCanonicalTaskPaths(taskFolder, wt2, repoRoot);
		assertEqual(norm(r1.taskFolderResolved), norm(r2.taskFolderResolved),
			"5.6 external: same canonical path regardless of worktree");
		assertEqual(norm(r1.donePath), norm(r2.donePath),
			"5.6 external: same donePath regardless of worktree");
	}
}

// ── Dual-mode execution ──────────────────────────────────────────────
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Execution Path Resolution (TP-003)", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch (e) {
		console.error("Test run failed:", e);
		process.exit(1);
	}
}
