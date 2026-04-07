import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import {
	applySegmentExpansionMutation,
	collectProcessedSegmentExpansionRequestIds,
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

	it("resume reconstructs approved-but-unexecuted expanded segment records from persisted state", () => {
		const state = makeState({
			wavePlan: [["TP-920"]],
			totalWaves: 1,
			tasks: [{
				taskId: "TP-920",
				laneNumber: 1,
				sessionName: "",
				status: "pending",
				taskFolder: "/tmp/tasks/TP-920",
				startedAt: Date.now() - 400,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
				segmentIds: ["TP-920::api-service", "TP-920::web-client"],
				activeSegmentId: null,
			}],
			segments: [
				makeSegment({
					taskId: "TP-920",
					segmentId: "TP-920::api-service",
					repoId: "api-service",
					status: "succeeded",
					endedAt: Date.now() - 200,
				}),
				makeSegment({
					taskId: "TP-920",
					segmentId: "TP-920::web-client",
					repoId: "web-client",
					status: "pending",
					dependsOnSegmentIds: ["TP-920::api-service"],
					expandedFrom: "TP-920::api-service",
					expansionRequestId: "exp-tp920",
					branch: "orch/tp-920",
				}),
			],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].activeSegmentId).toBe("TP-920::web-client");
		expect(buildResumeRuntimeWavePlan(state)).toEqual([["TP-920"], ["TP-920"]]);
		const persistedExpanded = state.segments.find((segment) => segment.segmentId === "TP-920::web-client");
		expect(persistedExpanded?.expandedFrom).toBe("TP-920::api-service");
		expect(persistedExpanded?.expansionRequestId).toBe("exp-tp920");
	});

	it("resume reconstruction activates repeat-repo expanded frontier (shared-libs::2)", () => {
		const state = makeState({
			wavePlan: [["TP-921"]],
			totalWaves: 1,
			tasks: [{
				taskId: "TP-921",
				laneNumber: 1,
				sessionName: "",
				status: "pending",
				taskFolder: "/tmp/tasks/TP-921",
				startedAt: Date.now() - 500,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
				segmentIds: ["TP-921::shared-libs", "TP-921::api-service", "TP-921::shared-libs::2"],
				activeSegmentId: null,
			}],
			segments: [
				makeSegment({
					taskId: "TP-921",
					segmentId: "TP-921::shared-libs",
					repoId: "shared-libs",
					status: "succeeded",
					endedAt: Date.now() - 400,
				}),
				makeSegment({
					taskId: "TP-921",
					segmentId: "TP-921::api-service",
					repoId: "api-service",
					status: "succeeded",
					dependsOnSegmentIds: ["TP-921::shared-libs"],
					endedAt: Date.now() - 200,
				}),
				makeSegment({
					taskId: "TP-921",
					segmentId: "TP-921::shared-libs::2",
					repoId: "shared-libs",
					status: "pending",
					dependsOnSegmentIds: ["TP-921::api-service"],
					expandedFrom: "TP-921::api-service",
					expansionRequestId: "exp-repeat",
				}),
			],
		});

		reconstructSegmentFrontier(state);
		expect(state.tasks[0].activeSegmentId).toBe("TP-921::shared-libs::2");
		expect(buildResumeRuntimeWavePlan(state)).toEqual([["TP-921"], ["TP-921"], ["TP-921"]]);
	});

	it("resume-seeded processed request IDs block duplicate expansion processing", () => {
		const knownRequestIds = collectProcessedSegmentExpansionRequestIds({
			resilience: {
				repairHistory: [
					{ id: "exp-resume-dup", strategy: "segment-expansion-request" },
				] as any,
			},
		} as any);
		expect([...knownRequestIds]).toEqual(["exp-resume-dup"]);

		const duplicate = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-930",
			"TP-930::api",
			"agent-1",
			{
				filePath: "/tmp/segment-expansion-exp-resume-dup.json",
				request: makeExpansionRequest({
					requestId: "exp-resume-dup",
					taskId: "TP-930",
					fromSegmentId: "TP-930::api",
					requestedRepoIds: ["api"],
				}),
			},
			{ terminalStatus: "pending" } as any,
			{ repos: new Map([["api", {}]]) } as any,
			knownRequestIds,
		);
		expect(duplicate.ok).toBe(false);
		if (!duplicate.ok) {
			expect(duplicate.reason).toMatch(/already processed/);
		}
	});

	it("boundary handling keeps deterministic request ordering and failed-origin/malformed file lifecycle guards", () => {
		const src = readFileSync(new URL("../taskplane/engine.ts", import.meta.url), "utf-8");
		expect(src).toMatch(/orderedRequests = \[\.\.\.parsedRequests\.valid\]\.sort\(\(a, b\) => a\.request\.requestId\.localeCompare\(b\.request\.requestId\)\)/);
		expect(src).toContain("markSegmentExpansionRequestFile(requestFile.filePath, \"discarded\")");
		expect(src).toContain("segment expansion request malformed");
	});
});

// ── TP-145: Expansion edge validation anchor-repo fix ───────────────

describe("TP-145 expansion edge validation anchor-repo fix", () => {
	it("accepts edge from anchor repo to new repo", () => {
		// Simulates: worker in shared-libs files expansion requesting web-client
		// with edge { from: "shared-libs", to: "web-client" }
		const segmentState: any = {
			terminalStatus: "pending",
			orderedSegments: [
				{ segmentId: "TP-950::shared-libs", taskId: "TP-950", repoId: "shared-libs", order: 0 },
				{ segmentId: "TP-950::api-service", taskId: "TP-950", repoId: "api-service", order: 1 },
			],
			statusBySegmentId: new Map([
				["TP-950::shared-libs", "running"],
				["TP-950::api-service", "pending"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-950::shared-libs", []],
				["TP-950::api-service", ["TP-950::shared-libs"]],
			]),
		};
		const result = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-950",
			"TP-950::shared-libs",
			"agent-1",
			{
				filePath: "/tmp/segment-expansion-anchor.json",
				request: makeExpansionRequest({
					requestId: "exp-anchor-1",
					taskId: "TP-950",
					fromSegmentId: "TP-950::shared-libs",
					requestedRepoIds: ["web-client"],
					edges: [{ from: "shared-libs", to: "web-client" }],
				}),
			},
			segmentState,
			{ repos: new Map([["shared-libs", {}], ["api-service", {}], ["web-client", {}]]) } as any,
			new Set<string>(),
		);
		expect(result.ok).toBe(true);
	});

	it("accepts edge between two new repos (existing behavior preserved)", () => {
		const segmentState: any = {
			terminalStatus: "pending",
			orderedSegments: [
				{ segmentId: "TP-951::api", taskId: "TP-951", repoId: "api", order: 0 },
			],
			statusBySegmentId: new Map([["TP-951::api", "running"]]),
			dependsOnBySegmentId: new Map([["TP-951::api", []]]),
		};
		const result = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-951",
			"TP-951::api",
			"agent-1",
			{
				filePath: "/tmp/segment-expansion-two-new.json",
				request: makeExpansionRequest({
					requestId: "exp-two-new",
					taskId: "TP-951",
					fromSegmentId: "TP-951::api",
					requestedRepoIds: ["web", "mobile"],
					edges: [{ from: "web", to: "mobile" }],
				}),
			},
			segmentState,
			{ repos: new Map([["api", {}], ["web", {}], ["mobile", {}]]) } as any,
			new Set<string>(),
		);
		expect(result.ok).toBe(true);
	});

	it("still rejects edge to truly unknown repo", () => {
		const segmentState: any = {
			terminalStatus: "pending",
			orderedSegments: [
				{ segmentId: "TP-952::api", taskId: "TP-952", repoId: "api", order: 0 },
			],
			statusBySegmentId: new Map([["TP-952::api", "running"]]),
			dependsOnBySegmentId: new Map([["TP-952::api", []]]),
		};
		const result = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-952",
			"TP-952::api",
			"agent-1",
			{
				filePath: "/tmp/segment-expansion-unknown-edge.json",
				request: makeExpansionRequest({
					requestId: "exp-unknown-edge",
					taskId: "TP-952",
					fromSegmentId: "TP-952::api",
					requestedRepoIds: ["web"],
					edges: [{ from: "nonexistent-repo", to: "web" }],
				}),
			},
			segmentState,
			{ repos: new Map([["api", {}], ["web", {}]]) } as any,
			new Set<string>(),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/edge references a repo outside/);
		}
	});

	it("accepts edge from completed segment repo", () => {
		const segmentState: any = {
			terminalStatus: "pending",
			orderedSegments: [
				{ segmentId: "TP-953::shared-libs", taskId: "TP-953", repoId: "shared-libs", order: 0 },
				{ segmentId: "TP-953::api-service", taskId: "TP-953", repoId: "api-service", order: 1 },
			],
			statusBySegmentId: new Map([
				["TP-953::shared-libs", "succeeded"],
				["TP-953::api-service", "running"],
			]),
			dependsOnBySegmentId: new Map([
				["TP-953::shared-libs", []],
				["TP-953::api-service", ["TP-953::shared-libs"]],
			]),
		};
		const result = processSegmentExpansionRequestAtBoundary(
			"batch-1",
			"TP-953",
			"TP-953::api-service",
			"agent-1",
			{
				filePath: "/tmp/segment-expansion-completed.json",
				request: makeExpansionRequest({
					requestId: "exp-completed-1",
					taskId: "TP-953",
					fromSegmentId: "TP-953::api-service",
					requestedRepoIds: ["web-client"],
					edges: [{ from: "shared-libs", to: "web-client" }],
				}),
			},
			segmentState,
			{ repos: new Map([["shared-libs", {}], ["api-service", {}], ["web-client", {}]]) } as any,
			new Set<string>(),
		);
		expect(result.ok).toBe(true);
	});
});
