import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import { persistRuntimeState } from "../taskplane/persistence.ts";
import { freshOrchBatchState } from "../taskplane/types.ts";
import type { AllocatedLane, LaneTaskOutcome, ParsedTask } from "../taskplane/types.ts";

describe("TP-135 segment state persistence", () => {
	it("persists segment lifecycle records into batch-state.json", () => {
		const repoRoot = join(tmpdir(), `tp135-segments-${Date.now()}`);

		try {
			const task: ParsedTask = {
				taskId: "TP-100",
				taskName: "TP-100",
				reviewLevel: 2,
				size: "M",
				dependencies: [],
				fileScope: [],
				taskFolder: "/tmp/tasks/TP-100",
				promptPath: "/tmp/tasks/TP-100/PROMPT.md",
				areaName: "default",
				status: "pending",
				resolvedRepoId: "api",
				segmentIds: ["TP-100::api", "TP-100::web"],
				activeSegmentId: "TP-100::api",
			};

			const lane: AllocatedLane = {
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-lane-1",
				worktreePath: "/tmp/worktree-1",
				branch: "task/lane-1",
				tasks: [{
					taskId: "TP-100",
					order: 0,
					task,
					estimatedMinutes: 5,
				}],
				strategy: "round-robin",
				estimatedLoad: 1,
				estimatedMinutes: 5,
			};

			const outcome: LaneTaskOutcome = {
				taskId: "TP-100",
				status: "running",
				startTime: Date.now() - 1000,
				endTime: null,
				exitReason: "Task in progress",
				sessionName: "orch-lane-1",
				doneFileFound: false,
				laneNumber: 1,
			};

			const batchState = freshOrchBatchState();
			batchState.phase = "executing";
			batchState.batchId = "20260403T210000";
			batchState.baseBranch = "main";
			batchState.orchBranch = "orch/test";
			batchState.mode = "repo";
			batchState.startedAt = Date.now() - 2000;
			batchState.currentWaveIndex = 0;
			batchState.totalWaves = 1;
			batchState.totalTasks = 1;
			batchState.currentLanes = [lane];
			batchState.segments = [{
				segmentId: "TP-100::api",
				taskId: "TP-100",
				repoId: "api",
				status: "running",
				laneId: "lane-1",
				sessionName: "orch-lane-1",
				worktreePath: "/tmp/worktree-1",
				branch: "task/lane-1",
				startedAt: Date.now() - 1000,
				endedAt: null,
				retries: 0,
				exitReason: "Segment running",
				dependsOnSegmentIds: [],
			}];

			persistRuntimeState(
				"segment-start",
				batchState,
				[["TP-100"]],
				[lane],
				[outcome],
				null,
				repoRoot,
			);

			const statePath = join(repoRoot, ".pi", "batch-state.json");
			const persisted = JSON.parse(readFileSync(statePath, "utf8")) as {
				tasks: Array<{ taskId: string; activeSegmentId?: string | null }>;
				segments: Array<{ segmentId: string; status: string }>;
			};

			expect(persisted.segments).toHaveLength(1);
			expect(persisted.segments[0].segmentId).toBe("TP-100::api");
			expect(persisted.segments[0].status).toBe("running");
			expect(persisted.tasks[0].taskId).toBe("TP-100");
			expect(persisted.tasks[0].activeSegmentId).toBe("TP-100::api");
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
