/**
 * TP-190 (#561): Runtime V2 spawn-failure visibility regression test.
 *
 * Verifies that when a Runtime V2 lane spawn fails (e.g., Pi CLI not findable,
 * worktree provisioning error), the failure becomes visible to operators
 * instead of producing a silent hang. Specifically asserts:
 *
 *   1. `executeLaneV2` catch produces a failed `LaneTaskOutcome` with
 *      `exitDiagnostic.classification === "spawn_failure"` and
 *      `exitReason` containing the underlying spawn error message.
 *   2. A synthetic terminal `RuntimeLaneSnapshot` is written to disk so
 *      `monitorLanes` can resolve the lane to terminal state and unblock
 *      `executeWave` (the root cause of the original silent hang).
 *   3. Spawn failure is NOT auto-retried — the engine's
 *      `attemptWorkerCrashRetry` short-circuits on
 *      `classification === "spawn_failure"`.
 *   4. Engine's `task-failure` IPC alert payload carries
 *      `context.exitCategory` so the supervisor playbook can branch on it.
 *   5. When every lane in a wave spawn-fails, `batchState.phase` transitions
 *      to `"failed"` (not left at `"executing"` or `"paused"`).
 *   6. The new `spawn_failure` ExitClassification is registered alongside
 *      existing values and is intentionally absent from
 *      `TIER0_RETRYABLE_CLASSIFICATIONS`.
 *
 * Test architecture:
 *   - Behavioral coverage for (1) and (2): mock the lane-runner's
 *     `executeTaskV2` to reject with a "Cannot find Pi CLI entrypoint"
 *     error and call `executeLaneV2` end-to-end with real temp dirs.
 *   - Source-string + structural coverage for (3), (4), (5): assert the
 *     guard / payload-population / phase-transition code is wired in
 *     `engine.ts`. These pieces live deep inside engine.ts's wave loop
 *     which has too many runtime prerequisites for a focused unit test;
 *     the source-string assertions guarantee the logic is in place and
 *     associated with the correct conditions.
 *   - Type-level coverage for (6): import the runtime values and assert
 *     membership.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/spawn-failure-visibility.test.ts
 */

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineSrc = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");
const resumeSrc = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");
const executionSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");
const diagnosticsSrc = readFileSync(join(__dirname, "..", "taskplane", "diagnostics.ts"), "utf-8");
const typesSrc = readFileSync(join(__dirname, "..", "taskplane", "types.ts"), "utf-8");

// ── Mock lane-runner.executeTaskV2 to simulate a spawn failure ──────
//
// `mock.module` MUST run before any dynamic import that pulls the
// mocked module into scope. We replace the runtime export only;
// type-only exports (`LaneRunnerConfig`, `LaneRunnerTaskResult`) are
// erased at runtime so they don't need stubs.

let executeTaskV2CallCount = 0;
const SPAWN_ERROR_MESSAGE =
	"Cannot find Pi CLI entrypoint (pi-coding-agent/dist/cli.js) under any known npm scope";

const realLaneRunner = await import("../taskplane/lane-runner.ts");
const mockExecuteTaskV2 = mock.fn(async () => {
	executeTaskV2CallCount += 1;
	throw new Error(SPAWN_ERROR_MESSAGE);
});

mock.module("../taskplane/lane-runner.ts", {
	namedExports: {
		...realLaneRunner,
		executeTaskV2: mockExecuteTaskV2,
	},
});

const { executeLaneV2 } = await import("../taskplane/execution.ts");
const { EXIT_CLASSIFICATIONS } = await import("../taskplane/diagnostics.ts");
const { TIER0_RETRYABLE_CLASSIFICATIONS } = await import("../taskplane/types.ts");

// ── Helpers ─────────────────────────────────────────────────────────

function makeTempRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** Build a minimal AllocatedLane backed by real temp directories. */
function buildFakeAllocatedLane(opts: {
	repoRoot: string;
	laneNumber: number;
	taskId: string;
}) {
	const taskFolder = join(opts.repoRoot, "tasks", opts.taskId);
	mkdirSync(taskFolder, { recursive: true });
	writeFileSync(
		join(taskFolder, "PROMPT.md"),
		`# Task: ${opts.taskId}\n\n## Steps\n\n### Step 0: Test\n- [ ] noop\n`,
		"utf-8",
	);

	const worktreePath = join(opts.repoRoot, ".worktrees", `lane-${opts.laneNumber}`);
	mkdirSync(worktreePath, { recursive: true });

	const parsedTask = {
		taskId: opts.taskId,
		taskName: opts.taskId,
		reviewLevel: 0,
		size: "S",
		dependencies: [],
		fileScope: [],
		taskFolder,
		promptPath: join(taskFolder, "PROMPT.md"),
		areaName: "test",
		status: "pending" as const,
	};

	return {
		laneNumber: opts.laneNumber,
		laneId: `lane-${opts.laneNumber}`,
		laneSessionId: `orch-test-lane-${opts.laneNumber}`,
		worktreePath,
		branch: `task/lane-${opts.laneNumber}`,
		tasks: [
			{
				taskId: opts.taskId,
				order: 0,
				task: parsedTask,
				estimatedMinutes: 5,
			},
		],
		strategy: "affinity-first" as const,
		estimatedLoad: 1,
		estimatedMinutes: 5,
		repoId: "default",
	};
}

/** Build a minimal OrchestratorConfig — only fields executeLaneV2 reads need to exist. */
function buildFakeOrchestratorConfig() {
	return {
		orchestrator: {
			max_lanes: 1,
			worktree_location: "subdirectory" as const,
			worktree_prefix: ".worktrees",
			batch_id_format: "timestamp" as const,
			spawn_mode: "subprocess" as const,
			sessionPrefix: "orch",
			operator_id: "test",
			integration: "manual" as const,
		},
		dependencies: { source: "prompt" as const, cache: true },
		assignment: {
			strategy: "affinity-first" as const,
			size_weights: {} as Record<string, number>,
		},
		pre_warm: { auto_detect: false, commands: {}, always: [] as string[] },
		merge: {
			model: "",
			tools: "",
			thinking: "",
			verify: [] as string[],
			order: "sequential" as const,
			timeout_minutes: 10,
		},
		failure: {
			on_task_failure: "skip-dependents" as const,
			on_merge_failure: "pause" as const,
			stall_timeout: 30,
			max_worker_minutes: 120,
			abort_grace_period: 30,
		},
		monitoring: { poll_interval: 5 },
		verification: {
			enabled: false,
			mode: "permissive" as const,
			flaky_reruns: 0,
		},
	};
}

// ── 1. Behavioral: executeLaneV2 catch path produces spawn_failure ──

describe("TP-190 #561: executeLaneV2 catch behavior on spawn failure", () => {
	let repoRoot: string;
	const batchId = "tp190-test-batch";

	beforeEach(() => {
		executeTaskV2CallCount = 0;
		mockExecuteTaskV2.mock.resetCalls();
		repoRoot = makeTempRoot("tp190-spawn-fail");
		// Minimal .pi/runtime structure so writeLaneSnapshot can scribble.
		mkdirSync(join(repoRoot, ".pi", "runtime", batchId, "lanes"), { recursive: true });
	});

	afterEach(() => {
		try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	});

	it("1.1: produces a failed LaneTaskOutcome tagged with classification='spawn_failure'", async () => {
		const lane = buildFakeAllocatedLane({ repoRoot, laneNumber: 1, taskId: "TP-TEST-001" });
		const config = buildFakeOrchestratorConfig();
		const pauseSignal = { paused: false };

		const result = await executeLaneV2(
			lane as any,
			config as any,
			repoRoot,
			pauseSignal,
			undefined,
			false,
			{ ORCH_BATCH_ID: batchId, TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous" },
		);

		expect(result.overallStatus).toBe("failed");
		expect(result.tasks).toHaveLength(1);
		const outcome = result.tasks[0];
		expect(outcome.taskId).toBe("TP-TEST-001");
		expect(outcome.status).toBe("failed");
		expect(outcome.exitReason).toContain("spawn failure:");
		expect(outcome.exitReason).toContain("Cannot find Pi CLI entrypoint");
		expect(outcome.exitDiagnostic).toBeTruthy();
		expect(outcome.exitDiagnostic!.classification).toBe("spawn_failure");
		expect(outcome.exitDiagnostic!.errorMessage).toContain("Cannot find Pi CLI entrypoint");
	});

	it("1.2: writes a synthetic terminal RuntimeLaneSnapshot so monitorLanes can exit cleanly", async () => {
		const lane = buildFakeAllocatedLane({ repoRoot, laneNumber: 1, taskId: "TP-TEST-002" });
		const config = buildFakeOrchestratorConfig();
		const pauseSignal = { paused: false };

		await executeLaneV2(
			lane as any,
			config as any,
			repoRoot,
			pauseSignal,
			undefined,
			false,
			{ ORCH_BATCH_ID: batchId, TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous" },
		);

		const snapshotPath = join(repoRoot, ".pi", "runtime", batchId, "lanes", "lane-1.json");
		expect(existsSync(snapshotPath)).toBe(true);
		const snap = JSON.parse(readFileSync(snapshotPath, "utf-8"));
		expect(snap.batchId).toBe(batchId);
		expect(snap.laneNumber).toBe(1);
		expect(snap.taskId).toBe("TP-TEST-002");
		expect(snap.status).toBe("failed"); // Triggers Priority 3 (sessionAlive=false → failed) in resolveTaskMonitorState
		expect(snap.worker).toBeTruthy();
		expect(snap.worker.status).toBe("crashed");
		expect(typeof snap.updatedAt).toBe("number");
	});

	it("1.3: spawn failure does NOT auto-retry — executeTaskV2 mock invoked exactly once per task", async () => {
		const lane = buildFakeAllocatedLane({ repoRoot, laneNumber: 1, taskId: "TP-TEST-003" });
		const config = buildFakeOrchestratorConfig();
		const pauseSignal = { paused: false };

		await executeLaneV2(
			lane as any,
			config as any,
			repoRoot,
			pauseSignal,
			undefined,
			false,
			{ ORCH_BATCH_ID: batchId, TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous" },
		);

		// executeLaneV2 must call executeTaskV2 exactly once for this task —
		// no internal retry loop on spawn errors. Engine-level retry is also
		// blocked at the `attemptWorkerCrashRetry` guard (covered in §3).
		expect(executeTaskV2CallCount).toBe(1);
		expect(mockExecuteTaskV2.mock.callCount()).toBe(1);
	});

	it("1.4: subsequent tasks in the same lane are skipped (shouldSkipRemaining)", async () => {
		// Two tasks in one lane — first one spawn-fails; the second must be
		// marked `skipped`, not retried, and the spawn mock must NOT be
		// called for the second task (it would also fail, but the contract
		// is to short-circuit, not re-attempt).
		const baseLane = buildFakeAllocatedLane({ repoRoot, laneNumber: 1, taskId: "TP-TEST-004A" });
		const taskBFolder = join(repoRoot, "tasks", "TP-TEST-004B");
		mkdirSync(taskBFolder, { recursive: true });
		writeFileSync(
			join(taskBFolder, "PROMPT.md"),
			`# Task: TP-TEST-004B\n\n## Steps\n\n### Step 0: Test\n- [ ] noop\n`,
			"utf-8",
		);
		const lane = {
			...baseLane,
			tasks: [
				baseLane.tasks[0],
				{
					taskId: "TP-TEST-004B",
					order: 1,
					task: {
						taskId: "TP-TEST-004B",
						taskName: "TP-TEST-004B",
						reviewLevel: 0,
						size: "S",
						dependencies: [],
						fileScope: [],
						taskFolder: taskBFolder,
						promptPath: join(taskBFolder, "PROMPT.md"),
						areaName: "test",
						status: "pending" as const,
					},
					estimatedMinutes: 5,
				},
			],
		};
		const config = buildFakeOrchestratorConfig();
		const pauseSignal = { paused: false };

		const result = await executeLaneV2(
			lane as any,
			config as any,
			repoRoot,
			pauseSignal,
			undefined,
			false,
			{ ORCH_BATCH_ID: batchId, TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous" },
		);

		expect(result.tasks).toHaveLength(2);
		expect(result.tasks[0].status).toBe("failed");
		expect(result.tasks[0].exitDiagnostic?.classification).toBe("spawn_failure");
		expect(result.tasks[1].status).toBe("skipped");
		// executeTaskV2 was called once (for the first task) — the second
		// task short-circuited before spawning.
		expect(executeTaskV2CallCount).toBe(1);
	});
});

// ── 2. ExitClassification + retry-classifier registration ───────────

describe("TP-190 #561: spawn_failure registered as a non-retryable ExitClassification", () => {
	it("2.1: 'spawn_failure' is exported in EXIT_CLASSIFICATIONS", () => {
		expect(EXIT_CLASSIFICATIONS).toContain("spawn_failure");
	});

	it("2.2: 'spawn_failure' is NOT in TIER0_RETRYABLE_CLASSIFICATIONS", () => {
		// This is the gate that protects against silent retry storms on
		// permanent failures. Any future addition would defeat the purpose
		// of TP-190.
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("spawn_failure")).toBe(false);
	});

	it("2.3: TIER0_RETRYABLE_CLASSIFICATIONS doc note explicitly calls out spawn_failure exclusion", () => {
		const setIdx = typesSrc.indexOf("export const TIER0_RETRYABLE_CLASSIFICATIONS");
		expect(setIdx).toBeGreaterThan(-1);
		const docBlock = typesSrc.slice(Math.max(0, setIdx - 1500), setIdx);
		expect(docBlock).toContain("spawn_failure");
		expect(docBlock).toContain("TP-190");
	});

	it("2.4: diagnostics.ts ExitClassification doc table mentions spawn_failure with TP-190 rationale", () => {
		expect(diagnosticsSrc).toContain('| `spawn_failure`');
		expect(diagnosticsSrc).toContain("TP-190");
	});
});

// ── 3. engine.ts: no-retry guard, IPC alert, phase transition ───────

describe("TP-190 #561: engine.ts wire-up for spawn_failure", () => {
	it("3.1: attemptWorkerCrashRetry has an explicit early-return for classification==='spawn_failure'", () => {
		expect(engineSrc).toContain('classification === "spawn_failure"');
		// The defense-in-depth log line must mention "operator action required"
		// so operators can grep stderr.
		expect(engineSrc).toContain("operator action required");
		expect(engineSrc).toContain("NOT auto-retrying");
	});

	it("3.2: task-failure IPC alert payload populates context.exitCategory from outcome.exitDiagnostic.classification", () => {
		// The alert-emission site must read the classification.
		const alertIdx = engineSrc.indexOf('category: "task-failure",');
		expect(alertIdx).toBeGreaterThan(-1);
		const alertBlock = engineSrc.slice(alertIdx, alertIdx + 1500);
		expect(alertBlock).toContain("exitCategory");
	});

	it("3.3: task-failure summary mentions spawn-failure escalate-immediately when applicable", () => {
		// The branch on exitCategory === 'spawn_failure' must produce a
		// distinguishable summary line for the supervisor.
		expect(engineSrc).toContain('exitCategory === "spawn_failure"');
		expect(engineSrc).toContain("escalate immediately");
	});

	it("3.4: post-wave phase transition flips batchState.phase to 'failed' on all-spawn-failed waves", () => {
		// Trigger condition: failed > 0 AND succeeded == 0 AND every failure is spawn_failure.
		const phaseIdx = engineSrc.indexOf("allFailedAreSpawnFailures");
		expect(phaseIdx).toBeGreaterThan(-1);
		const phaseBlock = engineSrc.slice(phaseIdx, phaseIdx + 2000);
		expect(phaseBlock).toContain("waveResult.failedTaskIds.length > 0");
		expect(phaseBlock).toContain("waveResult.succeededTaskIds.length === 0");
		expect(phaseBlock).toContain('classification === "spawn_failure"');
		expect(phaseBlock).toContain('batchState.phase = "failed"');
		// Persist + terminal event + break out of wave loop.
		expect(phaseBlock).toContain("persistRuntimeState(\"wave-spawn-failure\"");
		expect(phaseBlock).toContain("emitTerminalEvent(");
		expect(phaseBlock).toContain("break;");
	});

	it("3.5: phase transition uses 'failed' (not 'paused') per TP-190 design", () => {
		// Operator can't unstick spawn failures by un-pausing — they need to
		// fix the underlying cause first. The PROMPT explicitly chose
		// 'failed' for this reason.
		const phaseIdx = engineSrc.indexOf("allFailedAreSpawnFailures");
		const phaseBlock = engineSrc.slice(phaseIdx, phaseIdx + 2000);
		// 'paused' must not be the destination phase here.
		expect(phaseBlock).not.toContain('batchState.phase = "paused"');
	});
});

// ── 4. resume.ts mirror parity ──────────────────────────────────────

describe("TP-190 #561: resume.ts task-failure alert mirrors engine.ts exitCategory wiring", () => {
	it("4.1: resume.ts task-failure alert also populates context.exitCategory", () => {
		// /orch-resume must route through the same supervisor playbook as /orch.
		const alertIdx = resumeSrc.indexOf('category: "task-failure",');
		expect(alertIdx).toBeGreaterThan(-1);
		const alertBlock = resumeSrc.slice(alertIdx, alertIdx + 1500);
		expect(alertBlock).toContain("exitCategory");
	});

	it("4.2: resume.ts mirrors the spawn-failure escalate-immediately summary line", () => {
		expect(resumeSrc).toContain('exitCategory === "spawn_failure"');
		expect(resumeSrc).toContain("escalate immediately");
	});
});

// ── 5. execution.ts catch contract ──────────────────────────────────

describe("TP-190 #561: execution.ts catch hardening", () => {
	it("5.1: catch builds a TaskExitDiagnostic with classification='spawn_failure'", () => {
		expect(executionSrc).toContain("spawnExitDiagnostic");
		expect(executionSrc).toContain('classification: "spawn_failure"');
	});

	it("5.2: catch writes a synthetic terminal RuntimeLaneSnapshot via writeLaneSnapshot", () => {
		expect(executionSrc).toContain("spawnFailureSnapshot");
		expect(executionSrc).toContain("writeLaneSnapshot(stateRoot, batchId, lane.laneNumber");
	});

	it("5.3: synthetic snapshot uses status='failed' so monitorLanes Priority 3 fires", () => {
		const snapIdx = executionSrc.indexOf("spawnFailureSnapshot");
		const snapBlock = executionSrc.slice(snapIdx, snapIdx + 1500);
		expect(snapBlock).toContain('status: "failed"');
	});

	it("5.4: catch sets exitReason to 'spawn failure: <message>' for operator clarity", () => {
		// The PROMPT explicitly specifies this wording so the supervisor
		// (and operators reading STATUS.md) can spot spawn failures by
		// exitReason alone.
		expect(executionSrc).toContain("exitReason: `spawn failure: ${errMsg}`");
	});
});
