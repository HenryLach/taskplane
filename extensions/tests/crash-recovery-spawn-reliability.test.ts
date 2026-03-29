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

	it("adds post-spawn verification delay before checking session", () => {
		expect(tmuxBody).toContain("SPAWN_VERIFY_DELAY_MS");
		expect(tmuxBody).toContain("300");
	});

	it("defines verification polling (3 attempts, 200ms interval)", () => {
		expect(tmuxBody).toContain("SPAWN_VERIFY_POLL_ATTEMPTS");
		expect(tmuxBody).toContain("3");
		expect(tmuxBody).toContain("SPAWN_VERIFY_POLL_INTERVAL_MS");
		expect(tmuxBody).toContain("200");
	});

	it("defines max retry count (2 retries)", () => {
		expect(tmuxBody).toContain("SPAWN_MAX_RETRIES");
		expect(tmuxBody).toContain("= 2");
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
// 5. Quality gate fix agent does NOT accumulate tools (#334 regression)
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
