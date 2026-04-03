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
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
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
const {
	resolveTaskMonitorState,
} = await import("../taskplane/execution.ts");
const {
	writeLaneSnapshot,
} = await import("../taskplane/process-registry.ts");

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

	it("2.3: executeWave routes lanes directly to executeLaneV2", () => {
		expect(executionSrc).toContain("const lanePromises = lanes.map(lane =>");
		expect(executionSrc).toContain("executeLaneV2(lane, config");
	});

	it("2.4: executeWave forces Runtime V2 even when backend is omitted", () => {
		expect(executionSrc).toContain('const backend: RuntimeBackend = "v2"');
		expect(executionSrc).toContain("legacy runtime backend");
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

	it("3.2: worker crash retry executes via executeLaneV2", () => {
		expect(engineSrc).toContain("const retryResult = await executeLaneV2(");
		expect(engineSrc).not.toContain('(runtimeBackend === "v2") ? executeLaneV2 : executeLane');
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

	it("5.3: all makeResult calls pass config, statusPath, and telemetry", () => {
		// Every return makeResult(...) should end with config, statusPath[, lastTelemetry]
		const calls = laneRunnerSrc.match(/return makeResult\(/g);
		// Worker-result calls pass lastTelemetry; skipped calls don't (no agent ran)
		const callsWithTelemetry = laneRunnerSrc.match(/config, statusPath, lastTelemetry\)/g);
		expect(calls).not.toBe(null);
		// At least 3 calls pass telemetry (failed, max-iter-failed, succeeded)
		expect(callsWithTelemetry).not.toBe(null);
		expect(callsWithTelemetry!.length).toBeGreaterThanOrEqual(3);
	});

	it("5.4: lastTelemetry is scoped across loop and post-loop completion checks", () => {
		const declIdx = laneRunnerSrc.indexOf("let lastTelemetry: Partial<AgentHostResult> = {};");
		const loopIdx = laneRunnerSrc.indexOf("for (let iter = 0; iter < config.maxIterations; iter++)");
		const postLoopUseIdx = laneRunnerSrc.lastIndexOf("config, statusPath, lastTelemetry");
		expect(declIdx).toBeGreaterThan(-1);
		expect(loopIdx).toBeGreaterThan(-1);
		expect(postLoopUseIdx).toBeGreaterThan(-1);
		expect(declIdx).toBeLessThan(loopIdx);
		expect(loopIdx).toBeLessThan(postLoopUseIdx);
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
		expect(selectRuntimeBackend("all", [["TP-001"]], null).backend).toBe("v2");
		const ws = { mode: "workspace", repos: new Map(), configPath: "x", workspaceRoot: "x" } as any;
		expect(selectRuntimeBackend("all", [["TP-001"]], ws).backend).toBe("v2");
	});
});

// ── 11. Remediation behavioral tests (TP-108/109-R1) ────────────────

describe("11.x: Merge V2 liveness + abort correctness", () => {
	const mergeSrc = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");
	const abortSrc = readFileSync(join(__dirname, "..", "taskplane", "abort.ts"), "utf-8");
	const extensionSrc = readFileSync(join(__dirname, "..", "taskplane", "extension.ts"), "utf-8");

	it("11.1: waitForMergeResult is backend-aware (no TMUX for V2)", () => {
		const fnIdx = mergeSrc.indexOf("function waitForMergeResult(");
		const block = mergeSrc.slice(fnIdx, fnIdx + 3000);
		// Must accept runtimeBackend param
		expect(block).toContain("runtimeBackend");
		// V2 path uses activeMergeAgents, not TMUX
		expect(block).toContain("activeMergeAgents.has(sessionName)");
		// V2 timeout kills via killMergeAgentV2
		expect(block).toContain("killMergeAgentV2(sessionName)");
	});

	it("11.2: V2 merge error/retry path kills agent before respawn", () => {
		// Find retry section in mergeWave
		const retryIdx = mergeSrc.indexOf("Re-spawn merge agent for the retry");
		const block = mergeSrc.slice(retryIdx, retryIdx + 500);
		// Must kill V2 agent before respawn to prevent orphans
		const killIdx = block.indexOf("killMergeAgentV2(sessionName)");
		const spawnIdx = block.indexOf("spawnMergeAgentV2(");
		expect(killIdx).toBeGreaterThan(-1);
		expect(spawnIdx).toBeGreaterThan(-1);
		expect(killIdx).toBeLessThan(spawnIdx); // kill BEFORE spawn
	});

	it("11.3: V2 merge error cleanup path kills via Runtime V2 handle", () => {
		const errIdx = mergeSrc.indexOf("Kill merge agent if still alive");
		expect(errIdx).toBeGreaterThan(-1);
		const block = mergeSrc.slice(errIdx, errIdx + 300);
		expect(block).toContain("killMergeAgentV2(sessionName)");
		expect(block).not.toContain("tmux");
	});

	it("11.4: abort kills all V2 merge agents (not just TMUX sessions)", () => {
		expect(abortSrc).toContain("killAllMergeAgentsV2");
	});

	it("11.5: killAllMergeAgentsV2 is exported from merge.ts", () => {
		expect(mergeSrc).toContain("export function killAllMergeAgentsV2");
	});

	it("11.6: merge path has no TMUX health-monitor registration", () => {
		const fnIdx = mergeSrc.indexOf("export async function mergeWave(");
		const block = mergeSrc.slice(fnIdx, fnIdx + 16000);
		expect(block).not.toContain("addSession");
	});

	it("11.7: abort discovery uses Runtime V2 state sources (no tmux list-sessions)", () => {
		expect(abortSrc).toContain("discoverAbortSessionNames(");
		expect(abortSrc).not.toContain('execSync(\'tmux list-sessions');
	});

	it("11.8: /orch-abort helper delegates to executeAbort without tmux kill-session", () => {
		const fnIdx = extensionSrc.indexOf("function doOrchAbort(");
		expect(fnIdx).toBeGreaterThan(-1);
		const block = extensionSrc.slice(fnIdx, fnIdx + 2600);
		expect(block).toContain("await executeAbort(");
		expect(block).toContain("ORCH_MESSAGES.abortNoBatch()");
		expect(block).not.toContain("tmux list-sessions");
		expect(block).not.toContain("tmux kill-session");
	});
});

describe("12.x: Resume TDZ safety", () => {
	const resumeSrc = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

	it("12.1: resumeBackend is declared before first use", () => {
		const declIdx = resumeSrc.indexOf("const resumeBackend: RuntimeBackend");
		expect(declIdx).toBeGreaterThan(-1);
		// Check ALL uses — not just mergeWaveByRepo but also section 3 liveness
		const allUses = [...resumeSrc.matchAll(/resumeBackend/g)].map(m => m.index!);
		for (const useIdx of allUses) {
			if (useIdx === declIdx) continue; // skip the declaration itself
			expect(declIdx).toBeLessThan(useIdx);
		}
	});

	it("12.2: only one declaration of resumeBackend exists", () => {
		const decls = resumeSrc.match(/const resumeBackend/g);
		expect(decls).not.toBe(null);
		expect(decls!.length).toBe(1);
	});
});

// ── 13. TP-112: Resume + Monitor de-TMUX ────────────────────────────

describe("13.x: Resume de-TMUX for V2 (TP-112)", () => {
	const resumeSrc = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

	it("13.1: resume uses process registry for liveness (not tmuxHasSession)", () => {
		const section3Idx = resumeSrc.indexOf("Discover live signals");
		const block = resumeSrc.slice(section3Idx, section3Idx + 1200);
		expect(block).toContain("readRegistrySnapshot");
		expect(block).toContain("isProcessAlive");
		expect(block).not.toContain("tmuxHasSession");
	});

	it("13.2: V2 reconnect terminates then re-executes (detect+terminate+rehydrate)", () => {
		const reconnIdx = resumeSrc.indexOf("V2 reconnect: terminate + rehydrate");
		expect(reconnIdx).toBeGreaterThan(-1);
		const block = resumeSrc.slice(reconnIdx, reconnIdx + 1000);
		// Must terminate before execute
		const termIdx = block.indexOf("terminateAliveV2Agents");
		const execIdx = block.indexOf("executeLaneV2");
		expect(termIdx).toBeGreaterThan(-1);
		expect(execIdx).toBeGreaterThan(-1);
		expect(termIdx).toBeLessThan(execIdx);
	});

	it("13.3: V2 re-execute terminates then uses executeLaneV2", () => {
		const reexecIdx = resumeSrc.indexOf("Runtime V2 re-execution");
		expect(reexecIdx).toBeGreaterThan(-1);
		const block = resumeSrc.slice(reexecIdx, reexecIdx + 1000);
		const termIdx = block.indexOf("terminateAliveV2Agents");
		const execIdx = block.indexOf("executeLaneV2");
		expect(termIdx).toBeGreaterThan(-1);
		expect(execIdx).toBeGreaterThan(-1);
		expect(termIdx).toBeLessThan(execIdx);
	});

	it("13.4: V2 liveness identity maps lane session names for reconcile matching", () => {
		const section3Idx = resumeSrc.indexOf("Discover live signals");
		const block = resumeSrc.slice(section3Idx, section3Idx + 1500);
		// Must strip role suffix to match persisted sessionName
		expect(block).toContain("replace(/-(worker|reviewer)$/");
	});

	it("13.5: terminateAliveV2Agents function exists and uses SIGTERM", () => {
		expect(resumeSrc).toContain("function terminateAliveV2Agents");
		const fnIdx = resumeSrc.indexOf("function terminateAliveV2Agents");
		const block = resumeSrc.slice(fnIdx, fnIdx + 800);
		expect(block).toContain("SIGTERM");
		expect(block).toContain("readRegistrySnapshot");
		expect(block).toContain("isProcessAlive");
	});

	it("13.6: legacy reconnect/re-exec helpers removed from resume path", () => {
		expect(resumeSrc).not.toContain("pollUntilTaskComplete");
		expect(resumeSrc).not.toContain("spawnLaneSession");
		expect(resumeSrc).toContain("executeLaneV2");
	});
});

describe("14.x: Monitor de-TMUX for V2 (TP-112)", () => {
	const execSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");

	function freshTracker(taskId: string, now: number) {
		return {
			taskId,
			firstObservedAt: now,
			statusFileSeenOnce: false,
			lastMtime: null,
			stallTimerStart: null,
		};
	}

	it("14.1: resolveTaskMonitorState uses lane-snapshot-based V2 liveness with startup grace", () => {
		const fnIdx = execSrc.indexOf("function resolveTaskMonitorState");
		const block = execSrc.slice(fnIdx, fnIdx + 1500);
		// V2 primary: reads lane snapshot file (TP-115 resilience)
		expect(block).toContain("readLaneSnapshot");
		// Startup grace: assume alive when snapshot not yet written
		expect(block).toContain("snap == null");
		// V2 fallback: registry-based check
		expect(block).toContain("isV2AgentAlive");
	});

	it("14.2: isV2AgentAlive checks registry + PID (not TMUX)", () => {
		const fnIdx = execSrc.indexOf("function isV2AgentAlive");
		expect(fnIdx).toBeGreaterThan(-1);
		const block = execSrc.slice(fnIdx, fnIdx + 800);
		expect(block).toContain("isTerminalStatus");
		expect(block).toContain("isProcessAlive");
		// Must NOT contain tmux
		expect(block).not.toContain("tmux");
	});

	it("14.3: monitorLanes refreshes V2 registry cache each poll cycle using state root", () => {
		const fnIdx = execSrc.indexOf("function monitorLanes");
		const block = execSrc.slice(fnIdx, fnIdx + 6000);
		expect(block).toContain("setV2LivenessRegistryCache");
		expect(block).toContain("readRegistrySnapshot(stateRootForRegistry ?? repoRoot, batchId)");
	});

	it("14.4: monitorLanes lane snapshot uses backend-aware liveness", () => {
		const fnIdx = execSrc.indexOf("function monitorLanes");
		const block = execSrc.slice(fnIdx, fnIdx + 20000);
		// Lane snapshot sessionAlive must branch on V2
		expect(block).toContain("isV2AgentAlive(laneSessionIdOf(lane)");
	});

	it("14.4b: laneSessionIdOf uses canonical laneSessionId", () => {
		const fnIdx = execSrc.indexOf("function laneSessionIdOf");
		expect(fnIdx).toBeGreaterThan(-1);
		const block = execSrc.slice(fnIdx, fnIdx + 160);
		expect(block).toContain("return lane.laneSessionId;");
	});

	it("14.5: stall kill uses Runtime V2 PID termination (no TMUX fallback)", () => {
		const fnIdx = execSrc.indexOf("function resolveTaskMonitorState");
		const block = execSrc.slice(fnIdx, fnIdx + 5000);
		const stallIdx = block.indexOf("stall detected");
		expect(stallIdx).toBeGreaterThan(-1);
		const stallBlock = block.slice(stallIdx, stallIdx + 500);
		expect(stallBlock).toContain("killV2LaneAgents");
		expect(stallBlock).not.toContain("killLaneAndChildren");
		expect(stallBlock).not.toContain("tmux");
	});

	it("14.6: killV2LaneAgents terminates by PID from registry", () => {
		const fnIdx = execSrc.indexOf("function killV2LaneAgents");
		expect(fnIdx).toBeGreaterThan(-1);
		const nextSectionIdx = execSrc.indexOf("// ── Async TMUX Helpers", fnIdx);
		const block = execSrc.slice(fnIdx, nextSectionIdx > fnIdx ? nextSectionIdx : fnIdx + 1200);
		expect(block).toContain("process.kill");
		expect(block).toContain("SIGTERM");
		expect(block).not.toContain("spawn(\"tmux\"");
	});

	it("14.7: executeWave passes batchId and resolved state root to monitorLanes", () => {
		const waveIdx = execSrc.indexOf("function executeWave(");
		const waveBlock = execSrc.slice(waveIdx, waveIdx + 22000);
		expect(waveBlock).toContain("const monitorStateRoot = resolveRuntimeStateRoot(repoRoot, wsRoot)");
		const callIdx = waveBlock.indexOf("monitorLanes(");
		const block = waveBlock.slice(callIdx, callIdx + 420);
		expect(block).toContain("batchId");
		expect(block).toContain("monitorStateRoot");
	});

	it("14.8: final cleanup kills lingering Runtime V2 agents without TMUX fallbacks", () => {
		const cleanupIdx = engineSrc.indexOf("Kill lingering Runtime V2 agents BEFORE removing worktrees.");
		expect(cleanupIdx).toBeGreaterThan(-1);
		const cleanupBlock = engineSrc.slice(cleanupIdx, cleanupIdx + 1600);
		expect(cleanupBlock).toContain("readRegistrySnapshot(stateRoot, batchState.batchId)");
		expect(cleanupBlock).toContain("lingeringLaneSessions.add(manifest.agentId.replace(/-(worker|reviewer)$/");
		expect(cleanupBlock).toContain("killV2LaneAgents(sessionName");
		expect(cleanupBlock).toContain("killAllMergeAgentsV2()");
		expect(cleanupBlock).not.toContain("tmuxHasSession");
		expect(cleanupBlock).not.toContain("tmuxKillSession");
	});

	it("14.9: stale snapshot from a different task is treated as alive", async () => {
		const root = mkdtempSync(join(tmpdir(), "tp-127-"));
		const now = Date.now();
		const batchId = "b-stale";
		const taskId = "TP-127";
		try {
			writeLaneSnapshot(root, batchId, 1, {
				taskId: "TP-122",
				status: "complete",
				updatedAt: now,
			});

			const snapshot = await resolveTaskMonitorState(
				taskId,
				join(root, ".DONE"),
				"lane-1",
				{ parsed: null, error: null },
				freshTracker(taskId, now),
				30 * 60_000,
				now,
				"v2",
				{ stateRoot: root, batchId, laneNumber: 1 },
			);

			expect(snapshot.sessionAlive).toBe(true);
			expect(snapshot.status).toBe("running");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("14.10: current running snapshot keeps session alive", async () => {
		const root = mkdtempSync(join(tmpdir(), "tp-127-"));
		const now = Date.now();
		const batchId = "b-running";
		const taskId = "TP-127";
		try {
			writeLaneSnapshot(root, batchId, 1, {
				taskId,
				status: "running",
				updatedAt: now,
			});

			const snapshot = await resolveTaskMonitorState(
				taskId,
				join(root, ".DONE"),
				"lane-1",
				{ parsed: null, error: null },
				freshTracker(taskId, now),
				30 * 60_000,
				now,
				"v2",
				{ stateRoot: root, batchId, laneNumber: 1 },
			);

			expect(snapshot.sessionAlive).toBe(true);
			expect(snapshot.status).toBe("running");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("14.11: current complete snapshot marks session as dead", async () => {
		const root = mkdtempSync(join(tmpdir(), "tp-127-"));
		const now = Date.now();
		const batchId = "b-complete";
		const taskId = "TP-127";
		try {
			writeLaneSnapshot(root, batchId, 1, {
				taskId,
				status: "complete",
				updatedAt: now,
			});

			const snapshot = await resolveTaskMonitorState(
				taskId,
				join(root, ".DONE"),
				"lane-1",
				{ parsed: null, error: null },
				freshTracker(taskId, now),
				30 * 60_000,
				now,
				"v2",
				{ stateRoot: root, batchId, laneNumber: 1 },
			);

			expect(snapshot.sessionAlive).toBe(false);
			expect(snapshot.status).toBe("failed");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
