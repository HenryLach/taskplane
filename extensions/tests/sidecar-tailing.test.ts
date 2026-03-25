/**
 * Sidecar JSONL Tailing Tests — TP-026 Step 2 (R006)
 *
 * Tests for tailSidecarJsonl() and SidecarTailState: incremental byte-offset
 * reading, retry state persistence across ticks, partial-line buffering,
 * missing-file early polls, and final-tail-on-session-end.
 *
 * Run: npx vitest run extensions/tests/sidecar-tailing.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, mkdirSync, rmSync, existsSync, appendFileSync } from "fs";
import {
	_tailSidecarJsonl as tailSidecarJsonl,
	_createSidecarTailState as createSidecarTailState,
	type SidecarTailState,
	type SidecarTelemetryDelta,
} from "../task-runner.ts";

// ── Test helpers ─────────────────────────────────────────────────────

let tmpDir: string;
let sidecarPath: string;

beforeEach(() => {
	tmpDir = join(tmpdir(), `sidecar-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(tmpDir, { recursive: true });
	sidecarPath = join(tmpDir, "telemetry.jsonl");
});

afterEach(() => {
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

/** Append JSONL events to the sidecar file */
function appendEvents(...events: object[]): void {
	const content = events.map(e => JSON.stringify(e) + "\n").join("");
	appendFileSync(sidecarPath, content);
}

/** Create the sidecar file with initial events */
function writeEvents(...events: object[]): void {
	const content = events.map(e => JSON.stringify(e) + "\n").join("");
	writeFileSync(sidecarPath, content);
}

// ── 1. Missing file (early polls) ───────────────────────────────────

describe("tailSidecarJsonl — missing file", () => {
	it("returns zero delta when file does not exist", () => {
		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(sidecarPath, state);

		expect(delta.inputTokens).toBe(0);
		expect(delta.outputTokens).toBe(0);
		expect(delta.cost).toBe(0);
		expect(delta.toolCalls).toBe(0);
		expect(delta.retryActive).toBe(false);
		expect(delta.retriesStarted).toBe(0);
		expect(delta.hadEvents).toBe(false);
	});

	it("returns zero delta multiple times before file appears", () => {
		const state = createSidecarTailState();

		// Simulate 3 poll ticks before file is created
		for (let i = 0; i < 3; i++) {
			const delta = tailSidecarJsonl(sidecarPath, state);
			expect(delta.hadEvents).toBe(false);
			expect(state.offset).toBe(0);
		}

		// Now create the file with an event
		writeEvents({ type: "agent_start" });
		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(true);
	});
});

// ── 2. Basic event parsing ──────────────────────────────────────────

describe("tailSidecarJsonl — basic event parsing", () => {
	it("parses message_end token/cost data", () => {
		const state = createSidecarTailState();
		writeEvents({
			type: "message_end",
			message: { usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, cost: 0.01 } },
		});

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.inputTokens).toBe(100);
		expect(delta.outputTokens).toBe(50);
		expect(delta.cacheReadTokens).toBe(10);
		expect(delta.cacheWriteTokens).toBe(5);
		expect(delta.cost).toBeCloseTo(0.01);
		expect(delta.hadEvents).toBe(true);
	});

	it("accumulates multiple message_end events in one tick", () => {
		const state = createSidecarTailState();
		writeEvents(
			{ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } },
			{ type: "message_end", message: { usage: { input: 200, output: 80, cost: 0.02 } } },
		);

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.inputTokens).toBe(300);
		expect(delta.outputTokens).toBe(130);
		expect(delta.cost).toBeCloseTo(0.03);
	});

	it("handles message_end with object cost (cost.total)", () => {
		const state = createSidecarTailState();
		writeEvents({
			type: "message_end",
			message: { usage: { input: 100, output: 50, cost: { total: 0.05, input: 0.02, output: 0.03 } } },
		});

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.cost).toBeCloseTo(0.05);
	});

	it("counts tool_execution_start events", () => {
		const state = createSidecarTailState();
		writeEvents(
			{ type: "tool_execution_start", toolName: "bash", args: { command: "echo hello" } },
			{ type: "tool_execution_start", toolName: "read", args: { path: "file.ts" } },
		);

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.toolCalls).toBe(2);
		expect(delta.lastTool).toContain("read");
	});

	it("tracks latestTotalTokens from message_end", () => {
		const state = createSidecarTailState();
		writeEvents(
			{ type: "message_end", message: { usage: { input: 100, output: 50, totalTokens: 150 } } },
			{ type: "message_end", message: { usage: { input: 200, output: 100, totalTokens: 450 } } },
		);

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.latestTotalTokens).toBe(450);
	});

	it("includes cacheRead tokens in latestTotalTokens (TP-066 fix)", () => {
		const state = createSidecarTailState();
		// Simulate Anthropic-style usage: small input/output, large cacheRead
		writeEvents({
			type: "message_end",
			message: { usage: { input: 5000, output: 2000, cacheRead: 180000, totalTokens: 7000 } },
		});

		const delta = tailSidecarJsonl(sidecarPath, state);
		// totalTokens (7000) + cacheRead (180000) = 187000
		expect(delta.latestTotalTokens).toBe(187000);
	});

	it("includes cacheRead in fallback when totalTokens is absent (TP-066 fix)", () => {
		const state = createSidecarTailState();
		// No totalTokens field — falls back to input + output, then adds cacheRead
		writeEvents({
			type: "message_end",
			message: { usage: { input: 5000, output: 2000, cacheRead: 180000 } },
		});

		const delta = tailSidecarJsonl(sidecarPath, state);
		// (input 5000 + output 2000) + cacheRead 180000 = 187000
		expect(delta.latestTotalTokens).toBe(187000);
	});

	it("context pressure triggers at correct % with cache-heavy workload (TP-066 fix)", () => {
		const state = createSidecarTailState();
		// 200K context window, 170K cache reads → ~87% context usage
		writeEvents({
			type: "message_end",
			message: { usage: { input: 3000, output: 1000, cacheRead: 170000, totalTokens: 4000 } },
		});

		const delta = tailSidecarJsonl(sidecarPath, state);
		// totalTokens (4000) + cacheRead (170000) = 174000
		expect(delta.latestTotalTokens).toBe(174000);
		// 174000 / 200000 = 87% — would trigger 85% warn threshold
		const contextWindow = 200000;
		const pct = (delta.latestTotalTokens / contextWindow) * 100;
		expect(pct).toBe(87);
	});
});

// ── 3. Incremental reading across ticks ──────────────────────────────

describe("tailSidecarJsonl — incremental reading", () => {
	it("only reads new bytes on each tick (O(new) per call)", () => {
		const state = createSidecarTailState();

		// Tick 1: write 2 events
		writeEvents(
			{ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } },
			{ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } },
		);
		const delta1 = tailSidecarJsonl(sidecarPath, state);
		expect(delta1.inputTokens).toBe(100);
		expect(delta1.toolCalls).toBe(1);

		// Tick 2: no new data
		const delta2 = tailSidecarJsonl(sidecarPath, state);
		expect(delta2.inputTokens).toBe(0);
		expect(delta2.toolCalls).toBe(0);
		expect(delta2.hadEvents).toBe(false);

		// Tick 3: append 1 new event
		appendEvents(
			{ type: "message_end", message: { usage: { input: 200, output: 80, cost: 0.02 } } },
		);
		const delta3 = tailSidecarJsonl(sidecarPath, state);
		expect(delta3.inputTokens).toBe(200);
		expect(delta3.outputTokens).toBe(80);
		expect(delta3.hadEvents).toBe(true);
	});

	it("tracks byte offset correctly across multiple ticks", () => {
		const state = createSidecarTailState();
		expect(state.offset).toBe(0);

		writeEvents({ type: "agent_start" });
		tailSidecarJsonl(sidecarPath, state);
		const offset1 = state.offset;
		expect(offset1).toBeGreaterThan(0);

		appendEvents({ type: "message_end", message: { usage: { input: 100, output: 50 } } });
		tailSidecarJsonl(sidecarPath, state);
		expect(state.offset).toBeGreaterThan(offset1);
	});
});

// ── 4. Retry state persistence across ticks ─────────────────────────

describe("tailSidecarJsonl — retry state persistence", () => {
	it("auto_retry_start sets retryActive=true, persists across ticks", () => {
		const state = createSidecarTailState();

		// Tick 1: retry starts
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit", delayMs: 1000 });
		const delta1 = tailSidecarJsonl(sidecarPath, state);
		expect(delta1.retryActive).toBe(true);
		expect(delta1.retriesStarted).toBe(1);
		expect(delta1.lastRetryError).toBe("rate_limit");
		expect(state.retryActive).toBe(true);

		// Tick 2: unrelated events — retryActive should still be true
		appendEvents(
			{ type: "tool_execution_start", toolName: "bash", args: { command: "echo test" } },
			{ type: "message_end", message: { usage: { input: 50, output: 25 } } },
		);
		const delta2 = tailSidecarJsonl(sidecarPath, state);
		expect(delta2.retryActive).toBe(true); // persisted from previous tick
		expect(delta2.retriesStarted).toBe(0); // no new retries in this tick
		expect(delta2.hadEvents).toBe(true);
	});

	it("auto_retry_end clears retryActive", () => {
		const state = createSidecarTailState();

		// Tick 1: retry starts
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "overloaded" });
		tailSidecarJsonl(sidecarPath, state);
		expect(state.retryActive).toBe(true);

		// Tick 2: retry ends
		appendEvents({ type: "auto_retry_end", success: true });
		const delta2 = tailSidecarJsonl(sidecarPath, state);
		expect(delta2.retryActive).toBe(false);
		expect(state.retryActive).toBe(false);
	});

	it("tick with only auto_retry_end clears retryActive and fires hadEvents", () => {
		const state = createSidecarTailState();

		// Tick 1: retry starts
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit" });
		tailSidecarJsonl(sidecarPath, state);
		expect(state.retryActive).toBe(true);

		// Tick 2: ONLY auto_retry_end — must still dispatch and clear retry state
		appendEvents({ type: "auto_retry_end", success: true });
		const delta2 = tailSidecarJsonl(sidecarPath, state);
		expect(delta2.retryActive).toBe(false);
		expect(delta2.hadEvents).toBe(true);
		expect(state.retryActive).toBe(false);
	});

	it("full retry lifecycle: start → unrelated → end across 3 ticks", () => {
		const state = createSidecarTailState();

		// Tick 1: retry starts
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit", delayMs: 1000 });
		const d1 = tailSidecarJsonl(sidecarPath, state);
		expect(d1.retryActive).toBe(true);
		expect(d1.retriesStarted).toBe(1);

		// Tick 2: unrelated events during retry
		appendEvents(
			{ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } },
		);
		const d2 = tailSidecarJsonl(sidecarPath, state);
		expect(d2.retryActive).toBe(true); // still active
		expect(d2.retriesStarted).toBe(0); // no new retries
		expect(d2.inputTokens).toBe(100);

		// Tick 3: retry ends
		appendEvents({ type: "auto_retry_end", success: true });
		const d3 = tailSidecarJsonl(sidecarPath, state);
		expect(d3.retryActive).toBe(false); // cleared
		expect(d3.retriesStarted).toBe(0);
		expect(d3.hadEvents).toBe(true);
	});

	it("multiple retries across ticks track retryCount correctly", () => {
		const state = createSidecarTailState();

		// Tick 1: first retry
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit" });
		const d1 = tailSidecarJsonl(sidecarPath, state);
		expect(d1.retriesStarted).toBe(1);

		// Tick 2: retry ends, then second retry starts
		appendEvents(
			{ type: "auto_retry_end", success: false },
			{ type: "auto_retry_start", attempt: 2, errorMessage: "overloaded" },
		);
		const d2 = tailSidecarJsonl(sidecarPath, state);
		expect(d2.retriesStarted).toBe(1);
		expect(d2.retryActive).toBe(true);
		expect(d2.lastRetryError).toBe("overloaded");

		// Tick 3: second retry ends
		appendEvents({ type: "auto_retry_end", success: true });
		const d3 = tailSidecarJsonl(sidecarPath, state);
		expect(d3.retryActive).toBe(false);
	});

	it("empty tick preserves retry state from earlier", () => {
		const state = createSidecarTailState();

		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit" });
		tailSidecarJsonl(sidecarPath, state);
		expect(state.retryActive).toBe(true);

		// Empty tick (no new data)
		const d2 = tailSidecarJsonl(sidecarPath, state);
		expect(d2.retryActive).toBe(true); // initialized from tailState
		expect(d2.hadEvents).toBe(false);
	});
});

// ── 5. Partial-line buffering ────────────────────────────────────────

describe("tailSidecarJsonl — partial-line buffering", () => {
	it("buffers partial trailing line and completes on next tick", () => {
		const state = createSidecarTailState();

		// Write a complete line + partial line (no trailing newline)
		const completeEvent = JSON.stringify({ type: "agent_start" }) + "\n";
		const partialEvent = '{"type":"message_end","message":{"usage":{"input":10';
		writeFileSync(sidecarPath, completeEvent + partialEvent);

		const d1 = tailSidecarJsonl(sidecarPath, state);
		expect(d1.hadEvents).toBe(true);
		expect(d1.inputTokens).toBe(0); // partial event not yet parsed

		// Complete the partial line
		const rest = '0,"output":50}}}\n';
		appendFileSync(sidecarPath, rest);

		const d2 = tailSidecarJsonl(sidecarPath, state);
		expect(d2.hadEvents).toBe(true);
		expect(d2.inputTokens).toBe(100);
		expect(d2.outputTokens).toBe(50);
	});

	it("handles multiple partial lines across multiple ticks", () => {
		const state = createSidecarTailState();

		// Tick 1: partial JSON
		writeFileSync(sidecarPath, '{"type":"tool_exec');
		const d1 = tailSidecarJsonl(sidecarPath, state);
		expect(d1.hadEvents).toBe(false);

		// Tick 2: more partial
		appendFileSync(sidecarPath, 'ution_start","toolName":"bash","args":');
		const d2 = tailSidecarJsonl(sidecarPath, state);
		expect(d2.hadEvents).toBe(false);

		// Tick 3: complete the line
		appendFileSync(sidecarPath, '{"command":"echo hi"}}\n');
		const d3 = tailSidecarJsonl(sidecarPath, state);
		expect(d3.hadEvents).toBe(true);
		expect(d3.toolCalls).toBe(1);
		expect(d3.lastTool).toContain("bash");
	});
});

// ── 6. Malformed line resilience ─────────────────────────────────────

describe("tailSidecarJsonl — malformed lines", () => {
	it("skips malformed JSON lines without breaking", () => {
		const state = createSidecarTailState();
		writeFileSync(sidecarPath, [
			JSON.stringify({ type: "agent_start" }),
			"this is not JSON",
			JSON.stringify({ type: "message_end", message: { usage: { input: 100, output: 50 } } }),
			"{malformed json",
			JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "f.ts" } }),
		].join("\n") + "\n");

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(true);
		expect(delta.inputTokens).toBe(100);
		expect(delta.toolCalls).toBe(1);
	});

	it("skips events without type field", () => {
		const state = createSidecarTailState();
		writeEvents(
			{ noType: true, data: "something" },
			{ type: "message_end", message: { usage: { input: 100, output: 50 } } },
		);

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(true);
		expect(delta.inputTokens).toBe(100);
	});

	it("skips empty and whitespace-only lines", () => {
		const state = createSidecarTailState();
		writeFileSync(sidecarPath, [
			"",
			"  ",
			JSON.stringify({ type: "agent_start" }),
			"",
		].join("\n") + "\n");

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(true);
	});
});

// ── 7. Final tail on session end ─────────────────────────────────────

describe("tailSidecarJsonl — final tail scenarios", () => {
	it("final tail captures events written between last tick and session exit", () => {
		const state = createSidecarTailState();

		// Tick 1: initial events
		writeEvents(
			{ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } },
		);
		tailSidecarJsonl(sidecarPath, state);

		// Events written between last tick and session exit
		appendEvents(
			{ type: "tool_execution_start", toolName: "write", args: { path: "output.txt" } },
			{ type: "message_end", message: { usage: { input: 200, output: 100, cost: 0.02 } } },
			{ type: "agent_end" },
		);

		// Final tail
		const finalDelta = tailSidecarJsonl(sidecarPath, state);
		expect(finalDelta.hadEvents).toBe(true);
		expect(finalDelta.inputTokens).toBe(200);
		expect(finalDelta.toolCalls).toBe(1);
	});

	it("final tail preserves retry state from earlier ticks", () => {
		const state = createSidecarTailState();

		// Tick 1: retry starts
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit" });
		tailSidecarJsonl(sidecarPath, state);
		expect(state.retryActive).toBe(true);

		// Final tail with no new retry events — should still show retryActive
		appendEvents({ type: "message_end", message: { usage: { input: 100, output: 50 } } });
		const finalDelta = tailSidecarJsonl(sidecarPath, state);
		expect(finalDelta.retryActive).toBe(true);
		expect(finalDelta.lastRetryError).toBe(""); // no new retry errors in this tick
	});

	it("final tail clears retry state when auto_retry_end is last event", () => {
		const state = createSidecarTailState();

		// Tick 1: retry starts
		writeEvents({ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit" });
		tailSidecarJsonl(sidecarPath, state);

		// Final tail: retry ends
		appendEvents(
			{ type: "auto_retry_end", success: true },
			{ type: "message_end", message: { usage: { input: 200, output: 100 } } },
			{ type: "agent_end" },
		);
		const finalDelta = tailSidecarJsonl(sidecarPath, state);
		expect(finalDelta.retryActive).toBe(false);
		expect(finalDelta.inputTokens).toBe(200);
	});
});

// ── 8. hadEvents callback gating ─────────────────────────────────────

describe("tailSidecarJsonl — hadEvents callback gating", () => {
	it("hadEvents is false when file has no new data", () => {
		const state = createSidecarTailState();
		writeEvents({ type: "agent_start" });
		tailSidecarJsonl(sidecarPath, state);

		// No new data
		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(false);
	});

	it("hadEvents is true even for events with zero tokens/cost", () => {
		const state = createSidecarTailState();
		writeEvents({ type: "agent_start" });

		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(true);
		expect(delta.inputTokens).toBe(0);
		expect(delta.cost).toBe(0);
	});

	it("hadEvents is true for auto_retry_end (zero numeric fields)", () => {
		const state = createSidecarTailState();
		state.retryActive = true; // simulate prior retry start

		writeEvents({ type: "auto_retry_end", success: true });
		const delta = tailSidecarJsonl(sidecarPath, state);
		expect(delta.hadEvents).toBe(true);
		expect(delta.retryActive).toBe(false);
		// Under old gating, this would have been dropped because:
		// inputTokens=0, outputTokens=0, cost=0, toolCalls=0, retriesStarted=0
	});
});

// ── 9. Poll integration simulation ──────────────────────────────────

describe("tailSidecarJsonl — poll loop integration simulation", () => {
	it("simulates full poll loop with telemetry accumulation", () => {
		const state = createSidecarTailState();

		// Simulate accumulated TaskState fields
		let totalInputTokens = 0;
		let totalOutputTokens = 0;
		let totalCost = 0;
		let totalToolCalls = 0;
		let retryActive = false;
		let retryCount = 0;
		let lastRetryError = "";

		const onTelemetry = (delta: SidecarTelemetryDelta) => {
			totalInputTokens += delta.inputTokens;
			totalOutputTokens += delta.outputTokens;
			totalCost += delta.cost;
			totalToolCalls += delta.toolCalls;
			retryActive = delta.retryActive;
			retryCount += delta.retriesStarted;
			if (delta.lastRetryError) lastRetryError = delta.lastRetryError;
		};

		// Tick 1: session starts, first message
		writeEvents(
			{ type: "agent_start" },
			{ type: "tool_execution_start", toolName: "bash", args: { command: "echo hello" } },
			{ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } },
		);
		let delta = tailSidecarJsonl(sidecarPath, state);
		if (delta.hadEvents) onTelemetry(delta);
		expect(totalInputTokens).toBe(100);
		expect(totalToolCalls).toBe(1);

		// Tick 2: retry starts
		appendEvents(
			{ type: "auto_retry_start", attempt: 1, errorMessage: "rate_limit", delayMs: 5000 },
		);
		delta = tailSidecarJsonl(sidecarPath, state);
		if (delta.hadEvents) onTelemetry(delta);
		expect(retryActive).toBe(true);
		expect(retryCount).toBe(1);
		expect(lastRetryError).toBe("rate_limit");

		// Tick 3: no new data (empty tick during retry backoff)
		delta = tailSidecarJsonl(sidecarPath, state);
		if (delta.hadEvents) onTelemetry(delta);
		// retryActive should still be true from prior state (delta not dispatched)
		expect(retryActive).toBe(true);

		// Tick 4: retry ends + more work
		appendEvents(
			{ type: "auto_retry_end", success: true },
			{ type: "tool_execution_start", toolName: "write", args: { path: "out.ts" } },
			{ type: "message_end", message: { usage: { input: 200, output: 100, cost: 0.02 } } },
		);
		delta = tailSidecarJsonl(sidecarPath, state);
		if (delta.hadEvents) onTelemetry(delta);
		expect(retryActive).toBe(false);
		expect(totalInputTokens).toBe(300);
		expect(totalToolCalls).toBe(2);
		expect(totalCost).toBeCloseTo(0.03);

		// Tick 5: session ends
		appendEvents({ type: "agent_end" });
		delta = tailSidecarJsonl(sidecarPath, state);
		if (delta.hadEvents) onTelemetry(delta);
		expect(retryActive).toBe(false);
		expect(retryCount).toBe(1);
	});
});
