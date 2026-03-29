/**
 * Crash Recovery and Spawn Reliability Tests — TP-095
 *
 * Tests for:
 * 1. Worker spawn verification and retry (#335) — source extraction
 * 2. Lane-state reset on worker restart (#333) — source extraction
 * 3. Telemetry accumulation across restarts (#334) — source extraction + functional
 * 4. Lane session stderr capture (#339) — source extraction
 *
 * Uses source-extraction approach (matching existing test patterns) for
 * structural contract validation, plus functional tests for behavioral
 * verification.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/crash-recovery-spawn-reliability.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_RUNNER_PATH = resolve(__dirname, "../task-runner.ts");
const EXECUTION_PATH = resolve(__dirname, "../taskplane/execution.ts");

function readTaskRunnerSource(): string {
	return readFileSync(TASK_RUNNER_PATH, "utf-8").replace(/\r\n/g, "\n");
}

function readExecutionSource(): string {
	return readFileSync(EXECUTION_PATH, "utf-8").replace(/\r\n/g, "\n");
}

/**
 * Extract a region of source starting at `function <name>(` up to
 * the next `^function ` or section comment at the same indentation.
 */
function extractFunctionRegion(src: string, funcName: string): string {
	const pattern = new RegExp(`function ${funcName}\\(`);
	const match = pattern.exec(src);
	if (!match) throw new Error(`Function ${funcName} not found in source`);

	const startIdx = match.index;
	const rest = src.slice(startIdx + 1);
	const nextFunc = rest.search(/\nfunction /);
	const nextSection = rest.search(/\n\/\/ ── /);

	let endOffset: number;
	if (nextFunc === -1 && nextSection === -1) {
		endOffset = rest.length;
	} else if (nextFunc === -1) {
		endOffset = nextSection;
	} else if (nextSection === -1) {
		endOffset = nextFunc;
	} else {
		endOffset = Math.min(nextFunc, nextSection);
	}

	return src.slice(startIdx, startIdx + 1 + endOffset);
}

/**
 * Extract a region of source starting at an exported function.
 */
function extractExportedFunctionRegion(src: string, funcSignature: string): string {
	const idx = src.indexOf(funcSignature);
	if (idx < 0) throw new Error(`Function signature not found: ${funcSignature}`);

	const rest = src.slice(idx + 1);
	const nextFunc = rest.search(/\nexport (async )?function /);
	const endOffset = nextFunc === -1 ? rest.length : nextFunc;

	return src.slice(idx, idx + 1 + endOffset);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Worker spawn verification and retry (#335)
// ═══════════════════════════════════════════════════════════════════════

describe("worker spawn verification and retry (#335, source extraction)", () => {
	const src = readTaskRunnerSource();
	const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");

	it("adds post-spawn verification delay before checking session (500ms, TP-097)", () => {
		expect(tmuxBody).toContain("SPAWN_VERIFY_DELAY_MS");
		expect(tmuxBody).toContain("= 500");
	});

	it("defines verification polling (3 attempts, 200ms interval)", () => {
		expect(tmuxBody).toContain("SPAWN_VERIFY_POLL_ATTEMPTS");
		expect(tmuxBody).toContain("3");
		expect(tmuxBody).toContain("SPAWN_VERIFY_POLL_INTERVAL_MS");
		expect(tmuxBody).toContain("200");
	});

	it("defines max retry count (5 retries, TP-097)", () => {
		expect(tmuxBody).toContain("SPAWN_MAX_RETRIES");
		expect(tmuxBody).toContain("= 5");
	});

	it("verification uses tmux has-session to check liveness", () => {
		expect(tmuxBody).toContain("verifySessionAlive");
		expect(tmuxBody).toContain('"has-session"');
	});

	it("retries tmux new-session on startup failure", () => {
		expect(tmuxBody).toContain("spawnRetries");
		expect(tmuxBody).toContain("retrying");
		expect(tmuxBody).toContain('"new-session", "-d"');
	});

	it("kills remnant session before retry", () => {
		expect(tmuxBody).toContain('"kill-session"');
	});

	it("increases retry delay with each attempt", () => {
		// retryDelay = spawnRetries * 500
		expect(tmuxBody).toContain("retryDelay");
		expect(tmuxBody).toContain("* 500");
	});

	it("throws descriptive error after max retries exhausted", () => {
		expect(tmuxBody).toContain("died on startup after");
		expect(tmuxBody).toContain("SPAWN_MAX_RETRIES");
	});

	it("logs stderr path in failure diagnostics", () => {
		expect(tmuxBody).toContain("stderrLogHint");
		expect(tmuxBody).toContain("-stderr.log");
	});

	it("logs success message after successful retry", () => {
		expect(tmuxBody).toContain("alive after");
		expect(tmuxBody).toContain("retry(ies)");
	});

	it("applies to both worker and reviewer sessions (same function)", () => {
		// spawnAgentTmux is called for both workers and reviewers
		// Verify the verification code is inside spawnAgentTmux
		expect(tmuxBody).toContain("SPAWN_VERIFY_DELAY_MS");
		expect(tmuxBody).toContain("verifySessionAlive");
		// The sessionName can be either "orch-lane-1-worker" or "orch-lane-1-reviewer"
		expect(tmuxBody).toContain("opts.sessionName");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Lane-state reset on worker restart (#333)
// ═══════════════════════════════════════════════════════════════════════

describe("lane-state reset on worker restart (#333, source extraction)", () => {
	const src = readTaskRunnerSource();

	// Extract the executeTask function region
	const executeTaskRegion = (() => {
		const startMarker = "async function executeTask(";
		const idx = src.indexOf(startMarker);
		if (idx < 0) throw new Error("executeTask not found");
		return src.slice(idx, idx + 8000); // Large region to capture the iteration loop
	})();

	it("resets phase to 'running' before new worker spawn", () => {
		expect(executeTaskRegion).toContain('state.phase = "running"');
	});

	it("resets workerStatus to 'idle' before new worker spawn", () => {
		expect(executeTaskRegion).toContain('state.workerStatus = "idle"');
	});

	it("clears workerExitDiagnostic before new worker spawn", () => {
		expect(executeTaskRegion).toContain("state.workerExitDiagnostic = null");
	});

	it("resets workerElapsed before new worker spawn", () => {
		expect(executeTaskRegion).toContain("state.workerElapsed = 0");
	});

	it("resets workerContextPct before new worker spawn", () => {
		expect(executeTaskRegion).toContain("state.workerContextPct = 0");
	});

	it("calls writeLaneState immediately after reset", () => {
		// The writeLaneState call should appear in the reset block
		const resetBlock = executeTaskRegion.slice(
			executeTaskRegion.indexOf("TP-095: Reset stale lane-state"),
			executeTaskRegion.indexOf("await runWorker"),
		);
		expect(resetBlock).toContain("writeLaneState(state)");
	});

	it("only resets on iteration > 1 (not first iteration)", () => {
		expect(executeTaskRegion).toContain("state.totalIterations > 1");
	});

	it("preserves telemetry counters (tokens, cost) across iterations", () => {
		// The reset block should NOT contain token/cost ASSIGNMENT resets (= 0)
		// The comment mentioning the field names for documentation is fine
		const resetBlock = executeTaskRegion.slice(
			executeTaskRegion.indexOf("TP-095: Reset stale lane-state"),
			executeTaskRegion.indexOf("await runWorker"),
		);
		expect(resetBlock).not.toContain("state.workerInputTokens = 0");
		expect(resetBlock).not.toContain("state.workerOutputTokens = 0");
		expect(resetBlock).not.toContain("state.workerCostUsd = 0");
		expect(resetBlock).not.toContain("state.workerCacheReadTokens = 0");
		expect(resetBlock).not.toContain("state.workerCacheWriteTokens = 0");
		expect(resetBlock).not.toContain("state.workerToolCount = 0");
	});

	it("documents that token/cost fields are intentionally NOT reset", () => {
		const resetBlock = executeTaskRegion.slice(
			executeTaskRegion.indexOf("TP-095: Reset stale lane-state"),
			executeTaskRegion.indexOf("await runWorker"),
		);
		expect(resetBlock).toContain("intentionally NOT reset");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Telemetry accumulation across restarts (#334)
// ═══════════════════════════════════════════════════════════════════════

describe("telemetry accumulation across restarts (#334, source extraction)", () => {
	const src = readTaskRunnerSource();

	// Extract the runWorker function
	const runWorkerRegion = extractFunctionRegion(src, "runWorker");

	it("does NOT reset workerToolCount in runWorker", () => {
		// The runWorker function body (up to the next named function) should
		// not contain the workerToolCount = 0 reset. The fix agent has its own.
		// Use a smaller region: from runWorker start to "const spawnMode"
		const runWorkerSetup = runWorkerRegion.slice(0, runWorkerRegion.indexOf("const spawnMode"));
		expect(runWorkerSetup).not.toContain("state.workerToolCount = 0");
	});

	it("documents why workerToolCount is not reset", () => {
		expect(runWorkerRegion).toContain("TP-095");
		expect(runWorkerRegion).toContain("accumulate across iterations");
	});

	it("uses += for token accumulation in tmux onTelemetry", () => {
		expect(runWorkerRegion).toContain("state.workerInputTokens += delta.inputTokens");
		expect(runWorkerRegion).toContain("state.workerOutputTokens += delta.outputTokens");
		expect(runWorkerRegion).toContain("state.workerCacheReadTokens += delta.cacheReadTokens");
		expect(runWorkerRegion).toContain("state.workerCacheWriteTokens += delta.cacheWriteTokens");
		expect(runWorkerRegion).toContain("state.workerCostUsd += delta.cost");
	});

	it("uses += for tool count accumulation in tmux onTelemetry", () => {
		expect(runWorkerRegion).toContain("state.workerToolCount += delta.toolCalls");
	});

	it("uses += for token accumulation in subprocess mode", () => {
		expect(runWorkerRegion).toContain("state.workerInputTokens += tokens.input");
		expect(runWorkerRegion).toContain("state.workerOutputTokens += tokens.output");
		expect(runWorkerRegion).toContain("state.workerCacheReadTokens += tokens.cacheRead");
		expect(runWorkerRegion).toContain("state.workerCacheWriteTokens += tokens.cacheWrite");
		expect(runWorkerRegion).toContain("state.workerCostUsd += tokens.cost");
	});
});

// Functional test: verify sidecar tailing accumulates correctly
describe("telemetry accumulation functional test (#334)", () => {
	let tmpDir: string;
	let sidecarPath: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `tp095-accum-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(tmpDir, { recursive: true });
		sidecarPath = join(tmpDir, "telemetry.jsonl");
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
	});

	it("sidecar tailing accumulates tokens across multiple message_end events", async () => {
		const { _tailSidecarJsonl, _createSidecarTailState } = await import("../task-runner.ts");
		const tailState = _createSidecarTailState();

		// Simulate iteration 1: write some events
		const event1 = { type: "message_end", message: { usage: { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, cost: { total: 0.01 }, totalTokens: 350 } } };
		const event2 = { type: "tool_execution_start", toolName: "read", args: { path: "file.ts" } };
		writeFileSync(sidecarPath, JSON.stringify(event1) + "\n" + JSON.stringify(event2) + "\n");

		const delta1 = _tailSidecarJsonl(sidecarPath, tailState);
		expect(delta1.inputTokens).toBe(100);
		expect(delta1.outputTokens).toBe(50);
		expect(delta1.cacheReadTokens).toBe(200);
		expect(delta1.cacheWriteTokens).toBe(10);
		expect(delta1.cost).toBeCloseTo(0.01, 4);
		expect(delta1.toolCalls).toBe(1);
		expect(delta1.hadEvents).toBe(true);

		// Simulate iteration 2: new worker starts, writes more events
		// (sidecar file is the SAME file — each rpc-wrapper creates its own,
		// but for this test we simulate appending to the same one)
		const event3 = { type: "message_end", message: { usage: { input: 200, output: 100, cacheRead: 300, cacheWrite: 20, cost: { total: 0.02 }, totalTokens: 600 } } };
		appendFileSync(sidecarPath, JSON.stringify(event3) + "\n");

		const delta2 = _tailSidecarJsonl(sidecarPath, tailState);
		expect(delta2.inputTokens).toBe(200);
		expect(delta2.outputTokens).toBe(100);
		expect(delta2.cost).toBeCloseTo(0.02, 4);
		expect(delta2.hadEvents).toBe(true);

		// The caller (task-runner) accumulates deltas:
		// After delta1: total input = 100, total output = 50
		// After delta2: total input = 300, total output = 150
		// This matches the += pattern in onTelemetry
	});

	it("tool count accumulates across multiple tailing ticks", async () => {
		const { _tailSidecarJsonl, _createSidecarTailState } = await import("../task-runner.ts");
		const tailState = _createSidecarTailState();

		// Tick 1: 2 tool calls
		writeFileSync(sidecarPath, [
			JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } }),
			JSON.stringify({ type: "tool_execution_start", toolName: "edit", args: { path: "b.ts" } }),
		].join("\n") + "\n");

		const d1 = _tailSidecarJsonl(sidecarPath, tailState);
		expect(d1.toolCalls).toBe(2);

		// Tick 2: 1 more tool call
		appendFileSync(sidecarPath, JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "ls" } }) + "\n");

		const d2 = _tailSidecarJsonl(sidecarPath, tailState);
		expect(d2.toolCalls).toBe(1);

		// Total across ticks: 3 tool calls (caller uses +=)
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Lane session stderr capture (#339)
// ═══════════════════════════════════════════════════════════════════════

describe("lane session stderr capture (#339, source extraction)", () => {
	const execSrc = readExecutionSource();
	const funcBody = extractExportedFunctionRegion(execSrc, "export function buildTmuxSpawnArgs(");

	it("adds stderr redirect to piCommand when sidecar path is provided", () => {
		expect(funcBody).toContain("2>>");
	});

	it("derives stderr log path from sidecar path with -stderr.log suffix", () => {
		expect(funcBody).toContain("-stderr.log");
		expect(funcBody).toContain('.replace(/\\.jsonl$/, "-stderr.log")');
	});

	it("only adds stderr redirect when sidecarPath is provided", () => {
		expect(funcBody).toContain("if (sidecarPath)");
	});

	it("uses shell-quote for the stderr log path", () => {
		expect(funcBody).toContain("shellQuote(stderrLogPath)");
	});

	it("stderr redirect targets piCommand (not the tmux wrapper)", () => {
		// The redirect is appended to piCommand, not wrappedCommand
		const stderrSection = funcBody.slice(
			funcBody.indexOf("TP-095"),
			funcBody.indexOf("const tmuxWorktreePath"),
		);
		expect(stderrSection).toContain("piCommand =");
		expect(stderrSection).toContain("2>>");
	});

	it("includes TP-095 reference in the stderr capture code", () => {
		expect(funcBody).toContain("TP-095");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Context snapshot schema + portable spawn delay
// ═══════════════════════════════════════════════════════════════════════

describe("context snapshots + portable spawn delay", () => {
	const src = readTaskRunnerSource();

	it("includes contextWindow in writeContextSnapshot payload", () => {
		const snapshotRegion = extractFunctionRegion(src, "writeContextSnapshot");
		expect(snapshotRegion).toContain("contextWindow");
	});

	it("passes resolved contextWindow at snapshot call site", () => {
		const executeTaskRegion = (() => {
			const startMarker = "async function executeTask(";
			const idx = src.indexOf(startMarker);
			if (idx < 0) throw new Error("executeTask not found");
			return src.slice(idx, idx + 9000);
		})();
		expect(executeTaskRegion).toContain("snapshotContextWindow");
		expect(executeTaskRegion).toContain("writeContextSnapshot(state, snapshotContextWindow)");
	});

	it("uses sleepSyncMs helper instead of shelling out to sleep", () => {
		const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");
		expect(src).toContain("function sleepSyncMs(");
		expect(tmuxBody).toContain("sleepSyncMs(");
		expect(tmuxBody).not.toContain("spawnSync(\"sleep\"");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Quality gate fix agent does NOT accumulate tools (#334 regression)
// ═══════════════════════════════════════════════════════════════════════

describe("quality gate fix agent tool count isolation", () => {
	const src = readTaskRunnerSource();

	it("fix agent still resets workerToolCount (separate lifecycle)", () => {
		// The doQualityGateFixAgent function spawns a separate fix agent.
		// Its workerToolCount = 0 should remain because fix agents have
		// their own lifecycle (not worker iterations).
		const fixAgentRegion = extractFunctionRegion(src, "doQualityGateFixAgent");
		expect(fixAgentRegion).toContain("state.workerToolCount = 0");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 7. TP-097: Stable sidecar identity (#354)
// ═════════════════════════════════════════════════════════════════════

describe("TP-097: stable sidecar identity (source extraction)", () => {
	const src = readTaskRunnerSource();

	it("generateStableSidecarPaths uses ORCH_BATCH_ID for stable identity", () => {
		const funcBody = extractFunctionRegion(src, "generateStableSidecarPaths");
		expect(funcBody).toContain("ORCH_BATCH_ID");
		expect(funcBody).toContain("sidecarPath");
		expect(funcBody).toContain("exitSummaryPath");
	});

	it("executeTask generates stable sidecar paths ONCE before the iteration loop", () => {
		const executeTaskRegion = (() => {
			const startMarker = "async function executeTask(";
			const idx = src.indexOf(startMarker);
			if (idx < 0) throw new Error("executeTask not found");
			return src.slice(idx, idx + 10000);
		})();
		// Stable paths generated before the iteration loop
		expect(executeTaskRegion).toContain("workerStableSidecar");
		expect(executeTaskRegion).toContain("generateStableSidecarPaths");
		expect(executeTaskRegion).toContain("workerTailState");
		expect(executeTaskRegion).toContain("createSidecarTailState");
		// Passed to runWorker
		expect(executeTaskRegion).toContain("runWorker(remainingSteps, ctx, workerStableSidecar, workerTailState)");
	});

	it("spawnAgentTmux accepts optional sidecarPath, exitSummaryPath, tailState", () => {
		const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");
		expect(tmuxBody).toContain("opts.sidecarPath");
		expect(tmuxBody).toContain("opts.exitSummaryPath");
		expect(tmuxBody).toContain("opts.tailState");
	});

	it("spawnAgentTmux uses caller-provided tailState when available", () => {
		const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");
		expect(tmuxBody).toContain("opts.tailState ?? createSidecarTailState()");
	});

	it("runWorker passes stable sidecar paths and shared tailState to spawnAgentTmux", () => {
		const runWorkerRegion = extractFunctionRegion(src, "runWorker");
		expect(runWorkerRegion).toContain("sidecarPath: stableSidecar?.sidecarPath");
		expect(runWorkerRegion).toContain("exitSummaryPath: stableSidecar?.exitSummaryPath");
		expect(runWorkerRegion).toContain("tailState: sharedTailState");
	});

	it("non-worker sessions use per-spawn unique paths (Date.now batchId)", () => {
		const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");
		// Internal fallback path uses Date.now() for batchId (not ORCH_BATCH_ID)
		expect(tmuxBody).toContain("const telemetryTs = Date.now()");
		expect(tmuxBody).toContain("const batchId = String(telemetryTs)");
	});
});

describe("TP-097: stable sidecar path functional test", () => {
	it("generateStableSidecarPaths produces deterministic paths", async () => {
		const { _generateStableSidecarPaths } = await import("../task-runner.ts");

		// Set env vars for deterministic test
		const origBatchId = process.env.ORCH_BATCH_ID;
		const origOpId = process.env.TASKPLANE_OPERATOR_ID;
		process.env.ORCH_BATCH_ID = "test-batch-123";
		process.env.TASKPLANE_OPERATOR_ID = "test-op";

		try {
			const paths1 = _generateStableSidecarPaths("orch-lane-1-worker", "TP-097");
			const paths2 = _generateStableSidecarPaths("orch-lane-1-worker", "TP-097");

			// Same inputs + same env → same paths
			expect(paths1.sidecarPath).toBe(paths2.sidecarPath);
			expect(paths1.exitSummaryPath).toBe(paths2.exitSummaryPath);

			// Path includes expected components
			expect(paths1.sidecarPath).toContain("test-op");
			expect(paths1.sidecarPath).toContain("test-batch-123");
			expect(paths1.sidecarPath).toContain("tp-097");
			expect(paths1.sidecarPath).toContain("lane-1");
			expect(paths1.sidecarPath).toContain("worker");
			expect(paths1.sidecarPath).toContain(".jsonl");
			expect(paths1.exitSummaryPath).toContain("-exit.json");
		} finally {
			if (origBatchId !== undefined) process.env.ORCH_BATCH_ID = origBatchId;
			else delete process.env.ORCH_BATCH_ID;
			if (origOpId !== undefined) process.env.TASKPLANE_OPERATOR_ID = origOpId;
			else delete process.env.TASKPLANE_OPERATOR_ID;
		}
	});

	it("generateStableSidecarPaths differentiates worker vs reviewer roles", async () => {
		const { _generateStableSidecarPaths } = await import("../task-runner.ts");

		const origBatchId = process.env.ORCH_BATCH_ID;
		process.env.ORCH_BATCH_ID = "batch-456";

		try {
			const workerPaths = _generateStableSidecarPaths("orch-lane-1-worker", "TP-097");
			const reviewerPaths = _generateStableSidecarPaths("orch-lane-1-reviewer", "TP-097");

			// Different roles → different paths
			expect(workerPaths.sidecarPath).not.toBe(reviewerPaths.sidecarPath);
			expect(workerPaths.sidecarPath).toContain("worker");
			expect(reviewerPaths.sidecarPath).toContain("reviewer");
		} finally {
			if (origBatchId !== undefined) process.env.ORCH_BATCH_ID = origBatchId;
			else delete process.env.ORCH_BATCH_ID;
		}
	});
});

describe("TP-097: tailState preserved across iterations (functional)", () => {
	let tmpDir: string;
	let sidecarPath: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `tp097-tail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(tmpDir, { recursive: true });
		sidecarPath = join(tmpDir, "telemetry.jsonl");
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
	});

	it("shared tailState resumes from last byte offset across iterations", async () => {
		const { _tailSidecarJsonl, _createSidecarTailState } = await import("../task-runner.ts");

		// Shared tailState (created once, reused across iterations)
		const sharedTailState = _createSidecarTailState();

		// Iteration 1: worker writes events
		writeFileSync(sidecarPath, [
			JSON.stringify({ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } }),
			JSON.stringify({ type: "tool_execution_start", toolName: "bash", args: { command: "echo hello" } }),
		].join("\n") + "\n");

		const d1 = _tailSidecarJsonl(sidecarPath, sharedTailState);
		expect(d1.inputTokens).toBe(100);
		expect(d1.toolCalls).toBe(1);

		// Capture offset after iteration 1
		const offsetAfterIter1 = sharedTailState.offset;
		expect(offsetAfterIter1).toBeGreaterThan(0);

		// Iteration 2: new worker appends to SAME file (stable sidecar path)
		appendFileSync(sidecarPath, [
			JSON.stringify({ type: "message_end", message: { usage: { input: 200, output: 100, cost: 0.02 } } }),
		].join("\n") + "\n");

		// Tail with SAME shared tailState → only sees new events
		const d2 = _tailSidecarJsonl(sidecarPath, sharedTailState);
		expect(d2.inputTokens).toBe(200); // Only new events, not re-reading iter 1
		expect(d2.toolCalls).toBe(0); // No new tool calls in iter 2
		expect(sharedTailState.offset).toBeGreaterThan(offsetAfterIter1);
	});

	it("fresh tailState re-reads entire file (old behavior for reviewers)", async () => {
		const { _tailSidecarJsonl, _createSidecarTailState } = await import("../task-runner.ts");

		// Write some events
		writeFileSync(sidecarPath, [
			JSON.stringify({ type: "message_end", message: { usage: { input: 100, output: 50, cost: 0.01 } } }),
			JSON.stringify({ type: "message_end", message: { usage: { input: 200, output: 100, cost: 0.02 } } }),
		].join("\n") + "\n");

		// Fresh tailState starts from offset 0 → reads everything
		const freshState = _createSidecarTailState();
		const delta = _tailSidecarJsonl(sidecarPath, freshState);
		expect(delta.inputTokens).toBe(300); // Sum of both events
	});
});

// ═════════════════════════════════════════════════════════════════════
// 8. TP-097: Orphan process cleanup (#242)
// ═════════════════════════════════════════════════════════════════════

describe("TP-097: orphan process cleanup (source extraction)", () => {
	const src = readTaskRunnerSource();

	it("cleanupOrphanProcesses exists and reads PID file", () => {
		const funcBody = extractFunctionRegion(src, "cleanupOrphanProcesses");
		expect(funcBody).toContain(".pid");
		expect(funcBody).toContain("readFileSync");
		expect(funcBody).toContain("JSON.parse");
	});

	it("orphan cleanup skips self PID and PID 1", () => {
		const funcBody = extractFunctionRegion(src, "cleanupOrphanProcesses");
		expect(funcBody).toContain("process.pid");
		expect(funcBody).toContain("delete(selfPid)");
		expect(funcBody).toContain("delete(1)");
	});

	it("orphan cleanup uses Set for PID deduplication", () => {
		const funcBody = extractFunctionRegion(src, "cleanupOrphanProcesses");
		expect(funcBody).toContain("new Set<number>()");
	});

	it("orphan cleanup sends SIGTERM to alive processes", () => {
		const funcBody = extractFunctionRegion(src, "cleanupOrphanProcesses");
		expect(funcBody).toContain('"SIGTERM"');
	});

	it("orphan cleanup is called after spawnAgentTmux poll loop", () => {
		const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");
		expect(tmuxBody).toContain("cleanupOrphanProcesses(sidecarPath)");
	});

	it("orphan cleanup is called in kill function", () => {
		const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");
		// The kill function should also call orphan cleanup
		const killSection = tmuxBody.slice(tmuxBody.indexOf("Kill function"));
		expect(killSection).toContain("cleanupOrphanProcesses");
	});
});

describe("TP-097: PID file in rpc-wrapper (source extraction)", () => {
	const rpcSrc = readFileSync(resolve(__dirname, "../../bin/rpc-wrapper.mjs"), "utf-8").replace(/\r\n/g, "\n");

	it("writes PID file with wrapper and child PIDs", () => {
		expect(rpcSrc).toContain("pidFilePath");
		expect(rpcSrc).toContain("wrapperPid: process.pid");
		expect(rpcSrc).toContain("childPid: proc.pid");
	});

	it("PID file path is sidecarPath + .pid", () => {
		expect(rpcSrc).toContain('args.sidecarPath + ".pid"');
	});

	it("cleans up PID file on process exit", () => {
		expect(rpcSrc).toContain("cleanupPidFile");
		expect(rpcSrc).toContain('process.on("exit", cleanupPidFile)');
	});
});

describe("TP-097: orphan cleanup functional test", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `tp097-orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
	});

	it("cleanupOrphanProcesses handles missing PID file gracefully", async () => {
		const { _cleanupOrphanProcesses } = await import("../task-runner.ts");
		const sidecarPath = join(tmpDir, "nonexistent.jsonl");
		// Should not throw
		_cleanupOrphanProcesses(sidecarPath);
	});

	it("cleanupOrphanProcesses handles malformed PID file", async () => {
		const { _cleanupOrphanProcesses } = await import("../task-runner.ts");
		const sidecarPath = join(tmpDir, "test.jsonl");
		writeFileSync(sidecarPath + ".pid", "not json\n");
		// Should not throw
		_cleanupOrphanProcesses(sidecarPath);
	});

	it("cleanupOrphanProcesses handles dead PIDs gracefully", async () => {
		const { _cleanupOrphanProcesses } = await import("../task-runner.ts");
		const sidecarPath = join(tmpDir, "test.jsonl");
		// Write PID file with a PID that's almost certainly dead
		writeFileSync(sidecarPath + ".pid", JSON.stringify({
			wrapperPid: 999999999,
			childPid: 999999998,
			startedAt: Date.now(),
		}) + "\n");
		// Should not throw — dead PIDs are expected
		_cleanupOrphanProcesses(sidecarPath);
	});

	it("cleanupOrphanProcesses removes PID file after cleanup", async () => {
		const { _cleanupOrphanProcesses } = await import("../task-runner.ts");
		const { existsSync: exists } = await import("fs");
		const sidecarPath = join(tmpDir, "test.jsonl");
		const pidFile = sidecarPath + ".pid";
		writeFileSync(pidFile, JSON.stringify({
			wrapperPid: 999999999,
			childPid: 999999998,
			startedAt: Date.now(),
		}) + "\n");
		expect(exists(pidFile)).toBe(true);
		_cleanupOrphanProcesses(sidecarPath);
		expect(exists(pidFile)).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 9. TP-097: Spawn retry budget (#335)
// ═════════════════════════════════════════════════════════════════════

describe("TP-097: spawn retry budget increase (#335, source extraction)", () => {
	const src = readTaskRunnerSource();
	const tmuxBody = extractFunctionRegion(src, "spawnAgentTmux");

	it("SPAWN_MAX_RETRIES is 5 (was 2 before TP-097)", () => {
		expect(tmuxBody).toContain("SPAWN_MAX_RETRIES = 5");
	});

	it("SPAWN_VERIFY_DELAY_MS is 500 (was 300 before TP-097)", () => {
		expect(tmuxBody).toContain("SPAWN_VERIFY_DELAY_MS = 500");
	});

	it("progressive delay uses N * 500ms", () => {
		expect(tmuxBody).toContain("spawnRetries * 500");
	});

	it("logs stderr from failed session on each retry", () => {
		expect(tmuxBody).toContain("failedStderr");
		expect(tmuxBody).toContain("stderrLogHint");
	});
});
