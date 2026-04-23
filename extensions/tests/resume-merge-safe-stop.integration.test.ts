import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "./expect.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";

const mockRunDiscovery = mock.fn();
const mockExecuteWave = mock.fn();
const mockExecLog = mock.fn();
const mockMergeWaveByRepo = mock.fn();
const mockSelectRuntimeBackend = mock.fn(() => ({
	backend: "v2",
	isSingleTask: false,
	isRepoMode: true,
	isDirectPromptTarget: false,
}));
const mockResolveDisplayWaveNumber = mock.fn((waveIdx: number) => ({
	displayWave: waveIdx + 1,
	displayTotal: 1,
}));

const discoveryModuleUrl = new URL("../taskplane/discovery.ts", import.meta.url).href;
const executionModuleUrl = new URL("../taskplane/execution.ts", import.meta.url).href;
const engineModuleUrl = new URL("../taskplane/engine.ts", import.meta.url).href;
const mergeModuleUrl = new URL("../taskplane/merge.ts", import.meta.url).href;

const realDiscovery = await import(new URL("../taskplane/discovery.ts?resume-merge-safe-stop-real", import.meta.url).href);
const realExecution = await import(new URL("../taskplane/execution.ts?resume-merge-safe-stop-real", import.meta.url).href);

mock.module(discoveryModuleUrl, {
	namedExports: {
		...realDiscovery,
		runDiscovery: mockRunDiscovery,
	},
});

mock.module(executionModuleUrl, {
	namedExports: {
		...realExecution,
		buildReviewerEnv: mock.fn(() => ({})),
		buildWorkerExcludeEnv: mock.fn(() => ({})),
		computeTransitiveDependents: mock.fn(() => new Set<string>()),
		execLog: mockExecLog,
		executeLaneV2: mock.fn(async () => {
			throw new Error("executeLaneV2 should not run in merge-retry safe-stop test");
		}),
		executeWave: mockExecuteWave,
		resolveCanonicalTaskPaths: mock.fn(() => ({
			taskFolderResolved: "",
			statusPath: "",
			donePath: "",
		})),
	},
});

mock.module(engineModuleUrl, {
	namedExports: {
		executeOrchBatch: mock.fn(async () => {
			throw new Error("executeOrchBatch should not run in resume merge-retry safe-stop test");
		}),
		resolveDisplayWaveNumber: mockResolveDisplayWaveNumber,
		selectRuntimeBackend: mockSelectRuntimeBackend,
	},
});

mock.module(mergeModuleUrl, {
	namedExports: {
		mergeWaveByRepo: mockMergeWaveByRepo,
	},
});

const { resumeOrchBatch } = await import("../taskplane/resume.ts");
const {
	BATCH_STATE_SCHEMA_VERSION,
	DEFAULT_ORCHESTRATOR_CONFIG,
	DEFAULT_TASK_RUNNER_CONFIG,
	defaultBatchDiagnostics,
	defaultResilienceState,
	freshOrchBatchState,
} = await import("../taskplane/types.ts");
const { validatePersistedState, loadBatchState } = await import("../taskplane/persistence.ts");

type ParsedTask = import("../taskplane/types.ts").ParsedTask;
type PersistedBatchState = import("../taskplane/types.ts").PersistedBatchState;

let tmpDir = "";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function initGitRepo(repoDir: string, branchName: string): void {
	mkdirSync(repoDir, { recursive: true });
	git(repoDir, ["init", "--initial-branch=main"]);
	git(repoDir, ["config", "user.email", "test@example.com"]);
	git(repoDir, ["config", "user.name", "Taskplane Test"]);
	writeFileSync(join(repoDir, "README.md"), `# ${branchName}\n`, "utf-8");
	git(repoDir, ["add", "."]);
	git(repoDir, ["commit", "-m", "initial commit"]);
	git(repoDir, ["branch", branchName]);
}

function buildPersistedState(options?: {
	persistedTransactionRecords?: boolean;
	persistenceErrors?: string[];
	persistedFailureReason?: string;
}): PersistedBatchState {
	const persistedTransactionRecords = options?.persistedTransactionRecords ?? true;
	const persistenceErrors = options?.persistenceErrors;
	const persistedFailureReason = options?.persistedFailureReason ?? "rollback failures: [repo:default] reset failed";
	const mergeResult = {
		waveIndex: 0,
		status: "failed" as const,
		laneResults: [],
		failedLane: 1,
		failureReason: persistedFailureReason,
		totalDurationMs: 0,
		...(persistedTransactionRecords ? {
			transactionRecords: [
				{
					opId: "op-test",
					batchId: "20260422T150000",
					waveTransactionId: "wave-test",
					waveIndex: 0,
					repoAttemptSequence: 1,
					laneNumber: 1,
					repoId: null,
					baseHEAD: "11111111",
					laneHEAD: "22222222",
					mergedHEAD: null,
					status: "rollback_failed" as const,
					rollbackAttempted: true,
					rollbackResult: "reset failed: simulated persisted rollback failure",
					recoveryCommands: ["git reset --hard 11111111"],
					startedAt: new Date(Date.now() - 20_000).toISOString(),
					completedAt: new Date(Date.now() - 19_000).toISOString(),
				},
			],
		} : {}),
		...(persistenceErrors ? { persistenceErrors } : {}),
	};

	return {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: "paused",
		batchId: "20260422T150000",
		baseBranch: "main",
		orchBranch: "orch/test-resume-rollback-safe-stop",
		mode: "repo",
		startedAt: Date.now() - 60_000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-001"]],
		lanes: [
			{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-test-lane-1",
				worktreePath: join(tmpDir, "worktrees", "lane-1"),
				branch: "task/lane-1",
				taskIds: ["TP-001"],
			},
		],
		tasks: [
			{
				taskId: "TP-001",
				laneNumber: 1,
				sessionName: "orch-test-lane-1",
				status: "succeeded",
				taskFolder: join(tmpDir, "tasks", "TP-001"),
				startedAt: Date.now() - 30_000,
				endedAt: Date.now() - 20_000,
				doneFileFound: true,
				exitReason: "completed in prior run",
			},
		],
		mergeResults: [mergeResult],
		totalTasks: 1,
		succeededTasks: 1,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: defaultResilienceState(),
		diagnostics: defaultBatchDiagnostics(),
		segments: [],
	};
}

function writeStateFixture(options?: {
	persistedTransactionRecords?: boolean;
	persistenceErrors?: string[];
	persistedFailureReason?: string;
}): void {
	mkdirSync(join(tmpDir, ".pi"), { recursive: true });
	mkdirSync(join(tmpDir, "tasks", "TP-001"), { recursive: true });
	const validated = validatePersistedState(buildPersistedState(options));
	writeFileSync(join(tmpDir, ".pi", "batch-state.json"), JSON.stringify(validated, null, 2));
}

function makeCompletedTask(taskId: string): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 1,
		size: "M",
		dependencies: [],
		fileScope: [],
		taskFolder: join(tmpDir, "tasks", taskId),
		promptPath: join(tmpDir, "tasks", taskId, "PROMPT.md"),
		areaName: "default",
		status: "completed",
	};
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "tp-resume-merge-safe-stop-"));
	mockRunDiscovery.mock.resetCalls();
	mockExecuteWave.mock.resetCalls();
	mockExecLog.mock.resetCalls();
	mockMergeWaveByRepo.mock.resetCalls();
	mockSelectRuntimeBackend.mock.resetCalls();
	mockResolveDisplayWaveNumber.mock.resetCalls();

	writeStateFixture();

	mockRunDiscovery.mock.mockImplementation((() => ({
		pending: new Map<string, ParsedTask>(),
		completed: new Map<string, ParsedTask>([["TP-001", makeCompletedTask("TP-001")]]),
	})) as any);

	mockExecuteWave.mock.mockImplementation((async () => {
		throw new Error("executeWave should not run when resume enters merge-retry safe-stop path");
	}) as any);

	mockMergeWaveByRepo.mock.mockImplementation((async () => ({
		waveIndex: 1,
		status: "failed",
		laneResults: [],
		failedLane: 1,
		failureReason: "rollback failures: [repo:default] reset failed during merge retry",
		totalDurationMs: 0,
		transactionRecords: [
			{
				opId: "op-test",
				batchId: "20260422T150000",
				waveTransactionId: "wave-test-retry",
				waveIndex: 0,
				repoAttemptSequence: 1,
				laneNumber: 1,
				repoId: null,
				baseHEAD: "11111111",
				laneHEAD: "22222222",
				mergedHEAD: null,
				status: "rollback_failed",
				rollbackAttempted: true,
				rollbackResult: "reset failed: simulated retry rollback failure",
				recoveryCommands: ["git reset --hard 11111111"],
				startedAt: new Date(Date.now() - 5_000).toISOString(),
				completedAt: new Date(Date.now() - 4_000).toISOString(),
			},
		],
	})) as any);
});

afterEach(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	tmpDir = "";
});

describe("resumeOrchBatch merge-retry rollback safe-stop", () => {
	it("forces paused safe-stop from stale rollback metadata even when abort policy is configured", async () => {
		const batchState = freshOrchBatchState();
		const notifications: Array<{ message: string; level: string }> = [];
		const orchConfig = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			failure: {
				...DEFAULT_ORCHESTRATOR_CONFIG.failure,
				on_merge_failure: "abort",
			},
		};

		await resumeOrchBatch(
			orchConfig,
			DEFAULT_TASK_RUNNER_CONFIG,
			tmpDir,
			batchState,
			(message, level) => {
				notifications.push({ message, level });
			},
			undefined,
			null,
			tmpDir,
			undefined,
			false,
			undefined,
			"supervised",
		);

		expect(mockRunDiscovery.mock.calls.length).toBe(1);
		expect(mockExecuteWave.mock.calls.length).toBe(0);
		expect(mockMergeWaveByRepo.mock.calls.length).toBe(1);
		expect(batchState.phase).toBe("paused");
		expect(batchState.errors.some((message) => message.includes("Safe-stop at wave 1: verification rollback failed."))).toBe(true);
		expect(notifications.some((entry) => entry.level === "error" && entry.message.includes("🛑 Safe-stop: verification rollback failed at wave 1."))).toBe(true);
		expect(notifications.some((entry) => entry.message.includes("Batch aborted due to merge failure"))).toBe(false);

		const persisted = loadBatchState(tmpDir);
		expect(persisted).not.toBeNull();
		expect(persisted!.phase).toBe("paused");
		expect(persisted!.errors.some((message) => message.includes("Safe-stop at wave 1: verification rollback failed."))).toBe(true);
	});

	it("includes persistence warning when transaction records are missing but persistenceErrors survived", async () => {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = mkdtempSync(join(tmpdir(), "tp-resume-merge-safe-stop-"));
		mockRunDiscovery.mock.resetCalls();
		mockExecuteWave.mock.resetCalls();
		mockExecLog.mock.resetCalls();
		mockMergeWaveByRepo.mock.resetCalls();
		mockSelectRuntimeBackend.mock.resetCalls();
		mockResolveDisplayWaveNumber.mock.resetCalls();

		writeStateFixture({
			persistedTransactionRecords: false,
			persistenceErrors: ["lane 1 (repo: default): ENOENT: transaction record missing"],
			persistedFailureReason: "rollback failures: recovery files missing after rollback failure",
		});

		mockRunDiscovery.mock.mockImplementation((() => ({
			pending: new Map<string, ParsedTask>(),
			completed: new Map<string, ParsedTask>([["TP-001", makeCompletedTask("TP-001")]]),
		})) as any);

		mockExecuteWave.mock.mockImplementation((async () => {
			throw new Error("executeWave should not run when resume enters merge-retry safe-stop path");
		}) as any);

		mockMergeWaveByRepo.mock.mockImplementation((async () => ({
			waveIndex: 1,
			status: "failed",
			laneResults: [],
			failedLane: 1,
			failureReason: "rollback failures: recovery files missing after retry rollback failure",
			totalDurationMs: 0,
			persistenceErrors: ["lane 1 (repo: default): ENOENT: transaction record missing"],
		})) as any);

		const batchState = freshOrchBatchState();
		const notifications: Array<{ message: string; level: string }> = [];
		const orchConfig = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			failure: {
				...DEFAULT_ORCHESTRATOR_CONFIG.failure,
				on_merge_failure: "abort",
			},
		};

		await resumeOrchBatch(
			orchConfig,
			DEFAULT_TASK_RUNNER_CONFIG,
			tmpDir,
			batchState,
			(message, level) => {
				notifications.push({ message, level });
			},
			undefined,
			null,
			tmpDir,
			undefined,
			false,
			undefined,
			"supervised",
		);

		expect(mockMergeWaveByRepo.mock.calls.length).toBe(1);
		expect(batchState.phase).toBe("paused");
		expect(batchState.errors.some((message) => message.includes("transaction record(s) failed to persist"))).toBe(true);
		expect(batchState.errors.some((message) => message.includes("recovery file(s) may be missing"))).toBe(true);
		expect(notifications.some((entry) => entry.level === "error" && entry.message.includes("transaction record(s) failed to persist"))).toBe(true);
		expect(notifications.some((entry) => entry.level === "error" && entry.message.includes("recovery file(s) may be missing"))).toBe(true);

		const persisted = loadBatchState(tmpDir);
		expect(persisted).not.toBeNull();
		expect(persisted!.phase).toBe("paused");
		expect(persisted!.errors.some((message) => message.includes("transaction record(s) failed to persist"))).toBe(true);
	});

	it("workspace mode keeps repo-scoped attribution when repoResults survive but transaction files do not", async () => {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = mkdtempSync(join(tmpdir(), "tp-resume-merge-safe-stop-ws-"));
		const apiRepo = join(tmpDir, "repos", "api");
		const webRepo = join(tmpDir, "repos", "web");
		initGitRepo(apiRepo, "orch/test-resume-rollback-safe-stop");
		initGitRepo(webRepo, "orch/test-resume-rollback-safe-stop");

		mockRunDiscovery.mock.resetCalls();
		mockExecuteWave.mock.resetCalls();
		mockExecLog.mock.resetCalls();
		mockMergeWaveByRepo.mock.resetCalls();
		mockSelectRuntimeBackend.mock.resetCalls();
		mockResolveDisplayWaveNumber.mock.resetCalls();

		writeStateFixture({
			persistedTransactionRecords: false,
			persistenceErrors: ["lane 1 (repo: api): ENOENT: transaction record missing"],
			persistedFailureReason: "merge retry failed in workspace mode",
		});
		const persisted = JSON.parse(readFileSync(join(tmpDir, ".pi", "batch-state.json"), "utf-8"));
		persisted.mode = "workspace";
		persisted.lanes[0].repoId = "api";
		persisted.tasks[0].repoId = "api";
		persisted.tasks[0].resolvedRepoId = "api";
		persisted.tasks[0].taskFolder = join(apiRepo, "tasks", "TP-001");
		persisted.lanes[0].worktreePath = join(apiRepo, ".worktrees", "lane-1");
		writeFileSync(join(tmpDir, ".pi", "batch-state.json"), JSON.stringify(validatePersistedState(persisted), null, 2));

		mockRunDiscovery.mock.mockImplementation((() => ({
			pending: new Map<string, ParsedTask>(),
			completed: new Map<string, ParsedTask>([["TP-001", {
				...makeCompletedTask("TP-001"),
				resolvedRepoId: "api",
			}]]),
		})) as any);

		mockExecuteWave.mock.mockImplementation((async () => {
			throw new Error("executeWave should not run when resume enters workspace merge-retry safe-stop path");
		}) as any);

		mockMergeWaveByRepo.mock.mockImplementation((async () => ({
			waveIndex: 1,
			status: "failed",
			laneResults: [],
			failedLane: null,
			failureReason: "workspace merge retry failed",
			totalDurationMs: 0,
			persistenceErrors: ["lane 1 (repo: api): ENOENT: transaction record missing"],
			repoResults: [
				{
					repoId: "api",
					status: "failed",
					laneResults: [],
					failedLane: null,
					failureReason: "cross_repo_atomic_rollback_failed: unable to restore api main",
				},
				{
					repoId: "web",
					status: "failed",
					laneResults: [],
					failedLane: null,
					failureReason: "cross_repo_atomic_rollback: rolled back because another repo in the wave failed",
				},
			],
		})) as any);

		const batchState = freshOrchBatchState();
		const notifications: Array<{ message: string; level: string }> = [];
		const alerts: Array<any> = [];
		const orchConfig = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			failure: {
				...DEFAULT_ORCHESTRATOR_CONFIG.failure,
				on_merge_failure: "abort",
			},
		};
		const workspaceConfig = {
			repos: new Map([
				["api", { path: apiRepo }],
				["web", { path: webRepo }],
			]),
		} as any;

		await resumeOrchBatch(
			orchConfig,
			DEFAULT_TASK_RUNNER_CONFIG,
			apiRepo,
			batchState,
			(message, level) => {
				notifications.push({ message, level });
			},
			undefined,
			workspaceConfig,
			tmpDir,
			undefined,
			false,
			(alert) => {
				alerts.push(alert);
			},
			"supervised",
		);

		expect(mockMergeWaveByRepo.mock.calls.length).toBe(1);
		expect(batchState.phase).toBe("paused");
		expect(notifications.some((entry) => entry.level === "error" && entry.message.includes("transaction record(s) failed to persist"))).toBe(true);
		expect(alerts.length).toBeGreaterThanOrEqual(1);
		expect(alerts.some((alert) => alert.category === "merge-failure" && alert.context.repoId === "api")).toBe(true);

		const reloaded = loadBatchState(tmpDir);
		expect(reloaded).not.toBeNull();
		expect(reloaded!.phase).toBe("paused");
		expect(reloaded!.errors.some((message) => message.includes("transaction record(s) failed to persist"))).toBe(true);
	});
});