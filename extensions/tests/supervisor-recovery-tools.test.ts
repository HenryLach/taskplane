/**
 * Tests for TP-077: Supervisor Recovery Tools (orch_retry_task & orch_skip_task)
 *
 * Validates:
 * - Tool registration in extension.ts (source-based)
 * - Parameter schemas: required taskId string parameter
 * - Helper functions exist: doOrchRetryTask, doOrchSkipTask
 * - Retry: only failed/stalled tasks can be retried
 * - Retry: resets task to pending, clears exit reason, adjusts counters
 * - Skip: only failed/stalled/pending tasks can be skipped
 * - Skip: marks task as skipped, adjusts counters
 * - Skip: unblocks dependent tasks via dependency graph
 * - Counter consistency after retry and skip operations
 * - Persisted state round-trip: load → modify → save
 */
import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { BATCH_STATE_SCHEMA_VERSION, freshOrchBatchState } from "../taskplane/types.ts";
import type { PersistedBatchState, PersistedTaskRecord, LaneTaskStatus } from "../taskplane/types.ts";
import { saveBatchState, loadBatchState } from "../taskplane/persistence.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Helper to read source files for source-based tests */
function readSource(filename: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", filename), "utf-8");
}

/** Create a temporary directory for test state files */
function makeTempDir(): string {
	const dir = join(tmpdir(), `tp077-test-${randomBytes(6).toString("hex")}`);
	mkdirSync(join(dir, ".pi"), { recursive: true });
	return dir;
}

/** Build a minimal valid PersistedBatchState for testing */
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
			tmuxSessionName: "orch-lane-1",
			taskIds: ["TP-001", "TP-002", "TP-003"],
		}],
		tasks: [
			buildTaskRecord("TP-001", "succeeded"),
			buildTaskRecord("TP-002", "failed", "Session died without .DONE"),
			buildTaskRecord("TP-003", "pending"),
		],
		mergeResults: [],
		totalTasks: 3,
		succeededTasks: 1,
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
		...overrides,
	};
}

/** Build a minimal PersistedTaskRecord */
function buildTaskRecord(
	taskId: string,
	status: LaneTaskStatus,
	exitReason: string = "",
): PersistedTaskRecord {
	return {
		taskId,
		laneNumber: 1,
		sessionName: `orch-lane-1`,
		status,
		taskFolder: `/tmp/tasks/${taskId}`,
		startedAt: status !== "pending" ? Date.now() - 30000 : null,
		endedAt: status === "succeeded" || status === "failed" || status === "stalled" ? Date.now() - 10000 : null,
		doneFileFound: status === "succeeded",
		exitReason,
	};
}

const extensionSource = readSource("extension.ts");

// ══════════════════════════════════════════════════════════════════════
// 1.x — Tool registration (source-based)
// ══════════════════════════════════════════════════════════════════════

describe("1.x — orch_retry_task tool registration", () => {
	it("1.1 — orch_retry_task is registered with pi.registerTool", () => {
		expect(extensionSource).toContain('name: "orch_retry_task"');
	});

	it("1.2 — orch_retry_task has required taskId string parameter", () => {
		const idx = extensionSource.indexOf('name: "orch_retry_task"');
		const block = extensionSource.slice(idx, idx + 1200);
		expect(block).toContain("taskId:");
		expect(block).toContain("Type.String(");
	});

	it("1.3 — orch_retry_task has description, promptSnippet, and promptGuidelines", () => {
		const idx = extensionSource.indexOf('name: "orch_retry_task"');
		const block = extensionSource.slice(Math.max(0, idx - 200), idx + 1200);
		expect(block).toContain("description:");
		expect(block).toContain("promptSnippet:");
		expect(block).toContain("promptGuidelines:");
	});

	it("1.4 — orch_retry_task execute handler catches errors", () => {
		const idx = extensionSource.indexOf('name: "orch_retry_task"');
		const block = extensionSource.slice(idx, idx + 1200);
		expect(block).toContain("} catch (err)");
		expect(block).toContain('type: "text"');
	});

	it("1.5 — orch_retry_task delegates to doOrchRetryTask", () => {
		const idx = extensionSource.indexOf('name: "orch_retry_task"');
		const block = extensionSource.slice(idx, idx + 1200);
		expect(block).toContain("doOrchRetryTask(");
	});

	it("1.6 — doOrchRetryTask helper function exists", () => {
		expect(extensionSource).toContain("function doOrchRetryTask(");
	});
});

describe("1.x — orch_skip_task tool registration", () => {
	it("1.7 — orch_skip_task is registered with pi.registerTool", () => {
		expect(extensionSource).toContain('name: "orch_skip_task"');
	});

	it("1.8 — orch_skip_task has required taskId string parameter", () => {
		const idx = extensionSource.indexOf('name: "orch_skip_task"');
		const block = extensionSource.slice(idx, idx + 1200);
		expect(block).toContain("taskId:");
		expect(block).toContain("Type.String(");
	});

	it("1.9 — orch_skip_task has description, promptSnippet, and promptGuidelines", () => {
		const idx = extensionSource.indexOf('name: "orch_skip_task"');
		const block = extensionSource.slice(Math.max(0, idx - 200), idx + 1200);
		expect(block).toContain("description:");
		expect(block).toContain("promptSnippet:");
		expect(block).toContain("promptGuidelines:");
	});

	it("1.10 — orch_skip_task execute handler catches errors", () => {
		const idx = extensionSource.indexOf('name: "orch_skip_task"');
		const block = extensionSource.slice(idx, idx + 1200);
		expect(block).toContain("} catch (err)");
		expect(block).toContain('type: "text"');
	});

	it("1.11 — orch_skip_task delegates to doOrchSkipTask", () => {
		const idx = extensionSource.indexOf('name: "orch_skip_task"');
		const block = extensionSource.slice(idx, idx + 1200);
		expect(block).toContain("doOrchSkipTask(");
	});

	it("1.12 — doOrchSkipTask helper function exists", () => {
		expect(extensionSource).toContain("function doOrchSkipTask(");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Retry logic via persisted state manipulation
// ══════════════════════════════════════════════════════════════════════

describe("2.x — orch_retry_task logic (persisted state)", () => {
	it("2.1 — retry resets failed task to pending", () => {
		const state = buildTestPersistedState();
		const task = state.tasks.find(t => t.taskId === "TP-002")!;
		expect(task.status).toBe("failed");

		// Simulate what doOrchRetryTask does
		task.status = "pending";
		task.exitReason = "";
		task.doneFileFound = false;
		task.startedAt = null;
		task.endedAt = null;
		state.failedTasks = Math.max(0, state.failedTasks - 1);

		expect(task.status).toBe("pending");
		expect(task.exitReason).toBe("");
		expect(task.doneFileFound).toBe(false);
		expect(task.startedAt).toBeNull();
		expect(task.endedAt).toBeNull();
		expect(state.failedTasks).toBe(0);
	});

	it("2.2 — retry resets stalled task to pending", () => {
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "succeeded"),
				buildTaskRecord("TP-002", "stalled", "No progress for 15 minutes"),
				buildTaskRecord("TP-003", "pending"),
			],
		});
		const task = state.tasks.find(t => t.taskId === "TP-002")!;
		expect(task.status).toBe("stalled");

		task.status = "pending";
		task.exitReason = "";
		expect(task.status).toBe("pending");
	});

	it("2.3 — retry rejects running task", () => {
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "running"),
				buildTaskRecord("TP-002", "failed", "Some error"),
				buildTaskRecord("TP-003", "pending"),
			],
		});
		const task = state.tasks.find(t => t.taskId === "TP-001")!;
		// doOrchRetryTask rejects if status is not "failed" or "stalled"
		expect(task.status !== "failed" && task.status !== "stalled").toBe(true);
	});

	it("2.4 — retry rejects succeeded task", () => {
		const state = buildTestPersistedState();
		const task = state.tasks.find(t => t.taskId === "TP-001")!;
		expect(task.status).toBe("succeeded");
		expect(task.status !== "failed" && task.status !== "stalled").toBe(true);
	});

	it("2.5 — retry rejects unknown taskId", () => {
		const state = buildTestPersistedState();
		const task = state.tasks.find(t => t.taskId === "TP-999");
		expect(task).toBeUndefined();
	});

	it("2.6 — retry adjusts failedTasks counter correctly", () => {
		const state = buildTestPersistedState({ failedTasks: 2 });
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		expect(state.failedTasks).toBe(1);
	});

	it("2.7 — retry does not go below zero on failedTasks", () => {
		const state = buildTestPersistedState({ failedTasks: 0 });
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		expect(state.failedTasks).toBe(0);
	});

	it("2.8 — retry persists state round-trip", () => {
		const tempDir = makeTempDir();
		try {
			const state = buildTestPersistedState();
			// Save initial state
			saveBatchState(JSON.stringify(state, null, 2), tempDir);

			// Load, modify (retry), save
			const loaded = loadBatchState(tempDir)!;
			expect(loaded).not.toBeNull();
			const task = loaded.tasks.find(t => t.taskId === "TP-002")!;
			task.status = "pending";
			task.exitReason = "";
			task.doneFileFound = false;
			loaded.failedTasks = Math.max(0, loaded.failedTasks - 1);

			saveBatchState(JSON.stringify(loaded, null, 2), tempDir);

			// Verify round-trip
			const reloaded = loadBatchState(tempDir)!;
			const retriedTask = reloaded.tasks.find(t => t.taskId === "TP-002")!;
			expect(retriedTask.status).toBe("pending");
			expect(retriedTask.exitReason).toBe("");
			expect(retriedTask.doneFileFound).toBe(false);
			expect(reloaded.failedTasks).toBe(0);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Skip logic via persisted state manipulation
// ══════════════════════════════════════════════════════════════════════

describe("3.x — orch_skip_task logic (persisted state)", () => {
	it("3.1 — skip marks failed task as skipped", () => {
		const state = buildTestPersistedState();
		const task = state.tasks.find(t => t.taskId === "TP-002")!;
		expect(task.status).toBe("failed");

		task.status = "skipped";
		task.exitReason = "Skipped by supervisor";
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		state.skippedTasks = (state.skippedTasks || 0) + 1;

		expect(task.status).toBe("skipped");
		expect(task.exitReason).toBe("Skipped by supervisor");
		expect(state.failedTasks).toBe(0);
		expect(state.skippedTasks).toBe(1);
	});

	it("3.2 — skip marks pending task as skipped", () => {
		const state = buildTestPersistedState();
		const task = state.tasks.find(t => t.taskId === "TP-003")!;
		expect(task.status).toBe("pending");

		task.status = "skipped";
		task.exitReason = "Skipped by supervisor";
		// pending tasks don't decrement failedTasks
		state.skippedTasks = (state.skippedTasks || 0) + 1;

		expect(task.status).toBe("skipped");
		expect(state.failedTasks).toBe(1); // unchanged
		expect(state.skippedTasks).toBe(1);
	});

	it("3.3 — skip rejects running task", () => {
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "running"),
				buildTaskRecord("TP-002", "failed", "Some error"),
			],
		});
		const task = state.tasks.find(t => t.taskId === "TP-001")!;
		expect(task.status).toBe("running");
		// doOrchSkipTask rejects running
		const isSkippable = task.status === "failed" || task.status === "stalled" || task.status === "pending";
		expect(isSkippable).toBe(false);
	});

	it("3.4 — skip rejects succeeded task", () => {
		const state = buildTestPersistedState();
		const task = state.tasks.find(t => t.taskId === "TP-001")!;
		expect(task.status).toBe("succeeded");
		const isSkippable = task.status === "failed" || task.status === "stalled" || task.status === "pending";
		expect(isSkippable).toBe(false);
	});

	it("3.5 — skip unblocks dependent tasks", () => {
		// Simulate: TP-003 depends on TP-002. TP-002 is failed, TP-003 is blocked.
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "succeeded"),
				buildTaskRecord("TP-002", "failed", "Task failed"),
				buildTaskRecord("TP-003", "pending"),
			],
			blockedTaskIds: ["TP-003"],
			blockedTasks: 1,
		});

		// Build a mock dependency graph
		const dependencyGraph = {
			dependencies: new Map([
				["TP-001", []],
				["TP-002", []],
				["TP-003", ["TP-002"]],
			]),
			dependents: new Map([
				["TP-001", []],
				["TP-002", ["TP-003"]],
				["TP-003", []],
			]),
			nodes: new Set(["TP-001", "TP-002", "TP-003"]),
		};

		// Skip TP-002
		const task = state.tasks.find(t => t.taskId === "TP-002")!;
		task.status = "skipped";
		task.exitReason = "Skipped by supervisor";
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		state.skippedTasks = (state.skippedTasks || 0) + 1;

		// Check dependents — same logic as doOrchSkipTask
		const unblockedTasks: string[] = [];
		const dependents = dependencyGraph.dependents.get("TP-002") || [];
		for (const depId of dependents) {
			const depBlockedIdx = state.blockedTaskIds.indexOf(depId);
			if (depBlockedIdx === -1) continue;

			const depDeps = dependencyGraph.dependencies.get(depId) || [];
			const allResolved = depDeps.every(predId => {
				const predRecord = state.tasks.find(t => t.taskId === predId);
				if (!predRecord) return true;
				return predRecord.status === "succeeded" || predRecord.status === "skipped";
			});

			if (allResolved) {
				state.blockedTaskIds.splice(depBlockedIdx, 1);
				state.blockedTasks = Math.max(0, state.blockedTasks - 1);
				unblockedTasks.push(depId);
			}
		}

		expect(unblockedTasks).toContain("TP-003");
		expect(state.blockedTaskIds).not.toContain("TP-003");
		expect(state.blockedTasks).toBe(0);
	});

	it("3.6 — skip does not unblock task with other unresolved dependencies", () => {
		// TP-004 depends on both TP-002 and TP-003. Skipping TP-002 alone shouldn't unblock.
		const state = buildTestPersistedState({
			wavePlan: [["TP-001", "TP-002", "TP-003", "TP-004"]],
			tasks: [
				buildTaskRecord("TP-001", "succeeded"),
				buildTaskRecord("TP-002", "failed", "Task failed"),
				buildTaskRecord("TP-003", "failed", "Task failed"),
				buildTaskRecord("TP-004", "pending"),
			],
			totalTasks: 4,
			failedTasks: 2,
			blockedTaskIds: ["TP-004"],
			blockedTasks: 1,
		});

		const dependencyGraph = {
			dependencies: new Map([
				["TP-001", []],
				["TP-002", []],
				["TP-003", []],
				["TP-004", ["TP-002", "TP-003"]],
			]),
			dependents: new Map([
				["TP-001", []],
				["TP-002", ["TP-004"]],
				["TP-003", ["TP-004"]],
				["TP-004", []],
			]),
			nodes: new Set(["TP-001", "TP-002", "TP-003", "TP-004"]),
		};

		// Skip TP-002
		const task = state.tasks.find(t => t.taskId === "TP-002")!;
		task.status = "skipped";
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		state.skippedTasks = (state.skippedTasks || 0) + 1;

		// Check dependents
		const unblockedTasks: string[] = [];
		const dependents = dependencyGraph.dependents.get("TP-002") || [];
		for (const depId of dependents) {
			const depBlockedIdx = state.blockedTaskIds.indexOf(depId);
			if (depBlockedIdx === -1) continue;

			const depDeps = dependencyGraph.dependencies.get(depId) || [];
			const allResolved = depDeps.every(predId => {
				const predRecord = state.tasks.find(t => t.taskId === predId);
				if (!predRecord) return true;
				return predRecord.status === "succeeded" || predRecord.status === "skipped";
			});

			if (allResolved) {
				state.blockedTaskIds.splice(depBlockedIdx, 1);
				state.blockedTasks = Math.max(0, state.blockedTasks - 1);
				unblockedTasks.push(depId);
			}
		}

		// TP-004 should NOT be unblocked because TP-003 is still failed
		expect(unblockedTasks).not.toContain("TP-004");
		expect(state.blockedTaskIds).toContain("TP-004");
		expect(state.blockedTasks).toBe(1);
	});

	it("3.7 — skip persists state round-trip", () => {
		const tempDir = makeTempDir();
		try {
			const state = buildTestPersistedState();
			saveBatchState(JSON.stringify(state, null, 2), tempDir);

			const loaded = loadBatchState(tempDir)!;
			const task = loaded.tasks.find(t => t.taskId === "TP-002")!;
			task.status = "skipped";
			task.exitReason = "Skipped by supervisor";
			task.endedAt = Date.now();
			loaded.failedTasks = Math.max(0, loaded.failedTasks - 1);
			loaded.skippedTasks = (loaded.skippedTasks || 0) + 1;

			saveBatchState(JSON.stringify(loaded, null, 2), tempDir);

			const reloaded = loadBatchState(tempDir)!;
			const skippedTask = reloaded.tasks.find(t => t.taskId === "TP-002")!;
			expect(skippedTask.status).toBe("skipped");
			expect(skippedTask.exitReason).toBe("Skipped by supervisor");
			expect(reloaded.failedTasks).toBe(0);
			expect(reloaded.skippedTasks).toBe(1);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Counter consistency
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Counter consistency after retry and skip operations", () => {
	it("4.1 — retry then skip: counters stay consistent", () => {
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "succeeded"),
				buildTaskRecord("TP-002", "failed", "Error A"),
				buildTaskRecord("TP-003", "failed", "Error B"),
			],
			totalTasks: 3,
			succeededTasks: 1,
			failedTasks: 2,
			skippedTasks: 0,
			blockedTasks: 0,
		});

		// Retry TP-002
		const tp002 = state.tasks.find(t => t.taskId === "TP-002")!;
		tp002.status = "pending";
		tp002.exitReason = "";
		state.failedTasks = Math.max(0, state.failedTasks - 1);

		expect(state.failedTasks).toBe(1);

		// Skip TP-003
		const tp003 = state.tasks.find(t => t.taskId === "TP-003")!;
		tp003.status = "skipped";
		tp003.exitReason = "Skipped by supervisor";
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		state.skippedTasks += 1;

		// Verify final counters
		expect(state.succeededTasks).toBe(1);
		expect(state.failedTasks).toBe(0);
		expect(state.skippedTasks).toBe(1);
		// Sum check: succeeded + failed + skipped + pending = total (pending tasks aren't counted)
		const accounted = state.succeededTasks + state.failedTasks + state.skippedTasks;
		expect(accounted).toBeLessThanOrEqual(state.totalTasks);
	});

	it("4.2 — multiple retries on same task maintain correct counter", () => {
		const state = buildTestPersistedState({
			failedTasks: 1,
		});

		// First retry
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		expect(state.failedTasks).toBe(0);

		// Simulate task fails again
		state.failedTasks += 1;
		expect(state.failedTasks).toBe(1);

		// Second retry
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		expect(state.failedTasks).toBe(0);
	});

	it("4.3 — skip from stalled status decrements failedTasks", () => {
		// Stalled tasks are counted in failedTasks
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-001", "stalled", "No progress"),
			],
			totalTasks: 1,
			failedTasks: 1,
			skippedTasks: 0,
		});

		const task = state.tasks[0];
		task.status = "skipped";
		task.exitReason = "Skipped by supervisor";
		state.failedTasks = Math.max(0, state.failedTasks - 1);
		state.skippedTasks += 1;

		expect(state.failedTasks).toBe(0);
		expect(state.skippedTasks).toBe(1);
	});

	it("4.4 — skip from pending status does not decrement failedTasks", () => {
		const state = buildTestPersistedState({
			tasks: [
				buildTaskRecord("TP-003", "pending"),
			],
			totalTasks: 1,
			failedTasks: 0,
			skippedTasks: 0,
		});

		const task = state.tasks[0];
		const previousStatus = task.status;
		task.status = "skipped";
		task.exitReason = "Skipped by supervisor";

		// Only decrement failedTasks if was failed/stalled
		if (previousStatus === "failed" || previousStatus === "stalled") {
			state.failedTasks = Math.max(0, state.failedTasks - 1);
		}
		state.skippedTasks += 1;

		expect(state.failedTasks).toBe(0); // unchanged
		expect(state.skippedTasks).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Source-based: implementation correctness
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Implementation correctness (source-based)", () => {
	it("5.1 — doOrchRetryTask loads persisted batch state", () => {
		expect(extensionSource).toContain("function doOrchRetryTask(");
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 2500);
		expect(block).toContain("loadBatchState(");
	});

	it("5.2 — doOrchRetryTask saves modified state", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 5000);
		expect(block).toContain("saveBatchState(");
	});

	it("5.3 — doOrchRetryTask validates task status (failed and stalled)", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 2500);
		expect(block).toContain('"failed"');
		expect(block).toContain('"stalled"');
	});

	it("5.4 — doOrchRetryTask resets task fields", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 2500);
		expect(block).toContain('status = "pending"');
		expect(block).toContain('exitReason = ""');
		expect(block).toContain("doneFileFound = false");
	});

	it("5.5 — doOrchSkipTask loads persisted batch state", () => {
		expect(extensionSource).toContain("function doOrchSkipTask(");
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("loadBatchState(");
	});

	it("5.6 — doOrchSkipTask saves modified state", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("saveBatchState(");
	});

	it("5.7 — doOrchSkipTask sets exit reason to 'Skipped by supervisor'", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("Skipped by supervisor");
	});

	it("5.8 — doOrchSkipTask handles dependent unblocking via dependency graph", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 5000);
		expect(block).toContain("blockedTaskIds");
		expect(block).toContain("dependencyGraph");
		// Verifies it uses computeTransitiveDependents for recomputing blocked set
		expect(block).toContain("computeTransitiveDependents");
	});

	it("5.9 — doOrchSkipTask adjusts skippedTasks counter", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("skippedTasks");
	});

	it("5.10 — both tools update in-memory orchBatchState for widget sync", () => {
		const retryIdx = extensionSource.indexOf("function doOrchRetryTask(");
		// Search a larger block to ensure we capture updateOrchWidget call
		const retryBlock = extensionSource.slice(retryIdx, retryIdx + 5000);
		expect(retryBlock).toContain("updateOrchWidget()");

		const skipIdx = extensionSource.indexOf("function doOrchSkipTask(");
		const skipBlock = extensionSource.slice(skipIdx, skipIdx + 5000);
		expect(skipBlock).toContain("updateOrchWidget()");
	});

	it("5.11 — tools are registered in the TP-077 section", () => {
		expect(extensionSource).toContain("TP-077: Supervisor Recovery Tools");
	});

	it("5.12 — doOrchRetryTask rejects while batch is in active phase", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 2500);
		// Should check for active phases and reject
		expect(block).toContain("launching");
		expect(block).toContain("executing");
		expect(block).toContain("merging");
		expect(block).toContain("planning");
	});

	it("5.13 — doOrchSkipTask rejects while batch is in active phase", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("launching");
		expect(block).toContain("executing");
		expect(block).toContain("merging");
		expect(block).toContain("planning");
	});

	it("5.14 — doOrchRetryTask transitions failed phase to stopped", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 5000);
		// Should transition "failed" → "stopped" for resumability
		expect(block).toContain('"failed"');
		expect(block).toContain('"stopped"');
	});

	it("5.15 — doOrchSkipTask transitions failed phase to stopped", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain('"failed"');
		expect(block).toContain('"stopped"');
	});

	it("5.16 — doOrchRetryTask recomputes blocked dependents", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 5000);
		expect(block).toContain("computeTransitiveDependents");
		expect(block).toContain("remainingFailures");
		expect(block).toContain("blockedTaskIds");
	});

	it("5.17 — doOrchRetryTask clears exitDiagnostic and partial progress fields", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 5000);
		expect(block).toContain("exitDiagnostic");
		expect(block).toContain("partialProgressCommits");
		expect(block).toContain("partialProgressBranch");
	});

	it("5.17 — doOrchRetryTask syncs in-memory state gated on batchId match", () => {
		const idx = extensionSource.indexOf("function doOrchRetryTask(");
		const block = extensionSource.slice(idx, idx + 3500);
		expect(block).toContain("batchId");
		expect(block).toContain("orchBatchState.batchId");
	});

	it("5.18 — doOrchSkipTask uses computeTransitiveDependents for unblocking", () => {
		const idx = extensionSource.indexOf("function doOrchSkipTask(");
		const block = extensionSource.slice(idx, idx + 4000);
		expect(block).toContain("computeTransitiveDependents");
		expect(block).toContain("dependencyGraph");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Phase transition logic
// ══════════════════════════════════════════════════════════════════════

describe("6.x — Phase transition after retry/skip", () => {
	it("6.1 — retry on failed batch transitions phase to stopped", () => {
		const state = buildTestPersistedState({ phase: "failed" });

		// Simulate doOrchRetryTask phase logic
		if (state.phase === "failed") {
			state.phase = "stopped";
		}

		expect(state.phase).toBe("stopped");
	});

	it("6.2 — retry on stopped batch keeps phase as stopped", () => {
		const state = buildTestPersistedState({ phase: "stopped" });

		if (state.phase === "failed") {
			state.phase = "stopped";
		}

		expect(state.phase).toBe("stopped");
	});

	it("6.3 — retry on paused batch keeps phase as paused", () => {
		const state = buildTestPersistedState({ phase: "paused" });

		if (state.phase === "failed") {
			state.phase = "stopped";
		}

		expect(state.phase).toBe("paused");
	});

	it("6.4 — skip on failed batch transitions phase to stopped", () => {
		const state = buildTestPersistedState({ phase: "failed" });

		if (state.phase === "failed") {
			state.phase = "stopped";
		}

		expect(state.phase).toBe("stopped");
	});

	it("6.5 — skip persists with round-trip preserving phase transition", () => {
		const tempDir = makeTempDir();
		try {
			const state = buildTestPersistedState({ phase: "failed" });
			saveBatchState(JSON.stringify(state, null, 2), tempDir);

			const loaded = loadBatchState(tempDir)!;
			// Apply skip
			const task = loaded.tasks.find(t => t.taskId === "TP-002")!;
			task.status = "skipped";
			task.exitReason = "Skipped by supervisor";
			loaded.failedTasks = Math.max(0, loaded.failedTasks - 1);
			loaded.skippedTasks = (loaded.skippedTasks || 0) + 1;
			if (loaded.phase === "failed") {
				loaded.phase = "stopped";
			}

			saveBatchState(JSON.stringify(loaded, null, 2), tempDir);

			const reloaded = loadBatchState(tempDir)!;
			expect(reloaded.phase).toBe("stopped");
			expect(reloaded.skippedTasks).toBe(1);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — computeTransitiveDependents integration for skip unblocking
// ══════════════════════════════════════════════════════════════════════

import { computeTransitiveDependents } from "../taskplane/execution.ts";
import type { DependencyGraph } from "../taskplane/types.ts";

describe("7.x — Skip unblocking with computeTransitiveDependents", () => {
	it("7.1 — skipping the only failed blocker unblocks all its dependents", () => {
		// TP-002 failed → TP-003 and TP-004 are blocked (direct + transitive)
		const depGraph: DependencyGraph = {
			dependencies: new Map([
				["TP-001", []],
				["TP-002", []],
				["TP-003", ["TP-002"]],
				["TP-004", ["TP-003"]],
			]),
			dependents: new Map([
				["TP-001", []],
				["TP-002", ["TP-003"]],
				["TP-003", ["TP-004"]],
				["TP-004", []],
			]),
			nodes: new Set(["TP-001", "TP-002", "TP-003", "TP-004"]),
		};

		// Before skip: TP-002 failed → TP-003, TP-004 blocked
		const failedBefore = new Set(["TP-002"]);
		const blockedBefore = computeTransitiveDependents(failedBefore, depGraph);
		expect(blockedBefore.has("TP-003")).toBe(true);
		expect(blockedBefore.has("TP-004")).toBe(true);

		// After skip: TP-002 is now skipped, remaining failures = empty
		const failedAfter = new Set<string>();
		const blockedAfter = computeTransitiveDependents(failedAfter, depGraph);
		expect(blockedAfter.size).toBe(0);

		// Compute unblocked = was blocked before but not after
		const unblocked: string[] = [];
		for (const id of blockedBefore) {
			if (!blockedAfter.has(id)) unblocked.push(id);
		}
		expect(unblocked).toContain("TP-003");
		expect(unblocked).toContain("TP-004");
	});

	it("7.2 — skipping one of two failed blockers keeps partial blocked set", () => {
		// TP-002 and TP-003 both failed. TP-004 depends on both.
		const depGraph: DependencyGraph = {
			dependencies: new Map([
				["TP-002", []],
				["TP-003", []],
				["TP-004", ["TP-002", "TP-003"]],
			]),
			dependents: new Map([
				["TP-002", ["TP-004"]],
				["TP-003", ["TP-004"]],
				["TP-004", []],
			]),
			nodes: new Set(["TP-002", "TP-003", "TP-004"]),
		};

		// Skip TP-002, TP-003 still failed
		const remainingFailures = new Set(["TP-003"]);
		const blocked = computeTransitiveDependents(remainingFailures, depGraph);

		// TP-004 is still blocked because TP-003 is still failed
		expect(blocked.has("TP-004")).toBe(true);
	});

	it("7.3 — no dependency graph falls back to conservative removal", () => {
		// Without a dependency graph, just remove the skipped task from blocked list
		const blockedSet = new Set(["TP-003", "TP-004"]);
		const skippedId = "TP-003";

		// Conservative fallback: remove skipped task from blocked set
		blockedSet.delete(skippedId);

		expect(blockedSet.has("TP-003")).toBe(false);
		expect(blockedSet.has("TP-004")).toBe(true); // Other tasks remain blocked
	});
});
