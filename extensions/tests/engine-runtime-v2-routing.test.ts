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
const {
	selectRuntimeBackend,
} = await import("../taskplane/engine.ts");
const {
	mapLaneTaskStatusToTerminalSnapshotStatus,
	mapLaneSnapshotStatusToWorkerStatus,
} = await import("../taskplane/lane-runner.ts");

// ── 1. Backend selection logic in engine ─────────────────────────────

describe("1.x: Engine backend selection", () => {
	it("1.1: selects v2 for all repo-mode batches (TP-108 expanded gate)", () => {
		// TP-108: V2 for all repo-mode, legacy only for workspace
		expect(engineSrc).toContain("isRepoMode");
		expect(engineSrc).toContain('"v2"');
	});

	it("1.2: all modes use V2 (TP-109 workspace authority)", () => {
		// TP-109: workspace mode is now on V2 with packet-home authority
		expect(engineSrc).toContain('"v2"');
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
		expect(engineSrc).toContain("rawWaves.length === 1 && rawWaves[0]?.length === 1");
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

describe("4.x: Scope guards (TP-108/109 expanded)", () => {
	it("4.1: all batches use V2 (TP-109 enables workspace mode)", () => {
		// TP-109: workspace mode now uses V2 with packet-home authority
		expect(engineSrc).toContain('"v2"');
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

	it("5.2: terminal snapshot maps succeeded/skipped/failed correctly", () => {
		expect(laneRunnerSrc).toContain('"complete"');
		expect(laneRunnerSrc).toContain('"idle"');
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

// ── 7. Behavioral routing/mapping tests (non-source assertions) ─────

describe("7.x: Behavioral backend and snapshot mapping", () => {
	it("7.1: selectRuntimeBackend picks v2 for all batches (TP-109)", () => {
		// Repo mode
		expect(selectRuntimeBackend("tasks/TP-001/PROMPT.md", [["TP-001"]], null).backend).toBe("v2");
		expect(selectRuntimeBackend("all", [["TP-001"]], null).backend).toBe("v2");
		expect(selectRuntimeBackend("all", [["TP-001"], ["TP-002"]], null).backend).toBe("v2");
		// Workspace mode also V2 (TP-109: packet-home authority threaded)
		const ws = { mode: "workspace", repos: new Map(), routing: {}, configPath: "x", workspaceRoot: "x" } as any;
		expect(selectRuntimeBackend("all", [["TP-001"]], ws).backend).toBe("v2");
	});

	it("7.2: selectRuntimeBackend returns v2 in workspace mode (TP-109)", () => {
		const ws = { mode: "workspace", repos: new Map(), routing: {}, configPath: "x", workspaceRoot: "x" } as any;
		expect(selectRuntimeBackend("tasks/TP-001/PROMPT.md", [["TP-001"]], ws).backend).toBe("v2");
	});

	it("7.3: terminal lane status mapping preserves skipped as idle", () => {
		expect(mapLaneTaskStatusToTerminalSnapshotStatus("succeeded")).toBe("complete");
		expect(mapLaneTaskStatusToTerminalSnapshotStatus("skipped")).toBe("idle");
		expect(mapLaneTaskStatusToTerminalSnapshotStatus("failed")).toBe("failed");
	});

	it("7.4: worker status mapping emits terminal lifecycle states", () => {
		expect(mapLaneSnapshotStatusToWorkerStatus("running")).toBe("running");
		expect(mapLaneSnapshotStatusToWorkerStatus("complete")).toBe("exited");
		expect(mapLaneSnapshotStatusToWorkerStatus("idle")).toBe("wrapping_up");
		expect(mapLaneSnapshotStatusToWorkerStatus("failed")).toBe("crashed");
	});
});

// ── 8. TP-108: Resume backend parity ─────────────────────────────────

describe("8.x: Resume backend parity (TP-108)", () => {
	const resumeSrc = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

	it("8.1: resume computes runtime backend using selectRuntimeBackend", () => {
		expect(resumeSrc).toContain("selectRuntimeBackend");
		expect(resumeSrc).toContain("resumeBackend");
	});

	it("8.2: resume passes backend to executeWave", () => {
		// The executeWave call in resume must include the backend
		const waveCallIdx = resumeSrc.indexOf("await executeWave(");
		expect(waveCallIdx).toBeGreaterThan(-1);
		const waveCallSlice = resumeSrc.slice(waveCallIdx, waveCallIdx + 900);
		expect(waveCallSlice).toContain("resumeBackend");
	});

	it("8.3: resume imports RuntimeBackend type", () => {
		expect(resumeSrc).toContain("RuntimeBackend");
	});

	it("8.4: resume passes backend to mergeWaveByRepo calls", () => {
		// All mergeWaveByRepo calls in resume should include resumeBackend
		const mergeCallCount = (resumeSrc.match(/mergeWaveByRepo\(/g) || []).length;
		expect(mergeCallCount).toBeGreaterThan(0);
		// Count calls that include resumeBackend
		const withBackend = (resumeSrc.match(/resumeBackend,\r?\n/g) || []).length;
		// At least the 4 main merge calls should have backend
		expect(withBackend).toBeGreaterThanOrEqual(4);
	});
});

// ── 9. TP-108: Merge host V2 migration ─────────────────────────────

describe("9.x: Merge host V2 migration (TP-108)", () => {
	const mergeSrc = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");

	it("9.1: spawnMergeAgentV2 exists and uses agent-host", () => {
		expect(mergeSrc).toContain("export async function spawnMergeAgentV2");
		expect(mergeSrc).toContain("spawnAgent(opts)");
	});

	it("9.2: spawnMergeAgentV2 sets role to merger", () => {
		const fnIdx = mergeSrc.indexOf("function spawnMergeAgentV2");
		const block = mergeSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain('role: "merger"');
	});

	it("9.3: spawnMergeAgentV2 registers in process registry via stateRoot", () => {
		const fnIdx = mergeSrc.indexOf("function spawnMergeAgentV2");
		const block = mergeSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain("stateRoot");
	});

	it("9.4: mergeWave accepts runtimeBackend parameter", () => {
		expect(mergeSrc).toContain("runtimeBackend?: RuntimeBackend");
	});

	it("9.5: mergeWave routes spawn to V2 when backend is v2", () => {
		// Both retry and first-attempt paths must have V2 routing
		const fnIdx = mergeSrc.indexOf("export async function mergeWave(");
		const block = mergeSrc.slice(fnIdx, fnIdx + 16000);
		const v2SpawnCount = (block.match(/spawnMergeAgentV2\(/g) || []).length;
		expect(v2SpawnCount).toBeGreaterThanOrEqual(2); // first attempt + retry
	});

	it("9.6: engine threads selectedBackend to mergeWaveByRepo", () => {
		const mergeCallIdx = engineSrc.indexOf("mergeResult = await mergeWaveByRepo(");
		const block = engineSrc.slice(mergeCallIdx, mergeCallIdx + 600);
		expect(block).toContain("selectedBackend");
	});

	it("9.7: killMergeAgentV2 exists for cleanup/abort", () => {
		expect(mergeSrc).toContain("export function killMergeAgentV2");
	});

	it("9.8: V2 merge uses events.jsonl for telemetry (not sidecar files)", () => {
		const fnIdx = mergeSrc.indexOf("function spawnMergeAgentV2");
		const block = mergeSrc.slice(fnIdx, fnIdx + 2000);
		expect(block).toContain("eventsPath");
		expect(block).toContain("exitSummaryPath");
		expect(block).toContain("events.jsonl");
	});
});

// ── 10. TP-109: Packet-home authority and resume parity ──────────────

describe("10.x: Packet-home authority (TP-109)", () => {
	const resumeSrc = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");
	const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");

	it("10.1: resume checks worktree-relative .DONE path in addition to original", () => {
		// Resume must call resolveCanonicalTaskPaths for worktree-relative .DONE check
		expect(resumeSrc).toContain("resolveCanonicalTaskPaths");
		expect(resumeSrc).toContain("worktree-relative path");
	});

	it("10.2: resume imports resolveCanonicalTaskPaths", () => {
		expect(resumeSrc).toContain("resolveCanonicalTaskPaths");
	});

	it("10.3: lane-runner uses unit.packet.* for all artifact paths", () => {
		// Lane-runner must use packet paths, not cwd-derived paths
		expect(laneRunnerSrc).toContain("unit.packet.statusPath");
		expect(laneRunnerSrc).toContain("unit.packet.donePath");
		expect(laneRunnerSrc).toContain("unit.packet.promptPath");
		expect(laneRunnerSrc).toContain("unit.packet.taskFolder");
	});

	it("10.4: buildExecutionUnit resolves packet paths via resolveCanonicalTaskPaths", () => {
		const execSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");
		const fnIdx = execSrc.indexOf("function buildExecutionUnit");
		const block = execSrc.slice(fnIdx, fnIdx + 1000);
		expect(block).toContain("resolveCanonicalTaskPaths");
		expect(block).toContain("packetHomeRepoId");
	});

	it("10.5: selectRuntimeBackend returns v2 for all modes (TP-109 completion)", () => {
		// After TP-109, there's no legacy-only mode — all batches use V2
		expect(selectRuntimeBackend("all", [["TP-001"]], null).backend).toBe("v2");
		const ws = { mode: "workspace", repos: new Map(), configPath: "x", workspaceRoot: "x" } as any;
		expect(selectRuntimeBackend("all", [["TP-001"]], ws).backend).toBe("v2");
	});
});
