/**
 * Resume Supervisor Alert Acceptance Tests — TP-166 / #51
 *
 * Validates that resumeOrchBatch rehydrates persisted multi-repo segment
 * metadata into discovered tasks before resumed execution and emits the
 * supervisor task-failure alert from the real resume path.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/resume-supervisor-alert.integration.test.ts
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "./expect.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "batch-state-v2-polyrepo.json");

const mockRunDiscovery = mock.fn();
const mockExecuteWave = mock.fn();
const mockExecLog = mock.fn();
const mockComputeTransitiveDependents = mock.fn(() => new Set<string>());
const mockSelectRuntimeBackend = mock.fn(() => ({
	backend: "v2",
	isSingleTask: false,
	isRepoMode: true,
	isDirectPromptTarget: false,
}));
const mockResolveDisplayWaveNumber = mock.fn((waveIdx: number, _roundToTaskWave?: boolean, taskLevelWaveCount?: number) => ({
	displayWave: waveIdx + 1,
	displayTotal: typeof taskLevelWaveCount === "number" ? taskLevelWaveCount : 2,
}));

const discoveryModuleUrl = new URL("../taskplane/discovery.ts", import.meta.url).href;
const executionModuleUrl = new URL("../taskplane/execution.ts", import.meta.url).href;
const engineModuleUrl = new URL("../taskplane/engine.ts", import.meta.url).href;
const realDiscovery = await import(new URL("../taskplane/discovery.ts?resume-supervisor-alert-real", import.meta.url).href);
const realExecution = await import(new URL("../taskplane/execution.ts?resume-supervisor-alert-real", import.meta.url).href);

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
		computeTransitiveDependents: mockComputeTransitiveDependents,
		execLog: mockExecLog,
		executeLaneV2: mock.fn(async () => {
			throw new Error("executeLaneV2 should not run in this acceptance test");
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
			throw new Error("executeOrchBatch should not run in resume acceptance tests");
		}),
		resolveDisplayWaveNumber: mockResolveDisplayWaveNumber,
		selectRuntimeBackend: mockSelectRuntimeBackend,
	},
});

const { resumeOrchBatch } = await import("../taskplane/resume.ts");
const {
	DEFAULT_ORCHESTRATOR_CONFIG,
	DEFAULT_TASK_RUNNER_CONFIG,
	buildSupervisorTaskFailureAlert,
	freshOrchBatchState,
} = await import("../taskplane/types.ts");
const { validatePersistedState } = await import("../taskplane/persistence.ts");

type ParsedTask = import("../taskplane/types.ts").ParsedTask;
type SupervisorAlert = import("../taskplane/types.ts").SupervisorAlert;
type PersistedBatchState = import("../taskplane/types.ts").PersistedBatchState;

let tmpDir = "";
let capturedPendingTask: ParsedTask | null = null;

function makeParsedTask(taskId: string, overrides: Partial<ParsedTask> = {}): ParsedTask {
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
		status: "pending",
		...overrides,
	};
}

function writeResumeFixtureState(): void {
	const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as PersistedBatchState;
	const apiWorktreePath = join(tmpDir, "worktrees", "api");
	const frontendWorktreePath = join(tmpDir, "worktrees", "frontend");
	const docsLaneWorktreePath = join(tmpDir, "worktrees", "docs-lane");
	const apiLaneWorktreePath = join(tmpDir, "worktrees", "api-lane");
	const frontendLaneWorktreePath = join(tmpDir, "worktrees", "frontend-lane");

	fixture.orchBranch = "orch/test-resume-polyrepo";
	fixture.currentWaveIndex = 0;
	fixture.totalWaves = 2;
	fixture.wavePlan = [["AP-002"], ["SH-002"]];
	fixture.totalTasks = 2;
	fixture.succeededTasks = 0;
	fixture.failedTasks = 0;
	fixture.skippedTasks = 0;
	fixture.blockedTasks = 0;
	fixture.blockedTaskIds = [];
	fixture.lastError = null;
	fixture.errors = [];
	fixture.mergeResults = [];
	for (const lane of fixture.lanes) {
		if (lane.laneId === "docs/lane-1") {
			lane.taskIds = ["SH-002"];
			lane.worktreePath = docsLaneWorktreePath;
		} else if (lane.laneId === "api/lane-2") {
			lane.taskIds = ["AP-002"];
			lane.worktreePath = apiLaneWorktreePath;
		} else if (lane.laneId === "frontend/lane-3") {
			lane.taskIds = [];
			lane.worktreePath = frontendLaneWorktreePath;
		}
	}
	fixture.lanes = fixture.lanes.filter((lane) => lane.laneId === "docs/lane-1" || lane.laneId === "api/lane-2");
	fixture.segments = [
		{
			segmentId: "AP-002::frontend",
			taskId: "AP-002",
			repoId: "frontend",
			status: "pending",
			laneId: "frontend/lane-2",
			sessionName: "orch-op-api-lane-2",
			worktreePath: frontendWorktreePath,
			branch: "task/op-frontend-segment-20260316T120000",
			startedAt: null,
			endedAt: null,
			retries: 0,
			dependsOnSegmentIds: ["AP-002::api"],
			exitReason: "",
		},
	];

	const apiLane = fixture.lanes.find((lane) => lane.laneId === "api/lane-2");
	if (!apiLane) {
		throw new Error("api/lane-2 fixture lane missing");
	}
	apiLane.repoWorktrees = {
		api: {
			path: apiWorktreePath,
			branch: "task/op-api-lane-2-20260316T120000",
			laneNumber: 2,
			repoId: "api",
		},
		frontend: {
			path: frontendWorktreePath,
			branch: "task/op-frontend-segment-20260316T120000",
			laneNumber: 2,
			repoId: "frontend",
		},
	};

	const apiTask = fixture.tasks.find((task) => task.taskId === "AP-002");
	if (!apiTask) {
		throw new Error("AP-002 fixture task missing");
	}
	Object.assign(apiTask, {
		status: "pending",
		sessionName: "",
		startedAt: null,
		endedAt: null,
		doneFileFound: false,
		exitReason: "",
		resolvedRepoIds: ["api", "frontend"],
		resolvedRepoId: "api",
		participatingRepoIds: ["api", "frontend"],
		segmentIds: ["AP-002::frontend"],
		activeSegmentId: "AP-002::frontend",
		packetRepoId: "frontend",
		packetTaskPath: "tasks/api-tasks/AP-002-implement-auth-endpoints",
	});

	const frontendTask = fixture.tasks.find((task) => task.taskId === "UI-002");
	if (!frontendTask) {
		throw new Error("UI-002 fixture task missing");
	}
	Object.assign(frontendTask, {
		status: "pending",
		startedAt: null,
		endedAt: null,
		doneFileFound: false,
		exitReason: "",
	});
	fixture.tasks = [apiTask, frontendTask];

	const validated = validatePersistedState(fixture);
	const piDir = join(tmpDir, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "batch-state.json"), JSON.stringify(validated, null, 2));
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "tp-resume-alert-"));
	capturedPendingTask = null;
	mockRunDiscovery.mock.resetCalls();
	mockExecuteWave.mock.resetCalls();
	mockExecLog.mock.resetCalls();
	mockComputeTransitiveDependents.mock.resetCalls();
	mockSelectRuntimeBackend.mock.resetCalls();
	mockResolveDisplayWaveNumber.mock.resetCalls();

	writeResumeFixtureState();

	mockRunDiscovery.mock.mockImplementation((() => ({
		pending: new Map<string, ParsedTask>([
			["AP-002", makeParsedTask("AP-002", { resolvedRepoId: "api" })],
			["SH-002", makeParsedTask("SH-002", { dependencies: ["AP-002"], resolvedRepoId: "docs" })],
		]),
		completed: new Map<string, ParsedTask>([
			["SH-001", makeParsedTask("SH-001", { resolvedRepoId: "docs" })],
			["AP-001", makeParsedTask("AP-001", { resolvedRepoId: "api" })],
			["UI-001", makeParsedTask("UI-001", { resolvedRepoId: "frontend" })],
			["UI-002", makeParsedTask("UI-002", { resolvedRepoId: "frontend" })],
		]),
	})) as any);

	mockExecuteWave.mock.mockImplementation((async (
		waveTasks: string[],
		waveIndex: number,
		pending: Map<string, ParsedTask>,
		_orchConfig: unknown,
		_repoRoot: string,
		_batchId: string,
		_pauseSignal: unknown,
		_depGraph: unknown,
		_orchBranch: string,
		_monitorUpdate: unknown,
		_onAllocatedLanes: unknown,
		_workspaceConfig: unknown,
		_resumeBackend: unknown,
		emitAlert?: (alert: SupervisorAlert) => void,
	) => {
		expect(waveTasks).toEqual(["AP-002"]);
		capturedPendingTask = pending.get("AP-002") ?? null;
		const apiTask = pending.get("AP-002");
		if (!apiTask) {
			throw new Error("AP-002 missing from pending map");
		}
		if (emitAlert) {
			emitAlert(buildSupervisorTaskFailureAlert({
				taskId: "AP-002",
				failurePolicy: "skip-dependents",
				exitReason: "Segment compile failed",
				partialProgress: false,
				laneId: "frontend/lane-2",
				laneNumber: 2,
				laneRepoId: "frontend",
				taskSegmentIds: ["AP-002::frontend"],
				taskActiveSegmentId: "AP-002::frontend",
				persistedSegments: [
					{
						segmentId: "AP-002::api",
						taskId: "AP-002",
						repoId: "api",
						status: "succeeded",
						laneId: "api/lane-2",
						sessionName: "orch-op-api-lane-2",
						worktreePath: join(tmpDir, "worktrees", "api"),
						branch: "task/op-api-lane-2-20260316T120000",
						startedAt: 1741478600000,
						endedAt: 1741478610000,
						retries: 0,
						dependsOnSegmentIds: [],
						exitReason: "Segment completed successfully",
					},
					{
						segmentId: "AP-002::frontend",
						taskId: "AP-002",
						repoId: "frontend",
						status: "pending",
						laneId: "frontend/lane-2",
						sessionName: "orch-op-api-lane-2",
						worktreePath: join(tmpDir, "worktrees", "frontend"),
						branch: "task/op-frontend-segment-20260316T120000",
						startedAt: null,
						endedAt: null,
						retries: 0,
						dependsOnSegmentIds: ["AP-002::api"],
						exitReason: "",
					},
				],
				outcomeSegmentId: "AP-002::frontend",
				blockedTaskIds: ["SH-002"],
				batchProgress: {
					succeededTasks: 0,
					failedTasks: 0,
					skippedTasks: 0,
					blockedTasks: 0,
					totalTasks: 2,
					currentWave: 1,
					totalWaves: 2,
				},
				displayWave: 1,
				totalDisplayWaves: 2,
			}));
		}

		const allocatedLane = {
			laneNumber: 2,
			laneId: "frontend/lane-2",
			laneSessionId: "orch-op-api-lane-2",
			worktreePath: join(tmpDir, "worktrees", "frontend"),
			branch: "task/op-frontend-segment-20260316T120000",
			repoId: "frontend",
			repoWorktrees: {
				api: {
					path: join(tmpDir, "worktrees", "api"),
					branch: "task/op-api-lane-2-20260316T120000",
					laneNumber: 2,
					repoId: "api",
				},
				frontend: {
					path: join(tmpDir, "worktrees", "frontend"),
					branch: "task/op-frontend-segment-20260316T120000",
					laneNumber: 2,
					repoId: "frontend",
				},
			},
			tasks: [
				{
					taskId: "AP-002",
					order: 0,
					task: apiTask,
					estimatedMinutes: 60,
				},
			],
			strategy: "round-robin",
			estimatedLoad: 1,
			estimatedMinutes: 60,
		};

		return {
			waveIndex,
			startedAt: 10,
			endedAt: 25,
			laneResults: [
				{
					laneNumber: 2,
					laneId: "frontend/lane-2",
					tasks: [
						{
							taskId: "AP-002",
							status: "failed",
							startTime: 10,
							endTime: 25,
							exitReason: "Segment compile failed",
							sessionName: "orch-op-api-lane-2",
							doneFileFound: false,
							laneNumber: 2,
							segmentId: "AP-002::frontend",
						},
					],
					overallStatus: "failed",
					startTime: 10,
					endTime: 25,
				},
			],
			policyApplied: "skip-dependents",
			stoppedEarly: false,
			failedTaskIds: ["AP-002"],
			skippedTaskIds: [],
			succeededTaskIds: [],
			blockedTaskIds: ["SH-002"],
			laneCount: 1,
			overallStatus: "failed",
			finalMonitorState: null,
			allocatedLanes: [allocatedLane],
		};
	}) as any);
});

afterEach(() => {
	if (tmpDir) {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// best effort cleanup
		}
	}
	tmpDir = "";
	capturedPendingTask = null;
});

describe("resumeOrchBatch multi-repo alert acceptance", () => {
	it("rehydrates segment metadata into resumed execution and emits the task-failure alert", async () => {
		const batchState = freshOrchBatchState();
		const notifications: Array<{ message: string; level: string }> = [];
		const alerts: SupervisorAlert[] = [];

		await resumeOrchBatch(
			DEFAULT_ORCHESTRATOR_CONFIG,
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
			(alert) => {
				alerts.push(alert);
			},
			"supervised",
		);

		expect(mockRunDiscovery.mock.calls.length).toBe(1);
		expect(mockExecuteWave.mock.calls.length).toBe(1);
		expect(capturedPendingTask?.resolvedRepoIds).toEqual(["api", "frontend"]);
		expect(capturedPendingTask?.participatingRepoIds).toEqual(["api", "frontend"]);
		expect(capturedPendingTask?.segmentIds).toEqual(["AP-002::frontend"]);
		expect(capturedPendingTask?.activeSegmentId).toBe("AP-002::frontend");
		expect(capturedPendingTask?.packetRepoId).toBe("frontend");
		expect(capturedPendingTask?.packetTaskPath).toBe("tasks/api-tasks/AP-002-implement-auth-endpoints");

		expect(alerts.some((entry) =>
			entry.category === "task-failure"
			&& entry.context.taskId === "AP-002"
			&& entry.context.segmentId === "AP-002::frontend",
		)).toBe(true);
		const alert = alerts.find((entry) =>
			entry.category === "task-failure"
			&& entry.context.taskId === "AP-002"
			&& entry.context.segmentId === "AP-002::frontend",
		);
		if (!alert) {
			throw new Error("expected a task-failure supervisor alert for AP-002::frontend");
		}
		expect(alert.category).toBe("task-failure");
		expect(alert.context.taskId).toBe("AP-002");
		expect(alert.context.segmentId).toBe("AP-002::frontend");
		expect(alert.context.repoId).toBe("frontend");
		expect(alert.context.failurePolicy).toBe("skip-dependents");
		expect(alert.context.blockedTaskIds).toEqual(["SH-002"]);
		expect(alert.context.continueUnaffected).toBe(true);
		expect(alert.summary).toContain("Segment: AP-002::frontend (repo: frontend)");
		expect(alert.summary).toContain("Newly blocked dependents: SH-002");
		expect(alert.summary).toContain("Unrelated ready tasks continue under skip-dependents.");

		expect(batchState.failedTasks).toBe(1);
		expect([...batchState.blockedTaskIds]).toEqual(["SH-002"]);
		expect(notifications.some((entry) => entry.level === "warning" && entry.message.includes("Wave 1"))).toBe(true);
	});
});