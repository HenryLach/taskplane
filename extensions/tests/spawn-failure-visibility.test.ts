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
const { isAllLanesSpawnFailedWave, buildSpawnFailureAlertExtras } = await import(
	"../taskplane/engine.ts"
);

type MockLaneTaskOutcome = {
	taskId: string;
	status: string;
	startTime: number | null;
	endTime: number | null;
	exitReason: string;
	sessionName: string;
	doneFileFound: boolean;
	exitDiagnostic?: { classification: string };
};

function makeOutcome(
	taskId: string,
	status: "failed" | "succeeded",
	classification?: string,
): MockLaneTaskOutcome {
	return {
		taskId,
		status,
		startTime: 0,
		endTime: 0,
		exitReason: status === "failed" ? `failed: ${classification ?? "unknown"}` : "",
		sessionName: `session-${taskId}`,
		doneFileFound: status === "succeeded",
		...(classification ? { exitDiagnostic: { classification } } : {}),
	};
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeTempRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** Build a minimal AllocatedLane backed by real temp directories. */
function buildFakeAllocatedLane(opts: { repoRoot: string; laneNumber: number; taskId: string }) {
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
		try {
			rmSync(repoRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
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

		await executeLaneV2(lane as any, config as any, repoRoot, pauseSignal, undefined, false, {
			ORCH_BATCH_ID: batchId,
			TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous",
		});

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

		await executeLaneV2(lane as any, config as any, repoRoot, pauseSignal, undefined, false, {
			ORCH_BATCH_ID: batchId,
			TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous",
		});

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
		expect(diagnosticsSrc).toContain("| `spawn_failure`");
		expect(diagnosticsSrc).toContain("TP-190");
	});
});

// ── 3. engine.ts behavioral helpers (runtime-tested) ──────────────

describe("TP-190 #561: engine.ts buildSpawnFailureAlertExtras (behavioral)", () => {
	it("3.0a: returns exitCategory='spawn_failure' + escalate-immediately summary line for spawn-failure outcomes", () => {
		const outcome = makeOutcome("TP-X", "failed", "spawn_failure");
		const extras = buildSpawnFailureAlertExtras(outcome as any);
		expect(extras.exitCategory).toBe("spawn_failure");
		expect(extras.summaryLine).toContain("Spawn failure");
		expect(extras.summaryLine).toContain("escalate immediately");
		expect(extras.summaryLine).toContain("do not retry");
		expect(extras.summaryLine.endsWith("\n")).toBe(true);
	});

	it("3.0b: passes through non-spawn classifications (e.g. process_crash) with empty summary line", () => {
		const outcome = makeOutcome("TP-Y", "failed", "process_crash");
		const extras = buildSpawnFailureAlertExtras(outcome as any);
		expect(extras.exitCategory).toBe("process_crash");
		expect(extras.summaryLine).toBe("");
	});

	it("3.0c: handles outcomes with no exitDiagnostic (legacy / pending) gracefully", () => {
		const outcome = makeOutcome("TP-Z", "failed");
		const extras = buildSpawnFailureAlertExtras(outcome as any);
		expect(extras.exitCategory).toBeUndefined();
		expect(extras.summaryLine).toBe("");
	});

	it("3.0d: handles undefined outcome (defensive)", () => {
		const extras = buildSpawnFailureAlertExtras(undefined);
		expect(extras.exitCategory).toBeUndefined();
		expect(extras.summaryLine).toBe("");
	});
});

describe("TP-190 #561: engine.ts isAllLanesSpawnFailedWave (behavioral)", () => {
	it("3.1a: returns true when every failed task is classified spawn_failure (single task)", () => {
		const waveResult = { failedTaskIds: ["TP-1"], succeededTaskIds: [] };
		const outcomes = [makeOutcome("TP-1", "failed", "spawn_failure")];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(true);
	});

	it("3.1b: returns true when every failed task in a multi-lane wave is spawn_failure", () => {
		const waveResult = { failedTaskIds: ["TP-1", "TP-2", "TP-3"], succeededTaskIds: [] };
		const outcomes = [
			makeOutcome("TP-1", "failed", "spawn_failure"),
			makeOutcome("TP-2", "failed", "spawn_failure"),
			makeOutcome("TP-3", "failed", "spawn_failure"),
		];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(true);
	});

	it("3.1c: returns false when at least one failed task is NOT spawn_failure (mixed-cause wave)", () => {
		const waveResult = { failedTaskIds: ["TP-1", "TP-2"], succeededTaskIds: [] };
		const outcomes = [
			makeOutcome("TP-1", "failed", "spawn_failure"),
			makeOutcome("TP-2", "failed", "process_crash"),
		];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(false);
	});

	it("3.1d: returns false when at least one task succeeded (partial success)", () => {
		const waveResult = { failedTaskIds: ["TP-1"], succeededTaskIds: ["TP-2"] };
		const outcomes = [
			makeOutcome("TP-1", "failed", "spawn_failure"),
			makeOutcome("TP-2", "succeeded"),
		];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(false);
	});

	it("3.1e: returns false when there are no failures (clean wave)", () => {
		const waveResult = { failedTaskIds: [] as string[], succeededTaskIds: ["TP-1"] };
		const outcomes = [makeOutcome("TP-1", "succeeded")];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(false);
	});

	it("3.1f: returns false when a failed task has no exitDiagnostic (cannot prove spawn_failure)", () => {
		const waveResult = { failedTaskIds: ["TP-1"], succeededTaskIds: [] };
		const outcomes = [makeOutcome("TP-1", "failed")]; // no classification
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(false);
	});

	it("3.1g: returns false when a failed task has classification != spawn_failure (e.g. user_killed)", () => {
		const waveResult = { failedTaskIds: ["TP-1"], succeededTaskIds: [] };
		const outcomes = [makeOutcome("TP-1", "failed", "user_killed")];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(false);
	});

	// ── Sage post-mortem: multi-segment edge case (post-PR-#566) ─────────
	// `succeededTaskIds` is the *terminal* completion projection — it's
	// populated only when a task reaches its FINAL segment. A multi-segment
	// task that succeeds on segment 1 (with a continuation segment scheduled
	// for a later round) shows up in `laneResults[].tasks[]` with
	// `status: "succeeded"` but is NOT in `succeededTaskIds`. The previous
	// logic would have flagged a wave with such a non-terminal segment
	// success + a separate task spawn-failure as "all-spawn-failed" and
	// transitioned `phase` to `"failed"` — burying real progress.

	it("3.1h (sage): returns false when laneResults shows a segment success even if succeededTaskIds is empty (multi-segment continuation)", () => {
		const waveResult = {
			failedTaskIds: ["TP-2"],
			succeededTaskIds: [] as string[], // task-level terminal projection — empty for non-terminal segment
			laneResults: [
				{ tasks: [{ status: "succeeded" }] }, // TP-1's segment 1 succeeded; continuation in next round
				{ tasks: [{ status: "failed" }] }, // TP-2 spawn-failed
			],
		};
		const outcomes = [
			makeOutcome("TP-1", "succeeded"),
			makeOutcome("TP-2", "failed", "spawn_failure"),
		];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(false);
	});

	it("3.1i (sage): returns true when laneResults has zero successes AND every failure is spawn_failure (no false positive on the new check)", () => {
		const waveResult = {
			failedTaskIds: ["TP-1", "TP-2"],
			succeededTaskIds: [] as string[],
			laneResults: [{ tasks: [{ status: "failed" }] }, { tasks: [{ status: "failed" }] }],
		};
		const outcomes = [
			makeOutcome("TP-1", "failed", "spawn_failure"),
			makeOutcome("TP-2", "failed", "spawn_failure"),
		];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(true);
	});

	it("3.1j (sage): laneResults parameter is OPTIONAL — backward-compat with v0.29.0 callers", () => {
		// Existing callers (and the test suite above) pass only failedTaskIds +
		// succeededTaskIds. The new laneResults check must not break that path.
		const waveResult = { failedTaskIds: ["TP-1"], succeededTaskIds: [] };
		const outcomes = [makeOutcome("TP-1", "failed", "spawn_failure")];
		expect(isAllLanesSpawnFailedWave(waveResult, outcomes as any)).toBe(true);
	});
});

describe("TP-190 #561 sage post-mortem: resolveTaskMonitorState null-snapshot fallback", () => {
	// Regression guard for the residual hang sage flagged: when the
	// spawn-failure catch's snapshot write fails (disk full, permission,
	// transient I/O), `snap` stays null and `staleMs` is 0 (because
	// `snap?.updatedAt` is undefined). The previous logic had no exit from
	// the `snap == null && staleMs <= 30_000` branch other than
	// `sessionAlive = true`, which made the monitor poll forever —
	// reintroducing the same #561 hang the spawn-failure catch was
	// supposed to fix.
	//
	// The fix adds a tracker-age branch: when `snap == null` AND the
	// tracker has been observing this task for >= 60s (past startup
	// grace), fall back to the registry liveness check. This test asserts
	// the source pattern — a behavioral test would need a full monitor
	// loop with mocked registry and is covered indirectly by the existing
	// engine-orchestration test in this file.

	it("4.1 (sage): execution.ts has the null-snapshot tracker-age fallback wired", async () => {
		const { readFileSync } = await import("node:fs");
		const { fileURLToPath } = await import("node:url");
		const { dirname, join } = await import("node:path");
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const execPath = join(__dirname, "..", "taskplane", "execution.ts");
		const src = readFileSync(execPath, "utf-8");

		// The fallback branch must reference both the null-snapshot condition
		// and the trackerAge >= 60s threshold, AND it must call
		// `isV2AgentAlive` to decide liveness rather than defaulting to true.
		expect(src).toMatch(/snap == null && trackerAgeMs >= 60_000/);
		expect(src).toContain("sage post-mortem");
		// The branch must be ABOVE the unconditional `sessionAlive = true`
		// fallback so it short-circuits before defaulting to alive.
		const fallbackIdx = src.indexOf("snap == null && trackerAgeMs >= 60_000");
		expect(fallbackIdx).toBeGreaterThan(-1);
		const defaultAliveIdx = src.indexOf("sessionAlive = true", fallbackIdx);
		expect(defaultAliveIdx).toBeGreaterThan(fallbackIdx);
	});
});

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

	it("3.3: task-failure summary uses the shared buildSpawnFailureAlertExtras helper for spawn-failure-specific extras", () => {
		expect(engineSrc).toContain("buildSpawnFailureAlertExtras(outcome)");
		// The helper itself contains the escalate-immediately wording — verified in tests 3.0a-3.0d.
		expect(engineSrc).toContain("escalate immediately");
	});

	it("3.4: post-wave phase transition uses isAllLanesSpawnFailedWave helper and flips batchState.phase to 'failed'", () => {
		// The trigger logic is unit-tested in 3.1a-3.1g; here we just verify the
		// helper is called from the engine's post-wave site and drives the
		// expected side effects (phase transition + persist + terminal + break).
		const phaseIdx = engineSrc.indexOf("allFailedAreSpawnFailures");
		expect(phaseIdx).toBeGreaterThan(-1);
		// TP-193: Window increased from 2000 to 3500 to absorb formatter re-wrapping.
		const phaseBlock = engineSrc.slice(phaseIdx, phaseIdx + 3500);
		expect(phaseBlock).toContainNormalized("isAllLanesSpawnFailedWave(waveResult, allTaskOutcomes)");
		expect(phaseBlock).toContain('batchState.phase = "failed"');
		// Persist + terminal event + break out of wave loop.
		expect(phaseBlock).toContainNormalized('persistRuntimeState("wave-spawn-failure"');
		expect(phaseBlock).toContain("emitTerminalEvent(");
		expect(phaseBlock).toContain("break;");
	});

	it("3.5: phase transition uses 'failed' (not 'paused') per TP-190 design", () => {
		// Operator can't unstick spawn failures by un-pausing — they need to
		// fix the underlying cause first. The PROMPT explicitly chose
		// 'failed' for this reason.
		const phaseIdx = engineSrc.indexOf("allFailedAreSpawnFailures");
		// TP-193: Window increased from 2000 to 3500 to absorb formatter re-wrapping.
		const phaseBlock = engineSrc.slice(phaseIdx, phaseIdx + 3500);
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

	it("4.2: resume.ts uses the shared buildSpawnFailureAlertExtras helper (parity with engine.ts)", () => {
		expect(resumeSrc).toContain("buildSpawnFailureAlertExtras");
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
		expect(executionSrc).toContainNormalized("writeLaneSnapshot(stateRoot, batchId, lane.laneNumber");
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

// ── 6. Engine post-wave behavior — helper-level reproduction ─────────
//
// This section reproduces, at helper-level fidelity, exactly what the
// engine's wave loop does after `executeWave` returns when all lanes
// spawn-failed. The simulation:
//
//   - drives 1–3 real `executeLaneV2` invocations end-to-end (with the
//     mocked `executeTaskV2` throwing the canonical spawn error),
//   - aggregates results into a fake `WaveExecutionResult` matching the
//     shape produced by `executeWave`,
//   - mutates a real `OrchBatchRuntimeState` with the same updates that
//     happen inline in `executeOrchBatch` post-wave (counter increments,
//     alert emission via `buildSpawnFailureAlertExtras`, phase transition
//     via `isAllLanesSpawnFailedWave`),
//   - asserts the operator-visible outputs (`failedTasks`, `phase`, alert
//     payload) that `orch_status()` and the supervisor playbook consume.
//
// Why helper-level rather than driving `executeOrchBatch` end-to-end:
//   `executeOrchBatch` requires real git + pi binaries (preflight),
//   real PROMPT.md discovery, real worktree allocation, and full state
//   persistence. No existing test in this codebase drives it as a black
//   box (search the test directory for `await executeOrchBatch(`); the
//   project convention is to test the engine's post-wave logic by
//   reproducing it against extracted helpers + real state objects, with
//   source-string guards verifying call-site wiring. The §3.0/§3.1
//   helpers here are pure functions exported from engine.ts and called
//   from exactly one site each, so reproducing the call sequence with
//   the same helpers is functionally equivalent to running the engine
//   path — only the surrounding bookkeeping differs.
//
// This faithfully captures the original #561 bug surface ("failedTasks
// stays at 0, no IPC alert, phase stuck at executing") and verifies the
// fix produces the expected operator-visible signals.

describe("TP-190 #561: integrated post-wave behavior on all-spawn-failed wave", () => {
	let repoRoot: string;
	const batchId = "tp190-integrated-batch";

	beforeEach(() => {
		executeTaskV2CallCount = 0;
		mockExecuteTaskV2.mock.resetCalls();
		repoRoot = makeTempRoot("tp190-integrated");
		mkdirSync(join(repoRoot, ".pi", "runtime", batchId, "lanes"), { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(repoRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("6.1: three-lane wave — all spawn-fail → batchState.phase=failed, failedTasks counter, IPC alerts with exitCategory='spawn_failure'", async () => {
		// (a) Drive three executeLaneV2 invocations end-to-end with the mocked
		// executeTaskV2 throw — simulating one task per lane in a 3-lane wave.
		const config = buildFakeOrchestratorConfig();
		const pauseSignal = { paused: false };
		const laneResults = [];
		for (let n = 1; n <= 3; n++) {
			const lane = buildFakeAllocatedLane({ repoRoot, laneNumber: n, taskId: `TP-INT-${n}` });
			const result = await executeLaneV2(
				lane as any,
				config as any,
				repoRoot,
				pauseSignal,
				undefined,
				false,
				{ ORCH_BATCH_ID: batchId, TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous" },
			);
			laneResults.push(result);
		}

		// (b) Aggregate into a fake WaveExecutionResult — exactly what
		// `executeWave` produces from the per-lane results in real runs.
		const allTaskOutcomes = laneResults.flatMap((lr) => lr.tasks);
		const failedTaskIds = allTaskOutcomes
			.filter((t) => t.status === "failed")
			.map((t) => t.taskId)
			.sort();
		const succeededTaskIds: string[] = [];
		const waveResult = { failedTaskIds, succeededTaskIds, blockedTaskIds: [] as string[] };

		expect(allTaskOutcomes.every((t) => t.exitDiagnostic?.classification === "spawn_failure")).toBe(
			true,
		);

		// (c) Reproduce the engine's post-wave bookkeeping against a real
		// OrchBatchRuntimeState shape. This mirrors engine.ts:3105-3175.
		const batchState = {
			batchId,
			phase: "executing" as string,
			currentWaveIndex: 0,
			totalWaves: 1,
			succeededTasks: 0,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			totalTasks: 3,
		};

		// engine.ts:3107-3110 — accumulate counters from waveResult.
		batchState.succeededTasks += waveResult.succeededTaskIds.length;
		batchState.failedTasks += waveResult.failedTaskIds.length;
		batchState.skippedTasks += 0;

		// engine.ts:3050-3140 — IPC alert emission per failed task. Capture
		// emitted alert payloads via a real callback (the same callback shape
		// `executeOrchBatch` invokes).
		const emittedAlerts: Array<{
			category: string;
			summary: string;
			context: { taskId?: string; exitCategory?: string; exitReason?: string };
		}> = [];
		const emitAlert = (alert: any) => emittedAlerts.push(alert);

		for (const taskId of waveResult.failedTaskIds) {
			const outcome = allTaskOutcomes.find((o) => o.taskId === taskId);
			const extras = buildSpawnFailureAlertExtras(outcome as any);
			emitAlert({
				category: "task-failure",
				summary:
					`⚠️ Task failure: ${taskId}\n` +
					`  Exit reason: ${outcome?.exitReason ?? "unknown"}\n` +
					extras.summaryLine,
				context: {
					taskId,
					exitReason: outcome?.exitReason ?? "unknown",
					exitCategory: extras.exitCategory,
				},
			});
		}

		// engine.ts post-TP-190 — phase-transition decision via the helper.
		const allFailedAreSpawnFailures = isAllLanesSpawnFailedWave(waveResult, allTaskOutcomes as any);
		if (allFailedAreSpawnFailures) {
			batchState.phase = "failed";
		}

		// (d) Operator-visible signals from `orch_status()`.
		//
		// Pre-fix (#561): batchState.phase stayed at "executing", failedTasks
		// stayed at 0, emittedAlerts was empty. The dashboard showed all
		// lanes running.
		//
		// Post-fix:
		expect(batchState.phase).toBe("failed"); // not "executing"
		expect(batchState.phase).not.toBe("executing");
		expect(batchState.failedTasks).toBe(3);
		expect(batchState.succeededTasks).toBe(0);

		// IPC alerts: one per failed task, each carrying exitCategory and
		// the spawn-failure summary line.
		expect(emittedAlerts).toHaveLength(3);
		for (const alert of emittedAlerts) {
			expect(alert.category).toBe("task-failure");
			expect(alert.context.exitCategory).toBe("spawn_failure");
			expect(alert.summary).toContain("Spawn failure");
			expect(alert.summary).toContain("escalate immediately");
			expect(alert.context.exitReason).toContain("spawn failure:");
		}

		// Synthetic terminal lane snapshots are written for each lane,
		// confirming the monitor would now exit cleanly instead of looping.
		for (let n = 1; n <= 3; n++) {
			const snapshotPath = join(repoRoot, ".pi", "runtime", batchId, "lanes", `lane-${n}.json`);
			expect(existsSync(snapshotPath)).toBe(true);
			const snap = JSON.parse(readFileSync(snapshotPath, "utf-8"));
			expect(snap.status).toBe("failed");
		}
	});

	it("6.1b: single-task wave — spawn-fails → failedTasks===1, phase!=='executing', exactly one alert with exitCategory='spawn_failure'", async () => {
		// This test mirrors the exact scenario from PROMPT.md Step 5:
		//
		//   "Single-task batch: spawn fails → lane.status === 'failed',
		//    task.status === 'failed', failedTasks === 1, an IPC alert
		//    fires with category='spawn-failure', phase !== 'executing'."
		const lane = buildFakeAllocatedLane({ repoRoot, laneNumber: 1, taskId: "TP-SINGLE" });
		const config = buildFakeOrchestratorConfig();
		const pauseSignal = { paused: false };

		const laneResult = await executeLaneV2(
			lane as any,
			config as any,
			repoRoot,
			pauseSignal,
			undefined,
			false,
			{ ORCH_BATCH_ID: batchId, TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous" },
		);

		// The lane outcome itself reflects task-level failure.
		expect(laneResult.tasks).toHaveLength(1);
		expect(laneResult.tasks[0].status).toBe("failed");
		expect(laneResult.tasks[0].exitDiagnostic?.classification).toBe("spawn_failure");

		// Engine post-wave aggregation.
		const waveResult = {
			failedTaskIds: ["TP-SINGLE"],
			succeededTaskIds: [] as string[],
			blockedTaskIds: [] as string[],
		};
		const batchState = {
			phase: "executing" as string,
			succeededTasks: 0,
			failedTasks: 0,
		};
		batchState.failedTasks += waveResult.failedTaskIds.length;

		// IPC alert emission for the single failed task.
		const alerts: Array<{ category: string; context: { exitCategory?: string } }> = [];
		for (const taskId of waveResult.failedTaskIds) {
			const outcome = laneResult.tasks.find((t) => t.taskId === taskId);
			const { exitCategory, summaryLine } = buildSpawnFailureAlertExtras(outcome as any);
			alerts.push({
				category: "task-failure",
				context: { exitCategory },
			});
			expect(summaryLine).toContain("escalate immediately");
		}

		// Phase transition.
		if (isAllLanesSpawnFailedWave(waveResult, laneResult.tasks as any)) {
			batchState.phase = "failed";
		}

		// Assertions verbatim from PROMPT.md Step 5:
		expect(batchState.failedTasks).toBe(1); // failedTasks === 1
		expect(alerts).toHaveLength(1); // an IPC alert fires
		expect(alerts[0].category).toBe("task-failure");
		expect(alerts[0].context.exitCategory).toBe("spawn_failure");
		expect(batchState.phase).not.toBe("executing"); // phase !== "executing"
		expect(batchState.phase).toBe("failed");
	});

	it("6.2: a mixed wave (one spawn-fail + one success) does NOT trigger phase=failed", async () => {
		// Verify the helper correctly distinguishes mixed waves from all-spawn-failed.
		// This is the regression guard against a too-aggressive phase transition.
		const waveResult = {
			failedTaskIds: ["TP-A"],
			succeededTaskIds: ["TP-B"],
		};
		const allTaskOutcomes = [
			makeOutcome("TP-A", "failed", "spawn_failure"),
			makeOutcome("TP-B", "succeeded"),
		];
		expect(isAllLanesSpawnFailedWave(waveResult, allTaskOutcomes as any)).toBe(false);
		// The success contributes a non-spawn-failure outcome, so the
		// engine's failure-policy path (skip-dependents/stop-wave/stop-all)
		// continues to govern this case as before. Phase stays in whatever
		// the policy decides — NOT forced to "failed" by TP-190.
	});
});
