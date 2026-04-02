/**
 * Task-Runner RPC Integration Verification — TP-026 Step 4
 *
 * End-to-end verification tests that close the full TP-026 contract:
 *   1 — Workspace-mode sidecar path (ORCH_SIDECAR_DIR → telemetry dir)
 *   2 — /orch subprocess path non-regression (spawnAgent unchanged, execution.ts unmodified)
 *   3 — exitDiagnostic persistence/resume full round-trip
 *
 * Test matrix:
 *   rpc-wrapper.test.ts           → command generation, sidecar JSONL writing, exit summary building
 *   sidecar-tailing.test.ts       → incremental byte-offset reads, retry state, partial lines, poll sim
 *   task-runner-exit-diagnostic.ts → readExitSummary, buildExitDiagnostic, persistence validation
 *   THIS FILE                     → workspace path, /orch guardrail, resume propagation
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/task-runner-rpc-integration.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

// ── 1. Workspace-mode sidecar path ──────────────────────────────────


const __dirname = dirname(fileURLToPath(import.meta.url));
describe("workspace-mode sidecar path", () => {
	let origEnv: string | undefined;
	let tmpDir: string;

	beforeEach(() => {
		origEnv = process.env.ORCH_SIDECAR_DIR;
		tmpDir = join(tmpdir(), `tp026-ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		if (origEnv === undefined) {
			delete process.env.ORCH_SIDECAR_DIR;
		} else {
			process.env.ORCH_SIDECAR_DIR = origEnv;
		}
		try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
	});

	it("getSidecarDir returns ORCH_SIDECAR_DIR when set", async () => {
		const sidecarDir = join(tmpDir, "shared-pi");
		mkdirSync(sidecarDir, { recursive: true });
		process.env.ORCH_SIDECAR_DIR = sidecarDir;

		// Dynamic import to get the function with current env
		const { _getSidecarDir } = await import("../task-runner.ts");
		const result = _getSidecarDir();
		expect(result).toBe(sidecarDir);
	});

	it("getSidecarDir creates ORCH_SIDECAR_DIR directory if it does not exist", async () => {
		const sidecarDir = join(tmpDir, "nonexistent-pi");
		expect(existsSync(sidecarDir)).toBe(false);
		process.env.ORCH_SIDECAR_DIR = sidecarDir;

		const { _getSidecarDir } = await import("../task-runner.ts");
		const result = _getSidecarDir();
		expect(result).toBe(sidecarDir);
		expect(existsSync(sidecarDir)).toBe(true);
	});

	it("telemetry paths would be under getSidecarDir()/telemetry/", async () => {
		// Verify the naming contract: sidecar files go to {getSidecarDir}/telemetry/
		// This test reads the source to confirm the path construction pattern.
		const taskRunnerSrc = readFileSync(
			resolve(__dirname, "../task-runner.ts"),
			"utf-8",
		);

		// Confirm telemetry directory is derived from getSidecarDir()
		expect(taskRunnerSrc).toContain('join(getSidecarDir(), "telemetry")');

		// Confirm sidecar and exit summary paths use telemetryDir
		expect(taskRunnerSrc).toContain("join(telemetryDir, `${telemetryBasename}.jsonl`)");
		expect(taskRunnerSrc).toContain("join(telemetryDir, `${telemetryBasename}-exit.json`)");
	});
});

// ── 2. /orch subprocess path non-regression ─────────────────────────

describe("/orch subprocess path non-regression", () => {
	it("spawnAgent() still uses 'pi -p --mode json' (not rpc-wrapper)", () => {
		const src = readFileSync(
			resolve(__dirname, "../task-runner.ts"),
			"utf-8",
		);

		// Extract the spawnAgent function body (not spawnAgentTmux).
		// spawnAgent is the subprocess path used by /orch.
		// It starts at "function spawnAgent(opts:" and ends before "// ── Sidecar JSONL Tailing"
		const startIdx = src.indexOf("function spawnAgent(opts:");
		const endMarker = "// ── Sidecar JSONL Tailing";
		const endIdx = src.indexOf(endMarker, startIdx);
		expect(startIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(startIdx);

		const spawnAgentBody = src.slice(startIdx, endIdx);

		// Must use pi with -p flag and json mode (subprocess contract)
		expect(spawnAgentBody).toContain('"-p", "--mode", "json"');
		expect(spawnAgentBody).toContain('spawn("pi", args');

		// Must NOT contain rpc-wrapper references
		expect(spawnAgentBody).not.toContain("rpc-wrapper");
		expect(spawnAgentBody).not.toContain("sidecar-path");
		expect(spawnAgentBody).not.toContain("exit-summary-path");
	});

	it("spawnAgent() preserves --no-session, --no-extensions, --no-skills flags", () => {
		const src = readFileSync(
			resolve(__dirname, "../task-runner.ts"),
			"utf-8",
		);

		const startIdx = src.indexOf("function spawnAgent(opts:");
		const endMarker = "// ── Sidecar JSONL Tailing";
		const endIdx = src.indexOf(endMarker, startIdx);
		expect(startIdx).toBeGreaterThan(-1);
		expect(endIdx).toBeGreaterThan(startIdx);

		const body = src.slice(startIdx, endIdx);
		expect(body).toContain('"--no-session"');
		expect(body).toContain('"--no-extensions"');
		expect(body).toContain('"--no-skills"');
	});

	it("pollUntilTaskComplete in execution.ts has no sidecar-tailing references", () => {
		const src = readFileSync(
			resolve(__dirname, "../taskplane/execution.ts"),
			"utf-8",
		);

		// Confirm the function exists and is exported
		expect(src).toContain("export async function pollUntilTaskComplete(");

		// execution.ts now uses rpc-wrapper for spawn (TP-049) but the polling
		// loop should NOT directly tail sidecar files or build exit diagnostics.
		expect(src).not.toContain("tailSidecarJsonl");
		expect(src).not.toContain("readExitSummary");
		expect(src).not.toContain("buildExitDiagnostic");
	});

	it("spawnAgentTmux uses rpc-wrapper (tmux path only)", () => {
		const src = readFileSync(
			resolve(__dirname, "../task-runner.ts"),
			"utf-8",
		);

		// Find the spawnAgentTmux function
		const tmuxMatch = src.match(
			/function spawnAgentTmux\(opts:[\s\S]*?^}$/m,
		);
		expect(tmuxMatch).not.toBeNull();

		const tmuxBody = tmuxMatch![0];

		// tmux path MUST use rpc-wrapper
		expect(tmuxBody).toContain("resolveRpcWrapperPath()");
		expect(tmuxBody).toContain("--sidecar-path");
		expect(tmuxBody).toContain("--exit-summary-path");
		expect(tmuxBody).toContain("--prompt-file");

		// tmux path must NOT use "pi -p --mode json"
		expect(tmuxBody).not.toContain('"--mode", "json"');
	});
});

// ── 3. exitDiagnostic persistence/resume full round-trip ────────────

describe("exitDiagnostic persistence/resume full round-trip", () => {
	/**
	 * Tests the complete lifecycle:
	 *   1. Build a diagnostic via _buildExitDiagnostic
	 *   2. Insert it into a LaneTaskOutcome via upsertTaskOutcome
	 *   3. Sync it through syncTaskOutcomesFromMonitor
	 *   4. Serialize to batch state JSON
	 *   5. Validate (simulating load from disk)
	 *   6. Verify all fields survive the round-trip
	 */

	it("diagnostic survives build → upsert → sync → serialize → validate round-trip", async () => {
		const { _buildExitDiagnostic, _readExitSummary } = await import("../task-runner.ts");
		const { validatePersistedState, upsertTaskOutcome, syncTaskOutcomesFromMonitor } =
			await import("../taskplane/persistence.ts");
		const type = await import("../taskplane/types.ts");

		// Step 1: Build diagnostic
		const diag = _buildExitDiagnostic({
			exitSummary: {
				exitCode: 1,
				exitSignal: null,
				tokens: { input: 3000, output: 1500, cacheRead: 400, cacheWrite: 50 },
				cost: 0.12,
				toolCalls: 15,
				retries: [{ attempt: 1, error: "rate_limit", delayMs: 5000, succeeded: true }],
				compactions: 1,
				durationSec: 180,
				lastToolCall: "bash: npm test",
				error: "Process exited with code 1",
			},
			doneFileFound: false,
			timerKilled: false,
			contextKilled: false,
			userKilled: false,
			contextPct: 72,
			durationSec: 180,
			repoId: "my-repo",
			lastKnownStep: 3,
			lastKnownCheckbox: "run tests",
			partialProgressCommits: 2,
			partialProgressBranch: "task/TP-026",
		});

		expect(diag.classification).toBeDefined();
		expect(typeof diag.classification).toBe("string");

		// Step 2: Insert into outcome via upsertTaskOutcome
		const outcomes: any[] = [];
		const outcome = {
			taskId: "TP-026",
			status: "failed" as const,
			startTime: Date.now() - 180000,
			endTime: Date.now(),
			exitReason: "Worker crashed with exit code 1",
			sessionName: "orch-lane-1-worker",
			doneFileFound: false,
			exitDiagnostic: diag,
		};
		const changed = upsertTaskOutcome(outcomes, outcome);
		expect(changed).toBe(true);
		expect(outcomes[0].exitDiagnostic.classification).toBe(diag.classification);

		// Step 3: Sync through syncTaskOutcomesFromMonitor
		const monitor = {
			lanes: [{
				laneId: "lane-1",
				laneNumber: 1,
				sessionName: "orch-lane-1-worker",
				sessionAlive: false,
				currentTaskId: null,
				currentTaskSnapshot: null,
				completedTasks: [],
				failedTasks: ["TP-026"],
				remainingTasks: [],
			}],
			tasksDone: 0,
			tasksFailed: 1,
			tasksTotal: 1,
			waveNumber: 1,
			pollCount: 5,
			lastPollTime: Date.now(),
			allTerminal: true,
		};
		syncTaskOutcomesFromMonitor(monitor, outcomes);
		// exitDiagnostic should be preserved
		expect(outcomes[0].exitDiagnostic).toBe(diag);
		expect(outcomes[0].status).toBe("failed");

		// Step 4+5: Serialize to batch state, then validate (simulating disk round-trip)
		const batchState = {
			schemaVersion: 2,
			phase: "executing",
			batchId: "test-batch-rpc",
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: Date.now() - 200000,
			updatedAt: Date.now(),
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			totalTasks: 1,
			succeededTasks: 0,
			failedTasks: 1,
			skippedTasks: 0,
			blockedTasks: 0,
			wavePlan: [["TP-026"]],
			tasks: [{
				taskId: "TP-026",
				sessionName: "orch-lane-1-worker",
				taskFolder: "/tmp/tasks/TP-026",
				exitReason: "Worker crashed with exit code 1",
				laneNumber: 1,
				status: "failed",
				startedAt: outcomes[0].startTime,
				endedAt: outcomes[0].endTime,
				doneFileFound: false,
				exitDiagnostic: outcomes[0].exitDiagnostic,
			}],
			lanes: [{
				laneId: "lane-1",
				laneNumber: 1,
				laneSessionId: "orch-lane-1-worker",
				worktreePath: "/tmp/worktrees/lane-1",
				branch: "task/TP-026",
				taskIds: ["TP-026"],
			}],
			mergeResults: [],
			blockedTaskIds: [],
			errors: [],
			lastError: null,
		};

		// Serialize to JSON and back (disk round-trip simulation)
		const serialized = JSON.stringify(batchState);
		const deserialized = JSON.parse(serialized);

		// Validate (this is what loadState() does)
		const validated = validatePersistedState(deserialized);

		// Step 6: Verify all diagnostic fields survive
		const task = validated.tasks[0];
		expect(task.exitReason).toBe("Worker crashed with exit code 1");
		expect(task.exitDiagnostic).toBeDefined();
		expect(task.exitDiagnostic!.classification).toBe(diag.classification);
		expect(task.exitDiagnostic!.exitCode).toBe(1);
		expect(task.exitDiagnostic!.errorMessage).toBe("Process exited with code 1");
		expect(task.exitDiagnostic!.tokensUsed).toEqual({
			input: 3000, output: 1500, cacheRead: 400, cacheWrite: 50,
		});
		expect(task.exitDiagnostic!.contextPct).toBe(72);
		expect(task.exitDiagnostic!.partialProgressCommits).toBe(2);
		expect(task.exitDiagnostic!.partialProgressBranch).toBe("task/TP-026");
		expect(task.exitDiagnostic!.durationSec).toBe(180);
		expect(task.exitDiagnostic!.lastKnownStep).toBe(3);
		expect(task.exitDiagnostic!.lastKnownCheckbox).toBe("run tests");
		expect(task.exitDiagnostic!.repoId).toBe("my-repo");
	});

	it("completed task diagnostic survives round-trip with legacy exitReason coexistence", async () => {
		const { _buildExitDiagnostic } = await import("../task-runner.ts");
		const { validatePersistedState, upsertTaskOutcome, syncTaskOutcomesFromMonitor } =
			await import("../taskplane/persistence.ts");

		// Build a "completed" diagnostic
		const diag = _buildExitDiagnostic({
			exitSummary: {
				exitCode: 0,
				exitSignal: null,
				tokens: { input: 5000, output: 2500, cacheRead: 1000, cacheWrite: 200 },
				cost: 0.25,
				toolCalls: 30,
				retries: [],
				compactions: 0,
				durationSec: 300,
				lastToolCall: "write: STATUS.md",
				error: null,
			},
			doneFileFound: true,
			timerKilled: false,
			contextKilled: false,
			userKilled: false,
			contextPct: 45,
			durationSec: 300,
			repoId: "default",
			lastKnownStep: 5,
			lastKnownCheckbox: null,
			partialProgressCommits: 0,
			partialProgressBranch: null,
		});

		expect(diag.classification).toBe("completed");

		// Simulate full persistence round-trip
		const batchState = {
			schemaVersion: 2,
			phase: "merging",
			batchId: "test-completed",
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: Date.now() - 300000,
			updatedAt: Date.now(),
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			totalTasks: 1,
			succeededTasks: 1,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			wavePlan: [["task-ok"]],
			tasks: [{
				taskId: "task-ok",
				sessionName: "orch-lane-1-worker",
				taskFolder: "/tmp/tasks/task-ok",
				exitReason: ".DONE created",
				laneNumber: 1,
				status: "succeeded",
				startedAt: Date.now() - 300000,
				endedAt: Date.now(),
				doneFileFound: true,
				exitDiagnostic: diag,
			}],
			lanes: [{
				laneId: "lane-1",
				laneNumber: 1,
				laneSessionId: "orch-lane-1-worker",
				worktreePath: "/tmp/worktrees/lane-1",
				branch: "task/task-ok",
				taskIds: ["task-ok"],
			}],
			mergeResults: [],
			blockedTaskIds: [],
			errors: [],
			lastError: null,
		};

		const validated = validatePersistedState(JSON.parse(JSON.stringify(batchState)));
		const task = validated.tasks[0];

		// Both coexist
		expect(task.exitReason).toBe(".DONE created");
		expect(task.exitDiagnostic!.classification).toBe("completed");
		expect(task.exitDiagnostic!.exitCode).toBe(0);
		expect(task.exitDiagnostic!.errorMessage).toBeNull();
	});

	it("absent exitDiagnostic (pre-TP-026 state file) validates cleanly", async () => {
		const { validatePersistedState } = await import("../taskplane/persistence.ts");

		const legacyState = {
			schemaVersion: 2,
			phase: "completed",
			batchId: "legacy-batch",
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: Date.now() - 600000,
			updatedAt: Date.now(),
			endedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 1,
			totalTasks: 1,
			succeededTasks: 1,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			wavePlan: [["old-task"]],
			tasks: [{
				taskId: "old-task",
				sessionName: "orch-lane-1-worker",
				taskFolder: "/tmp/tasks/old-task",
				exitReason: ".DONE created",
				laneNumber: 1,
				status: "succeeded",
				startedAt: Date.now() - 300000,
				endedAt: Date.now(),
				doneFileFound: true,
				// NO exitDiagnostic field — pre-TP-026
			}],
			lanes: [{
				laneId: "lane-1",
				laneNumber: 1,
				laneSessionId: "orch-lane-1-worker",
				worktreePath: "/tmp/worktrees/lane-1",
				branch: "task/old-task",
				taskIds: ["old-task"],
			}],
			mergeResults: [],
			blockedTaskIds: [],
			errors: [],
			lastError: null,
		};

		const validated = validatePersistedState(legacyState);
		expect(validated.tasks[0].exitDiagnostic).toBeUndefined();
		expect(validated.tasks[0].exitReason).toBe(".DONE created");
	});
});
