import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import {
	collectDoneTaskIdsForResume,
	computeResumePoint,
	reconcileTaskStates,
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
		lanes: [{
			laneNumber: 1,
			laneId: "lane-1",
			laneSessionId: "orch-lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1",
			taskIds: ["TP-001"],
		}],
		tasks: [{
			taskId: "TP-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "running",
			taskFolder: "/tmp/tasks/TP-001",
			startedAt: Date.now() - 900,
			endedAt: null,
			doneFileFound: false,
			exitReason: "",
		}],
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
				tasks: [{
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
				}],
				segments: [
					makeSegment({ segmentId: "TP-001::api", status: "succeeded", endedAt: Date.now() - 500 }),
					makeSegment({ segmentId: "TP-001::web", repoId: "web", status: "running", dependsOnSegmentIds: ["TP-001::api"] }),
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
			tasks: [{
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
			}],
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
});
