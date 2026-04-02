/**
 * Task-Runner Exit Diagnostic Tests — TP-026 Step 3
 *
 * Tests for exit summary reading, diagnostic building, and persistence
 * validation of the exitDiagnostic field.
 *
 * Test categories:
 *   1 — _readExitSummary (missing file, malformed JSON, valid)
 *   2 — _buildExitDiagnostic (kill-reason mapping, missing summary)
 *   3 — Persistence validation (exitDiagnostic: present, absent, invalid shapes)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/task-runner-exit-diagnostic.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	_readExitSummary,
	_buildExitDiagnostic,
	type BuildExitDiagnosticInput,
} from "../task-runner.ts";
import {
	validatePersistedState,
	upsertTaskOutcome,
	syncTaskOutcomesFromMonitor,
} from "../taskplane/persistence.ts";
import type { ExitSummary, TaskExitDiagnostic } from "../taskplane/diagnostics.ts";
import type { LaneTaskOutcome, MonitorState } from "../taskplane/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a unique temp directory for each test. */
function makeTmpDir(): string {
	const dir = join(tmpdir(), `tp026-exit-diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Build a minimal valid ExitSummary with overrides. */
function makeSummary(overrides: Partial<ExitSummary> = {}): ExitSummary {
	return {
		exitCode: 0,
		exitSignal: null,
		tokens: { input: 1000, output: 500, cacheRead: 200, cacheWrite: 100 },
		cost: 0.05,
		toolCalls: 10,
		retries: [],
		compactions: 0,
		durationSec: 60,
		lastToolCall: "bash: echo done",
		error: null,
		...overrides,
	};
}

/** Build a minimal BuildExitDiagnosticInput with overrides. */
function makeInput(overrides: Partial<BuildExitDiagnosticInput> = {}): BuildExitDiagnosticInput {
	return {
		exitSummary: makeSummary(),
		doneFileFound: false,
		timerKilled: false,
		contextKilled: false,
		userKilled: false,
		contextPct: 50,
		durationSec: 120,
		repoId: "default",
		lastKnownStep: 2,
		lastKnownCheckbox: null,
		partialProgressCommits: 0,
		partialProgressBranch: null,
		...overrides,
	};
}

/** Build a minimal valid persisted batch state for validation tests. */
function makeMinimalBatchState(taskOverrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 2,
		phase: "executing",
		batchId: "test-batch-001",
		baseBranch: "main",
		orchBranch: "",
		mode: "repo",
		startedAt: Date.now(),
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		wavePlan: [["task-1"]],
		tasks: [{
			taskId: "task-1",
			sessionName: "orch-lane-1-worker",
			taskFolder: "/tmp/tasks/task-1",
			exitReason: "",
			laneNumber: 1,
			status: "running",
			startedAt: Date.now(),
			endedAt: null,
			doneFileFound: false,
			...taskOverrides,
		}],
		lanes: [{
			laneId: "lane-1",
			laneNumber: 1,
			laneSessionId: "orch-lane-1-worker",
			worktreePath: "/tmp/worktrees/lane-1",
			branch: "task/task-1",
			taskIds: ["task-1"],
		}],
		mergeResults: [],
		blockedTaskIds: [],
		errors: [],
		lastError: null,
	};
}

// ── 1. _readExitSummary ──────────────────────────────────────────────

describe("_readExitSummary", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null for missing file", () => {
		const result = _readExitSummary(join(tmpDir, "nonexistent.json"));
		expect(result).toBeNull();
	});

	it("returns null for empty file", () => {
		const path = join(tmpDir, "empty.json");
		writeFileSync(path, "", "utf-8");
		expect(_readExitSummary(path)).toBeNull();
	});

	it("returns null for whitespace-only file", () => {
		const path = join(tmpDir, "whitespace.json");
		writeFileSync(path, "   \n  \n  ", "utf-8");
		expect(_readExitSummary(path)).toBeNull();
	});

	it("returns null for malformed JSON", () => {
		const path = join(tmpDir, "malformed.json");
		writeFileSync(path, "{ not valid json }", "utf-8");
		expect(_readExitSummary(path)).toBeNull();
	});

	it("returns null for non-object JSON (string)", () => {
		const path = join(tmpDir, "string.json");
		writeFileSync(path, '"just a string"', "utf-8");
		expect(_readExitSummary(path)).toBeNull();
	});

	it("returns null for non-object JSON (array)", () => {
		const path = join(tmpDir, "array.json");
		writeFileSync(path, "[1, 2, 3]", "utf-8");
		expect(_readExitSummary(path)).toBeNull();
	});

	it("returns null for JSON null", () => {
		const path = join(tmpDir, "null.json");
		writeFileSync(path, "null", "utf-8");
		expect(_readExitSummary(path)).toBeNull();
	});

	it("returns parsed ExitSummary for valid JSON", () => {
		const summary = makeSummary({ exitCode: 1, error: "something broke" });
		const path = join(tmpDir, "valid.json");
		writeFileSync(path, JSON.stringify(summary), "utf-8");

		const result = _readExitSummary(path);
		expect(result).not.toBeNull();
		expect(result!.exitCode).toBe(1);
		expect(result!.error).toBe("something broke");
		expect(result!.tokens.input).toBe(1000);
	});

	it("returns parsed summary with trailing whitespace/newlines", () => {
		const summary = makeSummary();
		const path = join(tmpDir, "trailing.json");
		writeFileSync(path, JSON.stringify(summary) + "\n\n", "utf-8");

		const result = _readExitSummary(path);
		expect(result).not.toBeNull();
		expect(result!.exitCode).toBe(0);
	});
});

// ── 2. _buildExitDiagnostic ──────────────────────────────────────────

describe("_buildExitDiagnostic", () => {
	it("classifies completed when .DONE found", () => {
		const diag = _buildExitDiagnostic(makeInput({ doneFileFound: true }));
		expect(diag.classification).toBe("completed");
	});

	it("classifies wall_clock_timeout when timerKilled", () => {
		const diag = _buildExitDiagnostic(makeInput({ timerKilled: true }));
		expect(diag.classification).toBe("wall_clock_timeout");
	});

	it("classifies context_overflow when contextKilled (even without summary)", () => {
		const diag = _buildExitDiagnostic(makeInput({
			exitSummary: null,
			contextKilled: true,
		}));
		expect(diag.classification).toBe("context_overflow");
	});

	it("classifies context_overflow when contextKilled (summary exists, no compactions)", () => {
		const diag = _buildExitDiagnostic(makeInput({
			exitSummary: makeSummary({ compactions: 0, exitCode: 0 }),
			contextKilled: true,
			contextPct: 45,
		}));
		expect(diag.classification).toBe("context_overflow");
	});

	it("classifies user_killed when user killed (not timer, not context)", () => {
		const diag = _buildExitDiagnostic(makeInput({ userKilled: true }));
		expect(diag.classification).toBe("user_killed");
	});

	it("classifies session_vanished when summary missing (no kill signals)", () => {
		const diag = _buildExitDiagnostic(makeInput({ exitSummary: null }));
		expect(diag.classification).toBe("session_vanished");
	});

	it("classifies unknown for clean exit with no .DONE", () => {
		const diag = _buildExitDiagnostic(makeInput());
		expect(diag.classification).toBe("unknown");
	});

	it("populates progress metadata correctly", () => {
		const diag = _buildExitDiagnostic(makeInput({
			durationSec: 300,
			repoId: "my-repo",
			lastKnownStep: 3,
			lastKnownCheckbox: "implement feature X",
			partialProgressCommits: 5,
			partialProgressBranch: "task/TP-001",
			contextPct: 75,
		}));
		expect(diag.durationSec).toBe(300);
		expect(diag.repoId).toBe("my-repo");
		expect(diag.lastKnownStep).toBe(3);
		expect(diag.lastKnownCheckbox).toBe("implement feature X");
		expect(diag.partialProgressCommits).toBe(5);
		expect(diag.partialProgressBranch).toBe("task/TP-001");
		expect(diag.contextPct).toBe(75);
	});

	it("extracts exit summary fields into diagnostic", () => {
		const summary = makeSummary({
			exitCode: 1,
			error: "OOM",
			tokens: { input: 5000, output: 2000, cacheRead: 500, cacheWrite: 100 },
		});
		const diag = _buildExitDiagnostic(makeInput({
			exitSummary: summary,
		}));
		expect(diag.exitCode).toBe(1);
		expect(diag.errorMessage).toBe("OOM");
		expect(diag.tokensUsed).toEqual({ input: 5000, output: 2000, cacheRead: 500, cacheWrite: 100 });
	});

	it("handles null summary fields gracefully", () => {
		const diag = _buildExitDiagnostic(makeInput({ exitSummary: null }));
		expect(diag.exitCode).toBeNull();
		expect(diag.errorMessage).toBeNull();
		expect(diag.tokensUsed).toBeNull();
	});

	it("stallDetected is always false (task-runner level)", () => {
		// The buildExitDiagnostic always passes stallDetected=false
		// since stall detection is orchestrator-level.
		// A clean exit with no signals should never produce stall_timeout.
		const diag = _buildExitDiagnostic(makeInput());
		expect(diag.classification).not.toBe("stall_timeout");
	});
});

// ── 3. Persistence: exitDiagnostic validation ───────────────────────

describe("persistence — exitDiagnostic validation", () => {
	it("accepts state with exitDiagnostic absent (backward compatible)", () => {
		const state = makeMinimalBatchState();
		// No exitDiagnostic field at all
		expect(() => validatePersistedState(state)).not.toThrow();
	});

	it("accepts state with valid exitDiagnostic object", () => {
		const diag: TaskExitDiagnostic = {
			classification: "completed",
			exitCode: 0,
			errorMessage: null,
			tokensUsed: null,
			contextPct: 50,
			partialProgressCommits: 0,
			partialProgressBranch: null,
			durationSec: 120,
			lastKnownStep: 2,
			lastKnownCheckbox: null,
			repoId: "default",
		};
		const state = makeMinimalBatchState({ exitDiagnostic: diag });
		expect(() => validatePersistedState(state)).not.toThrow();
	});

	it("rejects exitDiagnostic that is an array", () => {
		const state = makeMinimalBatchState({ exitDiagnostic: [1, 2, 3] });
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic is not a plain object.*array/);
	});

	it("rejects exitDiagnostic that is a string", () => {
		const state = makeMinimalBatchState({ exitDiagnostic: "completed" });
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic is not a plain object/);
	});

	it("rejects exitDiagnostic that is a number", () => {
		const state = makeMinimalBatchState({ exitDiagnostic: 42 });
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic is not a plain object/);
	});

	it("rejects exitDiagnostic that is null", () => {
		const state = makeMinimalBatchState({ exitDiagnostic: null });
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic is not a plain object/);
	});

	it("rejects exitDiagnostic object without classification field", () => {
		const state = makeMinimalBatchState({
			exitDiagnostic: { exitCode: 0, durationSec: 10 },
		});
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic\.classification is not a string/);
	});

	it("rejects exitDiagnostic with non-string classification", () => {
		const state = makeMinimalBatchState({
			exitDiagnostic: { classification: 42 },
		});
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic\.classification is not a string/);
	});

	it("accepts exitDiagnostic with minimal valid shape (just classification)", () => {
		// Future-proofing: as long as classification is a string, validation passes
		const state = makeMinimalBatchState({
			exitDiagnostic: { classification: "unknown" },
		});
		expect(() => validatePersistedState(state)).not.toThrow();
	});

	it("preserves exitReason alongside exitDiagnostic (additive)", () => {
		const diag: TaskExitDiagnostic = {
			classification: "process_crash",
			exitCode: 1,
			errorMessage: "segfault",
			tokensUsed: null,
			contextPct: null,
			partialProgressCommits: 0,
			partialProgressBranch: null,
			durationSec: 30,
			lastKnownStep: 1,
			lastKnownCheckbox: null,
			repoId: "default",
		};
		const state = makeMinimalBatchState({
			exitReason: "Worker crashed with exit code 1",
			exitDiagnostic: diag,
		});
		// Validate doesn't throw — both fields coexist
		const validated = validatePersistedState(state);
		expect(validated.tasks[0].exitReason).toBe("Worker crashed with exit code 1");
		expect(validated.tasks[0].exitDiagnostic).toBeDefined();
		expect(validated.tasks[0].exitDiagnostic!.classification).toBe("process_crash");
	});
});

// ── Helpers for outcome/monitor tests ────────────────────────────────

/** Build a minimal LaneTaskOutcome. */
// Use a fixed timestamp to avoid flaky Date.now() drift between calls
const FIXED_START = 1700000000000;
function makeOutcome(overrides: Partial<LaneTaskOutcome> = {}): LaneTaskOutcome {
	return {
		taskId: "task-1",
		status: "running",
		startTime: FIXED_START,
		endTime: null,
		exitReason: "Task in progress",
		sessionName: "orch-lane-1-worker",
		doneFileFound: false,
		...overrides,
	};
}

/** Build a sample TaskExitDiagnostic. */
function makeDiag(overrides: Partial<TaskExitDiagnostic> = {}): TaskExitDiagnostic {
	return {
		classification: "process_crash",
		exitCode: 1,
		errorMessage: "segfault",
		tokensUsed: null,
		contextPct: 50,
		partialProgressCommits: 0,
		partialProgressBranch: null,
		durationSec: 60,
		lastKnownStep: 2,
		lastKnownCheckbox: null,
		repoId: "default",
		...overrides,
	};
}

// ── 4. upsertTaskOutcome — exitDiagnostic change detection ──────────

describe("upsertTaskOutcome — exitDiagnostic", () => {
	it("inserts new outcome with exitDiagnostic", () => {
		const outcomes: LaneTaskOutcome[] = [];
		const diag = makeDiag();
		const changed = upsertTaskOutcome(outcomes, makeOutcome({ exitDiagnostic: diag }));
		expect(changed).toBe(true);
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].exitDiagnostic).toBe(diag);
	});

	it("detects change when exitDiagnostic added to existing outcome", () => {
		const diag = makeDiag();
		const outcomes: LaneTaskOutcome[] = [makeOutcome()];
		const changed = upsertTaskOutcome(outcomes, makeOutcome({ exitDiagnostic: diag }));
		expect(changed).toBe(true);
		expect(outcomes[0].exitDiagnostic).toBe(diag);
	});

	it("detects change when exitDiagnostic replaced", () => {
		const diag1 = makeDiag({ classification: "process_crash" });
		const diag2 = makeDiag({ classification: "context_overflow" });
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ exitDiagnostic: diag1 })];
		const changed = upsertTaskOutcome(outcomes, makeOutcome({ exitDiagnostic: diag2 }));
		expect(changed).toBe(true);
		expect(outcomes[0].exitDiagnostic!.classification).toBe("context_overflow");
	});

	it("reports no change when same exitDiagnostic reference", () => {
		const diag = makeDiag();
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ exitDiagnostic: diag })];
		const changed = upsertTaskOutcome(outcomes, makeOutcome({ exitDiagnostic: diag }));
		expect(changed).toBe(false);
	});

	it("preserves exitDiagnostic when other fields unchanged", () => {
		const diag = makeDiag();
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ exitDiagnostic: diag })];
		const changed = upsertTaskOutcome(outcomes, makeOutcome({ exitDiagnostic: diag }));
		expect(changed).toBe(false);
		expect(outcomes[0].exitDiagnostic).toBe(diag);
	});
});

// ── 5. syncTaskOutcomesFromMonitor — exitDiagnostic carry-forward ────

describe("syncTaskOutcomesFromMonitor — exitDiagnostic carry-forward", () => {
	/** Build a minimal MonitorState with one lane. */
	function makeMonitor(overrides: {
		completedTasks?: string[];
		failedTasks?: string[];
		remainingTasks?: string[];
		currentTaskId?: string | null;
		currentTaskSnapshot?: any;
	} = {}): MonitorState {
		return {
			lanes: [{
				laneId: "lane-1",
				laneNumber: 1,
				sessionName: "orch-lane-1-worker",
				sessionAlive: true,
				currentTaskId: overrides.currentTaskId ?? null,
				currentTaskSnapshot: overrides.currentTaskSnapshot ?? null,
				completedTasks: overrides.completedTasks ?? [],
				failedTasks: overrides.failedTasks ?? [],
				remainingTasks: overrides.remainingTasks ?? [],
			}],
			tasksDone: 0,
			tasksFailed: 0,
			tasksTotal: 1,
			waveNumber: 1,
			pollCount: 1,
			lastPollTime: Date.now(),
			allTerminal: false,
		};
	}

	it("carries forward exitDiagnostic for remaining (pending) tasks", () => {
		const diag = makeDiag();
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ taskId: "task-1", exitDiagnostic: diag })];
		const monitor = makeMonitor({ remainingTasks: ["task-1"] });

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		expect(outcomes[0].exitDiagnostic).toBe(diag);
	});

	it("carries forward exitDiagnostic for completed tasks", () => {
		const diag = makeDiag({ classification: "completed" });
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ taskId: "task-1", exitDiagnostic: diag })];
		const monitor = makeMonitor({ completedTasks: ["task-1"] });

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		expect(outcomes[0].exitDiagnostic).toBe(diag);
		expect(outcomes[0].status).toBe("succeeded");
	});

	it("carries forward exitDiagnostic for failed tasks", () => {
		const diag = makeDiag({ classification: "process_crash" });
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ taskId: "task-1", exitDiagnostic: diag })];
		const monitor = makeMonitor({ failedTasks: ["task-1"] });

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		expect(outcomes[0].exitDiagnostic).toBe(diag);
		expect(outcomes[0].status).toBe("failed");
	});

	it("carries forward exitDiagnostic for current task snapshot", () => {
		const diag = makeDiag();
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ taskId: "task-1", exitDiagnostic: diag })];
		const monitor = makeMonitor({
			currentTaskId: "task-1",
			currentTaskSnapshot: {
				taskId: "task-1",
				status: "running",
				currentStepName: "Step 2",
				currentStepNumber: 2,
				totalSteps: 5,
				totalChecked: 3,
				totalItems: 10,
				sessionAlive: true,
				doneFileFound: false,
				stallReason: null,
				lastHeartbeat: Date.now(),
				observedAt: Date.now(),
				parseError: null,
				iteration: 1,
				reviewCounter: 0,
			},
		});

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		expect(outcomes[0].exitDiagnostic).toBe(diag);
	});

	it("does not inject exitDiagnostic when existing outcome has none", () => {
		const outcomes: LaneTaskOutcome[] = [makeOutcome({ taskId: "task-1" })];
		const monitor = makeMonitor({ completedTasks: ["task-1"] });

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		expect(outcomes[0].exitDiagnostic).toBeUndefined();
	});
});

// ── 6. Persistence round-trip (outcome → serialize → validate) ───────

describe("persistence round-trip — exitDiagnostic", () => {
	it("round-trips exitDiagnostic through validation", () => {
		const diag: TaskExitDiagnostic = {
			classification: "wall_clock_timeout",
			exitCode: 137,
			errorMessage: "killed by timer",
			tokensUsed: { input: 5000, output: 2000, cacheRead: 500, cacheWrite: 100 },
			contextPct: 85,
			partialProgressCommits: 3,
			partialProgressBranch: "task/TP-026",
			durationSec: 3600,
			lastKnownStep: 3,
			lastKnownCheckbox: "implement feature",
			repoId: "my-repo",
		};
		const state = makeMinimalBatchState({
			exitReason: "Killed by wall-clock timer",
			exitDiagnostic: diag,
			status: "failed",
		});

		// Validate (simulates load from disk)
		const validated = validatePersistedState(state);
		const task = validated.tasks[0];

		// All diagnostic fields survive the round-trip
		expect(task.exitDiagnostic).toBeDefined();
		expect(task.exitDiagnostic!.classification).toBe("wall_clock_timeout");
		expect(task.exitDiagnostic!.exitCode).toBe(137);
		expect(task.exitDiagnostic!.errorMessage).toBe("killed by timer");
		expect(task.exitDiagnostic!.tokensUsed).toEqual({ input: 5000, output: 2000, cacheRead: 500, cacheWrite: 100 });
		expect(task.exitDiagnostic!.contextPct).toBe(85);
		expect(task.exitDiagnostic!.partialProgressCommits).toBe(3);
		expect(task.exitDiagnostic!.partialProgressBranch).toBe("task/TP-026");
		expect(task.exitDiagnostic!.durationSec).toBe(3600);
		expect(task.exitDiagnostic!.lastKnownStep).toBe(3);
		expect(task.exitDiagnostic!.lastKnownCheckbox).toBe("implement feature");
		expect(task.exitDiagnostic!.repoId).toBe("my-repo");

		// Legacy exitReason also preserved
		expect(task.exitReason).toBe("Killed by wall-clock timer");
	});

	it("validates state without exitDiagnostic (backward compat)", () => {
		const state = makeMinimalBatchState({ status: "succeeded" });
		const validated = validatePersistedState(state);
		expect(validated.tasks[0].exitDiagnostic).toBeUndefined();
	});

	it("rejects corrupted exitDiagnostic in round-trip", () => {
		// Simulate a corrupted state file where exitDiagnostic got mangled
		const state = makeMinimalBatchState({
			exitDiagnostic: { classification: 123, garbage: true },
		});
		expect(() => validatePersistedState(state)).toThrow(/exitDiagnostic\.classification is not a string/);
	});
});
