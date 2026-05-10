import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import {
	buildResumeRuntimeWavePlan,
	collectDoneTaskIdsForResume,
	computeResumePoint,
	reconcileTaskStates,
	reconstructAllocatedLanes,
	reconstructSegmentFrontier,
} from "../taskplane/resume.ts";
import { defaultBatchDiagnostics, defaultResilienceState } from "../taskplane/types.ts";
import type { PersistedBatchState, PersistedSegmentRecord } from "../taskplane/types.ts";

function makeState(overrides: Partial<PersistedBatchState> = {}): PersistedBatchState {
	return {
		schemaVersion: 4,
		phase: "executing",
		batchId: "20260403T200000",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: Date.now() - 1000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-001"]],
		lanes: [
			{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-lane-1",
				worktreePath: "/tmp/wt-1",
				branch: "task/lane-1",
				taskIds: ["TP-001"],
			},
		],
		tasks: [
			{
				taskId: "TP-001",
				laneNumber: 1,
				sessionName: "orch-lane-1",
				status: "running",
				taskFolder: "/tmp/tasks/TP-001",
				startedAt: Date.now() - 900,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
			},
		],
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: defaultResilienceState(),
		diagnostics: defaultBatchDiagnostics(),
		segments: [],
		...overrides,
	};
}

function makeSegment(overrides: Partial<PersistedSegmentRecord>): PersistedSegmentRecord {
	return {
		segmentId: "TP-001::api",
		taskId: "TP-001",
		repoId: "api",
		status: "pending",
		laneId: "lane-1",
		sessionName: "orch-lane-1",
		worktreePath: "/tmp/wt-1",
		branch: "task/lane-1",
		startedAt: null,
		endedAt: null,
		retries: 0,
		exitReason: "",
		dependsOnSegmentIds: [],
		...overrides,
	};
}

describe("TP-135 resume segment fallback behavior", () => {
	it("keeps .DONE authoritative even when segment frontier is incomplete", () => {
		const root = join(tmpdir(), `tp135-done-${Date.now()}`);
		const taskFolder = join(root, "taskplane-tasks", "TP-001");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, ".DONE"), "", "utf8");

		try {
			const state = makeState({
				tasks: [
					{
						taskId: "TP-001",
						laneNumber: 1,
						sessionName: "orch-lane-1",
						status: "running",
						taskFolder,
						startedAt: Date.now() - 1000,
						endedAt: null,
						doneFileFound: false,
						exitReason: "",
						segmentIds: ["TP-001::api", "TP-001::web"],
						activeSegmentId: "TP-001::web",
					},
				],
				segments: [
					makeSegment({ segmentId: "TP-001::api", status: "succeeded", endedAt: Date.now() - 500 }),
					makeSegment({
						segmentId: "TP-001::web",
						repoId: "web",
						status: "running",
						dependsOnSegmentIds: ["TP-001::api"],
					}),
				],
			});

			const frontier = reconstructSegmentFrontier(state);
			expect(frontier.get("TP-001")!.allSucceeded).toBe(false);

			const doneTaskIds = collectDoneTaskIdsForResume(state, root, null);
			expect([...doneTaskIds]).toContain("TP-001");

			const reconciled = reconcileTaskStates(state, new Set(), doneTaskIds, new Set(["TP-001"]));
			expect(reconciled[0].action).toBe("mark-complete");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("falls back to task-level resume logic when mapped segment record is missing", () => {
		const state = makeState({
			wavePlan: [["TP-010"], ["TP-010"]],
			totalWaves: 2,
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" },
				{ waveIndex: 1, status: "succeeded" },
			] as any,
			tasks: [
				{
					taskId: "TP-010",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "succeeded",
					taskFolder: "/tmp/tasks/TP-010",
					startedAt: Date.now() - 1000,
					endedAt: Date.now() - 100,
					doneFileFound: true,
					exitReason: "done",
					segmentIds: ["TP-010::api", "TP-010::web"],
					activeSegmentId: null,
				},
			],
			segments: [],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].status).toBe("succeeded");

		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set());
		expect(reconciled[0].action).toBe("skip");

		const point = computeResumePoint(state, reconciled);
		expect(point.resumeWaveIndex).toBe(2);
		expect(point.pendingTaskIds).toEqual([]);
	});

	it("mid-segment crash re-executes the running segment", () => {
		const state = makeState({
			tasks: [
				{
					taskId: "TP-020",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-020",
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-020::api"],
					activeSegmentId: "TP-020::api",
				},
			],
			segments: [makeSegment({ taskId: "TP-020", segmentId: "TP-020::api", status: "running" })],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].activeSegmentId).toBe("TP-020::api");

		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set(["TP-020"]));
		expect(reconciled[0].action).toBe("re-execute");
	});

	it("between-segment crash resumes from next pending segment", () => {
		const state = makeState({
			wavePlan: [["TP-021"], ["TP-021"]],
			totalWaves: 2,
			tasks: [
				{
					taskId: "TP-021",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-021",
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-021::api", "TP-021::web"],
					activeSegmentId: null,
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-021",
					segmentId: "TP-021::api",
					status: "succeeded",
					endedAt: Date.now() - 100,
				}),
			],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].activeSegmentId).toBe("TP-021::web");
		expect(state.tasks[0].status).toBe("pending");

		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set(["TP-021"]));
		expect(reconciled[0].action).toBe("re-execute");
	});

	it("all segments complete keeps task terminal and resumes past final wave", () => {
		const state = makeState({
			wavePlan: [["TP-022"], ["TP-022"]],
			totalWaves: 2,
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" },
				{ waveIndex: 1, status: "succeeded" },
			] as any,
			tasks: [
				{
					taskId: "TP-022",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-022",
					startedAt: Date.now() - 2000,
					endedAt: Date.now() - 100,
					doneFileFound: true,
					exitReason: "done",
					segmentIds: ["TP-022::api", "TP-022::web"],
					activeSegmentId: null,
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-022",
					segmentId: "TP-022::api",
					status: "succeeded",
					endedAt: Date.now() - 500,
				}),
				makeSegment({
					taskId: "TP-022",
					segmentId: "TP-022::web",
					repoId: "web",
					status: "succeeded",
					dependsOnSegmentIds: ["TP-022::api"],
					endedAt: Date.now() - 100,
				}),
			],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].status).toBe("succeeded");
		expect(state.tasks[0].activeSegmentId).toBeNull();

		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set());
		const point = computeResumePoint(state, reconciled);
		expect(point.resumeWaveIndex).toBe(2);
	});

	it("failed segment is treated as task-level failure for dependency blocking", () => {
		const state = makeState({
			wavePlan: [["TP-030"], ["TP-031"]],
			totalWaves: 2,
			tasks: [
				{
					taskId: "TP-030",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-030",
					startedAt: Date.now() - 2000,
					endedAt: Date.now() - 100,
					doneFileFound: false,
					exitReason: "failed",
					segmentIds: ["TP-030::api"],
					activeSegmentId: null,
				},
				{
					taskId: "TP-031",
					laneNumber: 1,
					sessionName: "",
					status: "pending",
					taskFolder: "/tmp/tasks/TP-031",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-030",
					segmentId: "TP-030::api",
					status: "failed",
					endedAt: Date.now() - 100,
				}),
			],
		});

		reconstructSegmentFrontier(state);
		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set());
		const point = computeResumePoint(state, reconciled);
		expect(point.failedTaskIds).toContain("TP-030");
		expect(point.pendingTaskIds).toContain("TP-031");
	});

	it("expanded segments preserve dependency/lifecycle parity after resume reconstruction", () => {
		const state = makeState({
			wavePlan: [["TP-041"], ["TP-041"], ["TP-041"]],
			totalWaves: 3,
			tasks: [
				{
					taskId: "TP-041",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-041",
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-041::api", "TP-041::ops", "TP-041::web"],
					activeSegmentId: null,
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-041",
					segmentId: "TP-041::api",
					status: "succeeded",
					endedAt: Date.now() - 500,
				}),
				makeSegment({
					taskId: "TP-041",
					segmentId: "TP-041::ops",
					repoId: "ops",
					status: "pending",
					dependsOnSegmentIds: ["TP-041::api"],
					expandedFrom: "TP-041::api",
					expansionRequestId: "exp-041",
				} as any),
				makeSegment({
					taskId: "TP-041",
					segmentId: "TP-041::web",
					repoId: "web",
					status: "pending",
					dependsOnSegmentIds: ["TP-041::ops"],
				}),
			],
		});

		const frontier = reconstructSegmentFrontier(state);
		expect(state.tasks[0].activeSegmentId).toBe("TP-041::ops");
		expect(state.tasks[0].status).toBe("pending");
		expect(frontier.get("TP-041")!.dependencyBySegmentId.get("TP-041::web")).toEqual(["TP-041::ops"]);
		expect(frontier.get("TP-041")!.pendingSegmentIds).toEqual(["TP-041::ops", "TP-041::web"]);
	});

	it("resume wave-plan expansion keeps approved-but-unexecuted segments schedulable", () => {
		const state = makeState({
			wavePlan: [["TP-050"]],
			totalWaves: 1,
			mergeResults: [{ waveIndex: 0, status: "succeeded" }] as any,
			tasks: [
				{
					taskId: "TP-050",
					laneNumber: 1,
					sessionName: "",
					status: "pending",
					taskFolder: "/tmp/tasks/TP-050",
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-050::api", "TP-050::web"],
					activeSegmentId: null,
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-050",
					segmentId: "TP-050::api",
					status: "succeeded",
					endedAt: Date.now() - 100,
				}),
				makeSegment({
					taskId: "TP-050",
					segmentId: "TP-050::web",
					repoId: "web",
					status: "pending",
					dependsOnSegmentIds: ["TP-050::api"],
				}),
			],
		});

		reconstructSegmentFrontier(state);
		const runtimeWavePlan = buildResumeRuntimeWavePlan(state);
		expect(runtimeWavePlan).toEqual([["TP-050"], ["TP-050"]]);
		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set(["TP-050"]));
		const point = computeResumePoint(state, reconciled, runtimeWavePlan);
		expect(point.resumeWaveIndex).toBe(1);
		expect(point.pendingTaskIds).toContain("TP-050");
	});

	it("resume wave-plan expansion groups continuation rounds for multi-task wave parity", () => {
		const state = makeState({
			wavePlan: [["TP-060", "TP-061"], ["TP-062"]],
			totalWaves: 2,
			tasks: [
				{
					taskId: "TP-060",
					laneNumber: 1,
					sessionName: "",
					status: "pending",
					taskFolder: "/tmp/tasks/TP-060",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-060::api", "TP-060::web"],
					activeSegmentId: null,
				},
				{
					taskId: "TP-061",
					laneNumber: 2,
					sessionName: "",
					status: "pending",
					taskFolder: "/tmp/tasks/TP-061",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-061::api", "TP-061::web"],
					activeSegmentId: null,
				},
				{
					taskId: "TP-062",
					laneNumber: 3,
					sessionName: "",
					status: "pending",
					taskFolder: "/tmp/tasks/TP-062",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-062::api"],
					activeSegmentId: null,
				},
			],
			segments: [],
		});

		const runtimeWavePlan = buildResumeRuntimeWavePlan(state);
		expect(runtimeWavePlan).toEqual([["TP-060", "TP-061"], ["TP-060", "TP-061"], ["TP-062"]]);
	});

	it("repo-singleton tasks without segment IDs keep legacy resume behavior", () => {
		const state = makeState({
			wavePlan: [["TP-040"]],
			tasks: [
				{
					taskId: "TP-040",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-040",
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
				},
			],
			segments: [],
		});

		const frontier = reconstructSegmentFrontier(state);
		expect(frontier.size).toBe(0);
		expect(state.tasks[0].status).toBe("running");

		const reconciled = reconcileTaskStates(state, new Set(), new Set(), new Set(["TP-040"]));
		expect(reconciled[0].action).toBe("re-execute");
	});
});

// ── TP-169 Regression Tests ──────────────────────────────────────────

describe("TP-169 resume after segment expansion — no crash, taskFolder populated", () => {
	it("taskFolder is set on task stub even when persisted record has empty taskFolder", () => {
		const state = makeState({
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-lane-1",
					worktreePath: "/tmp/wt-1",
					branch: "task/lane-1",
					taskIds: ["TP-070"],
				},
			],
			tasks: [
				{
					taskId: "TP-070",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "", // empty — not enriched from discovery
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-070::api", "TP-070::web"],
					activeSegmentId: "TP-070::web",
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-070",
					segmentId: "TP-070::api",
					status: "succeeded",
					endedAt: Date.now() - 500,
				}),
				makeSegment({
					taskId: "TP-070",
					segmentId: "TP-070::web",
					repoId: "web",
					status: "pending",
					dependsOnSegmentIds: ["TP-070::api"],
					expandedFrom: "TP-070::api",
					expansionRequestId: "exp-070",
				} as any),
			],
		});

		const lanes = reconstructAllocatedLanes(state.lanes, state.tasks);
		// Task stub must have taskFolder property (even if empty string)
		const task = lanes[0].tasks[0];
		expect(task.task).not.toBe(null);
		expect(typeof task.task.taskFolder).toBe("string");
		// taskFolder should be "" (the persisted value), NOT undefined
		expect(task.task.taskFolder).toBe("");
		// Segment metadata should be carried forward
		expect(task.task.segmentIds).toEqual(["TP-070::api", "TP-070::web"]);
		expect(task.task.activeSegmentId).toBe("TP-070::web");
	});

	it("taskFolder is preserved on task stub when persisted record has a valid path", () => {
		const state = makeState({
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-lane-1",
					worktreePath: "/tmp/wt-1",
					branch: "task/lane-1",
					taskIds: ["TP-071"],
				},
			],
			tasks: [
				{
					taskId: "TP-071",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tmp/tasks/TP-071",
					startedAt: Date.now() - 1000,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					segmentIds: ["TP-071::api", "TP-071::web"],
					activeSegmentId: "TP-071::web",
				},
			],
			segments: [
				makeSegment({
					taskId: "TP-071",
					segmentId: "TP-071::api",
					status: "succeeded",
					endedAt: Date.now() - 500,
				}),
				makeSegment({
					taskId: "TP-071",
					segmentId: "TP-071::web",
					repoId: "web",
					status: "pending",
					dependsOnSegmentIds: ["TP-071::api"],
				}),
			],
		});

		const lanes = reconstructAllocatedLanes(state.lanes, state.tasks);
		const task = lanes[0].tasks[0];
		expect(task.task).not.toBe(null);
		expect(task.task.taskFolder).toBe("/tmp/tasks/TP-071");
	});

	it("task stub is not null when only segment fields are set (no repoId)", () => {
		const state = makeState({
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-lane-1",
					worktreePath: "/tmp/wt-1",
					branch: "task/lane-1",
					taskIds: ["TP-072"],
				},
			],
			tasks: [
				{
					taskId: "TP-072",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "pending",
					taskFolder: "",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
					// Only segment fields, no repoId/resolvedRepoId
					segmentIds: ["TP-072::default"],
					activeSegmentId: "TP-072::default",
				},
			],
		});

		const lanes = reconstructAllocatedLanes(state.lanes, state.tasks);
		const task = lanes[0].tasks[0];
		// Even with only segment fields, task should NOT be null
		expect(task.task).not.toBe(null);
		expect(typeof task.task.taskFolder).toBe("string");
	});
});
