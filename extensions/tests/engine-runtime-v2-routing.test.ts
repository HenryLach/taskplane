/**
 * Engine Runtime V2 Backend Routing Tests — TP-105 Remediation
 *
 * Validates that the engine selects the correct runtime backend
 * (legacy vs v2) based on batch characteristics, and that the
 * selection is threaded through wave execution and retry paths.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/engine-runtime-v2-routing.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");
const executionSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");

// ── 1. Backend selection logic in engine ─────────────────────────────

describe("1.x: Engine backend selection", () => {
	it("1.1: selects v2 when single task and repo mode", () => {
		expect(engineSrc).toContain("isSingleTask && isRepoMode");
		expect(engineSrc).toContain('"v2"');
	});

	it("1.2: falls back to legacy when workspace mode", () => {
		expect(engineSrc).toContain("!isRepoMode");
		expect(engineSrc).toContain("workspace mode not yet supported on Runtime V2");
	});

	it("1.3: logs backend selection for operator visibility", () => {
		expect(engineSrc).toContain("Runtime V2 backend selected");
		expect(engineSrc).toContain("Using Runtime V2 backend");
	});

	it("1.4: selectedBackend is threaded to executeWave", () => {
		// The executeWave call must include selectedBackend as an argument
		const waveCallIdx = engineSrc.indexOf("let waveResult = await executeWave(");
		expect(waveCallIdx).toBeGreaterThan(-1);
		const waveCallSlice = engineSrc.slice(waveCallIdx, waveCallIdx + 500);
		expect(waveCallSlice).toContain("selectedBackend");
	});

	it("1.5: isSingleTask checks exactly one wave with one task", () => {
		expect(engineSrc).toContain("rawWaves.length === 1 && rawWaves[0].length === 1");
	});
});

// ── 2. executeWave backend parameter ─────────────────────────────────

describe("2.x: executeWave backend parameter", () => {
	it("2.1: RuntimeBackend type is exported", () => {
		expect(executionSrc).toContain("export type RuntimeBackend");
	});

	it("2.2: executeWave accepts runtimeBackend parameter", () => {
		expect(executionSrc).toContain("runtimeBackend?: RuntimeBackend,");
	});

	it("2.3: executeWave routes to executeLaneV2 when v2", () => {
		expect(executionSrc).toContain('backend === "v2"');
		expect(executionSrc).toContain("executeLaneV2(lane, config");
	});

	it("2.4: executeWave defaults to legacy when no backend specified", () => {
		expect(executionSrc).toContain('const backend = runtimeBackend ?? "legacy"');
	});

	it("2.5: executeWave logs when using V2 backend", () => {
		expect(executionSrc).toContain("using Runtime V2 backend (executeLaneV2)");
	});
});

// ── 3. Retry path backend preservation ───────────────────────────────

describe("3.x: Retry paths preserve backend choice", () => {
	it("3.1: attemptWorkerCrashRetry accepts runtimeBackend", () => {
		expect(engineSrc).toContain("runtimeBackend?: RuntimeBackend,");
	});

	it("3.2: worker crash retry uses backend-aware executor", () => {
		expect(engineSrc).toContain('(runtimeBackend === "v2") ? executeLaneV2 : executeLane');
	});

	it("3.3: model fallback retry accepts runtimeBackend", () => {
		// Both retry functions should accept the parameter
		const matches = engineSrc.match(/runtimeBackend\?: RuntimeBackend/g);
		expect(matches).not.toBe(null);
		expect(matches!.length).toBeGreaterThanOrEqual(2);
	});

	it("3.4: selectedBackend is passed to retry callers", () => {
		// selectedBackend must appear in retry call sites
		const matches = engineSrc.match(/selectedBackend,/g);
		expect(matches).not.toBe(null);
		// At least 4 occurrences: wave call + crash retry + model fallback + stale worktree
		expect(matches!.length).toBeGreaterThanOrEqual(4);
	});

	it("3.5: stale worktree recovery threads backend", () => {
		// attemptStaleWorktreeRecovery should accept runtimeBackend
		const fnStart = engineSrc.indexOf("async function attemptStaleWorktreeRecovery(");
		expect(fnStart).toBeGreaterThan(-1);
		const fnSig = engineSrc.slice(fnStart, fnStart + 800);
		expect(fnSig).toContain("runtimeBackend?: RuntimeBackend");
	});
});

// ── 4. Scope guards ──────────────────────────────────────────────────

describe("4.x: Scope guards for TP-105 limits", () => {
	it("4.1: workspace mode explicitly falls back with notification", () => {
		expect(engineSrc).toContain("workspace mode not yet supported");
	});

	it("4.2: multi-task batches stay on legacy (no over-claim)", () => {
		// isSingleTask must be false for multi-task → selectedBackend stays legacy
		expect(engineSrc).toContain("isSingleTask && isRepoMode");
		// No forced v2 for multi-task
		expect(engineSrc).not.toContain("force v2 for multi-task");
	});
});

// ── 5. Terminal snapshots in lane-runner ──────────────────────────────

describe("5.x: Lane-runner terminal snapshot emission", () => {
	const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");

	it("5.1: makeResult can emit terminal snapshot", () => {
		// makeResult should accept config and statusPath for snapshot emission
		expect(laneRunnerSrc).toContain("config?: LaneRunnerConfig");
		expect(laneRunnerSrc).toContain("statusPath?: string");
	});

	it("5.2: terminal snapshot maps status correctly", () => {
		expect(laneRunnerSrc).toContain('"complete"');
		expect(laneRunnerSrc).toContain('"failed"');
		expect(laneRunnerSrc).toContain("terminalStatus");
	});

	it("5.3: all makeResult calls pass config and statusPath", () => {
		// Every return makeResult(...) should end with config, statusPath
		const calls = laneRunnerSrc.match(/return makeResult\(/g);
		const callsWithConfig = laneRunnerSrc.match(/config, statusPath\)/g);
		expect(calls).not.toBe(null);
		expect(callsWithConfig).not.toBe(null);
		expect(callsWithConfig!.length).toBe(calls!.length);
	});
});

// ── 6. Import/export validation ──────────────────────────────────────

describe("6.x: Runtime imports for backend routing", () => {
	it("6.1: engine imports executeLaneV2", () => {
		expect(engineSrc).toContain("executeLaneV2");
	});

	it("6.2: engine imports RuntimeBackend type", () => {
		expect(engineSrc).toContain("RuntimeBackend");
	});

	it("6.3: executeLaneV2 is exported from execution.ts", () => {
		expect(executionSrc).toContain("export async function executeLaneV2(");
	});

	it("6.4: RuntimeBackend is exported from execution.ts", () => {
		expect(executionSrc).toContain("export type RuntimeBackend");
	});
});
