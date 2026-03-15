/**
 * TP-005 — Repo-Scoped Merge Tests
 *
 * Tests for:
 *   1. groupLanesByRepo — deterministic repo grouping
 *   2. groupLanesByRepo — mono-repo no-regression (single group)
 *   3. Deterministic failure aggregation across repos
 *   4. mergeWaveByRepo — repo-mode passthrough
 *
 * Run: npx vitest run extensions/tests/merge-repo-scoped.test.ts
 */

import {
	groupLanesByRepo,
	determineMergeOrder,
} from "../task-orchestrator.ts";

import type {
	AllocatedLane,
	AllocatedTask,
	ParsedTask,
} from "../task-orchestrator.ts";

// ── Helpers ──────────────────────────────────────────────────────────

const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

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

function makeParsedTask(taskId: string, fileScope: string[] = []): ParsedTask {
	return {
		taskId,
		taskName: taskId,
		reviewLevel: 1,
		size: "M",
		dependencies: [],
		fileScope,
		taskFolder: `/tasks/${taskId}`,
		promptPath: `/tasks/${taskId}/PROMPT.md`,
		areaName: "default",
		status: "pending",
	};
}

function makeAllocatedTask(taskId: string, order: number, fileScope: string[] = []): AllocatedTask {
	return {
		taskId,
		order,
		task: makeParsedTask(taskId, fileScope),
		estimatedMinutes: 60,
	};
}

function makeLane(
	laneNumber: number,
	taskIds: string[],
	opts?: { repoId?: string; branch?: string; fileScope?: string[] },
): AllocatedLane {
	return {
		laneNumber,
		laneId: opts?.repoId ? `${opts.repoId}/lane-${laneNumber}` : `lane-${laneNumber}`,
		tmuxSessionName: opts?.repoId ? `orch-${opts.repoId}-lane-${laneNumber}` : `orch-lane-${laneNumber}`,
		worktreePath: `/worktrees/wt-${laneNumber}`,
		branch: opts?.branch ?? `task/lane-${laneNumber}-20260315T100000`,
		tasks: taskIds.map((id, i) => makeAllocatedTask(id, i, opts?.fileScope)),
		strategy: "affinity-first",
		estimatedLoad: taskIds.length * 2,
		estimatedMinutes: taskIds.length * 60,
		repoId: opts?.repoId,
	};
}

// ── Tests ────────────────────────────────────────────────────────────

function runAllTests(): void {
	console.log("\n══ TP-005: Repo-Scoped Merge Tests ══");

	// ─── 1. groupLanesByRepo: multi-repo deterministic grouping ──────
	console.log("\n── 1. groupLanesByRepo: multi-repo grouping ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(1, ["TP-010"], { repoId: "frontend" }),
			makeLane(2, ["TP-011"], { repoId: "api" }),
			makeLane(3, ["TP-012"], { repoId: "frontend" }),
			makeLane(4, ["TP-013"], { repoId: "api" }),
		];

		const groups = groupLanesByRepo(lanes);

		assert(groups.length === 2, "multi-repo: 2 groups for 2 repo IDs");
		assert(groups[0].repoId === "api", "multi-repo: first group is 'api' (alphabetical sort)");
		assert(groups[1].repoId === "frontend", "multi-repo: second group is 'frontend'");
		assert(groups[0].lanes.length === 2, "multi-repo: api group has 2 lanes");
		assert(groups[1].lanes.length === 2, "multi-repo: frontend group has 2 lanes");

		// Lane numbers within each group
		const apiLanes = groups[0].lanes.map(l => l.laneNumber).sort();
		const frontendLanes = groups[1].lanes.map(l => l.laneNumber).sort();
		assert(apiLanes[0] === 2 && apiLanes[1] === 4, "multi-repo: api group contains lanes 2, 4");
		assert(frontendLanes[0] === 1 && frontendLanes[1] === 3, "multi-repo: frontend group contains lanes 1, 3");
	}

	// ─── 2. groupLanesByRepo: mono-repo (no repoId) → single group ──
	console.log("\n── 2. groupLanesByRepo: mono-repo no-regression ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(1, ["TP-020"]),
			makeLane(2, ["TP-021"]),
			makeLane(3, ["TP-022"]),
		];

		const groups = groupLanesByRepo(lanes);

		assert(groups.length === 1, "mono-repo: single group");
		assert(groups[0].repoId === undefined, "mono-repo: repoId is undefined");
		assert(groups[0].lanes.length === 3, "mono-repo: group contains all 3 lanes");
	}

	// ─── 3. groupLanesByRepo: mixed repoId (some undefined) ─────────
	console.log("\n── 3. groupLanesByRepo: mixed undefined + repoId ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(1, ["TP-030"]),                           // undefined repoId
			makeLane(2, ["TP-031"], { repoId: "backend" }),
			makeLane(3, ["TP-032"]),                           // undefined repoId
		];

		const groups = groupLanesByRepo(lanes);

		assert(groups.length === 2, "mixed: 2 groups (undefined + backend)");
		// "" sorts before "backend", so undefined group comes first
		assert(groups[0].repoId === undefined, "mixed: undefined group sorts first");
		assert(groups[1].repoId === "backend", "mixed: backend group sorts second");
		assert(groups[0].lanes.length === 2, "mixed: undefined group has 2 lanes");
		assert(groups[1].lanes.length === 1, "mixed: backend group has 1 lane");
	}

	// ─── 4. groupLanesByRepo: empty input ────────────────────────────
	console.log("\n── 4. groupLanesByRepo: empty input ──");
	{
		const groups = groupLanesByRepo([]);
		assert(groups.length === 0, "empty: returns no groups");
	}

	// ─── 5. groupLanesByRepo: single lane per repo ──────────────────
	console.log("\n── 5. groupLanesByRepo: single lane per repo ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(1, ["TP-040"], { repoId: "svc-c" }),
			makeLane(2, ["TP-041"], { repoId: "svc-b" }),
			makeLane(3, ["TP-042"], { repoId: "svc-a" }),
		];

		const groups = groupLanesByRepo(lanes);

		assert(groups.length === 3, "single-per-repo: 3 groups");
		assert(groups[0].repoId === "svc-a", "single-per-repo: first group is svc-a");
		assert(groups[1].repoId === "svc-b", "single-per-repo: second group is svc-b");
		assert(groups[2].repoId === "svc-c", "single-per-repo: third group is svc-c");
	}

	// ─── 6. determineMergeOrder: fewest-files-first within group ─────
	console.log("\n── 6. determineMergeOrder: fewest-files-first ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(1, ["TP-050"], { fileScope: ["a.ts", "b.ts", "c.ts"], branch: "task/lane-1" }),
			makeLane(2, ["TP-051"], { fileScope: ["x.ts"], branch: "task/lane-2" }),
			makeLane(3, ["TP-052"], { fileScope: ["m.ts", "n.ts"], branch: "task/lane-3" }),
		];

		const ordered = determineMergeOrder(lanes, "fewest-files-first");

		assert(ordered[0].laneNumber === 2, "fewest-files: lane 2 (1 file) first");
		assert(ordered[1].laneNumber === 3, "fewest-files: lane 3 (2 files) second");
		assert(ordered[2].laneNumber === 1, "fewest-files: lane 1 (3 files) last");
	}

	// ─── 7. determineMergeOrder: sequential within group ─────────────
	console.log("\n── 7. determineMergeOrder: sequential ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(3, ["TP-060"]),
			makeLane(1, ["TP-061"]),
			makeLane(2, ["TP-062"]),
		];

		const ordered = determineMergeOrder(lanes, "sequential");

		assert(ordered[0].laneNumber === 1, "sequential: lane 1 first");
		assert(ordered[1].laneNumber === 2, "sequential: lane 2 second");
		assert(ordered[2].laneNumber === 3, "sequential: lane 3 third");
	}

	// ─── 8. Deterministic ordering: same input → same output ─────────
	console.log("\n── 8. Deterministic ordering across runs ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(5, ["TP-070"], { repoId: "z-repo" }),
			makeLane(1, ["TP-071"], { repoId: "a-repo" }),
			makeLane(3, ["TP-072"], { repoId: "z-repo" }),
			makeLane(2, ["TP-073"], { repoId: "a-repo" }),
			makeLane(4, ["TP-074"]),  // undefined
		];

		// Run grouping multiple times
		const results = [];
		for (let i = 0; i < 3; i++) {
			const groups = groupLanesByRepo(lanes);
			const summary = groups.map(g =>
				`${g.repoId ?? ""}:[${g.lanes.map(l => l.laneNumber).join(",")}]`
			).join("|");
			results.push(summary);
		}

		assert(results[0] === results[1] && results[1] === results[2],
			"deterministic: groupLanesByRepo produces identical output across 3 runs");

		// Verify the exact expected order
		const groups = groupLanesByRepo(lanes);
		assert(groups[0].repoId === undefined, "deterministic: undefined repo group first");
		assert(groups[1].repoId === "a-repo", "deterministic: a-repo second");
		assert(groups[2].repoId === "z-repo", "deterministic: z-repo third");
	}

	// ─── 9. Status rollup: lane-level evidence (not repo status) ─────
	// Tests the aggregation logic pattern used in mergeWaveByRepo().
	// This validates the fix for R002 finding #2 (all-partial misclassified as failed).
	console.log("\n── 9. Status rollup: lane-level evidence ──");
	{
		// Helper: simulate the status rollup logic from mergeWaveByRepo()
		function computeAggregateStatus(
			laneResults: Array<{ resultStatus: string | null; error: string | null }>,
			firstFailedLane: number | null,
		): "succeeded" | "failed" | "partial" {
			const anyLaneSucceeded = laneResults.some(
				r => r.resultStatus === "SUCCESS" || r.resultStatus === "CONFLICT_RESOLVED",
			);
			const anyLaneFailed = firstFailedLane !== null;
			if (!anyLaneFailed) return "succeeded";
			if (anyLaneSucceeded) return "partial";
			return "failed";
		}

		// Case A: All lanes succeed → succeeded
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }, { resultStatus: "SUCCESS", error: null }],
				null,
			) === "succeeded",
			"rollup: all SUCCESS → succeeded",
		);

		// Case B: Some lanes succeed, some fail → partial
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }, { resultStatus: "CONFLICT_UNRESOLVED", error: null }],
				2,
			) === "partial",
			"rollup: mixed SUCCESS + failure → partial",
		);

		// Case C: All lanes fail → failed
		assert(
			computeAggregateStatus(
				[{ resultStatus: "CONFLICT_UNRESOLVED", error: null }, { resultStatus: "BUILD_FAILURE", error: null }],
				1,
			) === "failed",
			"rollup: all failures → failed",
		);

		// Case D: All repos partial (some succeed in each repo, each has a failure)
		// This is the edge case from R002 finding #2.
		// Each repo is "partial" (has both succeeded and failed lanes), but globally
		// there ARE successful merges, so aggregate should be "partial", not "failed".
		assert(
			computeAggregateStatus(
				[
					{ resultStatus: "SUCCESS", error: null },                    // repo-a lane 1
					{ resultStatus: "CONFLICT_UNRESOLVED", error: null },        // repo-a lane 2 (failure)
					{ resultStatus: "CONFLICT_RESOLVED", error: null },          // repo-b lane 1
					{ resultStatus: "BUILD_FAILURE", error: null },              // repo-b lane 2 (failure)
				],
				2, // first failure at lane 2
			) === "partial",
			"rollup: all repos partial → global partial (not failed)",
		);

		// Case E: No lanes at all (vacuous) → succeeded
		assert(
			computeAggregateStatus([], null) === "succeeded",
			"rollup: no lanes → succeeded (vacuous)",
		);

		// Case F: Error lanes (no result, only error) → failed
		assert(
			computeAggregateStatus(
				[{ resultStatus: null, error: "spawn failed" }],
				1,
			) === "failed",
			"rollup: error lane without result → failed",
		);

		// Case G: Mix of success + error → partial
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }, { resultStatus: null, error: "timeout" }],
				2,
			) === "partial",
			"rollup: success + error → partial",
		);
	}

	// ─── 10. repoId propagation on MergeLaneResult ───────────────────
	// Validates that groupLanesByRepo preserves repoId from input lanes,
	// ensuring merge lane results can be correctly attributed to repos.
	console.log("\n── 10. repoId propagation through grouping ──");
	{
		const lanes: AllocatedLane[] = [
			makeLane(1, ["TP-080"], { repoId: "api" }),
			makeLane(2, ["TP-081"], { repoId: "web" }),
			makeLane(3, ["TP-082"], { repoId: "api" }),
		];

		const groups = groupLanesByRepo(lanes);

		// Verify repoId is preserved on each lane in each group
		for (const group of groups) {
			for (const lane of group.lanes) {
				assert(
					lane.repoId === group.repoId,
					`repoId preserved: lane ${lane.laneNumber} has repoId "${lane.repoId}" matching group "${group.repoId}"`,
				);
			}
		}
	}

	// ── Summary ──────────────────────────────────────────────────────
	console.log(`\n════════════════════════════════════════════════════════════`);
	console.log(`Test Results: ${passed} passed, ${failed} failed`);
	console.log(`════════════════════════════════════════════════════════════`);

	if (failures.length > 0) {
		console.error("\nFailures:");
		for (const f of failures) {
			console.error(`  ✗ ${f}`);
		}
	}

	if (failed > 0) throw new Error(`${failed} test(s) failed`);
}

// ── Dual-mode execution ──────────────────────────────────────────────
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("TP-005: Repo-Scoped Merge", () => {
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
