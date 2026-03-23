/**
 * TP-037 — Resume Bug Fixes & State Coherence Tests
 *
 * Tests for:
 *   1.x  — Merge skip detection (Bug #102): computeResumePoint() + getMergeStatusForWave()
 *   2.x  — Stale session names (Bug #102b): reconcileTaskStates() Precedence 5
 *   3.x  — State coherence: mergeResults alignment with waveIndex
 *
 * Run: npx vitest run tests/resume-bug-fixes.test.ts
 */

import { describe, it, expect } from "vitest";
import {
	computeResumePoint,
	reconcileTaskStates,
	getMergeStatusForWave,
} from "../taskplane/resume.ts";
import type {
	PersistedBatchState,
	ReconciledTaskState,
	LaneTaskStatus,
} from "../taskplane/types.ts";
import {
	BATCH_STATE_SCHEMA_VERSION,
	defaultResilienceState,
	defaultBatchDiagnostics,
} from "../taskplane/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal PersistedBatchState for testing. */
function makeState(overrides?: Partial<PersistedBatchState>): PersistedBatchState {
	return {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: "paused",
		batchId: "test-batch-001",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: Date.now() - 60000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 2,
		wavePlan: [["task-1", "task-2"], ["task-3"]],
		lanes: [],
		tasks: [
			{ taskId: "task-1", status: "succeeded" as LaneTaskStatus, sessionName: "sess-1", laneNumber: 1, taskFolder: "/tasks/task-1", startedAt: null, endedAt: null, exitReason: "" },
			{ taskId: "task-2", status: "succeeded" as LaneTaskStatus, sessionName: "sess-2", laneNumber: 1, taskFolder: "/tasks/task-2", startedAt: null, endedAt: null, exitReason: "" },
			{ taskId: "task-3", status: "pending" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/tasks/task-3", startedAt: null, endedAt: null, exitReason: "" },
		],
		mergeResults: [],
		totalTasks: 3,
		succeededTasks: 2,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: defaultResilienceState(),
		diagnostics: defaultBatchDiagnostics(),
		...overrides,
	} as PersistedBatchState;
}

/** Build a reconciled task state. */
function makeReconciled(
	taskId: string,
	action: ReconciledTaskState["action"],
	liveStatus: LaneTaskStatus,
	persistedStatus: LaneTaskStatus = liveStatus,
): ReconciledTaskState {
	return {
		taskId,
		persistedStatus,
		liveStatus,
		sessionAlive: action === "reconnect",
		doneFileFound: action === "mark-complete",
		worktreeExists: action === "re-execute",
		action,
	};
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — Merge skip detection (Bug #102)
// ══════════════════════════════════════════════════════════════════════

describe("1.x: getMergeStatusForWave", () => {
	it("1.1: returns null when no merge result exists for wave", () => {
		const result = getMergeStatusForWave([], 0);
		expect(result).toBeNull();
	});

	it("1.2: returns 'succeeded' when wave merge succeeded", () => {
		const mergeResults = [
			{ waveIndex: 0, status: "succeeded" as const },
		];
		expect(getMergeStatusForWave(mergeResults, 0)).toBe("succeeded");
	});

	it("1.3: returns 'failed' when wave merge failed", () => {
		const mergeResults = [
			{ waveIndex: 0, status: "failed" as const },
		];
		expect(getMergeStatusForWave(mergeResults, 0)).toBe("failed");
	});

	it("1.4: returns 'partial' when wave merge was partial", () => {
		const mergeResults = [
			{ waveIndex: 0, status: "partial" as const },
		];
		expect(getMergeStatusForWave(mergeResults, 0)).toBe("partial");
	});

	it("1.5: returns latest entry when multiple exist for same wave", () => {
		const mergeResults = [
			{ waveIndex: 0, status: "failed" as const },
			{ waveIndex: 0, status: "succeeded" as const },
		];
		// Latest (last in array) should win
		expect(getMergeStatusForWave(mergeResults, 0)).toBe("succeeded");
	});

	it("1.6: returns null for non-matching wave index", () => {
		const mergeResults = [
			{ waveIndex: 0, status: "succeeded" as const },
		];
		expect(getMergeStatusForWave(mergeResults, 1)).toBeNull();
	});

	it("1.7: handles multiple waves correctly", () => {
		const mergeResults = [
			{ waveIndex: 0, status: "succeeded" as const },
			{ waveIndex: 1, status: "failed" as const },
			{ waveIndex: 2, status: "succeeded" as const },
		];
		expect(getMergeStatusForWave(mergeResults, 0)).toBe("succeeded");
		expect(getMergeStatusForWave(mergeResults, 1)).toBe("failed");
		expect(getMergeStatusForWave(mergeResults, 2)).toBe("succeeded");
		expect(getMergeStatusForWave(mergeResults, 3)).toBeNull();
	});
});

describe("1.x: computeResumePoint — merge skip detection (Bug #102)", () => {
	it("1.8: wave with all succeeded tasks + missing merge → flagged for merge retry", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			mergeResults: [], // No merge results at all
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Wave 0 has all tasks done but no merge → should be flagged for retry
		expect(resume.mergeRetryWaveIndexes).toContain(0);
		// Resume should start at wave 0 (the merge-retry wave)
		expect(resume.resumeWaveIndex).toBe(0);
	});

	it("1.9: wave with all succeeded tasks + succeeded merge → skipped normally", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" as const },
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Wave 0 has succeeded merge → should NOT be in mergeRetryWaveIndexes
		expect(resume.mergeRetryWaveIndexes).not.toContain(0);
		// Resume should start at wave 1 (skip past completed+merged wave)
		expect(resume.resumeWaveIndex).toBe(1);
	});

	it("1.10: wave with all succeeded tasks + failed merge → flagged for retry", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			mergeResults: [
				{ waveIndex: 0, status: "failed" as const },
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		expect(resume.mergeRetryWaveIndexes).toContain(0);
		expect(resume.resumeWaveIndex).toBe(0);
	});

	it("1.11: wave with only failed tasks + no merge → NOT flagged (no merge expected)", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			mergeResults: [],
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-failed", "failed"),
			makeReconciled("task-2", "mark-failed", "failed"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Wave 0 has no succeeded tasks → no merge expected → not flagged
		expect(resume.mergeRetryWaveIndexes).toHaveLength(0);
		// Resume at wave 1 (wave 0 is all-terminal, even though all failed)
		expect(resume.resumeWaveIndex).toBe(1);
	});

	it("1.12: multiple waves need merge retry", () => {
		const state = makeState({
			wavePlan: [["task-1"], ["task-2"], ["task-3"]],
			totalWaves: 3,
			tasks: [
				{ taskId: "task-1", status: "succeeded" as LaneTaskStatus, sessionName: "s1", laneNumber: 1, taskFolder: "/t/1", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-2", status: "succeeded" as LaneTaskStatus, sessionName: "s2", laneNumber: 1, taskFolder: "/t/2", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-3", status: "pending" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/3", startedAt: null, endedAt: null, exitReason: "" },
			],
			mergeResults: [], // Both wave 0 and wave 1 are missing merges
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		expect(resume.mergeRetryWaveIndexes).toContain(0);
		expect(resume.mergeRetryWaveIndexes).toContain(1);
		expect(resume.mergeRetryWaveIndexes).toHaveLength(2);
		// Resume at wave 0 (first wave needing merge retry)
		expect(resume.resumeWaveIndex).toBe(0);
	});

	it("1.13: partial merge status → flagged for retry", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			mergeResults: [
				{ waveIndex: 0, status: "partial" as const },
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		expect(resume.mergeRetryWaveIndexes).toContain(0);
		expect(resume.resumeWaveIndex).toBe(0);
	});

	it("1.14: mixed wave (some succeeded, some failed) + missing merge → flagged", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			mergeResults: [],
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-failed", "failed"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Wave 0 has at least one succeeded task but no merge → flagged
		expect(resume.mergeRetryWaveIndexes).toContain(0);
		expect(resume.resumeWaveIndex).toBe(0);
	});

	it("1.15: merge retry wave with succeeded merge after failed → not flagged (latest wins)", () => {
		const state = makeState({
			wavePlan: [["task-1"], ["task-3"]],
			mergeResults: [
				{ waveIndex: 0, status: "failed" as const },
				{ waveIndex: 0, status: "succeeded" as const }, // retry succeeded
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Latest merge status is "succeeded" → no retry needed
		expect(resume.mergeRetryWaveIndexes).toHaveLength(0);
		expect(resume.resumeWaveIndex).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Stale session names (Bug #102b)
// ══════════════════════════════════════════════════════════════════════

describe("2.x: reconcileTaskStates — stale session names (Bug #102b)", () => {
	it("2.1: pending task with stale session + dead session + no worktree → pending (not failed)", () => {
		const state = makeState({
			tasks: [
				{
					taskId: "task-3",
					status: "pending" as LaneTaskStatus,
					sessionName: "stale-sess-3", // Stale session from prior failed resume
					laneNumber: 2,
					taskFolder: "/tasks/task-3",
					startedAt: null,
					endedAt: null,
					exitReason: "",
				},
			],
		});

		const aliveSessions = new Set<string>(); // session is dead
		const doneTaskIds = new Set<string>();    // no .DONE
		const existingWorktrees = new Set<string>(); // no worktree

		const result = reconcileTaskStates(state, aliveSessions, doneTaskIds, existingWorktrees);

		expect(result).toHaveLength(1);
		expect(result[0].taskId).toBe("task-3");
		expect(result[0].action).toBe("pending"); // NOT "mark-failed"
		expect(result[0].liveStatus).toBe("pending");
	});

	it("2.2: pending task with no session → pending (unchanged behavior)", () => {
		const state = makeState({
			tasks: [
				{
					taskId: "task-3",
					status: "pending" as LaneTaskStatus,
					sessionName: "", // No session (never allocated)
					laneNumber: 0,
					taskFolder: "/tasks/task-3",
					startedAt: null,
					endedAt: null,
					exitReason: "",
				},
			],
		});

		const result = reconcileTaskStates(state, new Set(), new Set(), new Set());

		expect(result[0].action).toBe("pending");
	});

	it("2.3: pending task with alive session → reconnect (not pending)", () => {
		const state = makeState({
			tasks: [
				{
					taskId: "task-3",
					status: "pending" as LaneTaskStatus,
					sessionName: "alive-sess",
					laneNumber: 2,
					taskFolder: "/tasks/task-3",
					startedAt: null,
					endedAt: null,
					exitReason: "",
				},
			],
		});

		const aliveSessions = new Set<string>(["alive-sess"]);
		const result = reconcileTaskStates(state, aliveSessions, new Set(), new Set());

		expect(result[0].action).toBe("reconnect");
	});

	it("2.4: pending task with stale session + worktree exists → re-execute", () => {
		const state = makeState({
			tasks: [
				{
					taskId: "task-3",
					status: "pending" as LaneTaskStatus,
					sessionName: "stale-sess",
					laneNumber: 2,
					taskFolder: "/tasks/task-3",
					startedAt: null,
					endedAt: null,
					exitReason: "",
				},
			],
		});

		const aliveSessions = new Set<string>(); // dead
		const existingWorktrees = new Set<string>(["task-3"]); // worktree exists
		const result = reconcileTaskStates(state, aliveSessions, new Set(), existingWorktrees);

		// Worktree exists → Precedence 4 (re-execute), not Precedence 5
		expect(result[0].action).toBe("re-execute");
	});

	it("2.5: running task with dead session + no worktree → mark-failed (not pending)", () => {
		const state = makeState({
			tasks: [
				{
					taskId: "task-3",
					status: "running" as LaneTaskStatus,
					sessionName: "dead-sess",
					laneNumber: 2,
					taskFolder: "/tasks/task-3",
					startedAt: Date.now() - 10000,
					endedAt: null,
					exitReason: "",
				},
			],
		});

		const result = reconcileTaskStates(state, new Set(), new Set(), new Set());

		// Running task with dead session = crashed → mark-failed
		expect(result[0].action).toBe("mark-failed");
	});

	it("2.6: multiple pending tasks with stale sessions → all remain pending", () => {
		const state = makeState({
			tasks: [
				{ taskId: "task-a", status: "pending" as LaneTaskStatus, sessionName: "stale-1", laneNumber: 1, taskFolder: "/t/a", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-b", status: "pending" as LaneTaskStatus, sessionName: "stale-2", laneNumber: 2, taskFolder: "/t/b", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-c", status: "pending" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/c", startedAt: null, endedAt: null, exitReason: "" },
			],
		});

		const result = reconcileTaskStates(state, new Set(), new Set(), new Set());

		expect(result).toHaveLength(3);
		expect(result[0].action).toBe("pending");
		expect(result[1].action).toBe("pending");
		expect(result[2].action).toBe("pending");
	});

	it("2.7: pending task with .DONE → mark-complete (Precedence 1 wins)", () => {
		const state = makeState({
			tasks: [
				{ taskId: "task-done", status: "pending" as LaneTaskStatus, sessionName: "stale", laneNumber: 1, taskFolder: "/t/done", startedAt: null, endedAt: null, exitReason: "" },
			],
		});

		const doneTaskIds = new Set<string>(["task-done"]);
		const result = reconcileTaskStates(state, new Set(), doneTaskIds, new Set());

		expect(result[0].action).toBe("mark-complete");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — State coherence: mergeResults vs waveIndex alignment
// ══════════════════════════════════════════════════════════════════════

describe("3.x: State coherence — mergeResults alignment", () => {
	it("3.1: coherent state with all merges matching completed waves", () => {
		const state = makeState({
			wavePlan: [["task-1"], ["task-2"], ["task-3"]],
			totalWaves: 3,
			tasks: [
				{ taskId: "task-1", status: "succeeded" as LaneTaskStatus, sessionName: "s1", laneNumber: 1, taskFolder: "/t/1", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-2", status: "succeeded" as LaneTaskStatus, sessionName: "s2", laneNumber: 1, taskFolder: "/t/2", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-3", status: "pending" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/3", startedAt: null, endedAt: null, exitReason: "" },
			],
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" as const },
				{ waveIndex: 1, status: "succeeded" as const },
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Both completed waves have succeeded merges → resume at wave 2
		expect(resume.resumeWaveIndex).toBe(2);
		expect(resume.mergeRetryWaveIndexes).toHaveLength(0);
		expect(resume.completedTaskIds).toContain("task-1");
		expect(resume.completedTaskIds).toContain("task-2");
		expect(resume.pendingTaskIds).toContain("task-3");
	});

	it("3.2: incoherent state — wave 0 succeeded, wave 1 merge missing → catches gap", () => {
		const state = makeState({
			wavePlan: [["task-1"], ["task-2"], ["task-3"]],
			totalWaves: 3,
			tasks: [
				{ taskId: "task-1", status: "succeeded" as LaneTaskStatus, sessionName: "s1", laneNumber: 1, taskFolder: "/t/1", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-2", status: "succeeded" as LaneTaskStatus, sessionName: "s2", laneNumber: 1, taskFolder: "/t/2", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-3", status: "pending" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/3", startedAt: null, endedAt: null, exitReason: "" },
			],
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" as const },
				// Wave 1 merge is missing!
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Wave 1 succeeded but merge missing → flagged
		expect(resume.mergeRetryWaveIndexes).toContain(1);
		expect(resume.mergeRetryWaveIndexes).not.toContain(0); // wave 0 merge succeeded
		// Resume starts at wave 1 (earliest needing attention)
		expect(resume.resumeWaveIndex).toBe(1);
	});

	it("3.3: all waves complete + all merges succeeded → resume past end", () => {
		const state = makeState({
			wavePlan: [["task-1"], ["task-2"]],
			totalWaves: 2,
			tasks: [
				{ taskId: "task-1", status: "succeeded" as LaneTaskStatus, sessionName: "s1", laneNumber: 1, taskFolder: "/t/1", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-2", status: "succeeded" as LaneTaskStatus, sessionName: "s2", laneNumber: 1, taskFolder: "/t/2", startedAt: null, endedAt: null, exitReason: "" },
			],
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" as const },
				{ waveIndex: 1, status: "succeeded" as const },
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
		];

		const resume = computeResumePoint(state, reconciled);

		// Everything done → resume past end
		expect(resume.resumeWaveIndex).toBe(2);
		expect(resume.mergeRetryWaveIndexes).toHaveLength(0);
		expect(resume.pendingTaskIds).toHaveLength(0);
	});

	it("3.4: wave with skipped tasks (all skipped) + no merge → no merge retry (no succeeded tasks)", () => {
		const state = makeState({
			wavePlan: [["task-1", "task-2"], ["task-3"]],
			tasks: [
				{ taskId: "task-1", status: "skipped" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/1", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-2", status: "skipped" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/2", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-3", status: "pending" as LaneTaskStatus, sessionName: "", laneNumber: 0, taskFolder: "/t/3", startedAt: null, endedAt: null, exitReason: "" },
			],
			mergeResults: [],
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "skip", "skipped", "skipped"),
			makeReconciled("task-2", "skip", "skipped", "skipped"),
			makeReconciled("task-3", "pending", "pending"),
		];

		const resume = computeResumePoint(state, reconciled);

		// No succeeded tasks in wave 0 → no merge expected → not flagged
		expect(resume.mergeRetryWaveIndexes).toHaveLength(0);
		expect(resume.resumeWaveIndex).toBe(1);
	});

	it("3.5: merge-retry wave precedes incomplete wave → resume at merge-retry wave", () => {
		const state = makeState({
			wavePlan: [["task-1"], ["task-2"], ["task-3"]],
			totalWaves: 3,
			tasks: [
				{ taskId: "task-1", status: "succeeded" as LaneTaskStatus, sessionName: "s1", laneNumber: 1, taskFolder: "/t/1", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-2", status: "succeeded" as LaneTaskStatus, sessionName: "s2", laneNumber: 1, taskFolder: "/t/2", startedAt: null, endedAt: null, exitReason: "" },
				{ taskId: "task-3", status: "running" as LaneTaskStatus, sessionName: "s3", laneNumber: 2, taskFolder: "/t/3", startedAt: null, endedAt: null, exitReason: "" },
			],
			mergeResults: [
				{ waveIndex: 0, status: "failed" as const }, // Wave 0 merge failed
				{ waveIndex: 1, status: "succeeded" as const },
			] as any,
		});

		const reconciled: ReconciledTaskState[] = [
			makeReconciled("task-1", "mark-complete", "succeeded"),
			makeReconciled("task-2", "mark-complete", "succeeded"),
			makeReconciled("task-3", "mark-failed", "failed", "running"), // task-3 crashed
		];

		const resume = computeResumePoint(state, reconciled);

		// Wave 0 merge failed → merge retry needed, even though wave 1 is fine
		expect(resume.mergeRetryWaveIndexes).toContain(0);
		expect(resume.resumeWaveIndex).toBe(0);
	});
});
