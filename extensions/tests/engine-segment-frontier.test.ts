import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import { buildSegmentFrontierWaves, linearizeTaskSegmentPlan } from "../taskplane/engine.ts";
import { buildExecutionUnit } from "../taskplane/execution.ts";
import type { AllocatedLane, AllocatedTask, ParsedTask, TaskSegmentPlan } from "../taskplane/types.ts";

function makeTask(taskId: string, repoId?: string): ParsedTask {
	return {
		taskId,
		taskName: taskId,
		reviewLevel: 1,
		size: "M",
		dependencies: [],
		fileScope: [],
		taskFolder: `/workspace/tasks/${taskId}`,
		promptPath: `/workspace/tasks/${taskId}/PROMPT.md`,
		areaName: "default",
		status: "pending",
		resolvedRepoId: repoId,
	};
}

describe("TP-133 segment frontier helpers", () => {
	it("repo-singleton tasks keep one execution round", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-001", makeTask("TP-001", "api")],
		]);

		const frontier = buildSegmentFrontierWaves([["TP-001"]], pending);
		expect(frontier.waves).toEqual([["TP-001"]]);

		const task = pending.get("TP-001")!;
		expect(task.segmentIds).toEqual(["TP-001::api"]);
		expect(task.activeSegmentId).toBeNull();
	});

	it("repo mode does not synthesize resolvedRepoId during frontier expansion", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-002", makeTask("TP-002")],
		]);

		buildSegmentFrontierWaves([["TP-002"]], pending);
		expect(pending.get("TP-002")!.resolvedRepoId).toBeUndefined();
		expect(pending.get("TP-002")!.segmentIds).toEqual(["TP-002::default"]);
	});

	it("engine dispatch only writes resolvedRepoId in workspace mode", () => {
		const src = readFileSync(new URL("../taskplane/engine.ts", import.meta.url), "utf-8");
		expect(src).toMatch(/if \(workspaceConfig\) \{\s*task\.resolvedRepoId = activeSegment\.repoId;/);
	});

	it("multi-segment task is decomposed into sequential rounds", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-010", makeTask("TP-010", "api")],
		]);

		const plan: TaskSegmentPlan = {
			taskId: "TP-010",
			mode: "explicit-dag",
			segments: [
				{ segmentId: "TP-010::api", taskId: "TP-010", repoId: "api", order: 0 },
				{ segmentId: "TP-010::web", taskId: "TP-010", repoId: "web", order: 1 },
				{ segmentId: "TP-010::docs", taskId: "TP-010", repoId: "docs", order: 2 },
			],
			edges: [
				{ fromSegmentId: "TP-010::api", toSegmentId: "TP-010::web", provenance: "explicit", reason: "explicit" },
				{ fromSegmentId: "TP-010::web", toSegmentId: "TP-010::docs", provenance: "explicit", reason: "explicit" },
			],
		};

		const frontier = buildSegmentFrontierWaves(
			[["TP-010"]],
			pending,
			new Map([["TP-010", plan]]),
		);

		expect(frontier.waves).toEqual([["TP-010"], ["TP-010"], ["TP-010"]]);
		const state = frontier.taskStateById.get("TP-010")!;
		expect(state.orderedSegments.map((s) => s.segmentId)).toEqual([
			"TP-010::api",
			"TP-010::web",
			"TP-010::docs",
		]);
	});

	it("linearization respects DAG edges (dependent segment last)", () => {
		const plan: TaskSegmentPlan = {
			taskId: "TP-020",
			mode: "explicit-dag",
			segments: [
				{ segmentId: "TP-020::api", taskId: "TP-020", repoId: "api", order: 0 },
				{ segmentId: "TP-020::web", taskId: "TP-020", repoId: "web", order: 1 },
				{ segmentId: "TP-020::docs", taskId: "TP-020", repoId: "docs", order: 2 },
			],
			edges: [
				{ fromSegmentId: "TP-020::api", toSegmentId: "TP-020::docs", provenance: "explicit", reason: "explicit" },
				{ fromSegmentId: "TP-020::web", toSegmentId: "TP-020::docs", provenance: "explicit", reason: "explicit" },
			],
		};

		const order = linearizeTaskSegmentPlan(plan).map((s) => s.segmentId);
		expect(order[order.length - 1]).toBe("TP-020::docs");
		expect(order.slice(0, 2).sort()).toEqual(["TP-020::api", "TP-020::web"]);
	});

	it("buildExecutionUnit uses packet-home STATUS/.DONE paths when provided", () => {
		const lane: AllocatedLane = {
			laneNumber: 1,
			laneId: "lane-1",
			laneSessionId: "orch-op-lane-1",
			worktreePath: "/repos/api/.worktrees/lane-1",
			branch: "orch/op-batch-lane-1",
			tasks: [],
			strategy: "affinity-first",
			estimatedLoad: 1,
			estimatedMinutes: 5,
			repoId: "api",
		};

		const parsed = makeTask("TP-030", "api");
		parsed.packetRepoId = "packets";
		parsed.packetTaskPath = "/repos/packets/taskplane-tasks/TP-030";
		parsed.activeSegmentId = "TP-030::api";

		const allocatedTask: AllocatedTask = {
			taskId: "TP-030",
			order: 0,
			task: parsed,
			estimatedMinutes: 5,
		};

		const unit = buildExecutionUnit(lane, allocatedTask, "/repos/api", true);
		expect(unit.packet.donePath).toBe("/repos/packets/taskplane-tasks/TP-030/.DONE");
		expect(unit.packet.statusPath).toBe("/repos/packets/taskplane-tasks/TP-030/STATUS.md");
		expect(unit.packetHomeRepoId).toBe("packets");
		expect(unit.packet.donePath.includes(lane.worktreePath)).toBe(false);
	});
});
