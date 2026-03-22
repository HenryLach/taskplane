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
 *
 * Run: npx vitest run tests/non-blocking-engine.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	emitEngineEvent,
} from "../taskplane/persistence.ts";

import {
	buildEngineEventBase,
	freshOrchBatchState,
} from "../taskplane/types.ts";

import type {
	EngineEvent,
	EngineEventCallback,
	EngineEventType,
	OrchBatchRuntimeState,
} from "../taskplane/types.ts";

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

	it("1.2: /orch handler uses startBatchAsync (fire-and-forget, no await on engine)", () => {
		const extSource = readSource("extension.ts");
		// The /orch handler must call startBatchAsync, not await executeOrchBatch
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);
		expect(orchHandler).toContain("startBatchAsync(");
		// Must NOT await executeOrchBatch directly
		expect(orchHandler).not.toContain("await executeOrchBatch(");
	});

	it("1.3: /orch-resume handler uses startBatchAsync (fire-and-forget)", () => {
		const extSource = readSource("extension.ts");
		const resumeHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-resume"'),
			extSource.indexOf('registerCommand("orch-abort"'),
		);
		expect(resumeHandler).toContain("startBatchAsync(");
		// Must NOT await resumeOrchBatch directly
		expect(resumeHandler).not.toContain("await resumeOrchBatch(");
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

	it("1.6: /orch sets phase to 'launching' synchronously before setTimeout detach", () => {
		const extSource = readSource("extension.ts");
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);
		// Must set launching phase before calling startBatchAsync
		const launchingIdx = orchHandler.indexOf('orchBatchState.phase = "launching"');
		const startAsyncIdx = orchHandler.indexOf("startBatchAsync(");
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
		const statusHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-status"'),
			extSource.indexOf('registerCommand("orch-pause"'),
		);
		// When phase is NOT idle, it should display in-memory state
		// The handler checks orchBatchState.phase === "idle" for disk fallback
		expect(statusHandler).toContain('orchBatchState.phase === "idle"');
		// So "launching" won't trigger disk fallback — it will show in-memory
	});

	it("5.2: /orch-pause accepts 'launching' phase (not in exclusion set)", () => {
		const extSource = readSource("extension.ts");
		const pauseHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-pause"'),
			extSource.indexOf('registerCommand("orch-resume"'),
		);
		// Pause handler excludes idle, completed, failed, stopped
		// It should NOT exclude "launching" — pause during launching is valid
		expect(pauseHandler).toContain('"idle"');
		expect(pauseHandler).toContain('"completed"');
		expect(pauseHandler).toContain('"failed"');
		expect(pauseHandler).toContain('"stopped"');
		// "launching" should not appear in the exclusion set
		const exclusionLine = pauseHandler.substring(
			pauseHandler.indexOf('orchBatchState.phase === "idle"'),
			pauseHandler.indexOf("ORCH_MESSAGES.pauseNoBatch"),
		);
		expect(exclusionLine).not.toContain('"launching"');
	});

	it("5.3: /orch-abort recognizes 'launching' as an active batch phase", () => {
		const extSource = readSource("extension.ts");
		const abortHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-abort"'),
			extSource.indexOf('registerCommand("orch-deps"') !== -1
				? extSource.indexOf('registerCommand("orch-deps"')
				: extSource.indexOf('registerCommand("orch-sessions"'),
		);
		// abort checks hasActiveBatch — launching should not be in inactive set
		expect(abortHandler).toContain("hasActiveBatch");
		// hasActiveBatch excludes only idle, completed, failed, stopped
		const activeCheck = abortHandler.substring(
			abortHandler.indexOf("hasActiveBatch"),
			abortHandler.indexOf("hasActiveBatch") + 400,
		);
		expect(activeCheck).toContain('"idle"');
		expect(activeCheck).toContain('"completed"');
		expect(activeCheck).toContain('"failed"');
		expect(activeCheck).toContain('"stopped"');
	});

	it("5.4: /orch-resume blocks 'launching' phase (prevents double-start)", () => {
		const extSource = readSource("extension.ts");
		const resumeHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-resume"'),
			extSource.indexOf('registerCommand("orch-abort"'),
		);
		// Resume must explicitly check for "launching" as an active phase
		expect(resumeHandler).toContain('"launching"');
		// It should be in the active-batch guard that prevents resume
		const guardStart = resumeHandler.indexOf('orchBatchState.phase === "launching"');
		const guardSection = resumeHandler.substring(guardStart, guardStart + 400);
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

	it("6.6: /orch handler sets 'launching' phase before calling startBatchAsync", () => {
		const extSource = readSource("extension.ts");
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);
		// Both launching phase AND startedAt must be set before startBatchAsync
		const launchPhaseIdx = orchHandler.indexOf('orchBatchState.phase = "launching"');
		const startedAtIdx = orchHandler.indexOf("orchBatchState.startedAt = Date.now()");
		const startAsyncIdx = orchHandler.indexOf("startBatchAsync(");
		expect(launchPhaseIdx).not.toBe(-1);
		expect(startedAtIdx).not.toBe(-1);
		expect(startAsyncIdx).not.toBe(-1);
		expect(launchPhaseIdx).toBeLessThan(startAsyncIdx);
		expect(startedAtIdx).toBeLessThan(startAsyncIdx);
	});

	it("6.7: /orch-resume handler sets 'launching' phase before calling startBatchAsync", () => {
		const extSource = readSource("extension.ts");
		const resumeHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-resume"'),
			extSource.indexOf('registerCommand("orch-abort"'),
		);
		const launchPhaseIdx = resumeHandler.indexOf('orchBatchState.phase = "launching"');
		const startAsyncIdx = resumeHandler.indexOf("startBatchAsync(");
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
		const statusHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-status"'),
			extSource.indexOf('registerCommand("orch-pause"'),
		);
		expect(statusHandler).toContain("loadBatchState");
		expect(statusHandler).toContain('orchBatchState.phase === "idle"');
	});

	it("7.2: disk fallback resolves stateRoot from workspaceRoot first", () => {
		const extSource = readSource("extension.ts");
		const statusHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-status"'),
			extSource.indexOf('registerCommand("orch-pause"'),
		);
		// Must use workspaceRoot ?? repoRoot ?? cwd (matching engine persistence)
		expect(statusHandler).toContain("workspaceRoot");
		expect(statusHandler).toContain("repoRoot");
	});

	it("7.3: disk fallback shows '(from disk)' indicator in status output", () => {
		const extSource = readSource("extension.ts");
		const statusHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch-status"'),
			extSource.indexOf('registerCommand("orch-pause"'),
		);
		expect(statusHandler).toContain("from disk");
	});
});
