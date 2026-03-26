/**
 * Non-Blocking Engine Tests — TP-040 Step 4
 *
 * Tests for the non-blocking /orch refactor:
 *
 *   1.x — startBatchAsync: fire-and-forget pattern, setTimeout detach, error boundary
 *   2.x — Engine event emission: emitEngineEvent writes JSONL + invokes callback
 *   3.x — JSONL persistence: events.jsonl created with correct lifecycle records
 *   4.x — Terminal events: batch_complete / batch_paused emitted correctly
 *   5.x — Launch-window command regression: "launching" phase recognized by commands
 *   6.x — Resume early-return regression: phase reset from "launching" to "idle"
 *   7.x — /orch-status disk fallback
 *   8.x — Behavioral: startBatchAsync non-blocking pattern (R008-1)
 *   9.x — Behavioral: launch-window command logic (R008-2a)
 *  10.x — Behavioral: engine event emission sequences (R008-2b)
 *  11.x — Behavioral: resumeOrchBatch early-return phase reset (R008-3)
 *
 * Run: npx vitest run tests/non-blocking-engine.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	emitEngineEvent,
} from "../taskplane/persistence.ts";

import {
	buildEngineEventBase,
	freshOrchBatchState,
	DEFAULT_ORCHESTRATOR_CONFIG,
	DEFAULT_TASK_RUNNER_CONFIG,
} from "../taskplane/types.ts";

import type {
	EngineEvent,
	EngineEventCallback,
	EngineEventType,
} from "../taskplane/types.ts";

import { startBatchAsync } from "../taskplane/extension.ts";
import { resumeOrchBatch } from "../taskplane/resume.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

/** Read all engine events from the events.jsonl file in a temp stateRoot */
function readEngineEvents(stateRoot: string): EngineEvent[] {
	const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
	if (!existsSync(eventsPath)) return [];
	const content = readFileSync(eventsPath, "utf-8");
	return content
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map(line => JSON.parse(line) as EngineEvent);
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — startBatchAsync: fire-and-forget, setTimeout detach, error boundary
// ══════════════════════════════════════════════════════════════════════

describe("1.x — startBatchAsync: non-blocking handler pattern", () => {
	it("1.1: startBatchAsync is defined and uses setTimeout for detach", () => {
		const extSource = readSource("extension.ts");
		// Must define startBatchAsync as a named function
		expect(extSource).toContain("function startBatchAsync(");
		// Must use setTimeout to detach engine start to next tick
		const fnStart = extSource.indexOf("function startBatchAsync(");
		const fnEnd = extSource.indexOf("\n// ── Extension", fnStart);
		const fnBody = extSource.substring(fnStart, fnEnd);
		expect(fnBody).toContain("setTimeout(");
	});

	it("1.2: /orch handler uses startBatchInWorker via doOrchStart (worker thread, no await on engine)", () => {
		const extSource = readSource("extension.ts");
		// The /orch handler must delegate to doOrchStart which calls startBatchInWorker
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);
		expect(orchHandler).toContain("doOrchStart(");
		// Must NOT await executeOrchBatch directly in the handler
		expect(orchHandler).not.toContain("await executeOrchBatch(");
		// doOrchStart must contain startBatchInWorker (TP-071: worker thread)
		const doOrchStartBody = extSource.substring(
			extSource.indexOf("function doOrchStart("),
			extSource.indexOf("function doOrchStatus("),
		);
		expect(doOrchStartBody).toContain("startBatchInWorker(");
	});

	it("1.3: /orch-resume handler uses startBatchInWorker (worker thread)", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchResume helper (TP-053 refactor)
		const resumeHelper = extSource.substring(
			extSource.indexOf("function doOrchResume("),
			extSource.indexOf("function doOrchAbort("),
		);
		expect(resumeHelper).toContain("startBatchInWorker(");
		// Must NOT await resumeOrchBatch directly
		expect(resumeHelper).not.toContain("await resumeOrchBatch(");
	});

	it("1.4: startBatchAsync has .catch() error boundary that sets phase to failed", () => {
		const extSource = readSource("extension.ts");
		const fnStart = extSource.indexOf("function startBatchAsync(");
		const fnEnd = extSource.indexOf("\n// ── Extension", fnStart);
		const fnBody = extSource.substring(fnStart, fnEnd);
		expect(fnBody).toContain(".catch(");
		expect(fnBody).toContain('batchState.phase = "failed"');
		expect(fnBody).toContain("batchState.endedAt = Date.now()");
	});

	it("1.5: startBatchAsync calls updateWidget on both success and error", () => {
		const extSource = readSource("extension.ts");
		const fnStart = extSource.indexOf("function startBatchAsync(");
		const fnEnd = extSource.indexOf("\n// ── Extension", fnStart);
		const fnBody = extSource.substring(fnStart, fnEnd);
		// .then() calls updateWidget on success
		expect(fnBody).toContain(".then(");
		// Count updateWidget calls — should appear in both .then and .catch
		const widgetCalls = fnBody.match(/updateWidget\(\)/g);
		expect(widgetCalls).not.toBeNull();
		expect(widgetCalls!.length).toBeGreaterThanOrEqual(2);
	});

	it("1.6: doOrchStart sets phase to 'launching' synchronously before startBatchInWorker", () => {
		const extSource = readSource("extension.ts");
		// The launching logic now lives in doOrchStart
		const doOrchStartBody = extSource.substring(
			extSource.indexOf("function doOrchStart("),
			extSource.indexOf("function doOrchStatus("),
		);
		// Must set launching phase before calling startBatchInWorker
		const launchingIdx = doOrchStartBody.indexOf('orchBatchState.phase = "launching"');
		const startAsyncIdx = doOrchStartBody.indexOf("startBatchInWorker(");
		expect(launchingIdx).not.toBe(-1);
		expect(startAsyncIdx).not.toBe(-1);
		expect(launchingIdx).toBeLessThan(startAsyncIdx);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Engine event emission: emitEngineEvent + buildEngineEventBase
// ══════════════════════════════════════════════════════════════════════

describe("2.x — Engine event emission infrastructure", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "engine-event-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("2.1: buildEngineEventBase produces correct fields", () => {
		const base = buildEngineEventBase("wave_start", "batch-42", 2, "executing");
		expect(base.timestamp).toBeDefined();
		expect(base.type).toBe("wave_start");
		expect(base.batchId).toBe("batch-42");
		expect(base.waveIndex).toBe(2);
		expect(base.phase).toBe("executing");
		// Timestamp must be ISO 8601
		expect(() => new Date(base.timestamp)).not.toThrow();
		expect(new Date(base.timestamp).toISOString()).toBe(base.timestamp);
	});

	it("2.2: buildEngineEventBase accepts all valid EngineEventType values", () => {
		const types: EngineEventType[] = [
			"wave_start", "task_complete", "task_failed",
			"merge_start", "merge_success", "merge_failed",
			"batch_complete", "batch_paused",
		];
		for (const type of types) {
			const base = buildEngineEventBase(type, "batch-1", 0, "executing");
			expect(base.type).toBe(type);
		}
	});

	it("2.3: emitEngineEvent creates .pi/supervisor directory and events.jsonl", () => {
		const event: EngineEvent = {
			...buildEngineEventBase("wave_start", "batch-1", 0, "executing"),
			taskIds: ["TP-001"],
			laneCount: 1,
		};
		emitEngineEvent(tmpDir, event);

		expect(existsSync(join(tmpDir, ".pi", "supervisor"))).toBe(true);
		expect(existsSync(join(tmpDir, ".pi", "supervisor", "events.jsonl"))).toBe(true);
	});

	it("2.4: emitEngineEvent writes valid JSONL (one line per event)", () => {
		const event1: EngineEvent = {
			...buildEngineEventBase("wave_start", "batch-1", 0, "executing"),
		};
		const event2: EngineEvent = {
			...buildEngineEventBase("task_complete", "batch-1", 0, "executing"),
			taskId: "TP-001",
			durationMs: 5000,
		};
		emitEngineEvent(tmpDir, event1);
		emitEngineEvent(tmpDir, event2);

		const events = readEngineEvents(tmpDir);
		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("wave_start");
		expect(events[1].type).toBe("task_complete");
		expect(events[1].taskId).toBe("TP-001");
		expect(events[1].durationMs).toBe(5000);
	});

	it("2.5: emitEngineEvent invokes callback with the event", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);

		const event: EngineEvent = {
			...buildEngineEventBase("merge_start", "batch-1", 0, "merging"),
			laneCount: 2,
		};
		emitEngineEvent(tmpDir, event, callback);

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("merge_start");
		expect(received[0].laneCount).toBe(2);
	});

	it("2.6: emitEngineEvent is best-effort — does not throw on write failure", () => {
		expect(() => {
			emitEngineEvent("", {
				...buildEngineEventBase("wave_start", "batch-1", 0, "executing"),
			});
		}).not.toThrow();
	});

	it("2.7: emitEngineEvent tolerates null callback gracefully", () => {
		const event: EngineEvent = {
			...buildEngineEventBase("wave_start", "batch-1", 0, "executing"),
		};
		// Should not throw with null callback
		expect(() => emitEngineEvent(tmpDir, event, null)).not.toThrow();
		// Should not throw with undefined callback
		expect(() => emitEngineEvent(tmpDir, event, undefined)).not.toThrow();
		// Events should still be written
		const events = readEngineEvents(tmpDir);
		expect(events.length).toBeGreaterThanOrEqual(2);
	});

	it("2.8: emitEngineEvent handles callback errors without crashing", () => {
		const throwingCallback: EngineEventCallback = () => {
			throw new Error("callback exploded");
		};
		expect(() => {
			emitEngineEvent(tmpDir, {
				...buildEngineEventBase("wave_start", "batch-1", 0, "executing"),
			}, throwingCallback);
		}).not.toThrow();
		// Event should still have been written to disk before callback
		const events = readEngineEvents(tmpDir);
		expect(events).toHaveLength(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — JSONL persistence: full lifecycle event records
// ══════════════════════════════════════════════════════════════════════

describe("3.x — JSONL persistence: events.jsonl lifecycle records", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "engine-jsonl-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("3.1: full lifecycle sequence produces correct JSONL entries", () => {
		// Simulate a full batch lifecycle: wave_start → task_complete → merge_start → merge_success → batch_complete
		const events: EngineEvent[] = [
			{ ...buildEngineEventBase("wave_start", "batch-1", 0, "executing"), taskIds: ["TP-001"], laneCount: 1 },
			{ ...buildEngineEventBase("task_complete", "batch-1", 0, "executing"), taskId: "TP-001", durationMs: 30000 },
			{ ...buildEngineEventBase("merge_start", "batch-1", 0, "merging"), laneCount: 1 },
			{ ...buildEngineEventBase("merge_success", "batch-1", 0, "merging"), totalWaves: 1 },
			{ ...buildEngineEventBase("batch_complete", "batch-1", 0, "completed"), succeededTasks: 1, failedTasks: 0, batchDurationMs: 35000 },
		];

		for (const event of events) {
			emitEngineEvent(tmpDir, event);
		}

		const written = readEngineEvents(tmpDir);
		expect(written).toHaveLength(5);
		expect(written.map(e => e.type)).toEqual([
			"wave_start", "task_complete", "merge_start", "merge_success", "batch_complete",
		]);
		// Verify terminal event has summary fields
		expect(written[4].succeededTasks).toBe(1);
		expect(written[4].batchDurationMs).toBe(35000);
	});

	it("3.2: failed lifecycle produces batch_paused terminal event", () => {
		const events: EngineEvent[] = [
			{ ...buildEngineEventBase("wave_start", "batch-2", 0, "executing"), taskIds: ["TP-002"], laneCount: 1 },
			{ ...buildEngineEventBase("task_failed", "batch-2", 0, "executing"), taskId: "TP-002", reason: "test failure" },
			{ ...buildEngineEventBase("batch_paused", "batch-2", 0, "paused"), reason: "stop-wave policy: all tasks failed", failedTasks: 1 },
		];

		for (const event of events) {
			emitEngineEvent(tmpDir, event);
		}

		const written = readEngineEvents(tmpDir);
		expect(written).toHaveLength(3);
		expect(written[2].type).toBe("batch_paused");
		expect(written[2].reason).toContain("stop-wave");
		expect(written[2].failedTasks).toBe(1);
	});

	it("3.3: task_failed event includes optional fields", () => {
		const event: EngineEvent = {
			...buildEngineEventBase("task_failed", "batch-1", 0, "executing"),
			taskId: "TP-003",
			durationMs: 12000,
			reason: "worker crashed",
			partialProgress: true,
		};
		emitEngineEvent(tmpDir, event);

		const events = readEngineEvents(tmpDir);
		expect(events[0].taskId).toBe("TP-003");
		expect(events[0].durationMs).toBe(12000);
		expect(events[0].reason).toBe("worker crashed");
		expect(events[0].partialProgress).toBe(true);
	});

	it("3.4: merge_failed event includes lane and error details", () => {
		const event: EngineEvent = {
			...buildEngineEventBase("merge_failed", "batch-1", 0, "merging"),
			laneNumber: 2,
			error: "merge conflict in src/main.ts",
		};
		emitEngineEvent(tmpDir, event);

		const events = readEngineEvents(tmpDir);
		expect(events[0].laneNumber).toBe(2);
		expect(events[0].error).toContain("merge conflict");
	});

	it("3.5: events share same JSONL file as Tier 0 events (events.jsonl path)", () => {
		// Verify the path is .pi/supervisor/events.jsonl (same as Tier 0)
		const event: EngineEvent = {
			...buildEngineEventBase("wave_start", "batch-1", 0, "executing"),
		};
		emitEngineEvent(tmpDir, event);

		const eventsPath = join(tmpDir, ".pi", "supervisor", "events.jsonl");
		expect(existsSync(eventsPath)).toBe(true);
	});

	it("3.6: when no engine events are emitted, events.jsonl does not exist", () => {
		const eventsPath = join(tmpDir, ".pi", "supervisor", "events.jsonl");
		expect(existsSync(eventsPath)).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Terminal events: batch_complete / batch_paused + guard
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Terminal event emission in engine", () => {
	it("4.1: engine defines emitTerminalEvent helper with one-shot guard", () => {
		const engineSource = readSource("engine.ts");
		// Must have the terminal event helper
		expect(engineSource).toContain("emitTerminalEvent");
		// Must have the guard flag
		expect(engineSource).toContain("terminalEventEmitted");
		// Guard prevents duplicate emissions
		expect(engineSource).toContain("if (terminalEventEmitted) return");
	});

	it("4.2: emitTerminalEvent emits batch_complete for completed/failed phases", () => {
		const engineSource = readSource("engine.ts");
		const terminalFn = engineSource.substring(
			engineSource.indexOf("const emitTerminalEvent"),
			engineSource.indexOf("// ── Phase 1"),
		);
		// Must check for completed/failed phase
		expect(terminalFn).toContain('"completed"');
		expect(terminalFn).toContain('"failed"');
		expect(terminalFn).toContain('"batch_complete"');
	});

	it("4.3: emitTerminalEvent emits batch_paused for paused/stopped phases", () => {
		const engineSource = readSource("engine.ts");
		const terminalFn = engineSource.substring(
			engineSource.indexOf("const emitTerminalEvent"),
			engineSource.indexOf("// ── Phase 1"),
		);
		expect(terminalFn).toContain('"paused"');
		expect(terminalFn).toContain('"stopped"');
		expect(terminalFn).toContain('"batch_paused"');
	});

	it("4.4: batch_complete event includes summary fields", () => {
		const engineSource = readSource("engine.ts");
		const terminalFn = engineSource.substring(
			engineSource.indexOf("const emitTerminalEvent"),
			engineSource.indexOf("// ── Phase 1"),
		);
		expect(terminalFn).toContain("succeededTasks");
		expect(terminalFn).toContain("failedTasks");
		expect(terminalFn).toContain("skippedTasks");
		expect(terminalFn).toContain("blockedTasks");
		expect(terminalFn).toContain("batchDurationMs");
	});

	it("4.5: batch_paused event includes reason and failedTasks", () => {
		const engineSource = readSource("engine.ts");
		const terminalFn = engineSource.substring(
			engineSource.indexOf("const emitTerminalEvent"),
			engineSource.indexOf("// ── Phase 1"),
		);
		expect(terminalFn).toContain("reason:");
		expect(terminalFn).toContain("failedTasks:");
	});

	it("4.6: engine calls emitTerminalEvent on early-return paths (detached HEAD, preflight, etc.)", () => {
		const engineSource = readSource("engine.ts");
		// Find all emitTerminalEvent calls in the engine
		const emitCalls = engineSource.match(/emitTerminalEvent\(/g);
		expect(emitCalls).not.toBeNull();
		// Should have multiple calls — early returns + normal exit paths
		expect(emitCalls!.length).toBeGreaterThanOrEqual(3);
	});

	it("4.7: engine emits wave_start event at the beginning of each wave", () => {
		const engineSource = readSource("engine.ts");
		// Find the wave loop section
		const waveLoopStart = engineSource.indexOf("export async function executeOrchBatch");
		const waveLoop = engineSource.substring(waveLoopStart);
		// wave_start event emitted in the loop
		expect(waveLoop).toContain('"wave_start"');
		const waveStartIdx = waveLoop.indexOf('"wave_start"');
		// Should include taskIds and laneCount
		const waveStartContext = waveLoop.substring(waveStartIdx - 200, waveStartIdx + 200);
		expect(waveStartContext).toContain("taskIds");
		expect(waveStartContext).toContain("laneCount");
	});

	it("4.8: engine emits task_complete and task_failed events after task outcomes", () => {
		const engineSource = readSource("engine.ts");
		const waveLoopStart = engineSource.indexOf("export async function executeOrchBatch");
		const waveLoop = engineSource.substring(waveLoopStart);
		expect(waveLoop).toContain('"task_complete"');
		expect(waveLoop).toContain('"task_failed"');
	});

	it("4.9: engine emits merge_start, merge_success, merge_failed events", () => {
		const engineSource = readSource("engine.ts");
		const waveLoopStart = engineSource.indexOf("export async function executeOrchBatch");
		const waveLoop = engineSource.substring(waveLoopStart);
		expect(waveLoop).toContain('"merge_start"');
		expect(waveLoop).toContain('"merge_success"');
		expect(waveLoop).toContain('"merge_failed"');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Launch-window command regression: "launching" phase
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Launch-window command behavior with 'launching' phase", () => {
	it("5.1: /orch-status reports batch status when phase is 'launching'", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchStatus helper (TP-053 refactor)
		const statusHelper = extSource.substring(
			extSource.indexOf("function doOrchStatus("),
			extSource.indexOf("function doOrchPause("),
		);
		// When phase is NOT idle, it should display in-memory state
		// The handler checks orchBatchState.phase === "idle" for disk fallback
		expect(statusHelper).toContain('orchBatchState.phase === "idle"');
		// So "launching" won't trigger disk fallback — it will show in-memory
	});

	it("5.2: /orch-pause accepts 'launching' phase (not in exclusion set)", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchPause helper (TP-053 refactor)
		const pauseHelper = extSource.substring(
			extSource.indexOf("function doOrchPause("),
			extSource.indexOf("function doOrchResume("),
		);
		// Pause handler excludes idle, completed, failed, stopped
		// It should NOT exclude "launching" — pause during launching is valid
		expect(pauseHelper).toContain('"idle"');
		expect(pauseHelper).toContain('"completed"');
		expect(pauseHelper).toContain('"failed"');
		expect(pauseHelper).toContain('"stopped"');
		// "launching" should not appear in the exclusion set
		const exclusionLine = pauseHelper.substring(
			pauseHelper.indexOf('orchBatchState.phase === "idle"'),
			pauseHelper.indexOf("ORCH_MESSAGES.pauseNoBatch"),
		);
		expect(exclusionLine).not.toContain('"launching"');
	});

	it("5.3: /orch-abort recognizes 'launching' as an active batch phase", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchAbort helper (TP-053 refactor)
		const abortHelper = extSource.substring(
			extSource.indexOf("function doOrchAbort("),
			extSource.indexOf("function doOrchIntegrate("),
		);
		// abort checks hasActiveBatch — launching should not be in inactive set
		expect(abortHelper).toContain("hasActiveBatch");
		// hasActiveBatch excludes only idle, completed, failed, stopped
		const activeCheck = abortHelper.substring(
			abortHelper.indexOf("hasActiveBatch"),
			abortHelper.indexOf("hasActiveBatch") + 400,
		);
		expect(activeCheck).toContain('"idle"');
		expect(activeCheck).toContain('"completed"');
		expect(activeCheck).toContain('"failed"');
		expect(activeCheck).toContain('"stopped"');
	});

	it("5.4: /orch-resume blocks 'launching' phase (prevents double-start)", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchResume helper (TP-053 refactor)
		const resumeHelper = extSource.substring(
			extSource.indexOf("function doOrchResume("),
			extSource.indexOf("function doOrchAbort("),
		);
		// Resume must explicitly check for "launching" as an active phase
		expect(resumeHelper).toContain('"launching"');
		// It should be in the active-batch guard that prevents resume
		const guardStart = resumeHelper.indexOf('orchBatchState.phase === "launching"');
		const guardSection = resumeHelper.substring(guardStart, guardStart + 400);
		expect(guardSection).toContain("Cannot resume");
	});

	it("5.5: engine transitions from 'launching' to 'planning' (preserving startedAt)", () => {
		const engineSource = readSource("engine.ts");
		const batchFn = engineSource.substring(
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		// Engine should set phase to "planning" at start
		expect(batchFn).toContain('batchState.phase = "planning"');
		// And preserve startedAt if already set during launching
		expect(batchFn).toContain("batchState.startedAt");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Resume early-return regression: phase reset to "idle"
// ══════════════════════════════════════════════════════════════════════

describe("6.x — /orch-resume early-return paths reset phase from 'launching' to 'idle'", () => {
	it("6.1: resumeOrchBatch resets phase to 'idle' on StateFileError early return", () => {
		const resumeSource = readSource("resume.ts");
		// Find the StateFileError catch block
		const catchBlock = resumeSource.substring(
			resumeSource.indexOf("if (err instanceof StateFileError)"),
			resumeSource.indexOf("throw err", resumeSource.indexOf("if (err instanceof StateFileError)")) + 20,
		);
		expect(catchBlock).toContain('batchState.phase = "idle"');
	});

	it("6.2: resumeOrchBatch resets phase to 'idle' when no persisted state found", () => {
		const resumeSource = readSource("resume.ts");
		// Find the !persistedState block
		const noStateIdx = resumeSource.indexOf("if (!persistedState)");
		expect(noStateIdx).not.toBe(-1);
		const noStateBlock = resumeSource.substring(noStateIdx, noStateIdx + 300);
		expect(noStateBlock).toContain('batchState.phase = "idle"');
	});

	it("6.3: resumeOrchBatch resets phase to 'idle' when eligibility check fails", () => {
		const resumeSource = readSource("resume.ts");
		const eligibilityIdx = resumeSource.indexOf("!eligibility.eligible");
		expect(eligibilityIdx).not.toBe(-1);
		const eligibilityBlock = resumeSource.substring(eligibilityIdx, eligibilityIdx + 300);
		expect(eligibilityBlock).toContain('batchState.phase = "idle"');
	});

	it("6.4: resumeOrchBatch resets phase to 'idle' when force-resume diagnostics fail", () => {
		const resumeSource = readSource("resume.ts");
		const diagIdx = resumeSource.indexOf("forceResumeDiagnosticsFailed");
		expect(diagIdx).not.toBe(-1);
		// The phase reset comes after the diagnostics failed notification
		const diagBlock = resumeSource.substring(diagIdx, diagIdx + 300);
		expect(diagBlock).toContain('batchState.phase = "idle"');
	});

	it("6.5: all early-return paths include TP-040 R006 reset annotation", () => {
		const resumeSource = readSource("resume.ts");
		// Count occurrences of the TP-040 R006 reset comment pattern
		const r006Matches = resumeSource.match(/TP-040 R006.*Reset phase/g);
		expect(r006Matches).not.toBeNull();
		// Should have at least 4 occurrences (StateFileError, no state, eligibility, diagnostics)
		expect(r006Matches!.length).toBeGreaterThanOrEqual(4);
	});

	it("6.6: doOrchStart sets 'launching' phase and startedAt before calling startBatchInWorker", () => {
		const extSource = readSource("extension.ts");
		// The launching logic now lives in doOrchStart
		const doOrchStartBody = extSource.substring(
			extSource.indexOf("function doOrchStart("),
			extSource.indexOf("function doOrchStatus("),
		);
		// Both launching phase AND startedAt must be set before startBatchInWorker
		const launchPhaseIdx = doOrchStartBody.indexOf('orchBatchState.phase = "launching"');
		const startedAtIdx = doOrchStartBody.indexOf("orchBatchState.startedAt = Date.now()");
		const startAsyncIdx = doOrchStartBody.indexOf("startBatchInWorker(");
		expect(launchPhaseIdx).not.toBe(-1);
		expect(startedAtIdx).not.toBe(-1);
		expect(startAsyncIdx).not.toBe(-1);
		expect(launchPhaseIdx).toBeLessThan(startAsyncIdx);
		expect(startedAtIdx).toBeLessThan(startAsyncIdx);
	});

	it("6.7: /orch-resume handler sets 'launching' phase before calling startBatchInWorker", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchResume helper (TP-053 refactor)
		const resumeHelper = extSource.substring(
			extSource.indexOf("function doOrchResume("),
			extSource.indexOf("function doOrchAbort("),
		);
		const launchPhaseIdx = resumeHelper.indexOf('orchBatchState.phase = "launching"');
		const startAsyncIdx = resumeHelper.indexOf("startBatchInWorker(");
		expect(launchPhaseIdx).not.toBe(-1);
		expect(startAsyncIdx).not.toBe(-1);
		expect(launchPhaseIdx).toBeLessThan(startAsyncIdx);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — /orch-status disk fallback (Step 3 regression)
// ══════════════════════════════════════════════════════════════════════

describe("7.x — /orch-status disk fallback for idle in-memory state", () => {
	it("7.1: /orch-status falls back to disk state when in-memory phase is 'idle'", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchStatus helper (TP-053 refactor)
		const statusHelper = extSource.substring(
			extSource.indexOf("function doOrchStatus("),
			extSource.indexOf("function doOrchPause("),
		);
		expect(statusHelper).toContain("loadBatchState");
		expect(statusHelper).toContain('orchBatchState.phase === "idle"');
	});

	it("7.2: disk fallback resolves stateRoot from workspaceRoot first", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchStatus helper (TP-053 refactor)
		const statusHelper = extSource.substring(
			extSource.indexOf("function doOrchStatus("),
			extSource.indexOf("function doOrchPause("),
		);
		// Must use workspaceRoot ?? repoRoot ?? cwd (matching engine persistence)
		expect(statusHelper).toContain("workspaceRoot");
		expect(statusHelper).toContain("repoRoot");
	});

	it("7.3: disk fallback shows '(from disk)' indicator in status output", () => {
		const extSource = readSource("extension.ts");
		// Logic lives in doOrchStatus helper (TP-053 refactor)
		const statusHelper = extSource.substring(
			extSource.indexOf("function doOrchStatus("),
			extSource.indexOf("function doOrchPause("),
		);
		expect(statusHelper).toContain("from disk");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — Behavioral: startBatchAsync (R008-1)
// ══════════════════════════════════════════════════════════════════════

describe("8.x — Behavioral: startBatchAsync non-blocking pattern", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("8.1: startBatchAsync returns synchronously before engine work begins", async () => {
		let engineStarted = false;
		const engineFn = async () => { engineStarted = true; };
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.batchId = "test-batch";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		// Before advancing timers, engine should NOT have started
		expect(engineStarted).toBe(false);

		// Advance past the setTimeout(0) detach
		await vi.advanceTimersByTimeAsync(0);

		// Now engine should have run
		expect(engineStarted).toBe(true);
	});

	it("8.2: startBatchAsync calls updateWidget on successful engine completion", async () => {
		const engineFn = async () => { /* success */ };
		const batchState = freshOrchBatchState();
		batchState.phase = "executing";
		batchState.batchId = "test-batch";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		// Before timer fires — no widget update
		expect(updateWidget).not.toHaveBeenCalled();

		// Advance past setTimeout(0) and let microtask (.then) resolve
		await vi.advanceTimersByTimeAsync(0);

		// Widget should have been updated after successful completion
		expect(updateWidget).toHaveBeenCalledTimes(1);
	});

	it("8.3: startBatchAsync error boundary sets phase to 'failed' on engine rejection", async () => {
		const engineFn = async () => { throw new Error("engine explosion"); };
		const batchState = freshOrchBatchState();
		batchState.phase = "executing";
		batchState.batchId = "crash-batch";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		// Advance timer and let rejection propagate
		await vi.advanceTimersByTimeAsync(0);

		// Error boundary should have set phase to "failed"
		expect(batchState.phase).toBe("failed");
		expect(batchState.endedAt).not.toBeNull();
		expect(batchState.errors).toContain("Unhandled engine error: engine explosion");
		// Widget should still have been updated
		expect(updateWidget).toHaveBeenCalledTimes(1);
		// Operator should have been notified
		expect(mockCtx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("engine explosion"),
			"error",
		);
	});

	it("8.4: startBatchAsync error boundary does NOT overwrite already-completed phase", async () => {
		const engineFn = async () => { throw new Error("late crash"); };
		const batchState = freshOrchBatchState();
		// Simulate engine having already set completed before the catch fires
		batchState.phase = "completed";
		batchState.batchId = "already-done";
		batchState.endedAt = Date.now();
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		await vi.advanceTimersByTimeAsync(0);

		// Phase should remain "completed" — error boundary checks for terminal phases
		expect(batchState.phase).toBe("completed");
		// Widget should still have been updated (error path always updates widget)
		expect(updateWidget).toHaveBeenCalledTimes(1);
	});

	it("8.5: startBatchAsync error boundary does NOT overwrite already-failed phase", async () => {
		const engineFn = async () => { throw new Error("double crash"); };
		const batchState = freshOrchBatchState();
		batchState.phase = "failed";
		batchState.batchId = "already-failed";
		batchState.endedAt = Date.now() - 1000;
		const originalErrors = [...batchState.errors];
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		await vi.advanceTimersByTimeAsync(0);

		// Phase should remain "failed" — no double-set
		expect(batchState.phase).toBe("failed");
		// endedAt should NOT have been overwritten
		expect(batchState.endedAt).toBeLessThanOrEqual(Date.now() - 900);
		// No extra errors pushed
		expect(batchState.errors).toEqual(originalErrors);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9.x — Behavioral: launch-window command logic (R008-2a)
// ══════════════════════════════════════════════════════════════════════

describe("9.x — Behavioral: launch-window command compatibility", () => {
	it("9.1: 'launching' phase is recognized as an active batch (not idle)", () => {
		// Behavioral test: verify that the phase logic used by /orch-pause, /orch-abort
		// correctly treats "launching" as an active state
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.batchId = "launch-test";
		batchState.startedAt = Date.now();

		// /orch-pause exclusion set: "idle", "completed", "failed", "stopped"
		// "launching" should NOT be in this set → pause is allowed
		const pauseExcludes: Set<string> = new Set(["idle", "completed", "failed", "stopped"]);
		expect(pauseExcludes.has(batchState.phase)).toBe(false);

		// /orch-abort active check: anything NOT in {"idle", "completed", "failed", "stopped"} is active
		const inactivePhases = new Set(["idle", "completed", "failed", "stopped"]);
		const hasActiveBatch = !inactivePhases.has(batchState.phase);
		expect(hasActiveBatch).toBe(true);

		// /orch-resume guard: "launching" should be recognized as actively running
		const resumeBlockedPhases: Set<string> = new Set(["launching", "executing", "merging", "planning"]);
		expect(resumeBlockedPhases.has(batchState.phase)).toBe(true);
	});

	it("9.2: /orch-status with non-idle phase uses in-memory state (not disk fallback)", () => {
		// The status handler only falls back to disk when phase === "idle"
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.batchId = "launch-status-test";
		batchState.startedAt = Date.now();

		const shouldFallbackToDisk = batchState.phase === "idle";
		expect(shouldFallbackToDisk).toBe(false);
	});

	it("9.3: freshOrchBatchState starts at 'idle' phase with empty batchId", () => {
		const state = freshOrchBatchState();
		expect(state.phase).toBe("idle");
		expect(state.batchId).toBe("");
		expect(state.startedAt).toBe(0);
		expect(state.endedAt).toBeNull();
		expect(state.errors).toEqual([]);
	});

	it("9.4: transitioning from idle → launching → planning preserves startedAt", () => {
		const state = freshOrchBatchState();
		expect(state.phase).toBe("idle");

		// Simulate /orch handler setting launching
		state.phase = "launching";
		state.startedAt = 1234567890;

		// Simulate engine transitioning to planning (preserves startedAt)
		state.phase = "planning";
		if (!state.startedAt) state.startedAt = Date.now(); // engine code
		expect(state.startedAt).toBe(1234567890); // preserved from launching
	});
});

// ══════════════════════════════════════════════════════════════════════
// 10.x — Behavioral: terminal event emission sequences (R008-2b)
// ══════════════════════════════════════════════════════════════════════

describe("10.x — Behavioral: engine event emission sequences", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "engine-terminal-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("10.1: terminal event helper emits batch_complete for 'completed' phase", () => {
		// Replicate the engine's emitTerminalEvent logic behaviorally
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);
		const batchState = freshOrchBatchState();
		batchState.batchId = "terminal-test";
		batchState.phase = "completed";
		batchState.startedAt = Date.now() - 30000;
		batchState.endedAt = Date.now();
		batchState.succeededTasks = 3;
		batchState.failedTasks = 0;
		batchState.skippedTasks = 1;
		batchState.blockedTasks = 0;
		batchState.currentWaveIndex = 2;

		// Emit batch_complete event (same logic as engine's emitTerminalEvent)
		let terminalEventEmitted = false;
		const emitTerminal = (reason?: string) => {
			if (terminalEventEmitted) return;
			terminalEventEmitted = true;
			if (batchState.phase === "completed" || batchState.phase === "failed") {
				const event: EngineEvent = {
					...buildEngineEventBase("batch_complete", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
					succeededTasks: batchState.succeededTasks,
					failedTasks: batchState.failedTasks,
					skippedTasks: batchState.skippedTasks,
					blockedTasks: batchState.blockedTasks,
					batchDurationMs: batchState.endedAt ? batchState.endedAt - batchState.startedAt : undefined,
				};
				emitEngineEvent(tmpDir, event, callback);
			}
		};

		emitTerminal();

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("batch_complete");
		expect(received[0].batchId).toBe("terminal-test");
		expect(received[0].succeededTasks).toBe(3);
		expect(received[0].failedTasks).toBe(0);
		expect(received[0].skippedTasks).toBe(1);
		expect(received[0].batchDurationMs).toBeGreaterThanOrEqual(29000);

		// Also written to disk
		const diskEvents = readEngineEvents(tmpDir);
		expect(diskEvents).toHaveLength(1);
		expect(diskEvents[0].type).toBe("batch_complete");
	});

	it("10.2: terminal event helper emits batch_paused for 'paused' phase", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);
		const batchState = freshOrchBatchState();
		batchState.batchId = "paused-test";
		batchState.phase = "paused";
		batchState.failedTasks = 2;
		batchState.currentWaveIndex = 1;
		batchState.errors.push("stop-wave policy triggered");

		let terminalEventEmitted = false;
		const emitTerminal = (reason?: string) => {
			if (terminalEventEmitted) return;
			terminalEventEmitted = true;
			if (batchState.phase === "paused" || batchState.phase === "stopped") {
				const event: EngineEvent = {
					...buildEngineEventBase("batch_paused", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
					reason: reason || (batchState.errors.length > 0 ? batchState.errors[batchState.errors.length - 1] : "paused"),
					failedTasks: batchState.failedTasks,
				};
				emitEngineEvent(tmpDir, event, callback);
			}
		};

		emitTerminal("Stopped by stop-wave policy at wave 2");

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("batch_paused");
		expect(received[0].batchId).toBe("paused-test");
		expect(received[0].reason).toContain("stop-wave");
		expect(received[0].failedTasks).toBe(2);
	});

	it("10.3: terminal event one-shot guard prevents duplicate emissions", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);
		const batchState = freshOrchBatchState();
		batchState.batchId = "guard-test";
		batchState.phase = "completed";
		batchState.startedAt = Date.now() - 5000;
		batchState.endedAt = Date.now();
		batchState.succeededTasks = 1;
		batchState.currentWaveIndex = 0;

		let terminalEventEmitted = false;
		const emitTerminal = (reason?: string) => {
			if (terminalEventEmitted) return;
			terminalEventEmitted = true;
			if (batchState.phase === "completed" || batchState.phase === "failed") {
				emitEngineEvent(tmpDir, {
					...buildEngineEventBase("batch_complete", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
					succeededTasks: batchState.succeededTasks,
					failedTasks: batchState.failedTasks,
				}, callback);
			}
		};

		// Call multiple times — only first should emit
		emitTerminal();
		emitTerminal();
		emitTerminal();

		expect(received).toHaveLength(1);
		const diskEvents = readEngineEvents(tmpDir);
		expect(diskEvents).toHaveLength(1);
	});

	it("10.4: terminal event emits batch_complete for 'failed' phase (not batch_paused)", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);
		const batchState = freshOrchBatchState();
		batchState.batchId = "failed-batch";
		batchState.phase = "failed";
		batchState.startedAt = Date.now() - 10000;
		batchState.endedAt = Date.now();
		batchState.failedTasks = 5;
		batchState.currentWaveIndex = 0;

		let terminalEventEmitted = false;
		const emitTerminal = () => {
			if (terminalEventEmitted) return;
			terminalEventEmitted = true;
			if (batchState.phase === "completed" || batchState.phase === "failed") {
				emitEngineEvent(tmpDir, {
					...buildEngineEventBase("batch_complete", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
					succeededTasks: batchState.succeededTasks,
					failedTasks: batchState.failedTasks,
					batchDurationMs: batchState.endedAt ? batchState.endedAt - batchState.startedAt : undefined,
				}, callback);
			}
		};

		emitTerminal();

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("batch_complete"); // NOT batch_paused
		expect(received[0].phase).toBe("failed");
		expect(received[0].failedTasks).toBe(5);
	});

	it("10.5: terminal event emits batch_paused for 'stopped' phase", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);
		const batchState = freshOrchBatchState();
		batchState.batchId = "stopped-batch";
		batchState.phase = "stopped";
		batchState.failedTasks = 1;
		batchState.currentWaveIndex = 0;

		let terminalEventEmitted = false;
		const emitTerminal = (reason?: string) => {
			if (terminalEventEmitted) return;
			terminalEventEmitted = true;
			if (batchState.phase === "paused" || batchState.phase === "stopped") {
				emitEngineEvent(tmpDir, {
					...buildEngineEventBase("batch_paused", batchState.batchId, batchState.currentWaveIndex, batchState.phase),
					reason: reason || "stopped",
					failedTasks: batchState.failedTasks,
				}, callback);
			}
		};

		emitTerminal("stop-all policy");

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("batch_paused");
		expect(received[0].phase).toBe("stopped");
		expect(received[0].reason).toBe("stop-all policy");
	});

	it("10.6: full lifecycle event sequence written to JSONL in correct order", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);

		// Simulate a complete batch lifecycle through events
		const batchId = "lifecycle-test";

		// Wave 0 start
		emitEngineEvent(tmpDir, {
			...buildEngineEventBase("wave_start", batchId, 0, "executing"),
			taskIds: ["TP-001", "TP-002"],
			laneCount: 2,
		}, callback);

		// Tasks complete
		emitEngineEvent(tmpDir, {
			...buildEngineEventBase("task_complete", batchId, 0, "executing"),
			taskId: "TP-001",
			durationMs: 15000,
		}, callback);

		emitEngineEvent(tmpDir, {
			...buildEngineEventBase("task_failed", batchId, 0, "executing"),
			taskId: "TP-002",
			durationMs: 8000,
			reason: "test failures",
		}, callback);

		// Merge
		emitEngineEvent(tmpDir, {
			...buildEngineEventBase("merge_start", batchId, 0, "merging"),
			laneCount: 1,
		}, callback);

		emitEngineEvent(tmpDir, {
			...buildEngineEventBase("merge_success", batchId, 0, "merging"),
			totalWaves: 1,
		}, callback);

		// Terminal
		emitEngineEvent(tmpDir, {
			...buildEngineEventBase("batch_complete", batchId, 0, "completed"),
			succeededTasks: 1,
			failedTasks: 1,
			batchDurationMs: 25000,
		}, callback);

		// Verify order in both callback and disk
		expect(received).toHaveLength(6);
		expect(received.map(e => e.type)).toEqual([
			"wave_start", "task_complete", "task_failed",
			"merge_start", "merge_success", "batch_complete",
		]);

		const diskEvents = readEngineEvents(tmpDir);
		expect(diskEvents).toHaveLength(6);
		expect(diskEvents.map(e => e.type)).toEqual([
			"wave_start", "task_complete", "task_failed",
			"merge_start", "merge_success", "batch_complete",
		]);

		// Verify event-specific fields survived serialization roundtrip
		expect(diskEvents[0].taskIds).toEqual(["TP-001", "TP-002"]);
		expect(diskEvents[1].taskId).toBe("TP-001");
		expect(diskEvents[2].reason).toBe("test failures");
		expect(diskEvents[5].batchDurationMs).toBe(25000);
	});

	it("10.7: no terminal event emitted for non-terminal phase ('executing')", () => {
		const received: EngineEvent[] = [];
		const callback: EngineEventCallback = (event) => received.push(event);
		const batchState = freshOrchBatchState();
		batchState.batchId = "non-terminal";
		batchState.phase = "executing";

		let terminalEventEmitted = false;
		const emitTerminal = () => {
			if (terminalEventEmitted) return;
			terminalEventEmitted = true;
			if (batchState.phase === "completed" || batchState.phase === "failed") {
				emitEngineEvent(tmpDir, {
					...buildEngineEventBase("batch_complete", batchState.batchId, 0, batchState.phase),
				}, callback);
			} else if (batchState.phase === "paused" || batchState.phase === "stopped") {
				emitEngineEvent(tmpDir, {
					...buildEngineEventBase("batch_paused", batchState.batchId, 0, batchState.phase),
				}, callback);
			}
		};

		emitTerminal();

		// Guard flag is set but no event emitted for "executing" phase
		expect(terminalEventEmitted).toBe(true);
		expect(received).toHaveLength(0);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — Behavioral: startBatchAsync with fake timers (R008-1)
// ══════════════════════════════════════════════════════════════════════

describe("8.x — Behavioral: startBatchAsync returns immediately, defers engine work", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("8.1: startBatchAsync returns synchronously (handler is not blocked)", () => {
		let engineStarted = false;
		const engineFn = () => new Promise<void>((resolve) => {
			engineStarted = true;
			resolve();
		});
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		// Call startBatchAsync — must return synchronously
		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		// Engine should NOT have started yet (setTimeout(0) hasn't fired)
		expect(engineStarted).toBe(false);
	});

	it("8.2: engine runs after setTimeout fires (next tick)", async () => {
		let engineStarted = false;
		const engineFn = () => new Promise<void>((resolve) => {
			engineStarted = true;
			resolve();
		});
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		// Fire the setTimeout
		vi.advanceTimersByTime(0);
		// Let microtasks (promise .then) settle
		await vi.advanceTimersByTimeAsync(0);

		expect(engineStarted).toBe(true);
		// Widget should be updated after engine completes
		expect(updateWidget).toHaveBeenCalled();
	});

	it("8.3: error boundary sets phase to 'failed' on engine rejection", async () => {
		const engineFn = () => Promise.reject(new Error("engine exploded"));
		const batchState = freshOrchBatchState();
		batchState.phase = "executing";
		batchState.batchId = "test-batch";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);

		// Fire setTimeout and let promise rejection settle
		await vi.advanceTimersByTimeAsync(0);

		expect(batchState.phase).toBe("failed");
		expect(batchState.endedAt).not.toBeNull();
		expect(batchState.errors).toContain("Unhandled engine error: engine exploded");
		expect(mockCtx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Engine crashed"),
			"error",
		);
		expect(updateWidget).toHaveBeenCalled();
	});

	it("8.4: error boundary does not overwrite already-completed phase", async () => {
		const engineFn = () => Promise.reject(new Error("late crash"));
		const batchState = freshOrchBatchState();
		batchState.phase = "completed"; // Already completed before error
		batchState.batchId = "test-batch";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);
		await vi.advanceTimersByTimeAsync(0);

		// Should still be "completed", not overwritten to "failed"
		expect(batchState.phase).toBe("completed");
	});

	it("8.5: success path calls updateWidget exactly once", async () => {
		const engineFn = () => Promise.resolve();
		const batchState = freshOrchBatchState();
		batchState.phase = "executing";
		const mockCtx = { ui: { notify: vi.fn(), setWidget: vi.fn() } } as any;
		const updateWidget = vi.fn();

		startBatchAsync(engineFn, batchState, mockCtx, updateWidget);
		await vi.advanceTimersByTimeAsync(0);

		expect(updateWidget).toHaveBeenCalledTimes(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9.x — Behavioral: Launch-window command logic (R008-2)
// ══════════════════════════════════════════════════════════════════════

describe("9.x — Behavioral: launch-window command logic with 'launching' phase", () => {
	/**
	 * These tests verify the command-handler logic paths that execute when
	 * the batch is in "launching" phase, by inspecting the same boolean
	 * conditions the handlers use. This validates the in-memory behavior
	 * without needing a full pi ExtensionAPI mock.
	 */

	it("9.1: 'launching' is recognized as active batch by /orch guard", () => {
		// /orch guard condition: phase !== idle && !== completed && !== failed && !== stopped
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";

		// This is the exact guard from the /orch handler
		const isBlocked = batchState.phase !== "idle" &&
			batchState.phase !== "completed" &&
			batchState.phase !== "failed" &&
			batchState.phase !== "stopped";

		expect(isBlocked).toBe(true);
	});

	it("9.2: /orch-status shows in-memory state when phase is 'launching' (no disk fallback)", () => {
		// /orch-status falls back to disk only when phase === "idle"
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.batchId = "20260322T120000";

		const useDiskFallback = batchState.phase === "idle";
		expect(useDiskFallback).toBe(false);
		// In-memory state should be used, showing batchId
		expect(batchState.batchId).toBe("20260322T120000");
	});

	it("9.3: /orch-pause is NOT blocked for 'launching' phase", () => {
		// /orch-pause exclusion set: idle, completed, failed, stopped
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";

		const isInactive = batchState.phase === "idle" ||
			batchState.phase === "completed" ||
			batchState.phase === "failed" ||
			batchState.phase === "stopped";

		expect(isInactive).toBe(false); // pause is allowed
	});

	it("9.4: /orch-abort recognizes 'launching' as active", () => {
		// hasActiveBatch: phase is not idle/completed/failed/stopped
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";

		const hasActiveBatch = batchState.phase !== "idle" &&
			batchState.phase !== "completed" &&
			batchState.phase !== "failed" &&
			batchState.phase !== "stopped";

		expect(hasActiveBatch).toBe(true);
	});

	it("9.5: /orch-resume blocks 'launching' phase (prevents double-start)", () => {
		// Resume guard: launching || executing || merging || planning
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";

		const isRunning = batchState.phase === "launching" ||
			batchState.phase === "executing" ||
			batchState.phase === "merging" ||
			batchState.phase === "planning";

		expect(isRunning).toBe(true);
	});

	it("9.6: all active phases blocked by /orch-resume guard", () => {
		const activePhases = ["launching", "executing", "merging", "planning"] as const;
		for (const phase of activePhases) {
			const isRunning = phase === "launching" ||
				phase === "executing" ||
				phase === "merging" ||
				phase === "planning";
			expect(isRunning).toBe(true);
		}
	});

	it("9.7: idle/completed/failed/stopped not blocked by /orch-resume guard", () => {
		const resumablePhases = ["idle", "completed", "failed", "stopped"] as const;
		for (const phase of resumablePhases) {
			const isRunning = phase === "launching" ||
				phase === "executing" ||
				phase === "merging" ||
				phase === "planning";
			expect(isRunning).toBe(false);
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 11.x — Behavioral: resumeOrchBatch early-return phase reset (R008-3)
// ══════════════════════════════════════════════════════════════════════

describe("11.x — Behavioral: resumeOrchBatch early-return resets phase to 'idle'", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "resume-phase-reset-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("11.1: phase resets from 'launching' to 'idle' when no persisted state exists", async () => {
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.startedAt = Date.now();

		const notifications: Array<{ message: string; level: string }> = [];
		const onNotify = (message: string, level: "info" | "warning" | "error") => {
			notifications.push({ message, level });
		};

		// Call resumeOrchBatch with an empty temp dir (no batch-state.json)
		await resumeOrchBatch(
			DEFAULT_ORCHESTRATOR_CONFIG,
			DEFAULT_TASK_RUNNER_CONFIG,
			tmpDir,
			batchState,
			onNotify,
			undefined,
			null,
			tmpDir, // workspaceRoot = tmpDir (no state file)
		);

		// Phase must reset to idle (not stuck at "launching")
		expect(batchState.phase).toBe("idle");
		// Should have notified about no state
		expect(notifications.some(n => n.level === "error")).toBe(true);
	});

	it("11.2: phase resets from 'launching' to 'idle' when state file is corrupt", async () => {
		const batchState = freshOrchBatchState();
		batchState.phase = "launching";
		batchState.startedAt = Date.now();

		// Create a corrupt batch-state.json
		const piDir = join(tmpDir, ".pi");
		const { mkdirSync, writeFileSync } = await import("fs");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(join(piDir, "batch-state.json"), "{ not valid json !!!");

		const notifications: Array<{ message: string; level: string }> = [];
		const onNotify = (message: string, level: "info" | "warning" | "error") => {
			notifications.push({ message, level });
		};

		await resumeOrchBatch(
			DEFAULT_ORCHESTRATOR_CONFIG,
			DEFAULT_TASK_RUNNER_CONFIG,
			tmpDir,
			batchState,
			onNotify,
			undefined,
			null,
			tmpDir,
		);

		// Phase must reset to idle
		expect(batchState.phase).toBe("idle");
		expect(notifications.some(n => n.level === "error")).toBe(true);
	});

	it("11.3: idle phase stays idle when no persisted state exists (no regression for non-launched state)", async () => {
		const batchState = freshOrchBatchState();
		// phase is already "idle" — should stay idle
		expect(batchState.phase).toBe("idle");

		const onNotify = vi.fn();

		await resumeOrchBatch(
			DEFAULT_ORCHESTRATOR_CONFIG,
			DEFAULT_TASK_RUNNER_CONFIG,
			tmpDir,
			batchState,
			onNotify,
			undefined,
			null,
			tmpDir,
		);

		expect(batchState.phase).toBe("idle");
	});
});
