/**
 * TP-171: Regression tests for skip progress preservation and batch history gap fixes.
 *
 * Tests verify:
 * 1. Skipped-task lane artifacts (STATUS.md, .reviews) are included in artifact staging
 * 2. .DONE is NOT staged for skipped-task lanes (false completion prevention)
 * 3. All wave-planned tasks appear in batch history (gap-filling)
 * 4. Non-terminal statuses ("running") are mapped to valid history statuses
 */
import { describe, it } from "node:test";
import { readFileSync } from "fs";
import { join } from "path";
import { expect } from "./expect.ts";

// ── Test 1: Skipped artifact lanes are computed correctly ──────────
describe("TP-171: skipped artifact lane detection in mergeWave", () => {
	it("identifies skipped-only lanes excluded from mergeable set", () => {
		// The core logic: lanes with skipped tasks that are NOT in mergeableLanes
		// should be identified for artifact staging.
		//
		// Read merge.ts source to verify the pattern exists
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// TP-171 added skippedArtifactLanes computation after mergeableLanes filter
		expect(mergeSource).toContain("skippedArtifactLanes");
		expect(mergeSource).toContain("mergeableLaneNumbers");

		// Verify skipped lanes use restricted allowlist (no .DONE)
		expect(mergeSource).toContain("SKIPPED_ARTIFACT_NAMES");
		expect(mergeSource).toContain('const SKIPPED_ARTIFACT_NAMES = ["STATUS.md", "REVIEW_VERDICT.json"]');
	});

	it("skipped artifact allowlist excludes .DONE to prevent false completion", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// The SKIPPED_ARTIFACT_NAMES should NOT contain .DONE
		const match = mergeSource.match(/const SKIPPED_ARTIFACT_NAMES = \[([^\]]+)\]/);
		expect(match).toBeTruthy();
		expect(match![1]).not.toContain(".DONE");
		expect(match![1]).toContain("STATUS.md");
		expect(match![1]).toContain("REVIEW_VERDICT.json");
	});

	it("skipped-only lanes are included in artifact staging loop", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// artifactStagingLanes should combine orderedLanes + skippedArtifactLanes
		expect(mergeSource).toContain("const artifactStagingLanes = [...orderedLanes, ...skippedArtifactLanes]");
	});

	it("artifact staging uses per-lane allowlist based on lane type", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// The loop should check isSkippedOnly to select the right allowlist
		expect(mergeSource).toContain("isSkippedOnly");
		expect(mergeSource).toContain("nameAllowlist");
		expect(mergeSource).toContain("isSkippedOnly ? SKIPPED_ARTIFACT_NAMES : ALLOWED_ARTIFACT_NAMES");
	});
});

// ── Test 2: stageSkippedArtifactsToTargetBranch uses isolated worktree ──
describe("TP-171: stageSkippedArtifactsToTargetBranch isolation", () => {
	it("uses a temporary worktree (not repoRoot) for artifact staging", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// The function should create a temp worktree via spawnSync
		expect(mergeSource).toContain('"worktree", "add"');
		expect(mergeSource).toContain("skip-artifacts-w");

		// And clean it up
		expect(mergeSource).toContain('"worktree", "remove"');
	});

	it("does NOT include .DONE in standalone skipped artifact staging", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// Find the stageSkippedArtifactsToTargetBranch function and check its allowlist
		const fnStart = mergeSource.indexOf("function stageSkippedArtifactsToTargetBranch");
		expect(fnStart).toBeGreaterThan(-1);
		const fnBody = mergeSource.slice(fnStart, fnStart + 500);

		// Should have STATUS.md in allowlist
		expect(fnBody).toContain('"STATUS.md"');
		// Should NOT have .DONE in allowlist
		const allowedNamesMatch = fnBody.match(/const ALLOWED_NAMES = \[([^\]]+)\]/);
		expect(allowedNamesMatch).toBeTruthy();
		expect(allowedNamesMatch![1]).not.toContain(".DONE");
	});
});

// ── Test 3: mergeWaveByRepo handles skipped-only repos ──────────
describe("TP-171: workspace-mode skipped repo handling", () => {
	it("mergeWaveByRepo stages artifacts for skipped-only repos not in mergeable groups", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// Should have post-loop skipped-only repo staging
		expect(mergeSource).toContain("skippedOnlyRepoLanes");
		expect(mergeSource).toContain("processedRepoIds");
	});

	it("mergeWaveByRepo gates skipped artifact staging behind safe-stop", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// Post-loop staging should check anyRollbackFailed
		expect(mergeSource).toContain("!anyRollbackFailed");
	});

	it("mergeWaveByRepo includes all repo lanes in filteredWaveResult (not just mergeable)", () => {
		const mergeSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// Should build allGroupLanes from completedLanes (not just mergeable)
		expect(mergeSource).toContain("allGroupLanes");
		expect(mergeSource).toContain("allGroupLaneNumbers");
	});
});

// ── Test 4: Batch history gap-filling covers all task statuses ──
describe("TP-171: batch history task status validation", () => {
	it("maps non-terminal statuses to valid BatchTaskSummary statuses", () => {
		const engineSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// TP-171 added status validation to prevent invalid "running" in history
		expect(engineSource).toContain("validStatuses");
		expect(engineSource).toContain('"running"');
		// The validStatuses set should contain all valid BatchTaskSummary statuses
		expect(engineSource).toContain('"succeeded"');
		expect(engineSource).toContain('"failed"');
		expect(engineSource).toContain('"skipped"');
		expect(engineSource).toContain('"blocked"');
		expect(engineSource).toContain('"stalled"');
	});

	it("TP-147 gap-fill ensures all wave-planned tasks appear in history", () => {
		const engineSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// The gap-filling code should iterate wavePlan and add missing tasks
		expect(engineSource).toContain("coveredTaskIds");
		expect(engineSource).toContain("TP-147: Ensure ALL tasks from the wave plan");
	});

	it("gap-filled tasks use blockedTaskIds for correct status", () => {
		const engineSource = readFileSync(
			join(import.meta.dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// Gap-filled tasks should check blockedTaskIds
		expect(engineSource).toContain("batchState.blockedTaskIds.has(taskId)");
		// Blocked tasks get "blocked" status, others get "pending"
		expect(engineSource).toContain('"Blocked by upstream failure"');
	});
});

// ── Test 5: saveBatchHistory handles all task statuses ──────────
import { saveBatchHistory, loadBatchHistory } from "../taskplane/persistence.ts";
import type { BatchHistorySummary, BatchTaskSummary } from "../taskplane/types.ts";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

describe("TP-171: batch history with mixed task statuses", () => {
	it("persists batch with skipped, blocked, and pending tasks", () => {
		const root = mkdtempSync(join(tmpdir(), "tp-171-history-"));
		try {
			const summary: BatchHistorySummary = {
				batchId: "batch-171",
				status: "partial",
				startedAt: 1000,
				endedAt: 2000,
				durationMs: 1000,
				totalWaves: 2,
				totalTasks: 5,
				succeededTasks: 1,
				failedTasks: 1,
				skippedTasks: 1,
				blockedTasks: 1,
				tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, costUsd: 0.05 },
				tasks: [
					{
						taskId: "TP-001", taskName: "TP-001", status: "succeeded",
						wave: 1, lane: 1, durationMs: 500,
						tokens: { input: 5, output: 10, cacheRead: 0, cacheWrite: 0, costUsd: 0.02 },
						exitReason: null,
					},
					{
						taskId: "TP-002", taskName: "TP-002", status: "failed",
						wave: 1, lane: 2, durationMs: 300,
						tokens: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
						exitReason: "Task crashed",
					},
					{
						taskId: "TP-003", taskName: "TP-003", status: "skipped",
						wave: 1, lane: 2, durationMs: 0,
						tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
						exitReason: "Skipped by stop-wave policy",
					},
					{
						taskId: "TP-004", taskName: "TP-004", status: "blocked",
						wave: 2, lane: 0, durationMs: 0,
						tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
						exitReason: "Blocked by upstream failure",
					},
					{
						taskId: "TP-005", taskName: "TP-005", status: "pending",
						wave: 2, lane: 0, durationMs: 0,
						tokens: { input: 2, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.02 },
						exitReason: null,
					},
				],
				waves: [
					{
						wave: 1, tasks: ["TP-001", "TP-002", "TP-003"],
						mergeStatus: "succeeded", durationMs: 500,
						tokens: { input: 8, output: 15, cacheRead: 0, cacheWrite: 0, costUsd: 0.03 },
					},
					{
						wave: 2, tasks: ["TP-004", "TP-005"],
						mergeStatus: "skipped", durationMs: 0,
						tokens: { input: 2, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.02 },
					},
				],
			};

			saveBatchHistory(root, summary);
			const loaded = loadBatchHistory(root);

			expect(loaded).toHaveLength(1);
			expect(loaded[0].tasks).toHaveLength(5);

			// Verify all statuses preserved
			const statuses = loaded[0].tasks.map(t => t.status);
			expect(statuses).toContain("succeeded");
			expect(statuses).toContain("failed");
			expect(statuses).toContain("skipped");
			expect(statuses).toContain("blocked");
			expect(statuses).toContain("pending");

			// Verify skipped task has correct metadata
			const skipped = loaded[0].tasks.find(t => t.taskId === "TP-003")!;
			expect(skipped.status).toBe("skipped");
			expect(skipped.exitReason).toBe("Skipped by stop-wave policy");

			// Verify blocked task has correct metadata
			const blocked = loaded[0].tasks.find(t => t.taskId === "TP-004")!;
			expect(blocked.status).toBe("blocked");
			expect(blocked.lane).toBe(0); // never allocated
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
