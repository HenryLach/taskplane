import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import {
	applySegmentExpansionMutation,
	processSegmentExpansionRequestAtBoundary,
} from "../taskplane/engine.ts";
import {
	buildResumeRuntimeWavePlan,
	reconstructSegmentFrontier,
} from "../taskplane/resume.ts";
import { defaultBatchDiagnostics, defaultResilienceState } from "../taskplane/types.ts";
import type { PersistedBatchState, PersistedSegmentRecord, SegmentExpansionRequest } from "../taskplane/types.ts";

function makeExpansionRequest(overrides: Partial<SegmentExpansionRequest> = {}): SegmentExpansionRequest {
	return {
		requestId: "exp-001",
		taskId: "TP-900",
		fromSegmentId: "TP-900::api",
		requestedRepoIds: ["api"],
		rationale: "follow-up",
		placement: "after-current",
		edges: [],
		timestamp: Date.now(),
		...overrides,
	};
}

function makeState(overrides: Partial<PersistedBatchState> = {}): PersistedBatchState {
	return {
		schemaVersion: 4,
		phase: "executing",
		batchId: "20260406T000000",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: Date.now() - 1000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-900"]],
		lanes: [],
		tasks: [{
			taskId: "TP-900",
			laneNumber: 1,
			sessionName: "",
			status: "pending",
			taskFolder: "/tmp/tasks/TP-900",
			startedAt: null,
			endedAt: null,
			doneFileFound: false,
			exitReason: "",
			segmentIds: ["TP-900::api"],
			activeSegmentId: null,
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
		segmentId: "TP-900::api",
		taskId: "TP-900",
		repoId: "api",
		status: "pending",
		laneId: "",
		sessionName: "",
		worktreePath: "",
		branch: "orch/test",
		startedAt: null,
		endedAt: null,
		retries: 0,
		exitReason: "",
		dependsOnSegmentIds: [],
		...overrides,
	};
}

describe("TP-143 segment expansion engine coverage", () => {
	it("mutation covers linear, fan-out, end placement, and repeat-repo disambiguation", () => {
		const linearState: any = {
			taskId: "TP-901",
			orderedSegments: [
				{ segmentId: "TP-901::a", taskId: "TP-901", repoId: "a", order: 0 },
				{ segmentId: "TP-901::b", taskId: "TP-901", repoId: "b", order: 1 },
				{ segmentId: "TP-901::c", taskId: "TP-901", repoId: "c", order: 2 },
			],
			nextSegmentIndex: 2,
			statusBySegmentId: new Map([["TP-901::a", "succeeded"], ["TP-901::b", "succeeded"], ["TP-901::c", "pending"]]),
			dependsOnBySegmentId: new Map([["TP-901::a", []], ["TP-901::b", ["TP-901::a"]], ["TP-901::c", ["TP-901::b"]]]),
			terminalStatus: "pending",
		};
		const linear = applySegmentExpansionMutation(linearState, makeExpansionRequest({
			requestId: "exp-linear",
			taskId: "TP-901",
			fromSegmentId: "TP-901::b",
			requestedRepoIds: ["x"],
			placement: "after-current",
			edges: [],
		}), "TP-901::b");
		expect(linear.insertedSegmentIds).toEqual(["TP-901::x"]);
		expect(linearState.dependsOnBySegmentId.get("TP-901::c")).toEqual(["TP-901::x"]);

		const fanoutState: any = {
			taskId: "TP-902",
			orderedSegments: [
				{ segmentId: "TP-902::a", taskId: "TP-902", repoId: "a", order: 0 },
				{ segmentId: "TP-902::b", taskId: "TP-902", repoId: "b", order: 1 },
				{ segmentId: "TP-902::c", taskId: "TP-902", repoId: "c", order: 2 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([["TP-902::a", "succeeded"], ["TP-902::b", "pending"], ["TP-902::c", "pending"]]),
			dependsOnBySegmentId: new Map([["TP-902::a", []], ["TP-902::b", ["TP-902::a"]], ["TP-902::c", ["TP-902::a"]]]),
			terminalStatus: "pending",
		};
		const fanout = applySegmentExpansionMutation(fanoutState, makeExpansionRequest({
			requestId: "exp-fanout",
			taskId: "TP-902",
			fromSegmentId: "TP-902::a",
			requestedRepoIds: ["x"],
			placement: "after-current",
			edges: [],
		}), "TP-902::a");
		expect(fanout.insertedSegmentIds).toEqual(["TP-902::x"]);
		expect(fanoutState.dependsOnBySegmentId.get("TP-902::b")).toEqual(["TP-902::x"]);
		expect(fanoutState.dependsOnBySegmentId.get("TP-902::c")).toEqual(["TP-902::x"]);

		const endState: any = {
			taskId: "TP-903",
			orderedSegments: [
				{ segmentId: "TP-903::a", taskId: "TP-903", repoId: "a", order: 0 },
				{ segmentId: "TP-903::b", taskId: "TP-903", repoId: "b", order: 1 },
				{ segmentId: "TP-903::c", taskId: "TP-903", repoId: "c", order: 2 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([["TP-903::a", "succeeded"], ["TP-903::b", "pending"], ["TP-903::c", "pending"]]),
			dependsOnBySegmentId: new Map([["TP-903::a", []], ["TP-903::b", ["TP-903::a"]], ["TP-903::c", ["TP-903::a"]]]),
			terminalStatus: "pending",
		};
		const end = applySegmentExpansionMutation(endState, makeExpansionRequest({
			requestId: "exp-end",
			taskId: "TP-903",
			fromSegmentId: "TP-903::c",
			requestedRepoIds: ["x", "y"],
			placement: "end",
			edges: [{ from: "x", to: "y" }],
		}), "TP-903::c");
		expect(end.insertedSegmentIds).toEqual(["TP-903::x", "TP-903::y"]);
		expect(endState.dependsOnBySegmentId.get("TP-903::x")?.sort()).toEqual(["TP-903::b", "TP-903::c"]);

		const repeatState: any = {
			taskId: "TP-904",
			orderedSegments: [
				{ segmentId: "TP-904::api", taskId: "TP-904", repoId: "api", order: 0 },
				{ segmentId: "TP-904::api::3", taskId: "TP-904", repoId: "api", order: 1 },
			],
			nextSegmentIndex: 1,
			statusBySegmentId: new Map([["TP-904::api", "succeeded"], ["TP-904::api::3", "pending"]]),
			dependsOnBySegmentId: new Map([["TP-904::api", []], ["TP-904::api::3", ["TP-904::api"]]]),
			terminalStatus: "pending",
		};
		const repeat = applySegmentExpansionMutation(repeatState, makeExpansionRequest({
			requestId: "exp-repeat",
			taskId: "TP-904",
			fromSegmentId: "TP-904::api::3",
			requestedRepoIds: ["api"],
			placement: "end",
		}), "TP-904::api::3");
		expect(repeat.insertedSegmentIds).toEqual(["TP-904::api::4"]);
	});

	it("validation rejects unknown repos, cycles, and duplicate request IDs", () => {
		const baseState: any = { terminalStatus: "pending" };
		const unknownRepo = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-905",
			"TP-905::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-005.json", request: makeExpansionRequest({ taskId: "TP-905", fromSegmentId: "TP-905::api", requestedRepoIds: ["web"] }) },
			baseState,
			{ repos: new Map([["api", {}]]) } as any,
			new Set<string>(),
		);
		expect(unknownRepo.ok).toBe(false);

		const cycle = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-905",
			"TP-905::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-006.json", request: makeExpansionRequest({ taskId: "TP-905", fromSegmentId: "TP-905::api", requestedRepoIds: ["api", "web"], edges: [{ from: "api", to: "web" }, { from: "web", to: "api" }] }) },
			baseState,
			{ repos: new Map([["api", {}], ["web", {}]]) } as any,
			new Set<string>(),
		);
		expect(cycle.ok).toBe(false);

		const knownRequestIds = new Set<string>();
		const accepted = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-905",
			"TP-905::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-007.json", request: makeExpansionRequest({ requestId: "exp-dupe", taskId: "TP-905", fromSegmentId: "TP-905::api" }) },
			baseState,
			{ repos: new Map([["api", {}]]) } as any,
			knownRequestIds,
		);
		expect(accepted.ok).toBe(true);
		const duplicate = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-905",
			"TP-905::api",
			"agent-1",
			{ filePath: "/tmp/segment-expansion-exp-007-dupe.json", request: makeExpansionRequest({ requestId: "exp-dupe", taskId: "TP-905", fromSegmentId: "TP-905::api" }) },
			baseState,
			{ repos: new Map([["api", {}]]) } as any,
			knownRequestIds,
		);
		expect(duplicate.ok).toBe(false);
	});

	it("resume after expansion keeps pending segments schedulable and extends missing rounds", () => {
		const state = makeState({
			wavePlan: [["TP-906"]],
			totalWaves: 1,
			tasks: [{
				taskId: "TP-906",
				laneNumber: 1,
				sessionName: "",
				status: "pending",
				taskFolder: "/tmp/tasks/TP-906",
				startedAt: null,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
				segmentIds: ["TP-906::api", "TP-906::web"],
				activeSegmentId: null,
			}],
			segments: [
				makeSegment({ taskId: "TP-906", segmentId: "TP-906::api", status: "succeeded", endedAt: Date.now() - 200 }),
				makeSegment({ taskId: "TP-906", segmentId: "TP-906::web", repoId: "web", status: "pending", dependsOnSegmentIds: ["TP-906::api"] }),
			],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].activeSegmentId).toBe("TP-906::web");
		expect(buildResumeRuntimeWavePlan(state)).toEqual([["TP-906"], ["TP-906"]]);
	});

	it("boundary handling keeps deterministic request ordering and failed-origin/malformed file lifecycle guards", () => {
		const src = readFileSync(new URL("../taskplane/engine.ts", import.meta.url), "utf-8");
		expect(src).toMatch(/orderedRequests = \[\.\.\.parsedRequests\.valid\]\.sort\(\(a, b\) => a\.request\.requestId\.localeCompare\(b\.request\.requestId\)\)/);
		expect(src).toContain("markSegmentExpansionRequestFile(requestFile.filePath, \"discarded\")");
		expect(src).toContain("segment expansion request malformed");
	});
});
