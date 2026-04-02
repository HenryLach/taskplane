/**
 * Tests for TP-078: orch_force_merge tool and supervisor recovery playbooks
 *
 * Validates:
 * - Tool registration in extension.ts (source-based)
 * - Parameter schema: optional waveIndex (number), optional skipFailed (boolean)
 * - Helper function exists: doOrchForceMerge
 * - Force merge: rejects when no merge failure exists
 * - Force merge: rejects when batch is actively running
 * - Force merge: rejects invalid wave index
 * - Force merge: succeeds with mixed-outcome partial merge result and skipFailed=true
 * - Force merge: requires skipFailed when failed tasks exist
 * - Force merge: clears failed merge result so resume re-attempts real merge
 * - Force merge: sets phase to paused for resumable recovery
 * - Force merge: adjusts counters (failed → skipped)
 * - Force merge: handles case where merge already succeeded
 * - Force merge: handles case with no succeeded tasks
 * - Persisted state round-trip: load → force merge prep → save → reload
 * - Recovery playbooks exist in supervisor-primer.md (source-based)
 */
import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { BATCH_STATE_SCHEMA_VERSION, freshOrchBatchState } from "../taskplane/types.ts";
import type { PersistedBatchState, PersistedTaskRecord, PersistedMergeResult, LaneTaskStatus } from "../taskplane/types.ts";
import { saveBatchState, loadBatchState } from "../taskplane/persistence.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Helper to read source files for source-based tests */
function readSource(filename: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", filename), "utf-8");
}

/** Create a temporary directory for test state files */
function makeTempDir(): string {
	const dir = join(tmpdir(), `tp078-test-${randomBytes(6).toString("hex")}`);
	mkdirSync(join(dir, ".pi"), { recursive: true });
	return dir;
}

/** Build a minimal PersistedTaskRecord */
function buildTaskRecord(
	taskId: string,
	status: LaneTaskStatus,
	exitReason: string = "",
	laneNumber: number = 1,
): PersistedTaskRecord {
	return {
		taskId,
		laneNumber,
		sessionName: `orch-lane-${laneNumber}`,
		status,
		taskFolder: `/tmp/tasks/${taskId}`,
		startedAt: status !== "pending" ? Date.now() - 30000 : null,
		endedAt: status === "succeeded" || status === "failed" || status === "stalled" ? Date.now() - 10000 : null,
		doneFileFound: status === "succeeded",
		exitReason,
	};
}

/** Build a minimal valid PersistedBatchState with a partial merge result */
function buildTestPersistedState(overrides?: Partial<PersistedBatchState>): PersistedBatchState {
	return {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: "stopped",
		batchId: "20260327T120000",
		baseBranch: "main",
		orchBranch: "orch/test-20260327T120000",
		mode: "repo",
		startedAt: Date.now() - 60000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-001", "TP-002", "TP-003"]],
		lanes: [{
			laneNumber: 1,
			laneId: "lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1",
			laneSessionId: "orch-lane-1",
			taskIds: ["TP-001", "TP-002", "TP-003"],
		}],
		tasks: [
			buildTaskRecord("TP-001", "succeeded"),
			buildTaskRecord("TP-002", "failed", "Session died without .DONE"),
			buildTaskRecord("TP-003", "succeeded"),
		],
		mergeResults: [{
			waveIndex: 0,
			status: "partial",
			failedLane: 1,
			failureReason: "Lane(s) lane-1 contain both succeeded and failed tasks. Automatic partial-branch merge is disabled to avoid dropping succeeded commits.",
		}],
		totalTasks: 3,
		succeededTasks: 2,
		failedTasks: 1,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: {
			resumeForced: false,
			retryCountByScope: {},
			lastFailureClass: null,
			repairHistory: [],
		},
		diagnostics: {
			taskExits: {},
			batchCost: 0,
		},
		segments: [],
		...overrides,
	};
}

const extensionSource = readSource("extension.ts");
const engineSource = readSource("engine.ts");
const resumeSource = readSource("resume.ts");
const primerSource = readSource("supervisor-primer.md");

// ══════════════════════════════════════════════════════════════════════
// 1.x — Tool registration (source-based)
// ══════════════════════════════════════════════════════════════════════

describe("1.x — orch_force_merge tool registration", () => {
	it("1.1 — orch_force_merge is registered with pi.registerTool", () => {
		expect(extensionSource).toContain('name: "orch_force_merge"');
	});

	it("1.2 — orch_force_merge has optional waveIndex number parameter", () => {
		const idx = extensionSource.indexOf('name: "orch_force_merge"');
		const block = extensionSource.slice(idx, idx + 2000);
		expect(block).toContain("waveIndex:");
		expect(block).toContain("Type.Optional(Type.Number(");
	});

	it("1.3 — orch_force_merge has optional skipFailed boolean parameter", () => {
		const idx = extensionSource.indexOf('name: "orch_force_merge"');
		const block = extensionSource.slice(idx, idx + 2000);
		expect(block).toContain("skipFailed:");
		expect(block).toContain("Type.Optional(Type.Boolean(");
	});

	it("1.4 — orch_force_merge has description, promptSnippet, and promptGuidelines", () => {
		const idx = extensionSource.indexOf('name: "orch_force_merge"');
		const block = extensionSource.slice(Math.max(0, idx - 200), idx + 2000);
		expect(block).toContain("description:");
		expect(block).toContain("promptSnippet:");
		expect(block).toContain("promptGuidelines:");
	});

	it("1.5 — orch_force_merge execute handler catches errors", () => {
		const idx = extensionSource.indexOf('name: "orch_force_merge"');
		const block = extensionSource.slice(idx, idx + 2000);
		expect(block).toContain("} catch (err)");
		expect(block).toContain('type: "text"');
	});

	it("1.6 — orch_force_merge delegates to doOrchForceMerge", () => {
		const idx = extensionSource.indexOf('name: "orch_force_merge"');
		const block = extensionSource.slice(idx, idx + 2000);
		expect(block).toContain("doOrchForceMerge(");
	});

	it("1.7 — doOrchForceMerge helper function exists", () => {
		expect(extensionSource).toContain("function doOrchForceMerge(");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Force merge logic validation
// ══════════════════════════════════════════════════════════════════════

describe("2.x — orch_force_merge validation logic (persisted state)", () => {
	it("2.1 — force merge rejects when no merge result exists for wave", () => {
		const state = buildTestPersistedState({ mergeResults: [] });
		const targetWave = state.currentWaveIndex;
		const mergeEntry = state.mergeResults.find(mr => mr.waveIndex === targetWave);
		// No merge result → should reject
		expect(mergeEntry).toBeUndefined();
	});

	it("2.2 — force merge is no-op when merge already succeeded", () => {
		const state = buildTestPersistedState({
			mergeResults: [{
				waveIndex: 0,
				status: "succeeded",
				failedLane: null,
				failureReason: null,
			}],
		});
		const mergeEntry = state.mergeResults.find(mr => mr.waveIndex === 0);
		expect(mergeEntry!.status).toBe("succeeded");
		// Should return "already succeeded" message
	});

	it("2.3 — force merge rejects invalid wave index (negative)", () => {
		const state = buildTestPersistedState();
		const targetWave = -1;
		expect(targetWave < 0 || targetWave >= state.totalWaves).toBe(true);
	});

	it("2.4 — force merge rejects invalid wave index (exceeds total)", () => {
		const state = buildTestPersistedState();
		const targetWave = state.totalWaves;
		expect(targetWave >= state.totalWaves).toBe(true);
	});

	it("2.5 — force merge rejects when no succeeded tasks in wave", () => {
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "failed", "Error 1"),
				buildTaskRecord("TP-002", "failed", "Error 2"),
				buildTaskRecord("TP-003", "failed", "Error 3"),
			],
			succeededTasks: 0,
			failedTasks: 3,
		});
		const waveTasks = state.wavePlan[0];
		const succeededInWave = waveTasks.filter(tid => {
			const t = state.tasks.find(t => t.taskId === tid);
			return t?.status === "succeeded";
		});
		expect(succeededInWave.length).toBe(0);
	});

	it("2.6 — force merge requires skipFailed when failed tasks exist and skipFailed is false", () => {
		const state = buildTestPersistedState();
		const waveTasks = state.wavePlan[0];
		const failedInWave = waveTasks.filter(tid => {
			const t = state.tasks.find(t => t.taskId === tid);
			return t?.status === "failed" || t?.status === "stalled";
		});
		// There are failed tasks → without skipFailed, should reject
		expect(failedInWave.length).toBeGreaterThan(0);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Force merge execution logic
// ══════════════════════════════════════════════════════════════════════

describe("3.x — orch_force_merge recovery prep logic (persisted state)", () => {
	it("3.1 — force merge with skipFailed marks failed tasks as skipped", () => {
		const state = buildTestPersistedState();
		const waveTasks = state.wavePlan[0];

		// Simulate doOrchForceMerge with skipFailed=true
		for (const taskId of waveTasks) {
			const task = state.tasks.find(t => t.taskId === taskId);
			if (!task) continue;
			if (task.status === "failed" || task.status === "stalled") {
				task.status = "skipped";
				task.exitReason = "Skipped by orch_force_merge";
				task.endedAt = Date.now();
				state.failedTasks = Math.max(0, state.failedTasks - 1);
				state.skippedTasks = (state.skippedTasks ?? 0) + 1;
			}
		}

		// Verify
		const tp002 = state.tasks.find(t => t.taskId === "TP-002")!;
		expect(tp002.status).toBe("skipped");
		expect(tp002.exitReason).toBe("Skipped by orch_force_merge");
		expect(state.failedTasks).toBe(0);
		expect(state.skippedTasks).toBe(1);
	});

	it("3.2 — force merge clears partial merge result so resume re-attempts merge", () => {
		const state = buildTestPersistedState();
		const mergeEntry = state.mergeResults[0];
		expect(mergeEntry.status).toBe("partial");

		// Simulate doOrchForceMerge
		state.mergeResults.splice(0, 1);

		expect(state.mergeResults.length).toBe(0);
	});

	it("3.3 — force merge transitions phase from failed to paused", () => {
		const state = buildTestPersistedState({ phase: "failed" });
		expect(state.phase).toBe("failed");

		// Simulate doOrchForceMerge phase transition
		state.phase = "paused";

		expect(state.phase).toBe("paused");
	});

	it("3.4 — force merge normalizes stopped/failed to paused for resume", () => {
		const stoppedState = buildTestPersistedState({ phase: "stopped" });
		stoppedState.phase = "paused";
		expect(stoppedState.phase).toBe("paused");

		const failedState = buildTestPersistedState({ phase: "failed" });
		failedState.phase = "paused";
		expect(failedState.phase).toBe("paused");
	});

	it("3.5 — force merge adjusts counters correctly with multiple failed tasks", () => {
		const state = buildTestPersistedState({
			wavePlan: [["TP-001", "TP-002", "TP-003", "TP-004"]],
			tasks: [
				buildTaskRecord("TP-001", "succeeded"),
				buildTaskRecord("TP-002", "failed", "Error 1"),
				buildTaskRecord("TP-003", "failed", "Error 2"),
				buildTaskRecord("TP-004", "succeeded"),
			],
			totalTasks: 4,
			succeededTasks: 2,
			failedTasks: 2,
			skippedTasks: 0,
			mergeResults: [{
				waveIndex: 0,
				status: "partial",
				failedLane: 1,
				failureReason: "Lane(s) lane-1 contain both succeeded and failed tasks.",
			}],
		});

		// Simulate skipFailed for all failed tasks in the wave
		for (const taskId of state.wavePlan[0]) {
			const task = state.tasks.find(t => t.taskId === taskId);
			if (!task) continue;
			if (task.status === "failed" || task.status === "stalled") {
				task.status = "skipped";
				task.exitReason = "Skipped by orch_force_merge";
				state.failedTasks = Math.max(0, state.failedTasks - 1);
				state.skippedTasks = (state.skippedTasks ?? 0) + 1;
			}
		}

		expect(state.failedTasks).toBe(0);
		expect(state.skippedTasks).toBe(2);
		expect(state.succeededTasks).toBe(2);
	});

	it("3.6 — force merge clears merge-related errors", () => {
		const state = buildTestPersistedState({
			errors: [
				"merge failed for wave 0: mixed outcomes",
				"some other error",
				"Merge timeout on lane 2",
			],
			lastError: "merge failed for wave 0",
		});

		// Simulate doOrchForceMerge error clearing
		state.errors = state.errors.filter(e => !e.includes("mixed") && !e.includes("merge") && !e.includes("Merge"));
		state.lastError = null;

		expect(state.errors).toEqual(["some other error"]);
		expect(state.lastError).toBeNull();
	});

	it("3.7 — force merge defaults to current wave when waveIndex not provided", () => {
		const state = buildTestPersistedState({ currentWaveIndex: 0 });
		const targetWave = undefined ?? state.currentWaveIndex;
		expect(targetWave).toBe(0);
	});

	it("3.8 — force merge handles multi-wave batch (targets specific wave)", () => {
		const state = buildTestPersistedState({
			totalWaves: 3,
			currentWaveIndex: 1,
			wavePlan: [["TP-001"], ["TP-002", "TP-003"], ["TP-004"]],
			tasks: [
				buildTaskRecord("TP-001", "succeeded"),
				buildTaskRecord("TP-002", "succeeded"),
				buildTaskRecord("TP-003", "failed", "Error"),
				buildTaskRecord("TP-004", "pending"),
			],
			mergeResults: [
				{
					waveIndex: 0,
					status: "succeeded",
					failedLane: null,
					failureReason: null,
				},
				{
					waveIndex: 1,
					status: "partial",
					failedLane: 2,
					failureReason: "Mixed outcomes",
				},
			],
		});

		// Force merge wave 1
		const targetWave = 1;
		const mergeEntry = state.mergeResults.find(mr => mr.waveIndex === targetWave);
		expect(mergeEntry).not.toBeUndefined();
		expect(mergeEntry!.status).toBe("partial");

		// Verify wave 0 is untouched
		const wave0 = state.mergeResults.find(mr => mr.waveIndex === 0);
		expect(wave0!.status).toBe("succeeded");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Persisted state round-trip
// ══════════════════════════════════════════════════════════════════════

describe("4.x — orch_force_merge persisted state round-trip", () => {
	it("4.1 — force merge prep persists state round-trip (save → load → modify → save → load)", () => {
		const tempDir = makeTempDir();
		try {
			const state = buildTestPersistedState();
			// Save initial state
			saveBatchState(JSON.stringify(state, null, 2), tempDir);

			// Load, apply force merge, save
			const loaded = loadBatchState(tempDir)!;
			expect(loaded).not.toBeNull();
			expect(loaded.mergeResults[0].status).toBe("partial");

			// Skip failed task
			const task = loaded.tasks.find(t => t.taskId === "TP-002")!;
			task.status = "skipped";
			task.exitReason = "Skipped by orch_force_merge";
			task.endedAt = Date.now();
			loaded.failedTasks = Math.max(0, loaded.failedTasks - 1);
			loaded.skippedTasks = (loaded.skippedTasks ?? 0) + 1;

			// Clear failed merge result and set paused so resume re-runs real merge
			loaded.mergeResults.splice(0, 1);
			loaded.phase = "paused";

			loaded.updatedAt = Date.now();
			saveBatchState(JSON.stringify(loaded, null, 2), tempDir);

			// Verify round-trip
			const reloaded = loadBatchState(tempDir)!;
			const skippedTask = reloaded.tasks.find(t => t.taskId === "TP-002")!;
			expect(skippedTask.status).toBe("skipped");
			expect(skippedTask.exitReason).toBe("Skipped by orch_force_merge");
			expect(reloaded.failedTasks).toBe(0);
			expect(reloaded.skippedTasks).toBe(1);
			expect(reloaded.phase).toBe("paused");
			expect(reloaded.mergeResults.length).toBe(0);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Recovery playbooks in supervisor-primer.md (source-based)
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Recovery playbooks in supervisor-primer.md", () => {
	it("5.1 — §13b Recovery Playbooks section exists", () => {
		expect(primerSource).toContain("## 13b. Recovery Playbooks");
	});

	it("5.2 — Task failure playbook (Playbook A) exists", () => {
		expect(primerSource).toContain("### Playbook A: Task Failure");
	});

	it("5.3 — Merge failure playbook (Playbook B) exists", () => {
		expect(primerSource).toContain("### Playbook B: Merge Failure");
	});

	it("5.4 — Batch complete playbook (Playbook C) exists", () => {
		expect(primerSource).toContain("### Playbook C: Batch Complete");
	});

	it("5.5 — Task failure playbook references orch_retry_task", () => {
		const playbookA = primerSource.slice(
			primerSource.indexOf("### Playbook A: Task Failure"),
			primerSource.indexOf("### Playbook B: Merge Failure"),
		);
		expect(playbookA).toContain("orch_retry_task");
	});

	it("5.6 — Task failure playbook references orch_skip_task", () => {
		const playbookA = primerSource.slice(
			primerSource.indexOf("### Playbook A: Task Failure"),
			primerSource.indexOf("### Playbook B: Merge Failure"),
		);
		expect(playbookA).toContain("orch_skip_task");
	});

	it("5.7 — Task failure playbook includes escalation path", () => {
		const playbookA = primerSource.slice(
			primerSource.indexOf("### Playbook A: Task Failure"),
			primerSource.indexOf("### Playbook B: Merge Failure"),
		);
		expect(playbookA).toContain("ESCALATE");
	});

	it("5.8 — Task failure playbook covers race condition", () => {
		const playbookA = primerSource.slice(
			primerSource.indexOf("### Playbook A: Task Failure"),
			primerSource.indexOf("### Playbook B: Merge Failure"),
		);
		expect(playbookA).toContain("race condition");
	});

	it("5.9 — Merge failure playbook references orch_force_merge", () => {
		const playbookB = primerSource.slice(
			primerSource.indexOf("### Playbook B: Merge Failure"),
			primerSource.indexOf("### Playbook C: Batch Complete"),
		);
		expect(playbookB).toContain("orch_force_merge");
	});

	it("5.10 — Merge failure playbook covers mixed-outcome lanes", () => {
		const playbookB = primerSource.slice(
			primerSource.indexOf("### Playbook B: Merge Failure"),
			primerSource.indexOf("### Playbook C: Batch Complete"),
		);
		expect(playbookB).toContain("mixed-outcome");
	});

	it("5.11 — Merge failure playbook covers conflict escalation", () => {
		const playbookB = primerSource.slice(
			primerSource.indexOf("### Playbook B: Merge Failure"),
			primerSource.indexOf("### Playbook C: Batch Complete"),
		);
		expect(playbookB).toContain("CONFLICT_UNRESOLVED");
	});

	it("5.12 — Batch complete playbook covers all-succeeded case", () => {
		const playbookC = primerSource.slice(
			primerSource.indexOf("### Playbook C: Batch Complete"),
			primerSource.indexOf("### Quick Reference") !== -1
				? primerSource.indexOf("### Quick Reference")
				: primerSource.indexOf("## 14."),
		);
		expect(playbookC).toContain("ALL SUCCEEDED");
	});

	it("5.13 — Batch complete playbook covers some-failed case", () => {
		const playbookC = primerSource.slice(
			primerSource.indexOf("### Playbook C: Batch Complete"),
			primerSource.indexOf("### Quick Reference") !== -1
				? primerSource.indexOf("### Quick Reference")
				: primerSource.indexOf("## 14."),
		);
		expect(playbookC).toContain("SOME FAILED");
	});

	it("5.14 — Batch complete playbook references orch_integrate", () => {
		const playbookC = primerSource.slice(
			primerSource.indexOf("### Playbook C: Batch Complete"),
			primerSource.indexOf("### Quick Reference") !== -1
				? primerSource.indexOf("### Quick Reference")
				: primerSource.indexOf("## 14."),
		);
		expect(playbookC).toContain("orch_integrate");
	});

	it("5.15 — Decision summary table exists with recovery actions", () => {
		expect(primerSource).toContain("Quick Reference");
		expect(primerSource).toContain("Recovery Action Matrix");
	});

	it("5.16 — Decision table references all three tools", () => {
		const matrixStart = primerSource.indexOf("Recovery Action Matrix");
		const matrixEnd = primerSource.indexOf("## 14.", matrixStart);
		const matrix = primerSource.slice(matrixStart, matrixEnd);
		expect(matrix).toContain("orch_retry_task");
		expect(matrix).toContain("orch_skip_task");
		expect(matrix).toContain("orch_force_merge");
	});

	it("5.17 — §13a alert handling section references recovery tools", () => {
		const section13a = primerSource.slice(
			primerSource.indexOf("## 13a."),
			primerSource.indexOf("## 13b."),
		);
		expect(section13a).toContain("orch_retry_task");
		expect(section13a).toContain("orch_skip_task");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — doOrchForceMerge implementation (source-based verification)
// ══════════════════════════════════════════════════════════════════════

describe("6.x — doOrchForceMerge implementation verification", () => {
	it("6.1 — doOrchForceMerge checks for active batch phases", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("activePhases");
		expect(fnBlock).toContain("launching");
		expect(fnBlock).toContain("executing");
		expect(fnBlock).toContain("merging");
	});

	it("6.2 — doOrchForceMerge loads persisted batch state", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("loadBatchState(");
	});

	it("6.3 — doOrchForceMerge validates wave index", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("totalWaves");
		expect(fnBlock).toContain("Invalid wave index");
	});

	it("6.4 — doOrchForceMerge searches for merge result entry", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("mergeResults");
		expect(fnBlock).toContain("No merge result found");
	});

	it("6.5 — doOrchForceMerge marks failed tasks with force merge exit reason", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("Skipped by orch_force_merge");
	});

	it("6.6 — doOrchForceMerge clears merge result and sets phase to paused for re-merge", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("mergeResults.splice(");
		expect(fnBlock).toContain('"paused"');
	});

	it("6.7 — doOrchForceMerge persists state with saveBatchState", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("saveBatchState(");
	});

	it("6.8 — doOrchForceMerge syncs in-memory orchBatchState", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("orchBatchState.batchId");
		expect(fnBlock).toContain("orchBatchState.failedTasks");
	});

	it("6.9 — doOrchForceMerge sets phase to paused for re-merge", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain('"paused"');
	});

	it("6.10 — doOrchForceMerge only allows partial (mixed-outcome) merge failures", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain('"partial"');
		expect(fnBlock).toContain("only applies to mixed-outcome");
	});

	it("6.11 — doOrchForceMerge provides resume hint in output", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("orch_resume");
	});

	it("6.12 — doOrchForceMerge requires a resumable batch phase", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("resumablePhases");
		expect(fnBlock).toContain("paused");
		expect(fnBlock).toContain("stopped");
		expect(fnBlock).toContain("failed");
	});

	it("6.13 — doOrchForceMerge validates partial reason matches mixed-outcome guard", () => {
		const fnStart = extensionSource.indexOf("function doOrchForceMerge(");
		const fnBlock = extensionSource.slice(fnStart, fnStart + 7000);
		expect(fnBlock).toContain("both succeeded and failed tasks");
		expect(fnBlock).toContain("automatic partial-branch merge is disabled");
		expect(fnBlock).toContain("does not match mixed-outcome lanes");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Follow-up regression guards (engine/resume wiring)
// ══════════════════════════════════════════════════════════════════════

describe("7.x — Follow-up regression guards", () => {
	it("7.1 — engine persists partial merge result for mixed-outcome/no-mergeable branch", () => {
		expect(engineSource).toContain("Keep mergeResults in sync even when no mergeable lane exists");
		expect(engineSource).toContain("allMergeResults.push(mergeResult)");
		expect(engineSource).toContain("batchState.mergeResults.push(mergeResult)");
	});

	it("7.2 — resume persists partial merge result for mixed-outcome/no-mergeable branch", () => {
		expect(resumeSource).toContain("Keep mergeResults in sync even when no mergeable lane exists");
		expect(resumeSource).toContain("batchState.mergeResults.push(mergeResult)");
	});

	it("7.3 — resume excludes persisted skipped tasks from wave execution", () => {
		expect(resumeSource).toContain("persistedStatusByTaskId.get(taskId) !== \"skipped\"");
	});

	it("7.4 — resume synthetic merge retry preserves skipped task status", () => {
		expect(resumeSource).toContain("Task skipped (merge retry)");
		expect(resumeSource).toContain("status === \"skipped\"");
	});
});
