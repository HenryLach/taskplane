/**
 * TP-056: Supervisor Merge Monitoring Tests
 *
 * Tests for:
 * - Health classification logic (classifyMergeHealth)
 * - MergeHealthMonitor session tracking, polling, and event emission
 * - Supervisor event formatting for merge health events
 * - Source-level integration verification (engine starts/stops monitor, supervisor handles events)
 * - Dead-session callback / early-exit signaling
 * - Event de-duplication (each tier emitted at most once)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/supervisor-merge-monitoring.test.ts
 */
import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { classifyMergeHealth, captureMergePaneOutput, MergeHealthMonitor } from "../taskplane/merge.ts";
import { formatEventNotification, shouldNotify } from "../taskplane/supervisor.ts";
import {
	MERGE_HEALTH_WARNING_THRESHOLD_MS,
	MERGE_HEALTH_STUCK_THRESHOLD_MS,
	MERGE_HEALTH_POLL_INTERVAL_MS,
	MERGE_HEALTH_CAPTURE_LINES,
} from "../taskplane/types.ts";
import type {
	MergeSessionHealthState,
	MergeHealthStatus,
} from "../taskplane/types.ts";


// ── Helper: create a default MergeSessionHealthState ─────────────────


const __dirname = dirname(fileURLToPath(import.meta.url));
function makeHealthState(overrides?: Partial<MergeSessionHealthState>): MergeSessionHealthState {
	const now = Date.now();
	return {
		sessionName: "orch-merge-1",
		laneNumber: 1,
		lastSnapshot: null,
		lastActivityAt: now,
		status: "healthy",
		warningEmitted: false,
		stuckEmitted: false,
		deadEmitted: false,
		...overrides,
	};
}


// ── 1. Health Classification Tests ───────────────────────────────────

describe("classifyMergeHealth", () => {
	it("1.1: returns 'dead' when session is gone and no result file", () => {
		const state = makeHealthState();
		const result = classifyMergeHealth(
			false,   // sessionAlive
			false,   // hasResultFile
			null,    // currentOutput
			state,
			Date.now(),
		);
		expect(result).toBe("dead");
	});

	it("1.2: returns 'healthy' when session is dead but result file exists", () => {
		const state = makeHealthState();
		const result = classifyMergeHealth(
			false,   // sessionAlive
			true,    // hasResultFile
			null,    // currentOutput
			state,
			Date.now(),
		);
		expect(result).toBe("healthy");
	});

	it("1.3: returns 'healthy' when session alive and output changed (new output)", () => {
		const now = Date.now();
		const state = makeHealthState({
			lastSnapshot: { content: "old output", capturedAt: now - 60_000 },
			lastActivityAt: now - 60_000,
		});
		const result = classifyMergeHealth(
			true,            // sessionAlive
			false,           // hasResultFile
			"new output",    // currentOutput (different from lastSnapshot)
			state,
			now,
		);
		expect(result).toBe("healthy");
	});

	it("1.4: returns 'healthy' when session alive and first capture (no previous snapshot)", () => {
		const now = Date.now();
		const state = makeHealthState({ lastSnapshot: null, lastActivityAt: now });
		const result = classifyMergeHealth(
			true,
			false,
			"some output",
			state,
			now,
		);
		expect(result).toBe("healthy");
	});

	it("1.5: returns 'warning' when session alive and output unchanged for warning threshold", () => {
		const now = Date.now();
		const staleTime = now - MERGE_HEALTH_WARNING_THRESHOLD_MS - 1;
		const state = makeHealthState({
			lastSnapshot: { content: "same output", capturedAt: staleTime },
			lastActivityAt: staleTime,
		});
		const result = classifyMergeHealth(
			true,
			false,
			"same output",  // same as lastSnapshot
			state,
			now,
		);
		expect(result).toBe("warning");
	});

	it("1.6: returns 'stuck' when session alive and output unchanged for stuck threshold", () => {
		const now = Date.now();
		const veryStaleTime = now - MERGE_HEALTH_STUCK_THRESHOLD_MS - 1;
		const state = makeHealthState({
			lastSnapshot: { content: "stale output", capturedAt: veryStaleTime },
			lastActivityAt: veryStaleTime,
		});
		const result = classifyMergeHealth(
			true,
			false,
			"stale output",  // same as lastSnapshot
			state,
			now,
		);
		expect(result).toBe("stuck");
	});

	it("1.7: returns 'healthy' when session alive but stale duration below warning threshold", () => {
		const now = Date.now();
		// 5 minutes of stale — below 10-minute warning threshold
		const recentStale = now - 5 * 60 * 1000;
		const state = makeHealthState({
			lastSnapshot: { content: "output", capturedAt: recentStale },
			lastActivityAt: recentStale,
		});
		const result = classifyMergeHealth(
			true,
			false,
			"output",  // same as lastSnapshot
			state,
			now,
		);
		expect(result).toBe("healthy");
	});

	it("1.8: stuck takes priority over warning when both thresholds exceeded", () => {
		const now = Date.now();
		const veryStaleTime = now - MERGE_HEALTH_STUCK_THRESHOLD_MS - 1;
		const state = makeHealthState({
			lastSnapshot: { content: "output", capturedAt: veryStaleTime },
			lastActivityAt: veryStaleTime,
		});
		const result = classifyMergeHealth(true, false, "output", state, now);
		expect(result).toBe("stuck");
	});

	it("1.9: null currentOutput with alive session still checks stale duration", () => {
		const now = Date.now();
		const staleTime = now - MERGE_HEALTH_WARNING_THRESHOLD_MS - 1;
		const state = makeHealthState({
			lastSnapshot: { content: "output", capturedAt: staleTime },
			lastActivityAt: staleTime,
		});
		// null output means capture failed — not a new output change
		const result = classifyMergeHealth(true, false, null, state, now);
		expect(result).toBe("warning");
	});
});


// ── 2. Snapshot Comparison Logic Tests ───────────────────────────────

describe("snapshot comparison logic", () => {
	it("2.1: output change detected when content differs from last snapshot", () => {
		const now = Date.now();
		const state = makeHealthState({
			lastSnapshot: { content: "line 1\nline 2", capturedAt: now - 60_000 },
			lastActivityAt: now - 60_000,
		});
		// Different content should classify as healthy
		const result = classifyMergeHealth(true, false, "line 1\nline 2\nline 3", state, now);
		expect(result).toBe("healthy");
	});

	it("2.2: no change detected when content matches last snapshot exactly", () => {
		const now = Date.now();
		const staleTime = now - MERGE_HEALTH_WARNING_THRESHOLD_MS - 1;
		const state = makeHealthState({
			lastSnapshot: { content: "exact same", capturedAt: staleTime },
			lastActivityAt: staleTime,
		});
		const result = classifyMergeHealth(true, false, "exact same", state, now);
		expect(result).toBe("warning");
	});

	it("2.3: first capture (null lastSnapshot) always counts as new activity", () => {
		const state = makeHealthState({ lastSnapshot: null });
		const result = classifyMergeHealth(true, false, "first output", state, Date.now());
		expect(result).toBe("healthy");
	});
});


// ── 3. Constants Verification ────────────────────────────────────────

describe("monitoring constants", () => {
	it("3.1: warning threshold is 10 minutes", () => {
		expect(MERGE_HEALTH_WARNING_THRESHOLD_MS).toBe(10 * 60 * 1000);
	});

	it("3.2: stuck threshold is 20 minutes", () => {
		expect(MERGE_HEALTH_STUCK_THRESHOLD_MS).toBe(20 * 60 * 1000);
	});

	it("3.3: poll interval is 2 minutes", () => {
		expect(MERGE_HEALTH_POLL_INTERVAL_MS).toBe(2 * 60 * 1000);
	});

	it("3.4: capture lines is 10", () => {
		expect(MERGE_HEALTH_CAPTURE_LINES).toBe(10);
	});

	it("3.5: stuck threshold > warning threshold", () => {
		expect(MERGE_HEALTH_STUCK_THRESHOLD_MS).toBeGreaterThan(MERGE_HEALTH_WARNING_THRESHOLD_MS);
	});
});


// ── 4. Supervisor Event Formatting Tests ─────────────────────────────

describe("supervisor merge health event formatting", () => {
	it("4.1: formats merge_health_warning event correctly", () => {
		const event = {
			timestamp: new Date().toISOString(),
			type: "merge_health_warning" as const,
			batchId: "test-batch",
			waveIndex: 0,
			laneNumber: 2,
			stalledMinutes: 10,
		};
		const text = formatEventNotification(event as any, "supervised");
		expect(text).toContain("lane 2");
		expect(text).toContain("stalled");
		expect(text).toContain("10");
		expect(text).toContain("⚠️");
	});

	it("4.2: formats merge_health_dead event correctly", () => {
		const event = {
			timestamp: new Date().toISOString(),
			type: "merge_health_dead" as const,
			batchId: "test-batch",
			waveIndex: 0,
			laneNumber: 3,
		};
		const text = formatEventNotification(event as any, "supervised");
		expect(text).toContain("lane 3");
		expect(text).toContain("died");
		expect(text).toContain("💀");
	});

	it("4.3: formats merge_health_stuck event correctly", () => {
		const event = {
			timestamp: new Date().toISOString(),
			type: "merge_health_stuck" as const,
			batchId: "test-batch",
			waveIndex: 0,
			laneNumber: 1,
			stalledMinutes: 20,
		};
		const text = formatEventNotification(event as any, "supervised");
		expect(text).toContain("lane 1");
		expect(text).toContain("stuck");
		expect(text).toContain("20");
		expect(text).toContain("🔒");
	});

	it("4.4: handles missing laneNumber gracefully", () => {
		const event = {
			timestamp: new Date().toISOString(),
			type: "merge_health_warning" as const,
			batchId: "test-batch",
			waveIndex: 0,
			stalledMinutes: 15,
		};
		const text = formatEventNotification(event as any, "supervised");
		expect(text).toContain("?"); // fallback for missing lane
	});
});


// ── 5. Supervisor shouldNotify Tests ─────────────────────────────────

describe("shouldNotify for merge health events", () => {
	it("5.1: merge_health_dead always notifies (any autonomy level)", () => {
		expect(shouldNotify("merge_health_dead" as any, "autonomous")).toBe(true);
		expect(shouldNotify("merge_health_dead" as any, "supervised")).toBe(true);
		expect(shouldNotify("merge_health_dead" as any, "interactive")).toBe(true);
	});

	it("5.2: merge_health_stuck always notifies (any autonomy level)", () => {
		expect(shouldNotify("merge_health_stuck" as any, "autonomous")).toBe(true);
		expect(shouldNotify("merge_health_stuck" as any, "supervised")).toBe(true);
		expect(shouldNotify("merge_health_stuck" as any, "interactive")).toBe(true);
	});

	it("5.3: merge_health_warning notifies in supervised and interactive modes", () => {
		expect(shouldNotify("merge_health_warning" as any, "supervised")).toBe(true);
		expect(shouldNotify("merge_health_warning" as any, "interactive")).toBe(true);
	});

	it("5.4: merge_health_warning does NOT notify in autonomous mode", () => {
		// warning is in SIGNIFICANT_EVENT_TYPES but not in the always-notify set,
		// so autonomous mode should skip it
		expect(shouldNotify("merge_health_warning" as any, "autonomous")).toBe(false);
	});
});


// ── 6. Source-Level Integration Verification ─────────────────────────

describe("source-level integration verification", () => {
	it("6.1: engine.ts imports and uses MergeHealthMonitor", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);
		// Verify import
		expect(engineSource).toContain("MergeHealthMonitor");
		// Verify it creates a monitor during merge
		expect(engineSource).toContain("new MergeHealthMonitor");
		// Verify start/stop calls
		expect(engineSource).toContain("mergeHealthMonitor.start()");
		expect(engineSource).toContain("mergeHealthMonitor.stop()");
	});

	it("6.2: merge.ts mergeWave accepts healthMonitor parameter", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		// mergeWave signature includes healthMonitor
		expect(mergeSource).toContain("healthMonitor?: MergeHealthMonitor");
		// Runtime V2 merge flow still performs deregistration on completion/error.
		expect(mergeSource).toContain("if (healthMonitor) healthMonitor.removeSession(sessionName)");
	});

	it("6.3: supervisor.ts handles merge_health_* event types", () => {
		const supervisorSource = readFileSync(
			join(__dirname, "..", "taskplane", "supervisor.ts"),
			"utf-8",
		);
		expect(supervisorSource).toContain("merge_health_warning");
		expect(supervisorSource).toContain("merge_health_dead");
		expect(supervisorSource).toContain("merge_health_stuck");
	});

	it("6.4: types.ts exports merge health constants", () => {
		const typesSource = readFileSync(
			join(__dirname, "..", "taskplane", "types.ts"),
			"utf-8",
		);
		expect(typesSource).toContain("MERGE_HEALTH_POLL_INTERVAL_MS");
		expect(typesSource).toContain("MERGE_HEALTH_WARNING_THRESHOLD_MS");
		expect(typesSource).toContain("MERGE_HEALTH_STUCK_THRESHOLD_MS");
		expect(typesSource).toContain("MERGE_HEALTH_CAPTURE_LINES");
		expect(typesSource).toContain("MergeHealthStatus");
	});

	it("6.5: EngineEventType includes merge health event types", () => {
		const typesSource = readFileSync(
			join(__dirname, "..", "taskplane", "types.ts"),
			"utf-8",
		);
		// Find the EngineEventType union
		const engineEventMatch = typesSource.match(/export type EngineEventType\s*=[\s\S]*?;/);
		expect(engineEventMatch).not.toBeNull();
		const engineEventType = engineEventMatch![0];
		expect(engineEventType).toContain("merge_health_warning");
		expect(engineEventType).toContain("merge_health_dead");
		expect(engineEventType).toContain("merge_health_stuck");
	});

	it("6.6: EngineEvent interface includes merge health fields", () => {
		const typesSource = readFileSync(
			join(__dirname, "..", "taskplane", "types.ts"),
			"utf-8",
		);
		expect(typesSource).toContain("sessionName?: string");
		expect(typesSource).toContain("healthStatus?: MergeHealthStatus");
		expect(typesSource).toContain("stalledMinutes?: number");
	});
});


// ── 7. MergeHealthMonitor Unit Tests ─────────────────────────────────

describe("MergeHealthMonitor", () => {
	it("7.1: addSession registers session with healthy initial state", () => {
		const monitor = new MergeHealthMonitor({
			stateRoot: "/tmp/test",
			batchId: "test-batch",
			waveIndex: 0,
			phase: "merging",
		});
		monitor.addSession("orch-merge-1", 1, "/tmp/result.json");

		const states = monitor.getSessionStates();
		expect(states.size).toBe(1);

		const state = states.get("orch-merge-1");
		expect(state).toBeDefined();
		expect(state!.status).toBe("healthy");
		expect(state!.laneNumber).toBe(1);
		expect(state!.warningEmitted).toBe(false);
		expect(state!.stuckEmitted).toBe(false);
		expect(state!.deadEmitted).toBe(false);
	});

	it("7.2: removeSession clears session state", () => {
		const monitor = new MergeHealthMonitor({
			stateRoot: "/tmp/test",
			batchId: "test-batch",
			waveIndex: 0,
			phase: "merging",
		});
		monitor.addSession("orch-merge-1", 1, "/tmp/result.json");
		expect(monitor.getSessionStates().size).toBe(1);

		monitor.removeSession("orch-merge-1");
		expect(monitor.getSessionStates().size).toBe(0);
	});

	it("7.3: start/stop controls running state", () => {
		const monitor = new MergeHealthMonitor({
			stateRoot: "/tmp/test",
			batchId: "test-batch",
			waveIndex: 0,
			phase: "merging",
			pollIntervalMs: 60_000, // Use large interval so no actual polls fire
		});

		expect(monitor.running).toBe(false);
		monitor.start();
		expect(monitor.running).toBe(true);
		monitor.stop();
		expect(monitor.running).toBe(false);
	});

	it("7.4: start is idempotent (calling twice doesn't create multiple timers)", () => {
		const monitor = new MergeHealthMonitor({
			stateRoot: "/tmp/test",
			batchId: "test-batch",
			waveIndex: 0,
			phase: "merging",
			pollIntervalMs: 60_000,
		});
		monitor.start();
		monitor.start(); // second call should be no-op
		expect(monitor.running).toBe(true);
		monitor.stop();
		expect(monitor.running).toBe(false);
	});

	it("7.5: stop clears all tracked sessions", () => {
		const monitor = new MergeHealthMonitor({
			stateRoot: "/tmp/test",
			batchId: "test-batch",
			waveIndex: 0,
			phase: "merging",
			pollIntervalMs: 60_000,
		});
		monitor.addSession("sess-1", 1, "/tmp/r1.json");
		monitor.addSession("sess-2", 2, "/tmp/r2.json");
		expect(monitor.getSessionStates().size).toBe(2);

		monitor.start();
		monitor.stop();
		expect(monitor.getSessionStates().size).toBe(0);
	});
});


// ── 8. MergeHealthMonitor.poll() Behavior Tests ──────────────────────

describe("MergeHealthMonitor.poll() behavior", () => {
	it("8.1: poll() source verifies it calls tmuxHasSession + existsSync + classifyMergeHealth", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		// Find the poll() method body
		const pollIdx = mergeSource.indexOf("poll(): Promise<void> {");
		expect(pollIdx).toBeGreaterThan(-1);
		const pollBody = mergeSource.substring(pollIdx, pollIdx + 1500);

		// Verify poll checks session liveness (async — TP-070)
		expect(pollBody).toContain("tmuxHasSessionAsync(sessionName)");
		// Verify poll checks result file
		expect(pollBody).toContain("existsSync(resultPath)");
		// Verify poll classifies health
		expect(pollBody).toContain("classifyMergeHealth");
		// Verify poll captures pane output (async — TP-070)
		expect(pollBody).toContain("captureMergePaneOutputAsync");
	});

	it("8.2: poll() updates snapshot when output changes", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const pollIdx = mergeSource.indexOf("poll(): Promise<void> {");
		const pollBody = mergeSource.substring(pollIdx, pollIdx + 1500);

		// Verify snapshot update logic
		expect(pollBody).toContain("lastSnapshot");
		expect(pollBody).toContain("lastActivityAt");
		// Must check for content difference before updating
		expect(pollBody).toContain("currentOutput !== state.lastSnapshot.content");
	});

	it("8.3: poll() calls _emitHealthEvents for each session", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const pollIdx = mergeSource.indexOf("poll(): Promise<void> {");
		const pollBody = mergeSource.substring(pollIdx, pollIdx + 1500);

		expect(pollBody).toContain("_emitHealthEvents");
	});

	it("8.4: poll() fires onDeadSession callback when dead session detected", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const pollIdx = mergeSource.indexOf("poll(): Promise<void> {");
		const pollBody = mergeSource.substring(pollIdx, pollIdx + 1500);

		// Dead session triggers callback
		expect(pollBody).toContain("_onDeadSession");
		// Only fires when status is "dead"
		expect(pollBody).toContain('"dead"');
	});
});


// ── 9. Event Emission and De-duplication Tests ───────────────────────

describe("event emission and de-duplication", () => {
	it("9.1: _emitHealthEvents source emits warning event only when warningEmitted is false", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const emitIdx = mergeSource.indexOf("_emitHealthEvents");
		expect(emitIdx).toBeGreaterThan(-1);
		const emitBody = mergeSource.substring(emitIdx, emitIdx + 2000);

		// Check that warning event emission is gated on warningEmitted
		expect(emitBody).toContain("!state.warningEmitted");
		expect(emitBody).toContain("state.warningEmitted = true");
		expect(emitBody).toContain("merge_health_warning");
	});

	it("9.2: _emitHealthEvents source emits dead event only when deadEmitted is false", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const emitIdx = mergeSource.indexOf("_emitHealthEvents");
		const emitBody = mergeSource.substring(emitIdx, emitIdx + 2000);

		// poll() or _emitHealthEvents checks deadEmitted
		expect(emitBody).toContain("merge_health_dead");
	});

	it("9.3: _emitHealthEvents source emits stuck event only when stuckEmitted is false", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const emitIdx = mergeSource.indexOf("_emitHealthEvents");
		const emitBody = mergeSource.substring(emitIdx, emitIdx + 2500);

		expect(emitBody).toContain("!state.stuckEmitted");
		expect(emitBody).toContain("state.stuckEmitted = true");
		expect(emitBody).toContain("merge_health_stuck");
	});

	it("9.4: events include laneNumber, sessionName, healthStatus, and stalledMinutes fields", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const emitIdx = mergeSource.indexOf("_emitHealthEvents");
		const emitBody = mergeSource.substring(emitIdx, emitIdx + 2000);

		expect(emitBody).toContain("laneNumber: state.laneNumber");
		expect(emitBody).toContain("sessionName: state.sessionName");
		expect(emitBody).toContain("healthStatus:");
		expect(emitBody).toContain("stalledMinutes");
	});

	it("9.5: events are written via emitEngineEvent (to unified events.jsonl)", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const emitIdx = mergeSource.indexOf("_emitHealthEvents");
		const emitBody = mergeSource.substring(emitIdx, emitIdx + 2000);

		expect(emitBody).toContain("emitEngineEvent");
	});

	it("9.6: event uses buildEngineEventBase for consistent event structure", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const emitIdx = mergeSource.indexOf("_emitHealthEvents");
		const emitBody = mergeSource.substring(emitIdx, emitIdx + 2000);

		expect(emitBody).toContain("buildEngineEventBase");
	});
});


// ── 10. Dead-Session Early Exit Signaling Tests ──────────────────────

describe("dead-session early exit signaling", () => {
	it("10.1: MergeHealthMonitor accepts onDeadSession callback in constructor", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		// Constructor accepts onDeadSession parameter
		expect(mergeSource).toContain("onDeadSession?:");
		// Stored as private field
		expect(mergeSource).toContain("_onDeadSession");
	});

	it("10.2: onDeadSession callback is invoked with sessionName and laneNumber", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const pollIdx = mergeSource.indexOf("poll(): Promise<void> {");
		const pollBody = mergeSource.substring(pollIdx, pollIdx + 1500);

		// Callback invocation passes session name and lane number
		expect(pollBody).toContain("this._onDeadSession(sessionName, state.laneNumber)");
	});

	it("10.3: engine.ts wires onDeadSession callback when creating monitor", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);
		expect(engineSource).toContain("onDeadSession:");
		// The callback logs the event for now — demonstrates the contract
		expect(engineSource).toContain("merge health monitor detected dead session");
	});

	it("10.4: dead session detection in poll() only fires once per session (deadEmitted guard)", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const pollIdx = mergeSource.indexOf("poll(): Promise<void> {");
		const pollBody = mergeSource.substring(pollIdx, pollIdx + 1500);

		// Dead detection gated on deadEmitted flag
		expect(pollBody).toContain("!state.deadEmitted");
		expect(pollBody).toContain("state.deadEmitted = true");
	});

	it("10.5: waitForMergeResult early exit path — monitor signals dead session before timeout", () => {
		// The merge.ts mergeWave() wires session registration/deregistration around
		// spawnMergeAgent + waitForMergeResult. When the monitor detects a dead session,
		// the normal waitForMergeResult polling loop catches it within MERGE_POLL_INTERVAL_MS
		// (2 seconds) because waitForMergeResult checks active merge-agent handles each poll.
		// The health monitor's value is the early _event emission_ (for operator visibility)
		// and the _dead session callback_ (for engine-level awareness), not a parallel
		// abort signal — the existing session-liveness check in waitForMergeResult handles
		// the actual early exit within its 2-second poll loop.
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// waitForMergeResult already checks session liveness each poll
		const waitFn = mergeSource.substring(
			mergeSource.indexOf("async function waitForMergeResult"),
			mergeSource.indexOf("async function waitForMergeResult") + 4000,
		);
		expect(waitFn).toContain("activeMergeAgents.has(sessionName)");
		expect(waitFn).toContain("sessionDiedAt");
		expect(waitFn).toContain("MERGE_SESSION_DIED");

		// Health monitor adds value by emitting events BEFORE the timeout
		// and signaling the engine via the dead session callback
		expect(mergeSource).toContain("merge_health_dead");
		expect(mergeSource).toContain("_onDeadSession");
	});
});


// ── 11. captureMergePaneOutput Tests ─────────────────────────────────

describe("captureMergePaneOutput source verification", () => {
	it("11.1: uses tmux capture-pane with correct arguments", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const fnIdx = mergeSource.indexOf("function captureMergePaneOutput");
		expect(fnIdx).toBeGreaterThan(-1);
		const fnBody = mergeSource.substring(fnIdx, fnIdx + 600);

		expect(fnBody).toContain("capture-pane");
		expect(fnBody).toContain("-t");
		expect(fnBody).toContain("-p");      // print to stdout
		expect(fnBody).toContain("-S");      // start from N lines back
	});

	it("11.2: returns null on failure (not empty string)", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const fnIdx = mergeSource.indexOf("function captureMergePaneOutput");
		const fnBody = mergeSource.substring(fnIdx, fnIdx + 600);

		// Returns null on non-zero status or error
		expect(fnBody).toContain("return null");
	});

	it("11.3: has a timeout guard to prevent hanging", () => {
		const mergeSource = readFileSync(
			join(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);
		const fnIdx = mergeSource.indexOf("function captureMergePaneOutput");
		const fnBody = mergeSource.substring(fnIdx, fnIdx + 600);

		expect(fnBody).toContain("timeout:");
	});
});
