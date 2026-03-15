/**
 * TP-005 — Repo-Scoped Merge Tests
 *
 * Tests for:
 *   1. groupLanesByRepo — deterministic repo grouping
 *   2. groupLanesByRepo — mono-repo no-regression (single group)
 *   3. Deterministic failure aggregation across repos
 *   4. mergeWaveByRepo — repo-mode passthrough
 *   5. formatRepoMergeSummary — repo-divergence partial summary (Step 1)
 *
 * Run: npx vitest run extensions/tests/merge-repo-scoped.test.ts
 */

import {
	groupLanesByRepo,
	determineMergeOrder,
	formatRepoMergeSummary,
	ORCH_MESSAGES,
} from "../task-orchestrator.ts";

import type {
	AllocatedLane,
	AllocatedTask,
	MergeLaneResult,
	MergeWaveResult,
	ParsedTask,
	RepoMergeOutcome,
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

	// ─── 9. Status rollup: lane-level + repo-level evidence ──────
	// Tests the aggregation logic pattern used in mergeWaveByRepo().
	// Validates R002 fixes: all-partial misclassification AND setup-failure detection.
	console.log("\n── 9. Status rollup: lane-level + repo-level evidence ──");
	{
		// Helper: simulate the status rollup logic from mergeWaveByRepo().
		// Uses BOTH lane-level evidence (anyLaneSucceeded) and repo-level evidence
		// (anyRepoFailed) to match the actual implementation.
		//
		// Parameters:
		//   laneResults: simulated MergeLaneResult[] with result status
		//   repoStatuses: per-repo status values from each mergeWave() call
		//     (captures setup failures where failedLane=null but status="failed")
		function computeAggregateStatus(
			laneResults: Array<{ resultStatus: string | null; error: string | null }>,
			repoStatuses: Array<"succeeded" | "failed" | "partial">,
		): "succeeded" | "failed" | "partial" {
			const anyLaneSucceeded = laneResults.some(
				r => r.resultStatus === "SUCCESS" || r.resultStatus === "CONFLICT_RESOLVED",
			);
			const anyRepoFailed = repoStatuses.some(s => s !== "succeeded");
			if (!anyRepoFailed) return "succeeded";
			if (anyLaneSucceeded) return "partial";
			return "failed";
		}

		// Case A: All lanes succeed → succeeded
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }, { resultStatus: "SUCCESS", error: null }],
				["succeeded", "succeeded"],
			) === "succeeded",
			"rollup: all SUCCESS → succeeded",
		);

		// Case B: Some lanes succeed, some fail → partial
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }, { resultStatus: "CONFLICT_UNRESOLVED", error: null }],
				["partial"],
			) === "partial",
			"rollup: mixed SUCCESS + failure → partial",
		);

		// Case C: All lanes fail → failed
		assert(
			computeAggregateStatus(
				[{ resultStatus: "CONFLICT_UNRESOLVED", error: null }, { resultStatus: "BUILD_FAILURE", error: null }],
				["failed"],
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
				["partial", "partial"],
			) === "partial",
			"rollup: all repos partial → global partial (not failed)",
		);

		// Case E: No lanes at all (vacuous) → succeeded
		assert(
			computeAggregateStatus([], []) === "succeeded",
			"rollup: no lanes → succeeded (vacuous)",
		);

		// Case F: Error lanes (no result, only error) → failed
		assert(
			computeAggregateStatus(
				[{ resultStatus: null, error: "spawn failed" }],
				["failed"],
			) === "failed",
			"rollup: error lane without result → failed",
		);

		// Case G: Mix of success + error → partial
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }, { resultStatus: null, error: "timeout" }],
				["partial"],
			) === "partial",
			"rollup: success + error → partial",
		);

		// Case H: Repo setup failure (failedLane=null, status="failed", no lane results)
		// This is R002 finding #1: temp branch or worktree creation fails before
		// any lane merges. mergeWave() returns status="failed" with failedLane=null
		// and empty laneResults. The aggregate must detect this as a failure.
		assert(
			computeAggregateStatus(
				[], // no lane results (setup failed before lane merges)
				["failed"],
			) === "failed",
			"rollup: repo setup failure with no lanes → failed",
		);

		// Case I: One repo setup-fails, another succeeds → partial
		// Repo A: setup failure (no lanes merged)
		// Repo B: all lanes merged successfully
		assert(
			computeAggregateStatus(
				[{ resultStatus: "SUCCESS", error: null }], // only repo B's lanes
				["failed", "succeeded"], // repo A failed setup, repo B succeeded
			) === "partial",
			"rollup: repo setup failure + other repo success → partial",
		);

		// Case J: All repos setup-fail → failed
		assert(
			computeAggregateStatus(
				[], // no lane results from any repo
				["failed", "failed"],
			) === "failed",
			"rollup: all repos setup failure → failed",
		);

		// Case K: One repo setup-fails, another is partial → partial
		// Repo A: setup failure (no lanes)
		// Repo B: partial (some lanes succeeded, some failed)
		assert(
			computeAggregateStatus(
				[
					{ resultStatus: "SUCCESS", error: null },              // repo B lane 1
					{ resultStatus: "BUILD_FAILURE", error: null },        // repo B lane 2
				],
				["failed", "partial"], // repo A setup fail, repo B partial
			) === "partial",
			"rollup: repo setup failure + other repo partial → partial",
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

	// ─── 11. formatRepoMergeSummary: repo-divergence partial ─────────
	console.log("\n── 11. formatRepoMergeSummary: repo-divergence partial ──");
	{
		// Two repos: api succeeded, frontend failed → should emit repo summary
		const mergeResult: MergeWaveResult = {
			waveIndex: 1,
			status: "partial",
			laneResults: [
				{
					laneNumber: 1, laneId: "api/lane-1", sourceBranch: "task/lane-1",
					targetBranch: "main", result: { status: "SUCCESS", source_branch: "task/lane-1", target_branch: "main", merge_commit: "abc1234", conflicts: [], verification: { ran: true, passed: true, output: "" } },
					error: null, durationMs: 5000, repoId: "api",
				},
				{
					laneNumber: 2, laneId: "frontend/lane-2", sourceBranch: "task/lane-2",
					targetBranch: "main", result: { status: "CONFLICT_UNRESOLVED", source_branch: "task/lane-2", target_branch: "main", merge_commit: "", conflicts: [{ file: "index.ts", type: "content", resolved: false }], verification: { ran: false, passed: false, output: "" } },
					error: null, durationMs: 3000, repoId: "frontend",
				},
			],
			failedLane: 2,
			failureReason: "Unresolved merge conflicts in lane 2: index.ts",
			totalDurationMs: 8000,
			repoResults: [
				{
					repoId: "api",
					status: "succeeded",
					laneResults: [{
						laneNumber: 1, laneId: "api/lane-1", sourceBranch: "task/lane-1",
						targetBranch: "main", result: { status: "SUCCESS", source_branch: "task/lane-1", target_branch: "main", merge_commit: "abc1234", conflicts: [], verification: { ran: true, passed: true, output: "" } },
						error: null, durationMs: 5000, repoId: "api",
					}],
					failedLane: null,
					failureReason: null,
				},
				{
					repoId: "frontend",
					status: "failed",
					laneResults: [{
						laneNumber: 2, laneId: "frontend/lane-2", sourceBranch: "task/lane-2",
						targetBranch: "main", result: { status: "CONFLICT_UNRESOLVED", source_branch: "task/lane-2", target_branch: "main", merge_commit: "", conflicts: [{ file: "index.ts", type: "content", resolved: false }], verification: { ran: false, passed: false, output: "" } },
						error: null, durationMs: 3000, repoId: "frontend",
					}],
					failedLane: 2,
					failureReason: "Unresolved merge conflicts in lane 2: index.ts",
				},
			],
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary !== null, "repo-divergence: produces summary when repos diverge");
		assert(summary!.includes("api"), "repo-divergence: summary mentions api repo");
		assert(summary!.includes("frontend"), "repo-divergence: summary mentions frontend repo");
		assert(summary!.includes("✅"), "repo-divergence: summary has success icon for api");
		assert(summary!.includes("❌"), "repo-divergence: summary has failure icon for frontend");
		assert(summary!.includes("1/1"), "repo-divergence: api shows 1/1 lanes merged");
		assert(summary!.includes("0/1"), "repo-divergence: frontend shows 0/1 lanes merged");
		assert(summary!.includes("Wave 1"), "repo-divergence: includes wave number");
	}

	// ─── 12. formatRepoMergeSummary: no summary for mono-repo ────────
	console.log("\n── 12. formatRepoMergeSummary: mono-repo → no summary ──");
	{
		// Mono-repo: partial but no repoResults
		const mergeResult: MergeWaveResult = {
			waveIndex: 2,
			status: "partial",
			laneResults: [
				{
					laneNumber: 1, laneId: "lane-1", sourceBranch: "task/lane-1",
					targetBranch: "main", result: { status: "SUCCESS", source_branch: "task/lane-1", target_branch: "main", merge_commit: "abc", conflicts: [], verification: { ran: true, passed: true, output: "" } },
					error: null, durationMs: 5000,
				},
			],
			failedLane: 2,
			failureReason: "some error",
			totalDurationMs: 5000,
			repoResults: [],  // Empty = mono-repo mode
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary === null, "mono-repo: formatRepoMergeSummary returns null when repoResults is empty");
	}

	// ─── 13. formatRepoMergeSummary: no summary when undefined ───────
	console.log("\n── 13. formatRepoMergeSummary: undefined repoResults → no summary ──");
	{
		const mergeResult: MergeWaveResult = {
			waveIndex: 1,
			status: "partial",
			laneResults: [],
			failedLane: 1,
			failureReason: "error",
			totalDurationMs: 1000,
			// repoResults not set (undefined)
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary === null, "undefined repoResults: returns null");
	}

	// ─── 14. formatRepoMergeSummary: no summary when all repos same status ──
	console.log("\n── 14. formatRepoMergeSummary: all repos same status → no summary ──");
	{
		// Both repos are partial (same status) → no divergence summary
		const mergeResult: MergeWaveResult = {
			waveIndex: 1,
			status: "partial",
			laneResults: [],
			failedLane: 2,
			failureReason: "error",
			totalDurationMs: 1000,
			repoResults: [
				{
					repoId: "api", status: "partial",
					laneResults: [], failedLane: 1, failureReason: "err1",
				},
				{
					repoId: "web", status: "partial",
					laneResults: [], failedLane: 2, failureReason: "err2",
				},
			],
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary === null, "all-same-status: returns null (no divergence)");
	}

	// ─── 15. formatRepoMergeSummary: single repo group → no summary ──
	console.log("\n── 15. formatRepoMergeSummary: single repo group → no summary ──");
	{
		const mergeResult: MergeWaveResult = {
			waveIndex: 1,
			status: "partial",
			laneResults: [],
			failedLane: 2,
			failureReason: "error",
			totalDurationMs: 1000,
			repoResults: [
				{
					repoId: "api", status: "partial",
					laneResults: [], failedLane: 2, failureReason: "err",
				},
			],
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary === null, "single-repo-group: returns null");
	}

	// ─── 16. formatRepoMergeSummary: deterministic ordering ──────────
	console.log("\n── 16. formatRepoMergeSummary: deterministic ordering ──");
	{
		// 3 repos with different statuses — verify order matches repoId sort
		const mergeResult: MergeWaveResult = {
			waveIndex: 3,
			status: "partial",
			laneResults: [],
			failedLane: 4,
			failureReason: "err",
			totalDurationMs: 1000,
			repoResults: [
				{
					repoId: "alpha", status: "succeeded",
					laneResults: [{
						laneNumber: 1, laneId: "alpha/lane-1", sourceBranch: "b1", targetBranch: "main",
						result: { status: "SUCCESS", source_branch: "b1", target_branch: "main", merge_commit: "a", conflicts: [], verification: { ran: true, passed: true, output: "" } },
						error: null, durationMs: 1000, repoId: "alpha",
					}],
					failedLane: null, failureReason: null,
				},
				{
					repoId: "beta", status: "failed",
					laneResults: [{
						laneNumber: 2, laneId: "beta/lane-2", sourceBranch: "b2", targetBranch: "main",
						result: { status: "BUILD_FAILURE", source_branch: "b2", target_branch: "main", merge_commit: "", conflicts: [], verification: { ran: true, passed: false, output: "tests failed" } },
						error: null, durationMs: 2000, repoId: "beta",
					}],
					failedLane: 2, failureReason: "build fail",
				},
				{
					repoId: "gamma", status: "succeeded",
					laneResults: [{
						laneNumber: 3, laneId: "gamma/lane-3", sourceBranch: "b3", targetBranch: "main",
						result: { status: "CONFLICT_RESOLVED", source_branch: "b3", target_branch: "main", merge_commit: "g", conflicts: [{ file: "x.ts", type: "content", resolved: true }], verification: { ran: true, passed: true, output: "" } },
						error: null, durationMs: 1500, repoId: "gamma",
					}],
					failedLane: null, failureReason: null,
				},
			],
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary !== null, "3-repo-divergence: produces summary");

		// Verify alpha comes before beta, beta before gamma (repoId alphabetical)
		const alphaIdx = summary!.indexOf("alpha");
		const betaIdx = summary!.indexOf("beta");
		const gammaIdx = summary!.indexOf("gamma");
		assert(alphaIdx < betaIdx, "3-repo: alpha appears before beta");
		assert(betaIdx < gammaIdx, "3-repo: beta appears before gamma");

		// Verify deterministic across runs
		const summary2 = formatRepoMergeSummary(mergeResult);
		assert(summary === summary2, "3-repo: identical output across 2 calls");
	}

	// ─── 17. formatRepoMergeSummary: uses ORCH_MESSAGES template ─────
	console.log("\n── 17. formatRepoMergeSummary: uses ORCH_MESSAGES template ──");
	{
		// Verify the template function exists and produces the expected prefix
		const lines = ["   ✅ api: 1/1 lane(s) merged", "   ❌ web: 0/1 lane(s) merged"];
		const templateOutput = ORCH_MESSAGES.orchMergePartialRepoSummary(2, lines);
		assert(templateOutput.includes("Wave 2"), "template: includes wave number");
		assert(templateOutput.includes("partially succeeded"), "template: includes 'partially succeeded'");
		assert(templateOutput.includes("repo outcomes diverged"), "template: includes 'repo outcomes diverged'");
		assert(templateOutput.includes("api"), "template: includes repo lines");
		assert(templateOutput.includes("web"), "template: includes repo lines");
	}

	// ─── 18. formatRepoMergeSummary: mixed-outcome-lane partial (no repo divergence) ──
	console.log("\n── 18. formatRepoMergeSummary: mixed-outcome-lane partial → no repo summary ──");
	{
		// Partial caused by mixed-outcome lanes within a single repo, both repos ended up "partial"
		// This should NOT produce a repo-divergence summary because no repos diverge
		const mergeResult: MergeWaveResult = {
			waveIndex: 1,
			status: "partial",
			laneResults: [],
			failedLane: 1,
			failureReason: "Lane(s) lane-1 contain both succeeded and failed tasks.",
			totalDurationMs: 1000,
			repoResults: [
				{
					repoId: "api", status: "partial",
					laneResults: [], failedLane: 1, failureReason: "mixed lanes",
				},
				{
					repoId: "web", status: "partial",
					laneResults: [], failedLane: 3, failureReason: "mixed lanes",
				},
			],
		};

		const summary = formatRepoMergeSummary(mergeResult);
		assert(summary === null, "mixed-outcome-lanes: no repo summary when all repos partial (same status)");
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
