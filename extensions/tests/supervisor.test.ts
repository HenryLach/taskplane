/**
 * Supervisor Agent Tests — TP-041 Step 5
 *
 * Tests for the supervisor agent module (supervisor.ts):
 *
 *   1.x — System prompt: buildSupervisorSystemPrompt correctness
 *   2.x — Lockfile: write/read/remove + field validation
 *   3.x — Heartbeat: isLockStale detection + staleness threshold
 *   4.x — Takeover: checkSupervisorLockOnStartup + buildTakeoverSummary
 *   5.x — Event notifications: parseJsonlLines, formatEventNotification, shouldNotify, processEvents
 *   6.x — Audit trail: appendAuditEntry, readAuditTrail, logRecoveryAction
 *   7.x — Recovery classification: requiresConfirmation decision matrix
 *   8.x — Activation/deactivation: state lifecycle, freshSupervisorState
 *
 * Run: npx vitest run tests/supervisor.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	buildSupervisorSystemPrompt,
	freshSupervisorState,
	resolveSupervisorConfig,
	DEFAULT_SUPERVISOR_CONFIG,
	// Lockfile
	writeLockfile,
	readLockfile,
	removeLockfile,
	lockfilePath,
	isLockStale,
	isProcessAlive,
	isBatchTerminal,
	HEARTBEAT_INTERVAL_MS,
	STALE_LOCK_THRESHOLD_MS,
	// Startup + takeover
	checkSupervisorLockOnStartup,
	buildTakeoverSummary,
	// Event tailer
	readNewBytes,
	parseJsonlLines,
	formatEventNotification,
	formatTaskDigest,
	shouldNotify,
	processEvents,
	freshEventTailerState,
	startEventTailer,
	stopEventTailer,
	startHeartbeat,
	EVENT_POLL_INTERVAL_MS,
	TASK_DIGEST_INTERVAL_MS,
	// Audit trail
	appendAuditEntry,
	logRecoveryAction,
	readAuditTrail,
	auditTrailPath,
	// Recovery classification
	requiresConfirmation,
	ACTION_CLASSIFICATION_EXAMPLES,
} from "../taskplane/supervisor.ts";

import type {
	SupervisorLockfile,
	SupervisorState,
	SupervisorConfig,
	SupervisorAutonomyLevel,
	RecoveryActionClassification,
	AuditTrailEntry,
	EventTailerState,
	LockfileCheckResult,
} from "../taskplane/supervisor.ts";

import { freshOrchBatchState, DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";
import type { PersistedBatchState } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

// ═════════════════════════════════════════════════════════════════════
// Test helpers
// ═════════════════════════════════════════════════════════════════════

/** Create a temp directory for tests */
function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "supervisor-test-"));
}

/** Create a minimal batch state for testing prompt generation */
function makeTestBatchState(overrides?: Partial<ReturnType<typeof freshOrchBatchState>>) {
	const state = freshOrchBatchState();
	state.batchId = "20260322T120000";
	state.baseBranch = "main";
	state.orchBranch = "orch/test-20260322T120000";
	state.phase = "executing";
	state.totalWaves = 3;
	state.currentWaveIndex = 1;
	state.totalTasks = 10;
	state.succeededTasks = 4;
	state.failedTasks = 1;
	state.skippedTasks = 0;
	state.blockedTasks = 0;
	if (overrides) Object.assign(state, overrides);
	return state;
}

/** Create a minimal persisted batch state for testing */
function makePersistedBatchState(overrides?: Partial<PersistedBatchState>): PersistedBatchState {
	return {
		schemaVersion: 3,
		phase: "executing",
		batchId: "20260322T120000",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: Date.now(),
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 1,
		totalWaves: 3,
		wavePlan: [["T-001", "T-002"], ["T-003"], ["T-004"]],
		lanes: [],
		tasks: [
			{ taskId: "T-001", status: "succeeded", laneNumber: 1, waveIndex: 0, startedAt: 0, endedAt: 0 } as any,
			{ taskId: "T-002", status: "failed", laneNumber: 2, waveIndex: 0, startedAt: 0, endedAt: 0 } as any,
			{ taskId: "T-003", status: "running", laneNumber: 1, waveIndex: 1, startedAt: 0, endedAt: null } as any,
			{ taskId: "T-004", status: "pending", laneNumber: 0, waveIndex: 2, startedAt: 0, endedAt: null } as any,
		],
		mergeResults: [],
		totalTasks: 4,
		succeededTasks: 1,
		failedTasks: 1,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: { retryBudgets: {}, waveRetryBudgets: {} } as any,
		diagnostics: {} as any,
		...overrides,
	};
}

/** Write a JSONL line to the events file */
function writeEventLine(stateRoot: string, event: Record<string, unknown>): void {
	const dir = join(stateRoot, ".pi", "supervisor");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const path = join(dir, "events.jsonl");
	const line = JSON.stringify(event) + "\n";
	const { appendFileSync } = require("fs");
	appendFileSync(path, line, "utf-8");
}

// ═════════════════════════════════════════════════════════════════════
// 1.x — System Prompt
// ═════════════════════════════════════════════════════════════════════

describe("1.x — Supervisor system prompt: buildSupervisorSystemPrompt", () => {
	it("1.1: prompt includes batch metadata", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("20260322T120000");
		expect(prompt).toContain("main");
		expect(prompt).toContain("executing");
		expect(prompt).toContain("2/3 waves"); // currentWaveIndex=1 → wave 2 of 3
		expect(prompt).toContain("10 total tasks");
	});

	it("1.2: prompt includes key file paths", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("batch-state.json");
		expect(prompt).toContain("events.jsonl");
		expect(prompt).toContain("actions.jsonl");
	});

	it("1.3: prompt includes identity and standing orders", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("batch supervisor");
		expect(prompt).toContain("Monitor engine events");
		expect(prompt).toContain("Handle failures");
		expect(prompt).toContain("Keep the operator informed");
		expect(prompt).toContain("Log all recovery actions");
	});

	it("1.4: prompt references supervisor primer", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("supervisor-primer.md");
		expect(prompt).toContain("operational runbook");
	});

	it("1.5: prompt adapts to interactive autonomy level", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "interactive" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("INTERACTIVE");
		expect(prompt).toContain("ASK the operator");
	});

	it("1.6: prompt adapts to autonomous autonomy level", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "autonomous" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("AUTONOMOUS");
		expect(prompt).toContain("Execute all recovery actions automatically");
	});

	it("1.7: prompt includes recovery action classification table", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("Diagnostic");
		expect(prompt).toContain("Tier 0 Known");
		expect(prompt).toContain("Destructive");
		expect(prompt).toContain("auto");
		expect(prompt).toContain("ASK");
	});

	it("1.8: prompt includes audit trail instructions", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("Audit Trail");
		expect(prompt).toContain("pending");
		expect(prompt).toContain("destructive");
		expect(prompt).toContain("actions.jsonl");
	});

	it("1.9: prompt includes what-you-must-never-do list", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("Never `git push`");
		expect(prompt).toContain("Never `git reset --hard`");
	});

	it("1.10: prompt handles pre-planning batchId gracefully", () => {
		const batchState = makeTestBatchState({ batchId: "", totalWaves: 0 });
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		// Should fallback gracefully instead of showing empty string
		expect(prompt).toContain("initializing");
		expect(prompt).toContain("planning");
	});

	it("1.11: prompt includes task counters (succeeded, failed, skipped, blocked)", () => {
		const batchState = makeTestBatchState({
			succeededTasks: 4,
			failedTasks: 1,
			skippedTasks: 2,
			blockedTasks: 3,
		});
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };
		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, "/tmp/test");

		expect(prompt).toContain("4");
		expect(prompt).toContain("1");
		expect(prompt).toContain("2");
		expect(prompt).toContain("3");
	});
});

describe("1.x — Supervisor prompt injection in extension.ts", () => {
	it("1.12: extension.ts imports and uses activateSupervisor", () => {
		const extSource = readSource("extension.ts");
		expect(extSource).toContain("activateSupervisor");
		expect(extSource).toContain("deactivateSupervisor");
		expect(extSource).toContain("registerSupervisorPromptHook");
	});

	it("1.13: doOrchStart calls activateSupervisor after startBatchAsync", () => {
		const extSource = readSource("extension.ts");
		// The batch-start logic now lives in doOrchStart
		const doOrchStartBody = extSource.substring(
			extSource.indexOf("function doOrchStart("),
			extSource.indexOf("function doOrchStatus("),
		);
		expect(doOrchStartBody).toContain("activateSupervisor");
		// Should be after startBatchAsync
		const startAsyncIdx = doOrchStartBody.indexOf("startBatchAsync(");
		expect(startAsyncIdx).not.toBe(-1);
		const activateIdxAfterBatch = doOrchStartBody.indexOf("activateSupervisor(", startAsyncIdx);
		expect(activateIdxAfterBatch).not.toBe(-1);
		expect(activateIdxAfterBatch).toBeGreaterThan(startAsyncIdx);
	});

	it("1.14: extension.ts registers before_agent_start hook for supervisor prompt", () => {
		const extSource = readSource("extension.ts");
		expect(extSource).toContain("registerSupervisorPromptHook(pi, supervisorState)");
	});

	it("1.15: deactivateSupervisor called on all terminal paths (completed, failed, stopped, abort)", () => {
		const extSource = readSource("extension.ts");
		// Must appear in the terminal callback of startBatchAsync
		const deactivateCount = (extSource.match(/deactivateSupervisor/g) || []).length;
		// At minimum: import + definition + /orch terminal + /orch-resume terminal + /orch-abort
		expect(deactivateCount).toBeGreaterThanOrEqual(4);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 2.x — Lockfile
// ═════════════════════════════════════════════════════════════════════

describe("2.x — Lockfile: write/read/remove + field validation", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("2.1: writeLockfile creates lockfile with all required fields", () => {
		const lock: SupervisorLockfile = {
			pid: 12345,
			sessionId: "pi-12345-1000",
			batchId: "20260322T120000",
			startedAt: "2026-03-22T12:00:00.000Z",
			heartbeat: "2026-03-22T12:00:00.000Z",
		};
		writeLockfile(tmpDir, lock);

		const path = lockfilePath(tmpDir);
		expect(existsSync(path)).toBe(true);

		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw);
		expect(parsed.pid).toBe(12345);
		expect(parsed.sessionId).toBe("pi-12345-1000");
		expect(parsed.batchId).toBe("20260322T120000");
		expect(parsed.startedAt).toBe("2026-03-22T12:00:00.000Z");
		expect(parsed.heartbeat).toBe("2026-03-22T12:00:00.000Z");
	});

	it("2.2: readLockfile parses valid lockfile", () => {
		const lock: SupervisorLockfile = {
			pid: 42,
			sessionId: "test-session",
			batchId: "batch-1",
			startedAt: "2026-03-22T10:00:00Z",
			heartbeat: "2026-03-22T10:00:30Z",
		};
		writeLockfile(tmpDir, lock);

		const result = readLockfile(tmpDir);
		expect(result).not.toBeNull();
		expect(result!.pid).toBe(42);
		expect(result!.sessionId).toBe("test-session");
	});

	it("2.3: readLockfile returns null for missing lockfile", () => {
		const result = readLockfile(tmpDir);
		expect(result).toBeNull();
	});

	it("2.4: readLockfile returns null for corrupt lockfile", () => {
		const dir = join(tmpDir, ".pi", "supervisor");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "lock.json"), "not valid json{{{", "utf-8");

		const result = readLockfile(tmpDir);
		expect(result).toBeNull();
	});

	it("2.5: readLockfile returns null for lockfile with missing fields", () => {
		const dir = join(tmpDir, ".pi", "supervisor");
		mkdirSync(dir, { recursive: true });
		// Missing sessionId
		writeFileSync(join(dir, "lock.json"), JSON.stringify({ pid: 1, batchId: "x" }), "utf-8");

		const result = readLockfile(tmpDir);
		expect(result).toBeNull();
	});

	it("2.6: removeLockfile deletes the lockfile", () => {
		const lock: SupervisorLockfile = {
			pid: 1,
			sessionId: "s",
			batchId: "b",
			startedAt: "t",
			heartbeat: "t",
		};
		writeLockfile(tmpDir, lock);
		expect(existsSync(lockfilePath(tmpDir))).toBe(true);

		removeLockfile(tmpDir);
		expect(existsSync(lockfilePath(tmpDir))).toBe(false);
	});

	it("2.7: removeLockfile is safe when lockfile doesn't exist", () => {
		// Should not throw
		expect(() => removeLockfile(tmpDir)).not.toThrow();
	});

	it("2.8: writeLockfile creates .pi/supervisor directory if missing", () => {
		const dir = join(tmpDir, ".pi", "supervisor");
		expect(existsSync(dir)).toBe(false);

		writeLockfile(tmpDir, {
			pid: 1, sessionId: "s", batchId: "b", startedAt: "t", heartbeat: "t",
		});

		expect(existsSync(dir)).toBe(true);
	});

	it("2.9: writeLockfile uses atomic write (temp + rename)", () => {
		const supervisorSource = readSource("supervisor.ts");
		// Check that writeLockfile uses temp file + rename pattern
		const writeFn = supervisorSource.substring(
			supervisorSource.indexOf("function writeLockfile("),
			supervisorSource.indexOf("function removeLockfile("),
		);
		expect(writeFn).toContain(".tmp");
		expect(writeFn).toContain("renameSync");
	});

	it("2.10: lockfilePath resolves to .pi/supervisor/lock.json", () => {
		const path = lockfilePath("/project/root");
		expect(path).toContain(".pi");
		expect(path).toContain("supervisor");
		expect(path).toContain("lock.json");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 3.x — Heartbeat
// ═════════════════════════════════════════════════════════════════════

describe("3.x — Heartbeat: isLockStale detection", () => {
	it("3.1: fresh heartbeat is not stale", () => {
		const lock: SupervisorLockfile = {
			pid: process.pid,
			sessionId: "s",
			batchId: "b",
			startedAt: new Date().toISOString(),
			heartbeat: new Date().toISOString(),
		};
		expect(isLockStale(lock)).toBe(false);
	});

	it("3.2: heartbeat older than threshold is stale", () => {
		const old = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS - 1000).toISOString();
		const lock: SupervisorLockfile = {
			pid: process.pid,
			sessionId: "s",
			batchId: "b",
			startedAt: old,
			heartbeat: old,
		};
		expect(isLockStale(lock)).toBe(true);
	});

	it("3.3: heartbeat exactly at threshold boundary is not stale", () => {
		// Just within the threshold — should not be stale
		const recent = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS + 5000).toISOString();
		const lock: SupervisorLockfile = {
			pid: process.pid,
			sessionId: "s",
			batchId: "b",
			startedAt: recent,
			heartbeat: recent,
		};
		expect(isLockStale(lock)).toBe(false);
	});

	it("3.4: invalid heartbeat date is treated as stale", () => {
		const lock: SupervisorLockfile = {
			pid: process.pid,
			sessionId: "s",
			batchId: "b",
			startedAt: "2026-01-01T00:00:00Z",
			heartbeat: "invalid-date",
		};
		expect(isLockStale(lock)).toBe(true);
	});

	it("3.5: isProcessAlive returns true for current process", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	it("3.6: isProcessAlive returns false for non-existent PID", () => {
		// Use a PID that's very unlikely to exist
		expect(isProcessAlive(999999999)).toBe(false);
	});

	it("3.7: HEARTBEAT_INTERVAL_MS is 30 seconds", () => {
		expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
	});

	it("3.8: STALE_LOCK_THRESHOLD_MS is 90 seconds (3x heartbeat)", () => {
		expect(STALE_LOCK_THRESHOLD_MS).toBe(90_000);
		expect(STALE_LOCK_THRESHOLD_MS).toBe(HEARTBEAT_INTERVAL_MS * 3);
	});

	it("3.9: heartbeat updates lockfile timestamp on interval (behavioral)", async () => {
		vi.useFakeTimers();
		const dir = makeTmpDir();
		try {
			const state = freshSupervisorState();
			state.active = true;
			state.stateRoot = dir;
			state.lockSessionId = "session-1";

			writeLockfile(dir, {
				pid: process.pid,
				sessionId: "session-1",
				batchId: "batch-1",
				startedAt: "2026-01-01T00:00:00.000Z",
				heartbeat: "2026-01-01T00:00:00.000Z",
			});

			const pi = { sendMessage: vi.fn(), setModel: vi.fn().mockResolvedValue(true) } as any;
			const timer = startHeartbeat(dir, state, pi);
			const before = readLockfile(dir)?.heartbeat;
			expect(before).toBe("2026-01-01T00:00:00.000Z");

			await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 5);
			// TP-070: heartbeat is now async — allow async I/O to settle
			vi.useRealTimers();
			await new Promise(r => setTimeout(r, 200));
			const after = readLockfile(dir)?.heartbeat;
			expect(after).toBeDefined();
			expect(after).not.toBe(before);

			state.active = false;
			clearInterval(timer);
		} finally {
			vi.useRealTimers();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("3.10: heartbeat timer is started on activation and stored on state", () => {
		const supervisorSource = readSource("supervisor.ts");
		// activateSupervisor must start heartbeat
		const activateFn = supervisorSource.substring(
			supervisorSource.indexOf("async function activateSupervisor("),
			supervisorSource.indexOf("async function deactivateSupervisor("),
		);
		expect(activateFn).toContain("startHeartbeat(");
		expect(activateFn).toContain("state.heartbeatTimer");
	});

	it("3.11: deactivation clears heartbeat timer", () => {
		const supervisorSource = readSource("supervisor.ts");
		const deactivateFn = supervisorSource.substring(
			supervisorSource.indexOf("async function deactivateSupervisor("),
			supervisorSource.indexOf("function registerSupervisorPromptHook("),
		);
		expect(deactivateFn).toContain("clearInterval(state.heartbeatTimer)");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 4.x — Takeover
// ═════════════════════════════════════════════════════════════════════

describe("4.x — Takeover: checkSupervisorLockOnStartup", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("4.1: returns no-active-batch when loadBatchState returns null", () => {
		const result = checkSupervisorLockOnStartup(tmpDir, () => null);
		expect(result.status).toBe("no-active-batch");
	});

	it("4.2: returns no-active-batch for terminal phase (completed)", () => {
		const state = makePersistedBatchState({ phase: "completed" as any });
		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("no-active-batch");
	});

	it("4.3: returns no-active-batch for terminal phase (idle)", () => {
		const state = makePersistedBatchState({ phase: "idle" as any });
		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("no-active-batch");
	});

	it("4.4: returns no-lockfile when active batch but no lock", () => {
		const state = makePersistedBatchState({ phase: "executing" as any });
		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("no-lockfile");
		if (result.status === "no-lockfile") {
			expect(result.batchState).toBeDefined();
		}
	});

	it("4.5: returns stale when lock exists with dead PID", () => {
		const state = makePersistedBatchState({ phase: "executing" as any });
		const lock: SupervisorLockfile = {
			pid: 999999999, // Non-existent PID
			sessionId: "old-session",
			batchId: "batch-1",
			startedAt: "2026-03-22T10:00:00Z",
			heartbeat: new Date().toISOString(), // Recent heartbeat but dead PID
		};
		writeLockfile(tmpDir, lock);

		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("stale");
		if (result.status === "stale") {
			expect(result.lock.sessionId).toBe("old-session");
		}
	});

	it("4.6: returns stale when lock exists with stale heartbeat", () => {
		const state = makePersistedBatchState({ phase: "executing" as any });
		const old = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS - 10_000).toISOString();
		const lock: SupervisorLockfile = {
			pid: process.pid, // Alive PID but stale heartbeat
			sessionId: "old-session",
			batchId: "batch-1",
			startedAt: old,
			heartbeat: old,
		};
		writeLockfile(tmpDir, lock);

		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("stale");
	});

	it("4.7: returns live when lock exists with alive PID and fresh heartbeat", () => {
		const state = makePersistedBatchState({ phase: "executing" as any });
		const lock: SupervisorLockfile = {
			pid: process.pid, // Current process = alive
			sessionId: "live-session",
			batchId: "batch-1",
			startedAt: new Date().toISOString(),
			heartbeat: new Date().toISOString(),
		};
		writeLockfile(tmpDir, lock);

		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("live");
		if (result.status === "live") {
			expect(result.lock.sessionId).toBe("live-session");
		}
	});

	it("4.8: returns corrupt when lockfile exists but is malformed", () => {
		const state = makePersistedBatchState({ phase: "executing" as any });
		const dir = join(tmpDir, ".pi", "supervisor");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "lock.json"), "{{corrupt}}", "utf-8");

		const result = checkSupervisorLockOnStartup(tmpDir, () => state);
		expect(result.status).toBe("corrupt");
	});

	it("4.9: isBatchTerminal correctly classifies phases", () => {
		expect(isBatchTerminal("idle")).toBe(true);
		expect(isBatchTerminal("completed")).toBe(true);
		expect(isBatchTerminal("failed")).toBe(true);
		expect(isBatchTerminal("stopped")).toBe(true);
		expect(isBatchTerminal("executing")).toBe(false);
		expect(isBatchTerminal("merging")).toBe(false);
		expect(isBatchTerminal("launching")).toBe(false);
	});
});

describe("4.x — buildTakeoverSummary", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("4.10: summary includes batch metadata", () => {
		const state = makePersistedBatchState();
		const summary = buildTakeoverSummary(tmpDir, state);

		expect(summary).toContain("20260322T120000");
		expect(summary).toContain("executing");
		expect(summary).toContain("main");
	});

	it("4.11: summary includes task counts", () => {
		const state = makePersistedBatchState();
		const summary = buildTakeoverSummary(tmpDir, state);

		expect(summary).toContain("1 succeeded");
		expect(summary).toContain("1 failed");
		expect(summary).toContain("1 running");
		expect(summary).toContain("1 pending");
	});

	it("4.12: summary includes recent audit trail actions", () => {
		const state = makePersistedBatchState();

		// Write some audit entries
		appendAuditEntry(tmpDir, {
			ts: "2026-03-22T12:00:00Z",
			action: "merge_retry",
			classification: "tier0_known",
			context: "merge timed out on wave 1",
			command: "git merge",
			result: "success",
			detail: "merged OK",
			batchId: "20260322T120000",
		});

		const summary = buildTakeoverSummary(tmpDir, state);
		expect(summary).toContain("merge_retry");
		expect(summary).toContain("merge timed out");
	});

	it("4.13: summary includes recent engine events", () => {
		const state = makePersistedBatchState();

		// Write some events
		writeEventLine(tmpDir, {
			timestamp: "2026-03-22T12:00:00Z",
			type: "wave_start",
			batchId: "20260322T120000",
			waveIndex: 0,
			message: "Wave 1 starting",
		});

		const summary = buildTakeoverSummary(tmpDir, state);
		expect(summary).toContain("wave_start");
	});

	it("4.14: summary handles missing audit trail gracefully", () => {
		const state = makePersistedBatchState();
		// No audit trail written — should not crash
		const summary = buildTakeoverSummary(tmpDir, state);
		expect(summary).not.toContain("Previous supervisor actions");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 5.x — Event Notifications
// ═════════════════════════════════════════════════════════════════════

describe("5.x — Event JSONL parsing: parseJsonlLines", () => {
	it("5.1: parses complete JSONL lines", () => {
		const line1 = JSON.stringify({ timestamp: "t1", type: "wave_start", batchId: "b1", waveIndex: 0 });
		const line2 = JSON.stringify({ timestamp: "t2", type: "task_complete", batchId: "b1", waveIndex: 0, taskId: "T-001" });
		const data = line1 + "\n" + line2 + "\n";

		const [events, remaining] = parseJsonlLines(data, "");
		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("wave_start");
		expect(events[1].type).toBe("task_complete");
		expect(remaining).toBe("");
	});

	it("5.2: handles partial lines (no trailing newline)", () => {
		const line1 = JSON.stringify({ timestamp: "t1", type: "wave_start", batchId: "b1", waveIndex: 0 });
		const partial = '{"timestamp":"t2","type":"task_com';
		const data = line1 + "\n" + partial;

		const [events, remaining] = parseJsonlLines(data, "");
		expect(events).toHaveLength(1);
		expect(remaining).toBe(partial);
	});

	it("5.3: prepends previous partial line", () => {
		const previousPartial = '{"timestamp":"t1","type":"wave_start","batch';
		const newData = 'Id":"b1","waveIndex":0}\n';

		const [events, remaining] = parseJsonlLines(newData, previousPartial);
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("wave_start");
		expect(remaining).toBe("");
	});

	it("5.4: skips malformed JSON lines", () => {
		const good = JSON.stringify({ timestamp: "t1", type: "wave_start", batchId: "b1", waveIndex: 0 });
		const data = good + "\n" + "not-json\n" + good + "\n";

		const [events, remaining] = parseJsonlLines(data, "");
		expect(events).toHaveLength(2); // Skips the bad line
	});

	it("5.5: skips lines missing required fields", () => {
		const good = JSON.stringify({ timestamp: "t1", type: "wave_start", batchId: "b1", waveIndex: 0 });
		const missingType = JSON.stringify({ timestamp: "t2", batchId: "b1" }); // No type
		const data = good + "\n" + missingType + "\n";

		const [events, remaining] = parseJsonlLines(data, "");
		expect(events).toHaveLength(1);
	});

	it("5.6: handles empty data", () => {
		const [events, remaining] = parseJsonlLines("", "");
		expect(events).toHaveLength(0);
		expect(remaining).toBe("");
	});
});

describe("5.x — formatEventNotification", () => {
	it("5.7: formats wave_start correctly", () => {
		const event = {
			timestamp: "t", type: "wave_start" as any, batchId: "b", waveIndex: 1,
			taskIds: ["T-1", "T-2", "T-3"], laneCount: 3,
		};
		const text = formatEventNotification(event, "supervised");
		expect(text).toContain("Wave 2"); // waveIndex 1 = wave 2
		expect(text).toContain("3 task(s)");
		expect(text).toContain("3 lanes");
		expect(text).toContain("🌊");
	});

	it("5.8: formats merge_success correctly", () => {
		const event = {
			timestamp: "t", type: "merge_success" as any, batchId: "b", waveIndex: 0,
			testCount: 42, totalWaves: 3,
		};
		const text = formatEventNotification(event, "supervised");
		expect(text).toContain("✅");
		expect(text).toContain("merged successfully");
		expect(text).toContain("42");
	});

	it("5.9: formats merge_failed differently for autonomous vs interactive", () => {
		const event = {
			timestamp: "t", type: "merge_failed" as any, batchId: "b", waveIndex: 0,
			reason: "conflict in src/app.ts",
		};

		const autoText = formatEventNotification(event, "autonomous");
		expect(autoText).toContain("Attempting recovery");

		const interText = formatEventNotification(event, "interactive");
		expect(interText).toContain("Recovery may be needed");
	});

	it("5.10: formats batch_complete with summary", () => {
		const event = {
			timestamp: "t", type: "batch_complete" as any, batchId: "b", waveIndex: -1,
			succeededTasks: 10, failedTasks: 2, skippedTasks: 1,
			batchDurationMs: 3661000, // 1h 1m 1s
		};
		const text = formatEventNotification(event, "supervised");
		expect(text).toContain("🏁");
		expect(text).toContain("Batch complete");
		expect(text).toContain("10 succeeded");
		expect(text).toContain("2 failed");
		expect(text).toContain("1h 1m");
	});

	it("5.11: formats tier0_escalation with pattern and suggestion", () => {
		const event = {
			timestamp: "t", type: "tier0_escalation" as any, batchId: "b", waveIndex: 0,
			pattern: "WORKER_CRASH", suggestion: "Check lane 2 logs",
		};

		const interText = formatEventNotification(event, "interactive");
		expect(interText).toContain("❌");
		expect(interText).toContain("WORKER_CRASH");
		expect(interText).toContain("Need your input");

		const supervisedText = formatEventNotification(event, "supervised");
		expect(supervisedText).toContain("⚡");
		expect(supervisedText).toContain("Diagnosing");
	});

	it("5.12: formats batch_paused differently by autonomy", () => {
		const event = {
			timestamp: "t", type: "batch_paused" as any, batchId: "b", waveIndex: 0,
			reason: "merge conflict",
		};

		const interText = formatEventNotification(event, "interactive");
		expect(interText).toContain("⏸️");
		expect(interText).toContain("What would you like to do");

		const autoText = formatEventNotification(event, "autonomous");
		expect(autoText).not.toContain("What would you like to do");
	});
});

describe("5.x — shouldNotify filtering", () => {
	it("5.13: always notifies for terminal/failure events regardless of autonomy", () => {
		const criticalTypes = ["batch_complete", "batch_paused", "merge_failed", "tier0_escalation"] as const;
		for (const type of criticalTypes) {
			expect(shouldNotify(type, "interactive")).toBe(true);
			expect(shouldNotify(type, "supervised")).toBe(true);
			expect(shouldNotify(type, "autonomous")).toBe(true);
		}
	});

	it("5.14: autonomous mode skips routine progress events", () => {
		expect(shouldNotify("wave_start", "autonomous")).toBe(false);
		expect(shouldNotify("merge_success", "autonomous")).toBe(false);
		expect(shouldNotify("merge_start", "autonomous")).toBe(false);
	});

	it("5.15: interactive and supervised modes notify for significant events", () => {
		expect(shouldNotify("wave_start", "interactive")).toBe(true);
		expect(shouldNotify("wave_start", "supervised")).toBe(true);
		expect(shouldNotify("merge_success", "interactive")).toBe(true);
		expect(shouldNotify("merge_success", "supervised")).toBe(true);
	});
});

describe("5.x — formatTaskDigest", () => {
	it("5.16: returns null for empty buffer", () => {
		const buf = { completed: [], failed: [], recoveryAttempts: 0, recoverySuccesses: 0, recoveryExhausted: 0 };
		expect(formatTaskDigest(buf, "supervised")).toBeNull();
	});

	it("5.17: formats completed tasks", () => {
		const buf = { completed: ["T-1", "T-2"], failed: [], recoveryAttempts: 0, recoverySuccesses: 0, recoveryExhausted: 0 };
		const text = formatTaskDigest(buf, "supervised");
		expect(text).not.toBeNull();
		expect(text).toContain("2 task(s) completed");
	});

	it("5.18: interactive mode shows individual task IDs for completed", () => {
		const buf = { completed: ["T-1", "T-2"], failed: [], recoveryAttempts: 0, recoverySuccesses: 0, recoveryExhausted: 0 };
		const text = formatTaskDigest(buf, "interactive");
		expect(text).toContain("T-1");
		expect(text).toContain("T-2");
	});

	it("5.19: always shows failed task IDs", () => {
		const buf = { completed: [], failed: ["T-3"], recoveryAttempts: 0, recoverySuccesses: 0, recoveryExhausted: 0 };
		const text = formatTaskDigest(buf, "autonomous");
		expect(text).not.toBeNull();
		expect(text).toContain("T-3");
		expect(text).toContain("1 task(s) failed");
	});

	it("5.20: formats recovery budget exhausted", () => {
		const buf = { completed: [], failed: [], recoveryAttempts: 0, recoverySuccesses: 0, recoveryExhausted: 2 };
		const text = formatTaskDigest(buf, "supervised");
		expect(text).not.toBeNull();
		expect(text).toContain("2 recovery budget(s) exhausted");
	});
});

describe("5.x — processEvents: batch-scoped filtering + routing", () => {
	it("5.21: filters events by batchId", () => {
		const tailer = freshEventTailerState();
		tailer.batchId = "batch-A";

		const events = [
			{ timestamp: "t1", type: "wave_start" as any, batchId: "batch-A", waveIndex: 0, taskIds: ["T-1"] },
			{ timestamp: "t2", type: "wave_start" as any, batchId: "batch-B", waveIndex: 0, taskIds: ["T-2"] },
		];

		const notifications: string[] = [];
		processEvents(events, tailer, "supervised", (text) => notifications.push(text));

		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain("Wave 1");
	});

	it("5.22: accepts all events when batchId is empty (pre-planning)", () => {
		const tailer = freshEventTailerState();
		tailer.batchId = "";

		const events = [
			{ timestamp: "t1", type: "wave_start" as any, batchId: "batch-A", waveIndex: 0, taskIds: ["T-1"] },
		];

		const notifications: string[] = [];
		processEvents(events, tailer, "supervised", (text) => notifications.push(text));

		expect(notifications).toHaveLength(1);
		// Also updates tailer batchId
		expect(tailer.batchId).toBe("batch-A");
	});

	it("5.23: buffers task_complete events into digest", () => {
		const tailer = freshEventTailerState();
		tailer.batchId = "batch-A";

		const events = [
			{ timestamp: "t1", type: "task_complete" as any, batchId: "batch-A", waveIndex: 0, taskId: "T-1" },
			{ timestamp: "t2", type: "task_complete" as any, batchId: "batch-A", waveIndex: 0, taskId: "T-2" },
		];

		const notifications: string[] = [];
		processEvents(events, tailer, "supervised", (text) => notifications.push(text));

		// Task completions should be buffered, not emitted immediately
		expect(notifications).toHaveLength(0);
		expect(tailer.digestBuffer.completed).toEqual(["T-1", "T-2"]);
	});

	it("5.24: buffers task_failed events into digest", () => {
		const tailer = freshEventTailerState();
		tailer.batchId = "batch-A";

		const events = [
			{ timestamp: "t1", type: "task_failed" as any, batchId: "batch-A", waveIndex: 0, taskId: "T-3" },
		];

		const notifications: string[] = [];
		processEvents(events, tailer, "supervised", (text) => notifications.push(text));

		expect(notifications).toHaveLength(0);
		expect(tailer.digestBuffer.failed).toEqual(["T-3"]);
	});
});

describe("5.x — readNewBytes + event tailer file operations", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("5.25: readNewBytes returns empty for missing file", () => {
		const [data, offset] = readNewBytes(join(tmpDir, "nonexistent.jsonl"), 0);
		expect(data).toBe("");
		expect(offset).toBe(0);
	});

	it("5.26: readNewBytes reads from byte offset", () => {
		const path = join(tmpDir, "events.jsonl");
		const line1 = JSON.stringify({ timestamp: "t1", type: "wave_start", batchId: "b1", waveIndex: 0 }) + "\n";
		const line2 = JSON.stringify({ timestamp: "t2", type: "merge_success", batchId: "b1", waveIndex: 0 }) + "\n";

		writeFileSync(path, line1 + line2, "utf-8");

		// Read from beginning
		const [data1, offset1] = readNewBytes(path, 0);
		expect(data1).toBe(line1 + line2);

		// Read from after first line
		const byteOffset = Buffer.byteLength(line1, "utf-8");
		const [data2, offset2] = readNewBytes(path, byteOffset);
		expect(data2).toBe(line2);
	});

	it("5.27: readNewBytes returns empty when no new data", () => {
		const path = join(tmpDir, "events.jsonl");
		const line1 = JSON.stringify({ timestamp: "t1", type: "wave_start", batchId: "b1", waveIndex: 0 }) + "\n";
		writeFileSync(path, line1, "utf-8");

		const fileSize = Buffer.byteLength(line1, "utf-8");
		const [data, offset] = readNewBytes(path, fileSize);
		expect(data).toBe("");
		expect(offset).toBe(fileSize);
	});
});

describe("5.x — Event tailer lifecycle", () => {
	it("5.28: freshEventTailerState starts with running=false", () => {
		const tailer = freshEventTailerState();
		expect(tailer.running).toBe(false);
		expect(tailer.byteOffset).toBe(0);
		expect(tailer.partialLine).toBe("");
		expect(tailer.pollTimer).toBeNull();
		expect(tailer.digestTimer).toBeNull();
	});

	it("5.29: stopEventTailer is idempotent", () => {
		const tailer = freshEventTailerState();
		// Should not throw when called on an already-stopped tailer
		expect(() => stopEventTailer(tailer)).not.toThrow();
		expect(tailer.running).toBe(false);
	});

	it("5.30: EVENT_POLL_INTERVAL_MS is 10 seconds", () => {
		expect(EVENT_POLL_INTERVAL_MS).toBe(10_000);
	});

	it("5.31: TASK_DIGEST_INTERVAL_MS is 30 seconds", () => {
		expect(TASK_DIGEST_INTERVAL_MS).toBe(30_000);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 6.x — Audit Trail
// ═════════════════════════════════════════════════════════════════════

describe("6.x — Audit trail: appendAuditEntry + readAuditTrail", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("6.1: appendAuditEntry creates file and writes entry", () => {
		const entry: AuditTrailEntry = {
			ts: "2026-03-22T12:00:00Z",
			action: "merge_retry",
			classification: "tier0_known",
			context: "wave 1 merge timed out",
			command: "git merge --no-ff task/lane-1",
			result: "success",
			detail: "merged with 0 conflicts",
			batchId: "batch-1",
		};

		appendAuditEntry(tmpDir, entry);

		const path = auditTrailPath(tmpDir);
		expect(existsSync(path)).toBe(true);

		const content = readFileSync(path, "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.action).toBe("merge_retry");
		expect(parsed.result).toBe("success");
	});

	it("6.2: appendAuditEntry appends multiple entries", () => {
		appendAuditEntry(tmpDir, {
			ts: "t1", action: "read_state", classification: "diagnostic",
			context: "checking batch state", command: "read batch-state.json",
			result: "success", detail: "ok", batchId: "b1",
		});
		appendAuditEntry(tmpDir, {
			ts: "t2", action: "kill_session", classification: "destructive",
			context: "stale session", command: "tmux kill-session -t lane-2",
			result: "pending", detail: "", batchId: "b1",
		});

		const entries = readAuditTrail(tmpDir);
		expect(entries).toHaveLength(2);
		expect(entries[0].action).toBe("read_state");
		expect(entries[1].action).toBe("kill_session");
	});

	it("6.3: readAuditTrail returns empty array for missing file", () => {
		const entries = readAuditTrail(tmpDir);
		expect(entries).toEqual([]);
	});

	it("6.4: readAuditTrail filters by batchId", () => {
		appendAuditEntry(tmpDir, {
			ts: "t1", action: "a1", classification: "diagnostic",
			context: "c", command: "cmd", result: "success", detail: "d",
			batchId: "batch-A",
		});
		appendAuditEntry(tmpDir, {
			ts: "t2", action: "a2", classification: "diagnostic",
			context: "c", command: "cmd", result: "success", detail: "d",
			batchId: "batch-B",
		});

		const filtered = readAuditTrail(tmpDir, { batchId: "batch-A" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0].action).toBe("a1");
	});

	it("6.5: readAuditTrail respects limit (tail)", () => {
		for (let i = 0; i < 10; i++) {
			appendAuditEntry(tmpDir, {
				ts: `t${i}`, action: `action-${i}`, classification: "diagnostic",
				context: "c", command: "cmd", result: "success", detail: "d",
				batchId: "b1",
			});
		}

		const limited = readAuditTrail(tmpDir, { limit: 3 });
		expect(limited).toHaveLength(3);
		// Should be the last 3 entries (tail)
		expect(limited[0].action).toBe("action-7");
		expect(limited[1].action).toBe("action-8");
		expect(limited[2].action).toBe("action-9");
	});

	it("6.6: readAuditTrail skips malformed lines", () => {
		const dir = join(tmpDir, ".pi", "supervisor");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, "actions.jsonl");
		writeFileSync(path, '{"ts":"t1","action":"a1","classification":"diagnostic","context":"c","command":"cmd","result":"success","detail":"d","batchId":"b1"}\nnot-json\n{"ts":"t2","action":"a2","classification":"diagnostic","context":"c","command":"cmd","result":"success","detail":"d","batchId":"b1"}\n', "utf-8");

		const entries = readAuditTrail(tmpDir);
		expect(entries).toHaveLength(2);
	});

	it("6.7: logRecoveryAction fills timestamp and batchId automatically", () => {
		logRecoveryAction(tmpDir, "batch-42", {
			action: "test_action",
			classification: "diagnostic",
			context: "test context",
			command: "echo hello",
			result: "success",
			detail: "all good",
		});

		const entries = readAuditTrail(tmpDir);
		expect(entries).toHaveLength(1);
		expect(entries[0].batchId).toBe("batch-42");
		expect(entries[0].ts).toBeDefined();
		// Timestamp should be recent (within last minute)
		const entryTime = new Date(entries[0].ts).getTime();
		expect(Date.now() - entryTime).toBeLessThan(60_000);
	});

	it("6.8: appendAuditEntry is best-effort (doesn't throw)", () => {
		// Even with an invalid path, it should not throw
		// This tests the try/catch wrapper
		const supervisorSource = readSource("supervisor.ts");
		const appendFn = supervisorSource.substring(
			supervisorSource.indexOf("function appendAuditEntry("),
			supervisorSource.indexOf("function logRecoveryAction("),
		);
		expect(appendFn).toContain("catch");
		expect(appendFn).toContain("Best-effort");
	});

	it("6.9: auditTrailPath resolves to .pi/supervisor/actions.jsonl", () => {
		const path = auditTrailPath("/root");
		expect(path).toContain(".pi");
		expect(path).toContain("supervisor");
		expect(path).toContain("actions.jsonl");
	});

	it("6.10: audit entry supports optional fields (waveIndex, laneNumber, taskId, durationMs)", () => {
		appendAuditEntry(tmpDir, {
			ts: "t1", action: "merge_retry", classification: "tier0_known",
			context: "wave 2 merge timeout", command: "git merge",
			result: "success", detail: "ok", batchId: "b1",
			waveIndex: 1, laneNumber: 3, taskId: "T-005", durationMs: 4500,
		});

		const entries = readAuditTrail(tmpDir);
		expect(entries).toHaveLength(1);
		expect(entries[0].waveIndex).toBe(1);
		expect(entries[0].laneNumber).toBe(3);
		expect(entries[0].taskId).toBe("T-005");
		expect(entries[0].durationMs).toBe(4500);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 7.x — Recovery Classification
// ═════════════════════════════════════════════════════════════════════

describe("7.x — Recovery classification: requiresConfirmation decision matrix", () => {
	it("7.1: diagnostic never requires confirmation (all autonomy levels)", () => {
		expect(requiresConfirmation("diagnostic", "interactive")).toBe(false);
		expect(requiresConfirmation("diagnostic", "supervised")).toBe(false);
		expect(requiresConfirmation("diagnostic", "autonomous")).toBe(false);
	});

	it("7.2: autonomous mode never asks (all classifications)", () => {
		expect(requiresConfirmation("diagnostic", "autonomous")).toBe(false);
		expect(requiresConfirmation("tier0_known", "autonomous")).toBe(false);
		expect(requiresConfirmation("destructive", "autonomous")).toBe(false);
	});

	it("7.3: interactive mode asks for tier0_known and destructive", () => {
		expect(requiresConfirmation("tier0_known", "interactive")).toBe(true);
		expect(requiresConfirmation("destructive", "interactive")).toBe(true);
	});

	it("7.4: supervised mode auto-approves tier0_known, asks for destructive", () => {
		expect(requiresConfirmation("tier0_known", "supervised")).toBe(false);
		expect(requiresConfirmation("destructive", "supervised")).toBe(true);
	});

	it("7.5: ACTION_CLASSIFICATION_EXAMPLES has entries for all three classifications", () => {
		expect(ACTION_CLASSIFICATION_EXAMPLES.diagnostic.length).toBeGreaterThan(0);
		expect(ACTION_CLASSIFICATION_EXAMPLES.tier0_known.length).toBeGreaterThan(0);
		expect(ACTION_CLASSIFICATION_EXAMPLES.destructive.length).toBeGreaterThan(0);
	});

	it("7.6: full decision matrix matches spec §6.3", () => {
		// Exhaustive matrix verification
		const matrix: Array<[RecoveryActionClassification, SupervisorAutonomyLevel, boolean]> = [
			// diagnostic: always false
			["diagnostic", "interactive", false],
			["diagnostic", "supervised", false],
			["diagnostic", "autonomous", false],
			// tier0_known: true for interactive, false for supervised/autonomous
			["tier0_known", "interactive", true],
			["tier0_known", "supervised", false],
			["tier0_known", "autonomous", false],
			// destructive: true for interactive/supervised, false for autonomous
			["destructive", "interactive", true],
			["destructive", "supervised", true],
			["destructive", "autonomous", false],
		];

		for (const [classification, autonomy, expected] of matrix) {
			expect(
				requiresConfirmation(classification, autonomy),
				`requiresConfirmation("${classification}", "${autonomy}") should be ${expected}`,
			).toBe(expected);
		}
	});
});

// ═════════════════════════════════════════════════════════════════════
// 8.x — Activation/Deactivation + State Lifecycle
// ═════════════════════════════════════════════════════════════════════

describe("8.x — Activation/deactivation: state lifecycle", () => {
	it("8.1: freshSupervisorState starts inactive", () => {
		const state = freshSupervisorState();
		expect(state.active).toBe(false);
		expect(state.batchId).toBe("");
		expect(state.batchStateRef).toBeNull();
		expect(state.orchConfigRef).toBeNull();
		expect(state.stateRoot).toBe("");
		expect(state.previousModel).toBeNull();
		expect(state.didSwitchModel).toBe(false);
		expect(state.lockSessionId).toBe("");
		expect(state.heartbeatTimer).toBeNull();
	});

	it("8.2: freshSupervisorState has default config", () => {
		const state = freshSupervisorState();
		expect(state.config.model).toBe("");
		expect(state.config.autonomy).toBe("supervised");
	});

	it("8.3: freshSupervisorState has fresh event tailer state", () => {
		const state = freshSupervisorState();
		expect(state.eventTailer.running).toBe(false);
		expect(state.eventTailer.byteOffset).toBe(0);
		expect(state.eventTailer.pollTimer).toBeNull();
		expect(state.eventTailer.digestTimer).toBeNull();
	});

	it("8.4: resolveSupervisorConfig returns defaults when no section provided", () => {
		const config = resolveSupervisorConfig();
		expect(config.model).toBe("");
		expect(config.autonomy).toBe("supervised");
	});

	it("8.5: resolveSupervisorConfig merges partial config", () => {
		const config = resolveSupervisorConfig({ autonomy: "autonomous" });
		expect(config.model).toBe(""); // Default
		expect(config.autonomy).toBe("autonomous"); // Overridden
	});

	it("8.6: resolveSupervisorConfig respects model override", () => {
		const config = resolveSupervisorConfig({ model: "anthropic/claude-sonnet-4" });
		expect(config.model).toBe("anthropic/claude-sonnet-4");
		expect(config.autonomy).toBe("supervised"); // Default
	});

	it("8.7: DEFAULT_SUPERVISOR_CONFIG has expected values", () => {
		expect(DEFAULT_SUPERVISOR_CONFIG.model).toBe("");
		expect(DEFAULT_SUPERVISOR_CONFIG.autonomy).toBe("supervised");
	});

	it("8.8: activateSupervisor source writes lockfile and starts heartbeat", () => {
		const supervisorSource = readSource("supervisor.ts");
		const activateFn = supervisorSource.substring(
			supervisorSource.indexOf("async function activateSupervisor("),
			supervisorSource.indexOf("async function deactivateSupervisor("),
		);
		expect(activateFn).toContain("writeLockfile(");
		expect(activateFn).toContain("startHeartbeat(");
		expect(activateFn).toContain("startEventTailer(");
		expect(activateFn).toContain("pi.sendMessage(");
		expect(activateFn).toContain("triggerTurn: true");
	});

	it("8.9: deactivateSupervisor source cleans up all resources", () => {
		const supervisorSource = readSource("supervisor.ts");
		const deactivateFn = supervisorSource.substring(
			supervisorSource.indexOf("async function deactivateSupervisor("),
			supervisorSource.indexOf("function registerSupervisorPromptHook("),
		);
		expect(deactivateFn).toContain("stopEventTailer(");
		expect(deactivateFn).toContain("clearInterval(");
		expect(deactivateFn).toContain("removeLockfile(");
		expect(deactivateFn).toContain("state.active = false");
	});

	it("8.10: deactivateSupervisor is idempotent (early return when not active)", () => {
		const supervisorSource = readSource("supervisor.ts");
		const deactivateFn = supervisorSource.substring(
			supervisorSource.indexOf("async function deactivateSupervisor("),
			supervisorSource.indexOf("function registerSupervisorPromptHook("),
		);
		expect(deactivateFn).toContain("if (!state.active) return");
	});

	it("8.11: extension registers session_end cleanup for supervisor lock/heartbeat", () => {
		const extSource = readSource("extension.ts");
		expect(extSource).toContain('pi.on("session_end"');
		expect(extSource).toContain("deactivateSupervisor(pi, supervisorState)");
	});

	it("8.12: /orch-takeover command exists in extension.ts", () => {
		const extSource = readSource("extension.ts");
		expect(extSource).toContain('registerCommand("orch-takeover"');
	});

	it("8.13: heartbeat detects force takeover (sessionId mismatch)", () => {
		const supervisorSource = readSource("supervisor.ts");
		const heartbeatFn = supervisorSource.substring(
			supervisorSource.indexOf("function startHeartbeat("),
			supervisorSource.indexOf("// ── Engine Event Consumption"),
		);
		expect(heartbeatFn).toContain("currentLock.sessionId !== sessionId");
		expect(heartbeatFn).toContain("supervisor-yield");
		expect(heartbeatFn).toContain("deactivateSupervisor");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 9.x — Config integration: supervisor config in schema/loader
// ═════════════════════════════════════════════════════════════════════

describe("9.x — Config integration", () => {
	it("9.1: config-schema includes supervisor section", () => {
		const schemaSource = readSource("config-schema.ts");
		expect(schemaSource).toContain("supervisor");
	});

	it("9.2: config-loader loads supervisor config", () => {
		const loaderSource = readSource("config-loader.ts");
		expect(loaderSource).toContain("supervisor");
	});

	it("9.3: settings-tui includes supervisor section", () => {
		const settingsSource = readFileSync(join(__dirname, "..", "taskplane", "settings-tui.ts"), "utf-8").replace(/\r\n/g, "\n");
		expect(settingsSource).toContain("supervisor");
	});
});
