/**
 * Partial Progress Preservation Tests — TP-028 Step 3
 *
 * Tests for TP-028 partial progress preservation:
 *   1. Branch preservation behavior (pure functions + mocked git)
 *   2. State contract (serialization, validation, round-trip)
 *
 * Run: npx vitest run extensions/tests/partial-progress.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Pure function imports (no git/fs side effects) ──────────────────

import {
	computePartialProgressBranchName,
	resolveSavedBranchCollision,
} from "../taskplane/worktree.ts";

import {
	upsertTaskOutcome,
	applyPartialProgressToOutcomes,
	serializeBatchState,
	validatePersistedState,
} from "../taskplane/persistence.ts";

import type {
	LaneTaskOutcome,
	AllocatedLane,
	AllocatedTask,
	ParsedTask,
	OrchBatchRuntimeState,
	PersistedBatchState,
	SavePartialProgressResult,
} from "../taskplane/types.ts";

import type {
	PreserveFailedLaneProgressResult,
} from "../taskplane/worktree.ts";

import { BATCH_STATE_SCHEMA_VERSION } from "../taskplane/types.ts";

// ── Test Helpers ────────────────────────────────────────────────────

/** Build a minimal ParsedTask for tests */
function makeParsedTask(taskId: string, repoId?: string): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 0,
		size: "S",
		dependencies: [],
		fileScope: [],
		taskFolder: `/tasks/${taskId}`,
		promptPath: `/tasks/${taskId}/PROMPT.md`,
		areaName: "default",
		status: "pending",
		promptRepoId: repoId,
		resolvedRepoId: repoId,
	};
}

/** Build a minimal AllocatedLane for tests */
function makeLane(
	laneNumber: number,
	branch: string,
	taskIds: string[],
	repoId?: string,
): AllocatedLane {
	return {
		laneNumber,
		laneId: `lane-${laneNumber}`,
		tmuxSessionName: `orch-lane-${laneNumber}`,
		worktreePath: `/worktrees/lane-${laneNumber}`,
		branch,
		tasks: taskIds.map((id, i) => ({
			taskId: id,
			order: i,
			task: makeParsedTask(id, repoId),
			estimatedMinutes: 30,
		})),
		strategy: "round-robin" as const,
		estimatedLoad: taskIds.length,
		estimatedMinutes: taskIds.length * 30,
		repoId,
	};
}

/** Build a minimal LaneTaskOutcome */
function makeOutcome(
	taskId: string,
	status: LaneTaskOutcome["status"],
	overrides?: Partial<LaneTaskOutcome>,
): LaneTaskOutcome {
	return {
		taskId,
		status,
		startTime: Date.now() - 60000,
		endTime: Date.now(),
		exitReason: `Task ${status}`,
		sessionName: `orch-lane-1`,
		doneFileFound: status === "succeeded",
		...overrides,
	};
}

/** Build a minimal OrchBatchRuntimeState for serialization tests */
function makeRuntimeState(overrides?: Partial<OrchBatchRuntimeState>): OrchBatchRuntimeState {
	return {
		phase: "executing",
		batchId: "20260319T140000",
		baseBranch: "main",
		orchBranch: "orch/test-20260319T140000",
		mode: "repo",
		pauseSignal: { paused: false },
		waveResults: [],
		currentWaveIndex: 0,
		totalWaves: 1,
		blockedTaskIds: new Set(),
		startedAt: Date.now() - 60000,
		endedAt: null,
		totalTasks: 2,
		succeededTasks: 0,
		failedTasks: 1,
		skippedTasks: 0,
		blockedTasks: 0,
		errors: [],
		currentLanes: [],
		dependencyGraph: null,
		mergeResults: [],
		...overrides,
	};
}

/** Build a minimal valid PersistedBatchState for validation tests */
function makePersistedState(taskOverrides?: Array<Record<string, unknown>>): Record<string, unknown> {
	const defaultTasks = taskOverrides ?? [
		{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "failed",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: false,
			exitReason: "Task failed",
		},
	];

	return {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: "failed",
		batchId: "20260319T140000",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: 1000,
		updatedAt: 2000,
		endedAt: 2000,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-001"]],
		lanes: [{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/worktrees/lane-1",
			branch: "task/test-lane-1-20260319T140000",
			taskIds: ["TP-001"],
		}],
		tasks: defaultTasks,
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 1,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
	};
}


// ═══════════════════════════════════════════════════════════════════════
// 1 — Branch Preservation Behavior Tests (Pure Functions)
// ═══════════════════════════════════════════════════════════════════════

describe("computePartialProgressBranchName", () => {
	it("repo mode: produces saved/{opId}-{taskId}-{batchId}", () => {
		const name = computePartialProgressBranchName("henry", "TP-028", "20260319T140000");
		expect(name).toBe("saved/henry-TP-028-20260319T140000");
	});

	it("workspace mode: includes repoId", () => {
		const name = computePartialProgressBranchName("henry", "TP-028", "20260319T140000", "api");
		expect(name).toBe("saved/henry-api-TP-028-20260319T140000");
	});

	it("repo mode: omits repoId segment", () => {
		const withRepo = computePartialProgressBranchName("henry", "TP-028", "20260319T140000", "api");
		const withoutRepo = computePartialProgressBranchName("henry", "TP-028", "20260319T140000");
		expect(withRepo).not.toBe(withoutRepo);
		expect(withoutRepo).not.toContain("api");
	});

	it("different operators produce different branch names", () => {
		const a = computePartialProgressBranchName("alice", "TP-028", "20260319T140000");
		const b = computePartialProgressBranchName("bob", "TP-028", "20260319T140000");
		expect(a).not.toBe(b);
	});

	it("different batches produce different branch names", () => {
		const a = computePartialProgressBranchName("henry", "TP-028", "20260319T140000");
		const b = computePartialProgressBranchName("henry", "TP-028", "20260320T100000");
		expect(a).not.toBe(b);
	});

	it("different tasks produce different branch names", () => {
		const a = computePartialProgressBranchName("henry", "TP-028", "20260319T140000");
		const b = computePartialProgressBranchName("henry", "TP-029", "20260319T140000");
		expect(a).not.toBe(b);
	});
});

describe("resolveSavedBranchCollision", () => {
	const savedName = "saved/henry-TP-028-20260319T140000";

	it("no existing branch → create", () => {
		const result = resolveSavedBranchCollision(savedName, "", "abc123");
		expect(result.action).toBe("create");
		expect(result.savedName).toBe(savedName);
	});

	it("same SHA → keep-existing (idempotent)", () => {
		const result = resolveSavedBranchCollision(savedName, "abc123", "abc123");
		expect(result.action).toBe("keep-existing");
		expect(result.savedName).toBe(savedName);
	});

	it("different SHA → create-suffixed with timestamp", () => {
		const result = resolveSavedBranchCollision(
			savedName, "abc123", "def456", "2026-03-19T14-00-00-000Z",
		);
		expect(result.action).toBe("create-suffixed");
		expect(result.savedName).toBe(`${savedName}-2026-03-19T14-00-00-000Z`);
	});

	it("different SHA without explicit timestamp generates one automatically", () => {
		const result = resolveSavedBranchCollision(savedName, "abc123", "def456");
		expect(result.action).toBe("create-suffixed");
		expect(result.savedName).toMatch(/^saved\/henry-TP-028-20260319T140000-\d{4}-\d{2}-\d{2}T/);
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 2 — preserveFailedLaneProgress Behavior (mocked git)
// ═══════════════════════════════════════════════════════════════════════

// We can't call preserveFailedLaneProgress directly in a test without real git,
// but we can test the logic by constructing equivalent PreserveFailedLaneProgressResult
// objects and testing applyPartialProgressToOutcomes (which is the state contract).
// We also test the input filtering logic via its contract: only failed/stalled
// tasks with allocated lanes should produce results.

describe("applyPartialProgressToOutcomes", () => {
	it("stamps outcomes for saved tasks", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed"),
			makeOutcome("TP-002", "succeeded"),
		];

		const ppResult: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: true, savedBranch: "saved/henry-TP-001-batch1", commitCount: 3, taskId: "TP-001" },
			],
			preservedBranches: new Set(["saved/henry-TP-001-batch1"]),
			unsafeBranches: new Set(),
		};

		const updated = applyPartialProgressToOutcomes(ppResult, outcomes);
		expect(updated).toBe(1);
		expect(outcomes[0].partialProgressCommits).toBe(3);
		expect(outcomes[0].partialProgressBranch).toBe("saved/henry-TP-001-batch1");
		// Succeeded task should NOT be touched
		expect(outcomes[1].partialProgressCommits).toBeUndefined();
		expect(outcomes[1].partialProgressBranch).toBeUndefined();
	});

	it("skips unsaved results (no commits)", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed"),
		];

		const ppResult: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: false, commitCount: 0, taskId: "TP-001" },
			],
			preservedBranches: new Set(),
			unsafeBranches: new Set(),
		};

		const updated = applyPartialProgressToOutcomes(ppResult, outcomes);
		expect(updated).toBe(0);
		expect(outcomes[0].partialProgressCommits).toBeUndefined();
	});

	it("skips results where save failed but commits existed (unsafe)", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed"),
		];

		const ppResult: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: false, commitCount: 5, taskId: "TP-001", error: "branch create failed" },
			],
			preservedBranches: new Set(),
			unsafeBranches: new Set(["task/test-lane-1-batch1"]),
		};

		const updated = applyPartialProgressToOutcomes(ppResult, outcomes);
		expect(updated).toBe(0);
		// Unsafe branches tracked at call site, not in outcome
		expect(ppResult.unsafeBranches.has("task/test-lane-1-batch1")).toBe(true);
	});

	it("handles multiple failed tasks across different lanes", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed"),
			makeOutcome("TP-002", "stalled"),
			makeOutcome("TP-003", "succeeded"),
		];

		const ppResult: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: true, savedBranch: "saved/henry-TP-001-batch1", commitCount: 3, taskId: "TP-001" },
				{ saved: true, savedBranch: "saved/henry-TP-002-batch1", commitCount: 1, taskId: "TP-002" },
			],
			preservedBranches: new Set(["saved/henry-TP-001-batch1", "saved/henry-TP-002-batch1"]),
			unsafeBranches: new Set(),
		};

		const updated = applyPartialProgressToOutcomes(ppResult, outcomes);
		expect(updated).toBe(2);
		expect(outcomes[0].partialProgressCommits).toBe(3);
		expect(outcomes[1].partialProgressCommits).toBe(1);
		expect(outcomes[2].partialProgressCommits).toBeUndefined();
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 3 — upsertTaskOutcome Change Detection for Partial Progress Fields
// ═══════════════════════════════════════════════════════════════════════

describe("upsertTaskOutcome — partialProgress change detection", () => {
	it("detects change when partialProgressCommits is added", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed"),
		];

		const updated = makeOutcome("TP-001", "failed", {
			partialProgressCommits: 3,
			partialProgressBranch: "saved/henry-TP-001-batch1",
		});

		const changed = upsertTaskOutcome(outcomes, updated);
		expect(changed).toBe(true);
		expect(outcomes[0].partialProgressCommits).toBe(3);
		expect(outcomes[0].partialProgressBranch).toBe("saved/henry-TP-001-batch1");
	});

	it("no change when fields are identical", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed", {
				partialProgressCommits: 3,
				partialProgressBranch: "saved/henry-TP-001-batch1",
			}),
		];

		const same = makeOutcome("TP-001", "failed", {
			partialProgressCommits: 3,
			partialProgressBranch: "saved/henry-TP-001-batch1",
		});

		const changed = upsertTaskOutcome(outcomes, same);
		expect(changed).toBe(false);
	});

	it("detects change when partialProgressBranch changes", () => {
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed", {
				partialProgressCommits: 3,
				partialProgressBranch: "saved/henry-TP-001-batch1",
			}),
		];

		const updated = makeOutcome("TP-001", "failed", {
			partialProgressCommits: 3,
			partialProgressBranch: "saved/henry-TP-001-batch1-2026-03-19T14-00-00-000Z",
		});

		const changed = upsertTaskOutcome(outcomes, updated);
		expect(changed).toBe(true);
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 4 — State Contract Tests: Serialization & Validation Round-Trip
// ═══════════════════════════════════════════════════════════════════════

describe("serializeBatchState — partialProgress fields", () => {
	it("includes partialProgress fields when present in outcome", () => {
		const state = makeRuntimeState();
		const wavePlan = [["TP-001"]];
		const lanes = [makeLane(1, "task/test-lane-1-batch1", ["TP-001"])];
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed", {
				partialProgressCommits: 5,
				partialProgressBranch: "saved/henry-TP-001-20260319T140000",
			}),
		];

		const json = serializeBatchState(state, wavePlan, lanes, outcomes);
		const parsed = JSON.parse(json);

		expect(parsed.tasks).toHaveLength(1);
		expect(parsed.tasks[0].partialProgressCommits).toBe(5);
		expect(parsed.tasks[0].partialProgressBranch).toBe("saved/henry-TP-001-20260319T140000");
	});

	it("omits partialProgress fields when undefined in outcome", () => {
		const state = makeRuntimeState();
		const wavePlan = [["TP-001"]];
		const lanes = [makeLane(1, "task/test-lane-1-batch1", ["TP-001"])];
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "succeeded"),
		];

		const json = serializeBatchState(state, wavePlan, lanes, outcomes);
		const parsed = JSON.parse(json);

		expect(parsed.tasks).toHaveLength(1);
		expect(parsed.tasks[0]).not.toHaveProperty("partialProgressCommits");
		expect(parsed.tasks[0]).not.toHaveProperty("partialProgressBranch");
	});

	it("round-trips through serialize → parse → validate with fields present", () => {
		const state = makeRuntimeState({ phase: "failed", endedAt: Date.now() });
		const wavePlan = [["TP-001", "TP-002"]];
		const lanes = [makeLane(1, "task/test-lane-1-batch1", ["TP-001", "TP-002"])];
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed", {
				partialProgressCommits: 3,
				partialProgressBranch: "saved/henry-TP-001-20260319T140000",
			}),
			makeOutcome("TP-002", "succeeded"),
		];

		const json = serializeBatchState(state, wavePlan, lanes, outcomes);
		const parsed = JSON.parse(json);

		// Validate the serialized state
		const validated = validatePersistedState(parsed);
		expect(validated).toBeDefined();
		expect(validated.tasks).toHaveLength(2);

		// Find the failed task and verify fields survived round-trip
		const failedTask = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-001");
		expect(failedTask).toBeDefined();
		expect(failedTask!.partialProgressCommits).toBe(3);
		expect(failedTask!.partialProgressBranch).toBe("saved/henry-TP-001-20260319T140000");

		// Succeeded task should not have the fields
		const succeededTask = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-002");
		expect(succeededTask).toBeDefined();
		expect(succeededTask!.partialProgressCommits).toBeUndefined();
		expect(succeededTask!.partialProgressBranch).toBeUndefined();
	});

	it("round-trips through serialize → parse → validate with fields absent", () => {
		const state = makeRuntimeState({ phase: "completed", endedAt: Date.now() });
		const wavePlan = [["TP-001"]];
		const lanes = [makeLane(1, "task/test-lane-1-batch1", ["TP-001"])];
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "succeeded"),
		];

		const json = serializeBatchState(state, wavePlan, lanes, outcomes);
		const parsed = JSON.parse(json);

		const validated = validatePersistedState(parsed);
		expect(validated).toBeDefined();
		const task = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-001");
		expect(task!.partialProgressCommits).toBeUndefined();
		expect(task!.partialProgressBranch).toBeUndefined();
	});
});

describe("validatePersistedState — partialProgress field validation", () => {
	it("accepts task with valid partialProgress fields", () => {
		const state = makePersistedState([{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "failed",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: false,
			exitReason: "Task failed",
			partialProgressCommits: 5,
			partialProgressBranch: "saved/henry-TP-001-20260319T140000",
		}]);

		expect(() => validatePersistedState(state)).not.toThrow();
		const validated = validatePersistedState(state);
		expect(validated.tasks[0].partialProgressCommits).toBe(5);
		expect(validated.tasks[0].partialProgressBranch).toBe("saved/henry-TP-001-20260319T140000");
	});

	it("accepts task without partialProgress fields (backward compat)", () => {
		const state = makePersistedState([{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "succeeded",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: true,
			exitReason: "Completed",
		}]);

		expect(() => validatePersistedState(state)).not.toThrow();
	});

	it("rejects partialProgressCommits when not a number", () => {
		const state = makePersistedState([{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "failed",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: false,
			exitReason: "Task failed",
			partialProgressCommits: "five",
		}]);

		expect(() => validatePersistedState(state)).toThrow(/partialProgressCommits/);
	});

	it("rejects partialProgressBranch when not a string", () => {
		const state = makePersistedState([{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "failed",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: false,
			exitReason: "Task failed",
			partialProgressBranch: 42,
		}]);

		expect(() => validatePersistedState(state)).toThrow(/partialProgressBranch/);
	});

	it("rejects partialProgressCommits when null", () => {
		const state = makePersistedState([{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "failed",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: false,
			exitReason: "Task failed",
			partialProgressCommits: null,
		}]);

		expect(() => validatePersistedState(state)).toThrow(/partialProgressCommits/);
	});

	it("rejects partialProgressBranch when null", () => {
		const state = makePersistedState([{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "failed",
			taskFolder: "/tasks/TP-001",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: false,
			exitReason: "Task failed",
			partialProgressBranch: null,
		}]);

		expect(() => validatePersistedState(state)).toThrow(/partialProgressBranch/);
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 5 — Unsafe Branch Tracking Contract
// ═══════════════════════════════════════════════════════════════════════

describe("PreserveFailedLaneProgressResult — unsafeBranches contract", () => {
	it("unsafeBranches tracks lane branches where preservation failed with commits", () => {
		// This tests the contract that callers use to skip reset/deletion
		const result: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: false, commitCount: 5, taskId: "TP-001", error: "branch create failed" },
				{ saved: true, savedBranch: "saved/henry-TP-002-batch1", commitCount: 2, taskId: "TP-002" },
			],
			preservedBranches: new Set(["saved/henry-TP-002-batch1"]),
			unsafeBranches: new Set(["task/test-lane-1-batch1"]),
		};

		// Unsafe branches should be skipped during reset
		expect(result.unsafeBranches.has("task/test-lane-1-batch1")).toBe(true);
		// Preserved branches are independently safe — lane branch can be deleted
		expect(result.preservedBranches.has("saved/henry-TP-002-batch1")).toBe(true);
	});

	it("empty sets when all preservation succeeds or no commits exist", () => {
		const result: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: true, savedBranch: "saved/henry-TP-001-batch1", commitCount: 3, taskId: "TP-001" },
				{ saved: false, commitCount: 0, taskId: "TP-002" }, // no commits, safe
			],
			preservedBranches: new Set(["saved/henry-TP-001-batch1"]),
			unsafeBranches: new Set(),
		};

		expect(result.unsafeBranches.size).toBe(0);
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 6 — End-to-End: Outcome → Serialize → Validate → Reconstruct
// ═══════════════════════════════════════════════════════════════════════

describe("end-to-end partial progress flow", () => {
	it("outcome stamping → serialization → validation preserves all fields", () => {
		// Step 1: Create outcomes for a batch with mixed results
		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed"),
			makeOutcome("TP-002", "succeeded"),
			makeOutcome("TP-003", "stalled"),
		];

		// Step 2: Apply partial progress (simulating preserveFailedLaneProgress result)
		const ppResult: PreserveFailedLaneProgressResult = {
			results: [
				{ saved: true, savedBranch: "saved/henry-TP-001-20260319T140000", commitCount: 3, taskId: "TP-001" },
				{ saved: true, savedBranch: "saved/henry-TP-003-20260319T140000", commitCount: 1, taskId: "TP-003" },
			],
			preservedBranches: new Set(["saved/henry-TP-001-20260319T140000", "saved/henry-TP-003-20260319T140000"]),
			unsafeBranches: new Set(),
		};
		applyPartialProgressToOutcomes(ppResult, outcomes);

		// Step 3: Serialize
		const state = makeRuntimeState({
			phase: "failed",
			endedAt: Date.now(),
			totalTasks: 3,
			failedTasks: 2,
		});
		const wavePlan = [["TP-001", "TP-002", "TP-003"]];
		const lanes = [
			makeLane(1, "task/test-lane-1-batch1", ["TP-001", "TP-002"]),
			makeLane(2, "task/test-lane-2-batch1", ["TP-003"]),
		];

		const json = serializeBatchState(state, wavePlan, lanes, outcomes);
		const parsed = JSON.parse(json);

		// Step 4: Validate (simulating what resume would do)
		const validated = validatePersistedState(parsed);

		// Step 5: Verify round-trip integrity
		const tp001 = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-001");
		expect(tp001!.partialProgressCommits).toBe(3);
		expect(tp001!.partialProgressBranch).toBe("saved/henry-TP-001-20260319T140000");

		const tp002 = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-002");
		expect(tp002!.partialProgressCommits).toBeUndefined();
		expect(tp002!.partialProgressBranch).toBeUndefined();

		const tp003 = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-003");
		expect(tp003!.partialProgressCommits).toBe(1);
		expect(tp003!.partialProgressBranch).toBe("saved/henry-TP-003-20260319T140000");
	});

	it("workspace mode naming flows through to serialized state", () => {
		// Verify workspace mode naming is correct end-to-end
		const branchName = computePartialProgressBranchName("henry", "TP-001", "20260319T140000", "api");
		expect(branchName).toBe("saved/henry-api-TP-001-20260319T140000");

		const outcomes: LaneTaskOutcome[] = [
			makeOutcome("TP-001", "failed", {
				partialProgressCommits: 2,
				partialProgressBranch: branchName,
			}),
		];

		const state = makeRuntimeState({ mode: "workspace" });
		const wavePlan = [["TP-001"]];
		const lanes = [makeLane(1, "task/test-lane-1-batch1", ["TP-001"], "api")];

		const json = serializeBatchState(state, wavePlan, lanes, outcomes);
		const parsed = JSON.parse(json);
		const validated = validatePersistedState(parsed);

		const task = validated.tasks.find((t: Record<string, unknown>) => t.taskId === "TP-001");
		expect(task!.partialProgressBranch).toBe("saved/henry-api-TP-001-20260319T140000");
		expect(task!.partialProgressCommits).toBe(2);
	});
});
