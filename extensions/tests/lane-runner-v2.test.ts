/**
 * Lane Runner V2 Tests — TP-105
 *
 * Tests for the headless lane-runner module and executeLaneV2 integration:
 *   - Source extraction: lane-runner module structure and exports
 *   - executeLaneV2 export and signature contract
 *   - Execution flow contract validation
 *   - No TMUX/TASK_AUTOSTART dependencies
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/lane-runner-v2.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");
const executionSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");
const agentBridgeSrc = readFileSync(join(__dirname, "..", "taskplane", "agent-bridge-extension.ts"), "utf-8");

// ── 1. Lane-runner module structure ─────────────────────────────────

describe("1.x: Lane-runner module structure", () => {
	it("1.1: exports executeTaskV2 function", () => {
		expect(laneRunnerSrc).toContain("export async function executeTaskV2(");
	});

	it("1.2: exports LaneRunnerConfig type", () => {
		expect(laneRunnerSrc).toContain("export interface LaneRunnerConfig");
	});

	it("1.3: exports LaneRunnerTaskResult type", () => {
		expect(laneRunnerSrc).toContain("export interface LaneRunnerTaskResult");
	});

	it("1.4: uses agent-host spawnAgent, not TMUX", () => {
		expect(laneRunnerSrc).toContain('from "./agent-host.ts"');
		expect(laneRunnerSrc).toContain("spawnAgent(hostOpts");
		// Verify no TMUX/TASK_AUTOSTART usage in executable code (comments ok)
		const codeOnly = laneRunnerSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
		expect(codeOnly).not.toContain("TASK_AUTOSTART");
		expect(codeOnly.toLowerCase()).not.toContain("tmux");
	});

	it("1.5: uses task-executor-core, not task-runner", () => {
		expect(laneRunnerSrc).toContain('from "./task-executor-core.ts"');
		expect(laneRunnerSrc).not.toContain('from "../task-runner');
	});

	it("1.6: uses process-registry for snapshots", () => {
		expect(laneRunnerSrc).toContain('from "./process-registry.ts"');
		expect(laneRunnerSrc).toContain("writeLaneSnapshot(");
	});

	it("1.7: no Pi extension imports", () => {
		expect(laneRunnerSrc).not.toContain("ExtensionAPI");
		expect(laneRunnerSrc).not.toContain("ExtensionContext");
		expect(laneRunnerSrc).not.toContain("pi-coding-agent");
	});
});

// ── 2. Lane-runner execution contract ───────────────────────────────

describe("2.x: Lane-runner execution contract", () => {
	it("2.1: executeTaskV2 takes ExecutionUnit, LaneRunnerConfig, and pauseSignal", () => {
		expect(laneRunnerSrc).toContain("unit: ExecutionUnit");
		expect(laneRunnerSrc).toContain("config: LaneRunnerConfig");
		expect(laneRunnerSrc).toContain("pauseSignal: { paused: boolean }");
	});

	it("2.2: returns LaneRunnerTaskResult with LaneTaskOutcome", () => {
		expect(laneRunnerSrc).toContain("Promise<LaneRunnerTaskResult>");
		expect(laneRunnerSrc).toContain("outcome: LaneTaskOutcome");
	});

	it("2.3: creates STATUS.md from PROMPT.md if missing", () => {
		expect(laneRunnerSrc).toContain("generateStatusMd(parsed)");
	});

	it("2.4: creates .DONE on completion", () => {
		expect(laneRunnerSrc).toContain("writeFileSync(donePath");
	});

	it("2.5: implements iteration loop with max iterations", () => {
		expect(laneRunnerSrc).toContain("config.maxIterations");
		expect(laneRunnerSrc).toContain("totalIterations++");
	});

	it("2.6: implements no-progress stall detection", () => {
		expect(laneRunnerSrc).toContain("noProgressCount");
		expect(laneRunnerSrc).toContain("config.noProgressLimit");
	});

	it("2.7: uses lean worker prompt (file paths, not inline content)", () => {
		expect(laneRunnerSrc).toContain("Read your task instructions at:");
		expect(laneRunnerSrc).toContain("Read your execution state at:");
	});

	it("2.8: passes context pressure callbacks to agent-host", () => {
		expect(laneRunnerSrc).toContain("config.warnPercent");
		expect(laneRunnerSrc).toContain("config.killPercent");
	});

	it("2.9: respects pause signal", () => {
		expect(laneRunnerSrc).toContain("pauseSignal.paused");
	});

	it("2.10: handles steering annotation from mailbox", () => {
		expect(laneRunnerSrc).toContain("steeringPendingPath");
		expect(laneRunnerSrc).toContain(".steering-pending");
	});

	it("2.11: passes mailbox directory to agent-host", () => {
		expect(laneRunnerSrc).toContain("mailboxDir");
		expect(laneRunnerSrc).toContain("config.batchId, workerAgentId");
	});

	it("2.12: reviewer snapshot refresh has failure threshold and success reset", () => {
		expect(laneRunnerSrc).toContain("reviewerSnapshotFailures = 0");
		expect(laneRunnerSrc).toContain("reviewerRefreshFailureThreshold = 5");
		expect(laneRunnerSrc).toContain("if (ok)");
		expect(laneRunnerSrc).toContain("clearInterval(reviewerRefresh)");
		expect(laneRunnerSrc).toContain("Snapshot refresh disabled");
	});

	it("2.13: empty thinking is forwarded as undefined to inherit session defaults", () => {
		expect(laneRunnerSrc).toContain("thinking: config.workerThinking || undefined");
	});
});

// ── 3. executeLaneV2 integration ────────────────────────────────────

describe("3.x: executeLaneV2 integration in execution.ts", () => {
	it("3.1: executeLaneV2 is exported", () => {
		expect(executionSrc).toContain("export async function executeLaneV2(");
	});

	it("3.2: executeLaneV2 signature matches legacy executeLane", () => {
		expect(executionSrc).toContain("lane: AllocatedLane,");
		expect(executionSrc).toContain("config: OrchestratorConfig,");
		expect(executionSrc).toContain("repoRoot: string,");
		expect(executionSrc).toContain("pauseSignal: { paused: boolean },");
		expect(executionSrc).toContain("Promise<LaneExecutionResult>");
	});

	it("3.3: executeLaneV2 does NOT use spawnLaneSession or TMUX", () => {
		// Extract just the executeLaneV2 function body
		const start = executionSrc.indexOf("export async function executeLaneV2(");
		const bodySection = executionSrc.slice(start, start + 5000);
		expect(bodySection).not.toContain("spawnLaneSession");
		expect(bodySection).not.toContain("tmuxHasSession");
		expect(bodySection).not.toContain("TASK_AUTOSTART");
	});

	it("3.4: executeLaneV2 uses executeTaskV2 from lane-runner", () => {
		expect(executionSrc).toContain('from "./lane-runner.ts"');
		expect(executionSrc).toContain("executeTaskV2(unit, laneRunnerConfig");
	});

	it("3.5: executeLaneV2 uses buildExecutionUnit", () => {
		expect(executionSrc).toContain("buildExecutionUnit(lane, task");
	});

	it("3.6: executeLaneV2 preserves commitTaskArtifacts and worktree reset", () => {
		const start = executionSrc.indexOf("export async function executeLaneV2(");
		const bodySection = executionSrc.slice(start, start + 5000);
		expect(bodySection).toContain("commitTaskArtifacts(");
		expect(bodySection).toContain("runGit(");
	});

	it("3.7: executeLaneV2 uses resolveRuntimeStateRoot", () => {
		const start = executionSrc.indexOf("export async function executeLaneV2(");
		const bodySection = executionSrc.slice(start, start + 5000);
		expect(bodySection).toContain("resolveRuntimeStateRoot(");
	});

	it("3.8: executeLaneV2 uses buildRuntimeAgentId for sessionName", () => {
		const start = executionSrc.indexOf("export async function executeLaneV2(");
		const bodySection = executionSrc.slice(start, start + 5000);
		expect(bodySection).toContain("buildRuntimeAgentId(");
	});
});

// ── 4. No TMUX dependency in the V2 path ────────────────────────────

describe("4.x: No TMUX dependency in the V2 execution path", () => {
	it("4.1: lane-runner.ts has no TMUX usage in executable code", () => {
		// Strip comments from source to check only executable code
		const codeOnly = laneRunnerSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
		expect(codeOnly.toLowerCase()).not.toContain("tmux");
	});

	it("4.2: lane-runner.ts has no TASK_AUTOSTART usage in executable code", () => {
		const codeOnly = laneRunnerSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
		expect(codeOnly).not.toContain("TASK_AUTOSTART");
	});

	it("4.3: lane-runner.ts has zero task-runner extension references", () => {
		expect(laneRunnerSrc).not.toContain("task-runner.ts");
		expect(laneRunnerSrc).not.toContain("TASK_RUNNER_SPAWN_MODE");
		expect(laneRunnerSrc).not.toContain("TASK_RUNNER_TMUX_PREFIX");
	});

	it("4.4: lane-runner.ts does not import from task-runner", () => {
		expect(laneRunnerSrc).not.toContain('from "../task-runner');
		expect(laneRunnerSrc).not.toContain("from '../task-runner");
	});
});

// ── 5. LaneRunnerConfig contract ────────────────────────────────────

describe("5.x: LaneRunnerConfig fields", () => {
	it("5.1: includes batch metadata fields", () => {
		expect(laneRunnerSrc).toContain("batchId: string");
		expect(laneRunnerSrc).toContain("agentIdPrefix: string");
	});

	it("5.2: includes lane metadata fields", () => {
		expect(laneRunnerSrc).toContain("laneNumber: number");
		expect(laneRunnerSrc).toContain("worktreePath: string");
		expect(laneRunnerSrc).toContain("branch: string");
		expect(laneRunnerSrc).toContain("repoId: string");
	});

	it("5.3: includes worker config fields", () => {
		expect(laneRunnerSrc).toContain("workerModel: string");
		expect(laneRunnerSrc).toContain("workerTools: string");
		expect(laneRunnerSrc).toContain("workerSystemPrompt: string");
	});

	it("5.4: includes execution limit fields", () => {
		expect(laneRunnerSrc).toContain("maxIterations: number");
		expect(laneRunnerSrc).toContain("noProgressLimit: number");
		expect(laneRunnerSrc).toContain("maxWorkerMinutes: number");
	});

	it("5.5: includes context pressure fields", () => {
		expect(laneRunnerSrc).toContain("warnPercent: number");
		expect(laneRunnerSrc).toContain("killPercent: number");
	});

	it("5.6: includes stateRoot for runtime artifacts", () => {
		expect(laneRunnerSrc).toContain("stateRoot: string");
	});
});

// ── 6. Segment-aware execution contracts (TP-134) ───────────────────

describe("6.x: Segment-aware lane execution contracts", () => {
	it("6.1: repo-singleton packet flow remains unchanged", () => {
		expect(laneRunnerSrc).toContain("const statusPath = unit.packet.statusPath;");
		expect(laneRunnerSrc).toContain("const promptPath = unit.packet.promptPath;");
		expect(laneRunnerSrc).toContain("const donePath = unit.packet.donePath;");
		expect(laneRunnerSrc).toContain("(none / whole-task execution)");
	});

	it("6.2: worker cwd is execution-unit worktree", () => {
		expect(laneRunnerSrc).toContain("cwd: unit.worktreePath");
	});

	it("6.3: packet path env wiring uses packet-home paths", () => {
		expect(laneRunnerSrc).toContain("TASKPLANE_STATUS_PATH: statusPath");
		expect(laneRunnerSrc).toContain("TASKPLANE_PROMPT_PATH: promptPath");
		expect(laneRunnerSrc).toContain("TASKPLANE_REVIEWS_DIR: unit.packet.reviewsDir");
		expect(laneRunnerSrc).toContain("TASKPLANE_REVIEWER_STATE_PATH: reviewerStatePath");
		expect(agentBridgeSrc).toContain("process.env.TASKPLANE_STATUS_PATH");
		expect(agentBridgeSrc).toContain("process.env.TASKPLANE_PROMPT_PATH");
		expect(agentBridgeSrc).toContain("process.env.TASKPLANE_REVIEWS_DIR");
		expect(agentBridgeSrc).toContain("process.env.TASKPLANE_REVIEWER_STATE_PATH");
	});

	it("6.4: lane snapshots include segmentId", () => {
		expect(laneRunnerSrc).toContain("segmentId: string | null");
		expect(laneRunnerSrc).toContain("segmentId,");
		expect(laneRunnerSrc).toContain("emitSnapshot(config, taskId, segmentId");
	});
});

// ── 7. Functional import validation ─────────────────────────────────

describe("7.x: Functional exports exist at runtime", () => {
	it("7.1: executeTaskV2 is importable", async () => {
		const mod = await import("../taskplane/lane-runner.ts");
		expect(typeof mod.executeTaskV2).toBe("function");
	});

	it("7.2: executeLaneV2 is importable from execution.ts", async () => {
		const mod = await import("../taskplane/execution.ts");
		expect(typeof mod.executeLaneV2).toBe("function");
	});
});

// ── 8. Multi-segment .DONE suppression (TP-145) ────────────────────

describe("8.x: Multi-segment .DONE timing (TP-145)", () => {
	it("8.1: lane-runner suppresses .DONE for non-final segments", () => {
		// The isNonFinalSegment check must exist
		expect(laneRunnerSrc).toContain("isNonFinalSegment");
		// It checks segmentId is non-null, segmentIds has multiple entries, and current is not last
		expect(laneRunnerSrc).toContain("segmentId != null");
		expect(laneRunnerSrc).toContain("unit.task.segmentIds.length > 1");
		expect(laneRunnerSrc).toContain('unit.task.segmentIds[unit.task.segmentIds.length - 1] !== segmentId');
	});

	it("8.2: non-final segment returns succeeded without creating .DONE", () => {
		expect(laneRunnerSrc).toContain(".DONE suppressed");
		expect(laneRunnerSrc).toContain('"succeeded"');
		// The return for non-final segment passes doneFileFound=false
		const nonFinalBlock = laneRunnerSrc.slice(
			laneRunnerSrc.indexOf("isNonFinalSegment"),
			laneRunnerSrc.indexOf("// Create .DONE if not already present")
		);
		expect(nonFinalBlock).toContain('"succeeded"');
		expect(nonFinalBlock).toContain("false");
	});

	it("8.3: final segment and single-segment tasks still create .DONE", () => {
		// The .DONE creation code is preserved after the non-final guard
		const afterGuard = laneRunnerSrc.slice(
			laneRunnerSrc.indexOf("// Create .DONE if not already present")
		);
		expect(afterGuard).toContain("writeFileSync(donePath");
		expect(afterGuard).toContain('"✅ Complete"');
		expect(afterGuard).toContain('.DONE created');
	});

	it("8.4: single-segment task (segmentId null) is unaffected", () => {
		// When segmentId is null, isNonFinalSegment is false
		// This means the .DONE creation block runs normally
		expect(laneRunnerSrc).toContain("segmentId != null");
		// The logical expression evaluates to false when segmentId is null
		expect(laneRunnerSrc).toContain("const isNonFinalSegment = segmentId != null");
	});
});
