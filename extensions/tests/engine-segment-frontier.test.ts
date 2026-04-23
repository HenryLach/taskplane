import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import {
	applySegmentExpansionMutation,
	buildSegmentFrontierWaves,
	collectProcessedSegmentExpansionRequestIds,
	linearizeTaskSegmentPlan,
	processSegmentExpansionRequestAtBoundary,
	resolveDisplayWaveNumber,
	scheduleContinuationSegmentRound,
	upsertPendingExpandedSegmentRecords,
} from "../taskplane/engine.ts";
import { buildExecutionUnit, ensureTaskFilesCommitted } from "../taskplane/execution.ts";
import type { AllocatedLane, AllocatedTask, ParsedTask, SegmentExpansionRequest, TaskSegmentPlan } from "../taskplane/types.ts";

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

function makeExpansionRequest(overrides: Partial<SegmentExpansionRequest> = {}): SegmentExpansionRequest {
	return {
		requestId: "exp-001",
		taskId: "TP-100",
		fromSegmentId: "TP-100::api",
		requestedRepoIds: ["api"],
		rationale: "follow-up",
		placement: "after-current",
		edges: [],
		timestamp: Date.now(),
		...overrides,
	};
}

describe("TP-133 segment frontier helpers", () => {
	it("repo-singleton tasks keep one execution round", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-001", makeTask("TP-001", "api")],
		]);

		const frontier = buildSegmentFrontierWaves([["TP-001"]], pending);
		expect(frontier.waves).toEqual([["TP-001"]]);
		expect(frontier.taskLevelWaveCount).toBe(1);
		expect(frontier.roundToTaskWave).toEqual([0]);

		const task = pending.get("TP-001")!;
		expect(task.segmentIds).toEqual(["TP-001::api"]);
		expect(task.resolvedRepoIds).toEqual(["api"]);
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
		// TP-166: Task-level wave count should be 1 (one original wave), not 3
		expect(frontier.taskLevelWaveCount).toBe(1);
		expect(frontier.roundToTaskWave).toEqual([0, 0, 0]);
		const state = frontier.taskStateById.get("TP-010")!;
		expect(pending.get("TP-010")!.resolvedRepoIds).toEqual(["api", "web", "docs"]);
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

	it("frontier expansion honors explicit DAG dependencies even when segment order conflicts", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-021", makeTask("TP-021", "api")],
		]);

		const plan: TaskSegmentPlan = {
			taskId: "TP-021",
			mode: "explicit-dag",
			segments: [
				{ segmentId: "TP-021::docs", taskId: "TP-021", repoId: "docs", order: 0 },
				{ segmentId: "TP-021::api", taskId: "TP-021", repoId: "api", order: 1 },
				{ segmentId: "TP-021::web", taskId: "TP-021", repoId: "web", order: 2 },
			],
			edges: [
				{ fromSegmentId: "TP-021::api", toSegmentId: "TP-021::docs", provenance: "explicit", reason: "explicit" },
				{ fromSegmentId: "TP-021::web", toSegmentId: "TP-021::docs", provenance: "explicit", reason: "explicit" },
			],
		};

		const frontier = buildSegmentFrontierWaves(
			[["TP-021"]],
			pending,
			new Map([["TP-021", plan]]),
		);

		expect(frontier.waves).toEqual([["TP-021"], ["TP-021"], ["TP-021"]]);
		const state = frontier.taskStateById.get("TP-021")!;
		expect(state.orderedSegments.map((segment) => segment.segmentId)).toEqual([
			"TP-021::api",
			"TP-021::web",
			"TP-021::docs",
		]);
		expect(pending.get("TP-021")!.participatingRepoIds).toEqual(["api", "web", "docs"]);
		expect(pending.get("TP-021")!.resolvedRepoIds).toEqual(["api", "web", "docs"]);
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

describe("segment expansion boundary validation smoke", () => {
	it("rejects unknown repo IDs in workspace mode", () => {
		const request = makeExpansionRequest({ requestedRepoIds: ["web"] });
		const result = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-100",
			"TP-100::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-001.json", request },
			{ terminalStatus: "pending" } as any,
			{ repos: new Map([ ["api", {}] ]) } as any,
			new Set<string>(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/unknown repoId/);
		}
	});

	it("accepts valid request and enforces requestId idempotency", () => {
		const request = makeExpansionRequest({ requestedRepoIds: ["api"] });
		const knownRequestIds = new Set<string>();
		const first = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-100",
			"TP-100::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-001.json", request },
			{ terminalStatus: "pending" } as any,
			{ repos: new Map([ ["api", {}] ]) } as any,
			knownRequestIds,
		);
		expect(first).toEqual({ ok: true });
		expect(knownRequestIds.has("exp-001")).toBe(true);

		const duplicate = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-100",
			"TP-100::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-001-dupe.json", request },
			{ terminalStatus: "pending" } as any,
			{ repos: new Map([ ["api", {}] ]) } as any,
			knownRequestIds,
		);
		expect(duplicate.ok).toBe(false);
		if (!duplicate.ok) {
			expect(duplicate.reason).toMatch(/already processed/);
		}
	});
});

describe("segment expansion graph mutation", () => {
	it("rewires after-current by routing anchor successors through inserted sinks", () => {
		const segmentState: any = {
			taskId: "TP-300",
			orderedSegments: [
				{ segmentId: "TP-300::api", taskId: "TP-300", repoId: "api", order: 0 },
				{ segmentId: "TP-300::web", taskId: "TP-300", repoId: "web", order: 1 },
				{ segmentId: "TP-300::docs", taskId: "TP-300", repoId: "docs", order: 2 },
			],
			nextSegmentIndex: 2,
			statusBySegmentId: new Map([
				["TP-300::api", "succeeded"],
				["TP-300::web", "succeeded"],
				["TP-300::docs", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-300::api", []],
				["TP-300::web", ["TP-300::api"]],
				["TP-300::docs", ["TP-300::web"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-after-current",
			taskId: "TP-300",
			fromSegmentId: "TP-300::web",
			requestedRepoIds: ["ops"],
			placement: "after-current",
			edges: [],
		});

		const result = applySegmentExpansionMutation(segmentState, request, "TP-300::web");
		expect(result.insertedSegmentIds).toEqual(["TP-300::ops"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-300::ops")).toEqual(["TP-300::web"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-300::docs")).toEqual(["TP-300::ops"]);
		expect(segmentState.orderedSegments.map((segment: any) => segment.segmentId)).toEqual([
			"TP-300::api",
			"TP-300::web",
			"TP-300::ops",
			"TP-300::docs",
		]);
		expect(segmentState.nextSegmentIndex).toBe(2);
		expect(segmentState.statusBySegmentId.get("TP-300::ops")).toBe("pending");
	});

	it("TP-007-style api-service expansion rewires order and schedules web-client continuation", () => {
		const segmentState: any = {
			taskId: "TP-007",
			orderedSegments: [
				{ segmentId: "TP-007::api-service", taskId: "TP-007", repoId: "api-service", order: 0 },
				{ segmentId: "TP-007::docs", taskId: "TP-007", repoId: "docs", order: 1 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([
				["TP-007::api-service", "succeeded"],
				["TP-007::docs", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-007::api-service", []],
				["TP-007::docs", ["TP-007::api-service"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-tp007",
			taskId: "TP-007",
			fromSegmentId: "TP-007::api-service",
			requestedRepoIds: ["web-client"],
			placement: "after-current",
			edges: [],
		});

		const mutation = applySegmentExpansionMutation(segmentState, request, "TP-007::api-service");
		expect(mutation.insertedSegmentIds).toEqual(["TP-007::web-client"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-007::web-client")).toEqual(["TP-007::api-service"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-007::docs")).toEqual(["TP-007::web-client"]);
		expect(segmentState.orderedSegments.map((segment: any) => segment.segmentId)).toEqual([
			"TP-007::api-service",
			"TP-007::web-client",
			"TP-007::docs",
		]);

		const runtimeRounds = [["TP-007"], ["TP-099"]];
		expect(scheduleContinuationSegmentRound(runtimeRounds, 0, ["TP-007"])).toEqual(["TP-007"]);
		expect(runtimeRounds).toEqual([["TP-007"], ["TP-007"], ["TP-099"]]);
	});

	it("TP-007-style approved expansion upserts pending web-client segment persistence metadata", () => {
		const segmentState: any = {
			taskId: "TP-007",
			orderedSegments: [
				{ segmentId: "TP-007::api-service", taskId: "TP-007", repoId: "api-service", order: 0 },
				{ segmentId: "TP-007::docs", taskId: "TP-007", repoId: "docs", order: 1 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([
				["TP-007::api-service", "succeeded"],
				["TP-007::docs", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-007::api-service", []],
				["TP-007::docs", ["TP-007::api-service"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-tp007-persist",
			taskId: "TP-007",
			fromSegmentId: "TP-007::api-service",
			requestedRepoIds: ["web-client"],
			placement: "after-current",
		});
		const mutation = applySegmentExpansionMutation(segmentState, request, "TP-007::api-service");

		const task = makeTask("TP-007", "api-service");
		const batchState: any = { orchBranch: "orch/tp-007", segments: [] };
		const changed = upsertPendingExpandedSegmentRecords(
			batchState,
			task,
			segmentState,
			mutation.insertedSegmentIds,
			"TP-007::api-service",
			request.requestId,
			batchState.orchBranch,
		);
		expect(changed).toBe(true);

		const webRecord = batchState.segments.find((record: any) => record.segmentId === "TP-007::web-client");
		expect(webRecord).toBeTruthy();
		expect(webRecord.taskId).toBe("TP-007");
		expect(webRecord.repoId).toBe("web-client");
		expect(webRecord.status).toBe("pending");
		expect(webRecord.dependsOnSegmentIds).toEqual(["TP-007::api-service"]);
		expect(webRecord.expandedFrom).toBe("TP-007::api-service");
		expect(webRecord.expansionRequestId).toBe("exp-tp007-persist");
		expect(webRecord.branch).toBe("orch/tp-007");
	});

	it("end placement connects all current terminals to roots of inserted DAG", () => {
		const segmentState: any = {
			taskId: "TP-301",
			orderedSegments: [
				{ segmentId: "TP-301::api", taskId: "TP-301", repoId: "api", order: 0 },
				{ segmentId: "TP-301::web", taskId: "TP-301", repoId: "web", order: 1 },
				{ segmentId: "TP-301::docs", taskId: "TP-301", repoId: "docs", order: 2 },
			],
			nextSegmentIndex: 2,
			statusBySegmentId: new Map([
				["TP-301::api", "succeeded"],
				["TP-301::web", "pending"],
				["TP-301::docs", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-301::api", []],
				["TP-301::web", ["TP-301::api"]],
				["TP-301::docs", ["TP-301::api"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-end",
			taskId: "TP-301",
			fromSegmentId: "TP-301::docs",
			requestedRepoIds: ["ops", "infra"],
			placement: "end",
			edges: [{ from: "ops", to: "infra" }],
		});

		const result = applySegmentExpansionMutation(segmentState, request, "TP-301::docs");
		expect(result.insertedSegmentIds).toEqual(["TP-301::ops", "TP-301::infra"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-301::ops")?.sort()).toEqual(["TP-301::docs", "TP-301::web"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-301::infra")).toEqual(["TP-301::ops"]);
		expect(segmentState.orderedSegments.map((segment: any) => segment.segmentId).slice(-2)).toEqual([
			"TP-301::ops",
			"TP-301::infra",
		]);
	});

	it("repeat repo IDs use max-existing suffix + 1", () => {
		const segmentState: any = {
			taskId: "TP-302",
			orderedSegments: [
				{ segmentId: "TP-302::api", taskId: "TP-302", repoId: "api", order: 0 },
				{ segmentId: "TP-302::api::3", taskId: "TP-302", repoId: "api", order: 1 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([
				["TP-302::api", "succeeded"],
				["TP-302::api::3", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-302::api", []],
				["TP-302::api::3", ["TP-302::api"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-repeat-repo",
			taskId: "TP-302",
			fromSegmentId: "TP-302::api::3",
			requestedRepoIds: ["api"],
			placement: "end",
			edges: [],
		});

		const result = applySegmentExpansionMutation(segmentState, request, "TP-302::api::3");
		expect(result.insertedSegmentIds).toEqual(["TP-302::api::4"]);
	});

	it("TP-008-style repeat-repo expansion creates shared-libs::2 from api-service boundary", () => {
		const segmentState: any = {
			taskId: "TP-008",
			orderedSegments: [
				{ segmentId: "TP-008::shared-libs", taskId: "TP-008", repoId: "shared-libs", order: 0 },
				{ segmentId: "TP-008::api-service", taskId: "TP-008", repoId: "api-service", order: 1 },
			],
			nextSegmentIndex: 2,
			statusBySegmentId: new Map([
				["TP-008::shared-libs", "succeeded"],
				["TP-008::api-service", "succeeded"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-008::shared-libs", []],
				["TP-008::api-service", ["TP-008::shared-libs"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-tp008-repeat",
			taskId: "TP-008",
			fromSegmentId: "TP-008::api-service",
			requestedRepoIds: ["shared-libs"],
			placement: "after-current",
		});

		const mutation = applySegmentExpansionMutation(segmentState, request, "TP-008::api-service");
		expect(mutation.insertedSegmentIds).toEqual(["TP-008::shared-libs::2"]);
		expect(segmentState.orderedSegments.map((segment: any) => segment.segmentId)).toEqual([
			"TP-008::shared-libs",
			"TP-008::api-service",
			"TP-008::shared-libs::2",
		]);
		expect(segmentState.dependsOnBySegmentId.get("TP-008::shared-libs::2")).toEqual(["TP-008::api-service"]);
	});

	it("TP-008 repeat-repo insertion rewires downstream dependents through shared-libs::2", () => {
		const segmentState: any = {
			taskId: "TP-008",
			orderedSegments: [
				{ segmentId: "TP-008::shared-libs", taskId: "TP-008", repoId: "shared-libs", order: 0 },
				{ segmentId: "TP-008::api-service", taskId: "TP-008", repoId: "api-service", order: 1 },
				{ segmentId: "TP-008::web-client", taskId: "TP-008", repoId: "web-client", order: 2 },
			],
			nextSegmentIndex: 2,
			statusBySegmentId: new Map([
				["TP-008::shared-libs", "succeeded"],
				["TP-008::api-service", "succeeded"],
				["TP-008::web-client", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-008::shared-libs", []],
				["TP-008::api-service", ["TP-008::shared-libs"]],
				["TP-008::web-client", ["TP-008::api-service"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-tp008-rewire",
			taskId: "TP-008",
			fromSegmentId: "TP-008::api-service",
			requestedRepoIds: ["shared-libs"],
			placement: "after-current",
		});

		const mutation = applySegmentExpansionMutation(segmentState, request, "TP-008::api-service");
		expect(mutation.insertedSegmentIds).toEqual(["TP-008::shared-libs::2"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-008::shared-libs::2")).toEqual(["TP-008::api-service"]);
		expect(segmentState.dependsOnBySegmentId.get("TP-008::web-client")).toEqual(["TP-008::shared-libs::2"]);
	});

	it("TP-008 repeat-repo persistence uses orch-branch provisioning metadata for shared-libs::2", () => {
		const segmentState: any = {
			taskId: "TP-008",
			orderedSegments: [
				{ segmentId: "TP-008::shared-libs", taskId: "TP-008", repoId: "shared-libs", order: 0 },
				{ segmentId: "TP-008::api-service", taskId: "TP-008", repoId: "api-service", order: 1 },
			],
			nextSegmentIndex: 2,
			statusBySegmentId: new Map([
				["TP-008::shared-libs", "succeeded"],
				["TP-008::api-service", "succeeded"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-008::shared-libs", []],
				["TP-008::api-service", ["TP-008::shared-libs"]],
			]),
			terminalStatus: "pending",
		};
		const request = makeExpansionRequest({
			requestId: "exp-tp008-persist",
			taskId: "TP-008",
			fromSegmentId: "TP-008::api-service",
			requestedRepoIds: ["shared-libs"],
			placement: "after-current",
		});
		const mutation = applySegmentExpansionMutation(segmentState, request, "TP-008::api-service");
		const task = makeTask("TP-008", "api-service");
		const batchState: any = { orchBranch: "orch/tp-008", segments: [] };

		const changed = upsertPendingExpandedSegmentRecords(
			batchState,
			task,
			segmentState,
			mutation.insertedSegmentIds,
			"TP-008::api-service",
			request.requestId,
			batchState.orchBranch,
		);
		expect(changed).toBe(true);

		const secondPassRecord = batchState.segments.find((record: any) => record.segmentId === "TP-008::shared-libs::2");
		expect(secondPassRecord).toBeTruthy();
		expect(secondPassRecord.repoId).toBe("shared-libs");
		expect(secondPassRecord.branch).toBe("orch/tp-008");
		expect(secondPassRecord.status).toBe("pending");
		expect(secondPassRecord.dependsOnSegmentIds).toEqual(["TP-008::api-service"]);
		expect(secondPassRecord.expandedFrom).toBe("TP-008::api-service");
		expect(secondPassRecord.expansionRequestId).toBe("exp-tp008-persist");
	});

	it("continuation round insertion keeps expanded tasks executable before the next planned task wave", () => {
		const runtimeRounds = [
			["TP-400"],
			["TP-500"],
		];
		const inserted = scheduleContinuationSegmentRound(runtimeRounds, 0, ["TP-400"]);
		expect(inserted).toEqual(["TP-400"]);
		expect(runtimeRounds).toEqual([
			["TP-400"],
			["TP-400"],
			["TP-500"],
		]);
	});

	it("resyncs persisted pending dependencies across sequential approved requests on one boundary", () => {
		const segmentState: any = {
			taskId: "TP-401",
			orderedSegments: [
				{ segmentId: "TP-401::api", taskId: "TP-401", repoId: "api", order: 0 },
				{ segmentId: "TP-401::web", taskId: "TP-401", repoId: "web", order: 1 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([
				["TP-401::api", "succeeded"],
				["TP-401::web", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-401::api", []],
				["TP-401::web", ["TP-401::api"]],
			]),
			terminalStatus: "pending",
		};
		const task = makeTask("TP-401", "api");
		const batchState: any = { orchBranch: "orch/test-batch", segments: [] };

		const firstRequest = makeExpansionRequest({
			requestId: "exp-401-1",
			taskId: "TP-401",
			fromSegmentId: "TP-401::api",
			requestedRepoIds: ["ops"],
			placement: "after-current",
			edges: [],
		});
		const firstMutation = applySegmentExpansionMutation(segmentState, firstRequest, "TP-401::api");
		upsertPendingExpandedSegmentRecords(
			batchState,
			task,
			segmentState,
			firstMutation.insertedSegmentIds,
			"TP-401::api",
			firstRequest.requestId,
			batchState.orchBranch,
		);

		const secondRequest = makeExpansionRequest({
			requestId: "exp-401-2",
			taskId: "TP-401",
			fromSegmentId: "TP-401::api",
			requestedRepoIds: ["infra"],
			placement: "after-current",
			edges: [],
		});
		const secondMutation = applySegmentExpansionMutation(segmentState, secondRequest, "TP-401::api");
		upsertPendingExpandedSegmentRecords(
			batchState,
			task,
			segmentState,
			secondMutation.insertedSegmentIds,
			"TP-401::api",
			secondRequest.requestId,
			batchState.orchBranch,
		);

		const opsRecord = batchState.segments.find((record: any) => record.segmentId === "TP-401::ops");
		expect(opsRecord.dependsOnSegmentIds).toEqual(["TP-401::infra"]);
	});

	it("approval path persists mutation state before renaming request file to .processed", () => {
		const src = readFileSync(new URL("../taskplane/engine.ts", import.meta.url), "utf-8");
		expect(src).toMatch(/persistRuntimeState\("segment-expansion-approved"[\s\S]*markSegmentExpansionRequestFile\(pendingRequest\.filePath, "processed"\)/);
	});

	it("pending segment persistence carries expansion provenance and orch-branch provisioning metadata", () => {
		const src = readFileSync(new URL("../taskplane/engine.ts", import.meta.url), "utf-8");
		expect(src).toContain("expandedFrom");
		expect(src).toContain("expansionRequestId");
		expect(src).toContain("batchState.orchBranch");
	});

	it("idempotency seed includes previously processed request IDs from persisted resilience history", () => {
		const processed = collectProcessedSegmentExpansionRequestIds({
			resilience: {
				repairHistory: [
					{ id: "exp-keep", strategy: "segment-expansion-request" },
					{ id: "other", strategy: "stale-worktree-cleanup" },
				] as any,
			},
		} as any);
		expect([...processed].sort()).toEqual(["exp-keep"]);
	});
});

// TP-166: resolveDisplayWaveNumber unit tests
describe("TP-166 resolveDisplayWaveNumber", () => {
	it("maps segment round to task-level wave with full metadata", () => {
		// 3 task-level waves, 5 segment rounds: [0,0,1,1,2]
		const roundToTaskWave = [0, 0, 1, 1, 2];
		const taskLevelWaveCount = 3;

		expect(resolveDisplayWaveNumber(0, roundToTaskWave, taskLevelWaveCount)).toEqual({
			displayWave: 1,
			displayTotal: 3,
		});
		expect(resolveDisplayWaveNumber(1, roundToTaskWave, taskLevelWaveCount)).toEqual({
			displayWave: 1,
			displayTotal: 3,
		});
		expect(resolveDisplayWaveNumber(2, roundToTaskWave, taskLevelWaveCount)).toEqual({
			displayWave: 2,
			displayTotal: 3,
		});
		expect(resolveDisplayWaveNumber(4, roundToTaskWave, taskLevelWaveCount)).toEqual({
			displayWave: 3,
			displayTotal: 3,
		});
	});

	it("falls back to roundIdx + 1 when mapping is undefined (legacy state)", () => {
		expect(resolveDisplayWaveNumber(0, undefined, undefined, 5)).toEqual({
			displayWave: 1,
			displayTotal: 5,
		});
		expect(resolveDisplayWaveNumber(2, undefined, undefined, 5)).toEqual({
			displayWave: 3,
			displayTotal: 5,
		});
	});

	it("falls back to roundIdx + 1 when no fallbackTotal either", () => {
		expect(resolveDisplayWaveNumber(0, undefined, undefined)).toEqual({
			displayWave: 1,
			displayTotal: 1,
		});
		expect(resolveDisplayWaveNumber(3, undefined, undefined)).toEqual({
			displayWave: 4,
			displayTotal: 4,
		});
	});

	it("prefers taskLevelWaveCount over fallbackTotal", () => {
		expect(resolveDisplayWaveNumber(0, [0], 3, 10)).toEqual({
			displayWave: 1,
			displayTotal: 3,
		});
	});
});

// ── TP-169 Regression Tests: buildExecutionUnit guard ────────────────

describe("TP-169 buildExecutionUnit taskFolder guard", () => {
	it("throws EXEC_MISSING_TASK_FOLDER when taskFolder is empty", () => {
		const lane: AllocatedLane = {
			laneNumber: 1,
			laneId: "lane-1",
			laneSessionId: "orch-lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1",
			tasks: [],
			strategy: "round-robin",
			estimatedLoad: 0,
			estimatedMinutes: 0,
		};
		const task: AllocatedTask = {
			taskId: "TP-080",
			order: 0,
			task: { taskFolder: "" } as unknown as ParsedTask,
			estimatedMinutes: 0,
		};

		let threw = false;
		let errCode = "";
		try {
			buildExecutionUnit(lane, task, "/repos/main");
		} catch (err: any) {
			threw = true;
			errCode = err.code ?? "";
		}
		expect(threw).toBe(true);
		expect(errCode).toBe("EXEC_MISSING_TASK_FOLDER");
	});

	it("throws EXEC_MISSING_TASK_FOLDER when task.task is null", () => {
		const lane: AllocatedLane = {
			laneNumber: 1,
			laneId: "lane-1",
			laneSessionId: "orch-lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1",
			tasks: [],
			strategy: "round-robin",
			estimatedLoad: 0,
			estimatedMinutes: 0,
		};
		const task: AllocatedTask = {
			taskId: "TP-081",
			order: 0,
			task: null as unknown as ParsedTask,
			estimatedMinutes: 0,
		};

		let threw = false;
		try {
			buildExecutionUnit(lane, task, "/repos/main");
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});

describe("TP-169 workspace orch branch: ensureTaskFilesCommitted is exported", () => {
	it("ensureTaskFilesCommitted accepts orchBranch parameter", () => {
		// Structural test: ensureTaskFilesCommitted signature includes orchBranch
		const execSrc = readFileSync(
			new URL("../taskplane/execution.ts", import.meta.url),
			"utf-8",
		);
		const fnIdx = execSrc.indexOf("function ensureTaskFilesCommitted");
		const sig = execSrc.slice(fnIdx, fnIdx + 300);
		expect(sig).toContain("orchBranch");
		// TP-169: Must use GIT_INDEX_FILE for orch branch isolation
		const fnBody = execSrc.slice(fnIdx, fnIdx + 5000);
		expect(fnBody).toContain("GIT_INDEX_FILE");
		expect(fnBody).toContain("commit-tree");
		expect(fnBody).toContain("update-ref");
	});
});
