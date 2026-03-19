/**
 * Polyrepo End-to-End Regression Tests — TP-012 Step 1
 *
 * Validates the full polyrepo orchestration lifecycle using the polyrepo
 * fixture from Step 0. Tests cover:
 *
 *   1.x — /task routing: discovery resolves each task to the correct repo
 *   2.x — /orch-plan: wave computation, lane allocation, repo-aware naming
 *   3.x — Serialization: persisted state has repo-aware fields
 *   4.x — Per-repo merge outcomes: groupLanesByRepo, merge result schema
 *   5.x — Resume: reconciliation, resume-point, workspace-mode resume
 *   6.x — Collision-safe naming: session names, lane IDs, branches unique per-repo
 *   7.x — Repo-aware persisted state: validate/upconvert, v1→v2, field round-trip
 *
 * Run: npx vitest run extensions/tests/polyrepo-regression.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Fixture ──────────────────────────────────────────────────────────

import {
	buildPolyrepoFixture,
	buildFixtureParsedTasks,
	buildFixtureDiscovery,
	FIXTURE_TASK_IDS,
	FIXTURE_REPO_IDS,
	type PolyrepoFixture,
} from "./fixtures/polyrepo-builder.ts";

// ── Production modules (direct imports) ─────────────────────────────

import { runDiscovery, formatDiscoveryResults } from "../taskplane/discovery.ts";
import {
	buildDependencyGraph,
	computeWaves,
	groupTasksByRepo,
	generateLaneId,
	generateTmuxSessionName,
	resolveRepoRoot,
	resolveBaseBranch,
	assignTasksToLanes,
} from "../taskplane/waves.ts";
import {
	serializeBatchState,
	validatePersistedState,
	upconvertV1toV2,
	hasTaskDoneMarker,
	seedPendingOutcomesForAllocatedLanes,
} from "../taskplane/persistence.ts";
import { groupLanesByRepo } from "../taskplane/merge.ts";
import {
	checkResumeEligibility,
	reconcileTaskStates,
	computeResumePoint,
	reconstructAllocatedLanes,
	collectRepoRoots,
} from "../taskplane/resume.ts";
import { generateBranchName, generateWorktreePath } from "../taskplane/worktree.ts";
import { sanitizeNameComponent, resolveOperatorId } from "../taskplane/naming.ts";
import {
	freshOrchBatchState,
	BATCH_STATE_SCHEMA_VERSION,
	DEFAULT_ORCHESTRATOR_CONFIG,
} from "../taskplane/types.ts";
import type {
	AllocatedLane,
	AllocatedTask,
	LaneTaskOutcome,
	OrchBatchRuntimeState,
	ParsedTask,
	PersistedBatchState,
	WorkspaceConfig,
	WorkspaceRepoConfig,
	MergeWaveResult,
	RepoMergeOutcome,
	MergeLaneResult,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Shared Fixture ───────────────────────────────────────────────────

let fixture: PolyrepoFixture;

beforeAll(() => {
	fixture = buildPolyrepoFixture();
});

afterAll(() => {
	fixture.cleanup();
});

// ── Helpers ──────────────────────────────────────────────────────────

function makeParsedTask(taskId: string, opts?: Partial<ParsedTask>): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 1,
		size: opts?.size || "M",
		dependencies: opts?.dependencies || [],
		fileScope: opts?.fileScope || [],
		taskFolder: opts?.taskFolder || `/tasks/${taskId}`,
		promptPath: opts?.promptPath || `/tasks/${taskId}/PROMPT.md`,
		areaName: opts?.areaName || "default",
		status: opts?.status || "pending",
		promptRepoId: opts?.promptRepoId,
		resolvedRepoId: opts?.resolvedRepoId,
	};
}

function makeAllocatedTask(taskId: string, order: number, parsed: ParsedTask): AllocatedTask {
	return {
		taskId,
		order,
		task: parsed,
		estimatedMinutes: 60,
	};
}

function makeAllocatedLane(
	laneNumber: number,
	tasks: AllocatedTask[],
	opts: {
		repoId?: string;
		branch?: string;
		worktreePath?: string;
		tmuxSessionName?: string;
		laneId?: string;
	} = {},
): AllocatedLane {
	return {
		laneNumber,
		laneId: opts.laneId ?? (opts.repoId ? `${opts.repoId}/lane-${laneNumber}` : `lane-${laneNumber}`),
		tmuxSessionName: opts.tmuxSessionName ?? (opts.repoId ? `orch-op-${opts.repoId}-lane-${laneNumber}` : `orch-op-lane-${laneNumber}`),
		worktreePath: opts.worktreePath ?? `/worktrees/wt-${laneNumber}`,
		branch: opts.branch ?? `task/op-lane-${laneNumber}-20260316T120000`,
		tasks,
		strategy: "affinity-first",
		estimatedLoad: tasks.length * 2,
		estimatedMinutes: tasks.length * 60,
		repoId: opts.repoId,
	};
}

/**
 * Build workspace-mode AllocatedLane[] from the fixture's parsed tasks.
 * Mimics allocateLanes() output for testing serialization/resume.
 */
function buildFixtureAllocatedLanes(pending: Map<string, ParsedTask>): AllocatedLane[] {
	const opId = "testop";
	const batchId = "20260316T120000";

	// Wave 1: one lane per repo
	const docsTask = pending.get("SH-001")!;
	const apiTask = pending.get("AP-001")!;
	const frontendTask = pending.get("UI-001")!;

	return [
		makeAllocatedLane(1, [makeAllocatedTask("SH-001", 0, docsTask)], {
			repoId: "docs",
			laneId: "docs/lane-1",
			tmuxSessionName: `orch-${opId}-docs-lane-1`,
			branch: `task/${opId}-docs-lane-1-${batchId}`,
		}),
		makeAllocatedLane(2, [makeAllocatedTask("AP-001", 0, apiTask)], {
			repoId: "api",
			laneId: "api/lane-1",
			tmuxSessionName: `orch-${opId}-api-lane-1`,
			branch: `task/${opId}-api-lane-1-${batchId}`,
		}),
		makeAllocatedLane(3, [makeAllocatedTask("UI-001", 0, frontendTask)], {
			repoId: "frontend",
			laneId: "frontend/lane-1",
			tmuxSessionName: `orch-${opId}-frontend-lane-1`,
			branch: `task/${opId}-frontend-lane-1-${batchId}`,
		}),
	];
}

// ═══════════════════════════════════════════════════════════════════════
// 1.x — /task routing: end-to-end discovery with polyrepo fixture
// ═══════════════════════════════════════════════════════════════════════

describe("1.x: /task routing — polyrepo discovery", () => {
	it("1.1: runDiscovery resolves all 6 tasks with correct repo routing", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		// No fatal errors (allow DEP_SOURCE_FALLBACK)
		expect(result.errors.filter(e => e.code !== "DEP_SOURCE_FALLBACK")).toHaveLength(0);
		expect(result.pending.size).toBe(6);

		// Every task has resolvedRepoId set
		for (const [taskId, task] of result.pending) {
			expect(task.resolvedRepoId).toBeDefined();
			expect(task.resolvedRepoId).toBe(fixture.expectedRouting[taskId]);
		}
	});

	it("1.2: formatDiscoveryResults shows repo annotation for workspace-mode tasks", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});
		const output = formatDiscoveryResults(result);

		// Each task should have "repo: <id>" in the output
		expect(output).toContain("repo: api");
		expect(output).toContain("repo: docs");
		expect(output).toContain("repo: frontend");
	});

	it("1.3: cross-repo dependencies are preserved in discovery output", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		// UI-002 depends on UI-001 (same repo) and AP-001 (cross-repo)
		const ui002 = result.pending.get("UI-002")!;
		expect(ui002.dependencies).toContain("UI-001");
		expect(ui002.dependencies).toContain("AP-001");
		expect(ui002.resolvedRepoId).toBe("frontend");

		// SH-002 depends on AP-002 (api) and UI-002 (frontend) — both cross-repo
		const sh002 = result.pending.get("SH-002")!;
		expect(sh002.dependencies).toContain("AP-002");
		expect(sh002.dependencies).toContain("UI-002");
		expect(sh002.resolvedRepoId).toBe("docs");
	});

	it("1.4: prompt-level repo declaration overrides area-level", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		// UI-001 declares Repo: frontend in PROMPT.md
		const ui001 = result.pending.get("UI-001")!;
		expect(ui001.promptRepoId).toBe("frontend");
		expect(ui001.resolvedRepoId).toBe("frontend");

		// AP-001 does NOT declare repo in PROMPT — uses area fallback
		const ap001 = result.pending.get("AP-001")!;
		expect(ap001.promptRepoId).toBeUndefined();
		expect(ap001.resolvedRepoId).toBe("api");
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 2.x — /orch-plan: wave computation and lane allocation
// ═══════════════════════════════════════════════════════════════════════

describe("2.x: /orch-plan — wave computation and lane allocation", () => {
	it("2.1: groupTasksByRepo separates wave-1 tasks into 3 repo groups", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const groups = groupTasksByRepo(["SH-001", "AP-001", "UI-001"], pending);

		expect(groups).toHaveLength(3);
		const repoIds = groups.map(g => g.repoId).sort();
		expect(repoIds).toEqual(["api", "docs", "frontend"]);

		// Each group has exactly 1 task
		for (const group of groups) {
			expect(group.taskIds).toHaveLength(1);
		}
	});

	it("2.2: groupTasksByRepo separates wave-2 tasks into 2 repo groups", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const groups = groupTasksByRepo(["AP-002", "UI-002"], pending);

		expect(groups).toHaveLength(2);
		const repoIds = groups.map(g => g.repoId).sort();
		expect(repoIds).toEqual(["api", "frontend"]);
	});

	it("2.3: groupTasksByRepo puts wave-3 task in 1 repo group (docs)", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const groups = groupTasksByRepo(["SH-002"], pending);

		expect(groups).toHaveLength(1);
		expect(groups[0].repoId).toBe("docs");
		expect(groups[0].taskIds).toEqual(["SH-002"]);
	});

	it("2.4: assignTasksToLanes produces per-repo lanes for wave-1", () => {
		const pending = buildFixtureParsedTasks(fixture);

		// Process each repo group independently (matches allocateLanes behavior)
		const groups = groupTasksByRepo(["SH-001", "AP-001", "UI-001"], pending);
		for (const group of groups) {
			const assignments = assignTasksToLanes(
				group.taskIds,
				pending,
				3,
				"affinity-first",
				{ S: 1, M: 2, L: 4 },
			);
			// Each repo group has 1 task → 1 lane
			expect(assignments).toHaveLength(1);
			expect(assignments[0].lane).toBe(1); // local lane 1 within each group
		}
	});

	it("2.5: resolveRepoRoot returns correct paths for each repo", () => {
		for (const repoId of FIXTURE_REPO_IDS) {
			const root = resolveRepoRoot(repoId, fixture.workspaceRoot, fixture.workspaceConfig);
			expect(root).toBe(fixture.repoPaths[repoId]);
		}
	});

	it("2.6: resolveRepoRoot falls back to defaultRoot for undefined repoId", () => {
		const root = resolveRepoRoot(undefined, fixture.workspaceRoot, fixture.workspaceConfig);
		expect(root).toBe(fixture.workspaceRoot);
	});

	it("2.7: resolveBaseBranch detects main from each repo", () => {
		for (const repoId of FIXTURE_REPO_IDS) {
			const repoRoot = fixture.repoPaths[repoId];
			const branch = resolveBaseBranch(repoId, repoRoot, "main", fixture.workspaceConfig);
			expect(branch).toBe("main"); // fixture repos init with --initial-branch=main
		}
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 3.x — Serialization: repo-aware persisted state
// ═══════════════════════════════════════════════════════════════════════

describe("3.x: Serialization — repo-aware persisted state", () => {
	it("3.1: serializeBatchState emits workspace mode and repo fields", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const lanes = buildFixtureAllocatedLanes(pending);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 3,
			totalTasks: 6,
			currentLanes: lanes,
		};

		const wavePlan = fixture.expectedWaves;
		const json = serializeBatchState(batchState, wavePlan, lanes, []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		expect(parsed.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(parsed.mode).toBe("workspace");
		expect(parsed.wavePlan).toEqual(wavePlan);
		expect(parsed.tasks).toHaveLength(6);

		// Lane records have repoId
		for (const lane of parsed.lanes) {
			expect(lane.repoId).toBeDefined();
			expect(["docs", "api", "frontend"]).toContain(lane.repoId);
		}

		// Task records for allocated tasks have resolvedRepoId
		for (const task of parsed.tasks) {
			if (lanes.some(l => l.tasks.some(t => t.taskId === task.taskId))) {
				const expectedRepo = fixture.expectedRouting[task.taskId];
				expect(task.resolvedRepoId).toBe(expectedRepo);
			}
		}
	});

	it("3.2: serializeBatchState round-trips through validatePersistedState", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const lanes = buildFixtureAllocatedLanes(pending);
		const outcomes: LaneTaskOutcome[] = [];

		// Seed pending outcomes
		seedPendingOutcomesForAllocatedLanes(lanes, outcomes);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 3,
			totalTasks: 6,
			currentLanes: lanes,
		};

		const json = serializeBatchState(batchState, fixture.expectedWaves, lanes, outcomes);
		const parsed = JSON.parse(json);

		// Validate doesn't throw
		const validated = validatePersistedState(parsed);
		expect(validated.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(validated.mode).toBe("workspace");
		expect(validated.tasks).toHaveLength(6);
		expect(validated.lanes).toHaveLength(3);
	});

	it("3.3: task records preserve promptRepoId via repoId field", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const lanes = buildFixtureAllocatedLanes(pending);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 3,
			totalTasks: 6,
			currentLanes: lanes,
		};

		const json = serializeBatchState(batchState, fixture.expectedWaves, lanes, []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		// UI-001 has promptRepoId = "frontend"
		const ui001Record = parsed.tasks.find(t => t.taskId === "UI-001");
		expect(ui001Record).toBeDefined();
		expect(ui001Record!.repoId).toBe("frontend");  // serialized from promptRepoId
		expect(ui001Record!.resolvedRepoId).toBe("frontend");

		// AP-001 has no promptRepoId (uses area fallback)
		const ap001Record = parsed.tasks.find(t => t.taskId === "AP-001");
		expect(ap001Record).toBeDefined();
		expect(ap001Record!.resolvedRepoId).toBe("api");
	});

	it("3.4: unallocated future-wave tasks are still in task registry", () => {
		const pending = buildFixtureParsedTasks(fixture);
		// Only wave 1 lanes are allocated
		const lanes = buildFixtureAllocatedLanes(pending);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 3,
			totalTasks: 6,
			currentLanes: lanes,
		};

		const json = serializeBatchState(batchState, fixture.expectedWaves, lanes, []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		// All 6 tasks should be present (from wavePlan), even future wave tasks
		expect(parsed.tasks).toHaveLength(6);
		const taskIds = parsed.tasks.map(t => t.taskId).sort();
		expect(taskIds).toEqual(["AP-001", "AP-002", "SH-001", "SH-002", "UI-001", "UI-002"]);

		// Future wave tasks are pending with no lane assignment
		const sh002 = parsed.tasks.find(t => t.taskId === "SH-002");
		expect(sh002).toBeDefined();
		expect(sh002!.status).toBe("pending");
		expect(sh002!.laneNumber).toBe(0); // no lane assigned yet
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 4.x — Per-repo merge outcomes
// ═══════════════════════════════════════════════════════════════════════

describe("4.x: Per-repo merge outcomes", () => {
	it("4.1: groupLanesByRepo groups workspace-mode lanes by repoId", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const lanes = buildFixtureAllocatedLanes(pending);

		const groups = groupLanesByRepo(lanes);

		expect(groups).toHaveLength(3);
		const repoIds = groups.map(g => g.repoId).sort();
		expect(repoIds).toEqual(["api", "docs", "frontend"]);

		// Each group has 1 lane
		for (const group of groups) {
			expect(group.lanes).toHaveLength(1);
		}
	});

	it("4.2: merge result serialization includes per-repo outcomes", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const lanes = buildFixtureAllocatedLanes(pending);

		// Simulate wave 1 merge results with per-repo outcomes
		const mergeResult: MergeWaveResult = {
			waveIndex: 1, // 1-based from merge module
			status: "succeeded",
			laneResults: lanes.map(lane => ({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sourceBranch: lane.branch,
				targetBranch: "main",
				result: null,
				error: null,
				durationMs: 5000,
				repoId: lane.repoId,
			})),
			failedLane: null,
			failureReason: null,
			totalDurationMs: 15000,
			repoResults: [
				{
					repoId: "docs",
					status: "succeeded",
					laneResults: [],
					failedLane: null,
					failureReason: null,
				},
				{
					repoId: "api",
					status: "succeeded",
					laneResults: [],
					failedLane: null,
					failureReason: null,
				},
				{
					repoId: "frontend",
					status: "succeeded",
					laneResults: [],
					failedLane: null,
					failureReason: null,
				},
			],
		};

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: Date.now(),
			currentWaveIndex: 1,
			totalWaves: 3,
			totalTasks: 6,
			currentLanes: lanes,
			mergeResults: [mergeResult],
		};

		const json = serializeBatchState(batchState, fixture.expectedWaves, lanes, []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		expect(parsed.mergeResults).toHaveLength(1);
		const mr = parsed.mergeResults[0];
		expect(mr.status).toBe("succeeded");
		expect(mr.waveIndex).toBe(0); // normalized: 1-based → 0-based
		expect(mr.repoResults).toBeDefined();
		expect(mr.repoResults!).toHaveLength(3);
		const mrRepoIds = mr.repoResults!.map(r => r.repoId).sort();
		expect(mrRepoIds).toEqual(["api", "docs", "frontend"]);
	});

	it("4.3: static fixture merge results validate via validatePersistedState", () => {
		const fixtureData = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);

		const validated = validatePersistedState(fixtureData);
		expect(validated.mergeResults).toHaveLength(1);
		expect(validated.mergeResults[0].repoResults).toBeDefined();
		expect(validated.mergeResults[0].repoResults!).toHaveLength(3);
	});

	it("4.4: partial merge failure is captured per-repo", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const lanes = buildFixtureAllocatedLanes(pending);

		const mergeResult: MergeWaveResult = {
			waveIndex: 1,
			status: "partial",
			laneResults: [],
			failedLane: 2,
			failureReason: "Conflict in api/src/auth.ts",
			totalDurationMs: 10000,
			repoResults: [
				{
					repoId: "docs",
					status: "succeeded",
					laneResults: [],
					failedLane: null,
					failureReason: null,
				},
				{
					repoId: "api",
					status: "failed",
					laneResults: [],
					failedLane: 2,
					failureReason: "Conflict in api/src/auth.ts",
				},
				{
					repoId: "frontend",
					status: "succeeded",
					laneResults: [],
					failedLane: null,
					failureReason: null,
				},
			],
		};

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "paused",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 3,
			totalTasks: 6,
			currentLanes: lanes,
			mergeResults: [mergeResult],
		};

		const json = serializeBatchState(batchState, fixture.expectedWaves, lanes, []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		const mr = parsed.mergeResults[0];
		expect(mr.status).toBe("partial");
		expect(mr.repoResults).toBeDefined();

		const apiResult = mr.repoResults!.find(r => r.repoId === "api");
		expect(apiResult).toBeDefined();
		expect(apiResult!.status).toBe("failed");
		expect(apiResult!.failedLane).toBe(2);
		expect(apiResult!.failureReason).toContain("Conflict");

		const docsResult = mr.repoResults!.find(r => r.repoId === "docs");
		expect(docsResult!.status).toBe("succeeded");
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 5.x — Resume: reconciliation and resume-point computation
// ═══════════════════════════════════════════════════════════════════════

describe("5.x: Resume — polyrepo workspace-mode resume", () => {
	const fixtureState: PersistedBatchState = JSON.parse(
		readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
	);

	it("5.1: checkResumeEligibility: paused workspace batch is eligible", () => {
		const eligibility = checkResumeEligibility(fixtureState);
		expect(eligibility.eligible).toBe(true);
		expect(eligibility.phase).toBe("paused");
		expect(eligibility.batchId).toBe("20260316T120000");
	});

	it("5.2: reconcileTaskStates correctly categorizes wave-1 succeeded, wave-2 running, wave-3 pending", () => {
		// Simulate: all sessions dead (orchestrator restarted), wave-1 tasks have .DONE
		const aliveSessions = new Set<string>(); // all dead
		const doneTaskIds = new Set(["SH-001", "AP-001", "UI-001"]); // wave 1 complete

		const reconciled = reconcileTaskStates(fixtureState, aliveSessions, doneTaskIds);

		expect(reconciled).toHaveLength(6);

		// Wave 1 tasks: .DONE found → mark-complete
		const sh001 = reconciled.find(t => t.taskId === "SH-001")!;
		expect(sh001.action).toBe("mark-complete");
		expect(sh001.doneFileFound).toBe(true);

		const ap001 = reconciled.find(t => t.taskId === "AP-001")!;
		expect(ap001.action).toBe("mark-complete");

		const ui001 = reconciled.find(t => t.taskId === "UI-001")!;
		expect(ui001.action).toBe("mark-complete");

		// Wave 2 tasks: no .DONE, no alive session, was running → mark-failed
		const ap002 = reconciled.find(t => t.taskId === "AP-002")!;
		expect(ap002.action).toBe("mark-failed");
		expect(ap002.persistedStatus).toBe("running");

		const ui002 = reconciled.find(t => t.taskId === "UI-002")!;
		expect(ui002.action).toBe("mark-failed");
		expect(ui002.persistedStatus).toBe("running");

		// Wave 3 task: pending, was never started, has session name from seeding
		// Since it has a sessionName but status is pending, dead session → mark-failed
		const sh002 = reconciled.find(t => t.taskId === "SH-002")!;
		// SH-002 has sessionName "orch-op-docs-lane-1" but status pending
		// With no alive session and no .DONE → mark-failed
		expect(["mark-failed", "pending"]).toContain(sh002.action);
	});

	it("5.3: computeResumePoint: all sessions dead, wave-1 done, wave-2/3 terminal → past end", () => {
		const aliveSessions = new Set<string>();
		const doneTaskIds = new Set(["SH-001", "AP-001", "UI-001"]);

		const reconciled = reconcileTaskStates(fixtureState, aliveSessions, doneTaskIds);
		const resumePoint = computeResumePoint(fixtureState, reconciled);

		// Wave 0: all mark-complete → terminal (skipped)
		// Wave 1: AP-002/UI-002 mark-failed → terminal (skipped)
		// Wave 2: SH-002 mark-failed → terminal (skipped)
		// All waves are terminal → resumeWaveIndex = wavePlan.length (past end)
		expect(resumePoint.resumeWaveIndex).toBe(3);
		expect(resumePoint.completedTaskIds.sort()).toEqual(["AP-001", "SH-001", "UI-001"]);
		expect(resumePoint.failedTaskIds).toContain("AP-002");
		expect(resumePoint.failedTaskIds).toContain("UI-002");
		// SH-002 was pending with session name → mark-failed
		expect(resumePoint.failedTaskIds).toContain("SH-002");
	});

	it("5.4: reconcileTaskStates with alive sessions → reconnect", () => {
		// Simulate: wave-2 sessions are still alive (operator just reconnected)
		const aliveSessions = new Set(["orch-op-api-lane-2", "orch-op-frontend-lane-3"]);
		const doneTaskIds = new Set(["SH-001", "AP-001", "UI-001"]);

		const reconciled = reconcileTaskStates(fixtureState, aliveSessions, doneTaskIds);

		const ap002 = reconciled.find(t => t.taskId === "AP-002")!;
		expect(ap002.action).toBe("reconnect");
		expect(ap002.sessionAlive).toBe(true);

		const ui002 = reconciled.find(t => t.taskId === "UI-002")!;
		expect(ui002.action).toBe("reconnect");
		expect(ui002.sessionAlive).toBe(true);
	});

	it("5.5: computeResumePoint with reconnect tasks stays at wave 1", () => {
		const aliveSessions = new Set(["orch-op-api-lane-2", "orch-op-frontend-lane-3"]);
		const doneTaskIds = new Set(["SH-001", "AP-001", "UI-001"]);

		const reconciled = reconcileTaskStates(fixtureState, aliveSessions, doneTaskIds);
		const resumePoint = computeResumePoint(fixtureState, reconciled);

		// Wave 1 has reconnect tasks → resume at wave 1
		expect(resumePoint.resumeWaveIndex).toBe(1);
		expect(resumePoint.reconnectTaskIds.sort()).toEqual(["AP-002", "UI-002"]);
		expect(resumePoint.completedTaskIds.sort()).toEqual(["AP-001", "SH-001", "UI-001"]);
	});

	it("5.6: reconstructAllocatedLanes preserves repoId from persisted state", () => {
		const lanes = reconstructAllocatedLanes(fixtureState.lanes, fixtureState.tasks);

		expect(lanes).toHaveLength(3);

		const docsLane = lanes.find(l => l.repoId === "docs")!;
		expect(docsLane).toBeDefined();
		expect(docsLane.laneId).toBe("docs/lane-1");

		const apiLane = lanes.find(l => l.repoId === "api")!;
		expect(apiLane).toBeDefined();
		expect(apiLane.laneId).toContain("api");

		const frontendLane = lanes.find(l => l.repoId === "frontend")!;
		expect(frontendLane).toBeDefined();
	});

	it("5.7: reconstructAllocatedLanes carries forward repo fields to task stubs", () => {
		const lanes = reconstructAllocatedLanes(fixtureState.lanes, fixtureState.tasks);

		// Find the lane with UI-001 — should carry resolvedRepoId from persisted task
		const frontendLane = lanes.find(l => l.repoId === "frontend")!;
		const ui001Task = frontendLane.tasks.find(t => t.taskId === "UI-001");
		expect(ui001Task).toBeDefined();
		expect(ui001Task!.task?.resolvedRepoId).toBe("frontend");
	});

	it("5.8: collectRepoRoots returns unique repo roots from persisted lanes", () => {
		const workspaceConfig: WorkspaceConfig = {
			mode: "workspace",
			repos: new Map([
				["docs", { id: "docs", path: "/repos/docs" }],
				["api", { id: "api", path: "/repos/api" }],
				["frontend", { id: "frontend", path: "/repos/frontend" }],
			]),
			routing: { tasksRoot: "/workspace/tasks", defaultRepo: "docs" },
			configPath: "/workspace/.pi/taskplane-workspace.yaml",
		};

		const roots = collectRepoRoots(fixtureState, "/workspace", workspaceConfig);

		// Should include all 3 repo roots + default workspace root
		expect(roots.length).toBeGreaterThanOrEqual(3);
		expect(roots).toContain("/repos/docs");
		expect(roots).toContain("/repos/api");
		expect(roots).toContain("/repos/frontend");
	});

	it("5.9: full resume scenario — wave-1 done, wave-2 partial, all sessions dead", () => {
		// Simulate a realistic resume: wave-1 all done, AP-002 done but UI-002 failed
		// All sessions dead (orchestrator restarted after crash)
		const aliveSessions = new Set<string>();
		const doneTaskIds = new Set(["SH-001", "AP-001", "UI-001", "AP-002"]);

		const reconciled = reconcileTaskStates(fixtureState, aliveSessions, doneTaskIds);
		const resumePoint = computeResumePoint(fixtureState, reconciled);

		// AP-002 completed → mark-complete
		const ap002 = reconciled.find(t => t.taskId === "AP-002")!;
		expect(ap002.action).toBe("mark-complete");

		// UI-002 failed → mark-failed
		const ui002 = reconciled.find(t => t.taskId === "UI-002")!;
		expect(ui002.action).toBe("mark-failed");

		// SH-002 had session seeded but never started → mark-failed (dead session)
		const sh002 = reconciled.find(t => t.taskId === "SH-002")!;
		expect(sh002.action).toBe("mark-failed");

		// All waves are terminal (mark-complete or mark-failed) → past end
		expect(resumePoint.resumeWaveIndex).toBe(3);
		expect(resumePoint.completedTaskIds.sort()).toEqual(["AP-001", "AP-002", "SH-001", "UI-001"]);
		expect(resumePoint.failedTaskIds).toContain("UI-002");
		expect(resumePoint.failedTaskIds).toContain("SH-002");
	});

	it("5.10: resume with alive wave-2 session keeps resumeWaveIndex at wave 1", () => {
		// Simulate: wave-1 done, AP-002 session alive, UI-002 done
		const aliveSessions = new Set(["orch-op-api-lane-2"]);
		const doneTaskIds = new Set(["SH-001", "AP-001", "UI-001", "UI-002"]);

		const reconciled = reconcileTaskStates(fixtureState, aliveSessions, doneTaskIds);
		const resumePoint = computeResumePoint(fixtureState, reconciled);

		// AP-002 has alive session → reconnect (NOT terminal)
		const ap002 = reconciled.find(t => t.taskId === "AP-002")!;
		expect(ap002.action).toBe("reconnect");

		// Wave 1 has a non-terminal task (reconnect) → resume here
		expect(resumePoint.resumeWaveIndex).toBe(1);
		expect(resumePoint.reconnectTaskIds).toContain("AP-002");
		expect(resumePoint.completedTaskIds).toContain("UI-002");
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 6.x — Collision-safe naming
// ═══════════════════════════════════════════════════════════════════════

describe("6.x: Collision-safe naming — polyrepo artifacts", () => {
	it("6.1: TMUX session names are unique across repos for same operator+lane", () => {
		const opId = "testop";
		const sessions = FIXTURE_REPO_IDS.map(repoId =>
			generateTmuxSessionName("orch", 1, opId, repoId),
		);

		// All 3 sessions should be distinct
		expect(new Set(sessions).size).toBe(3);
		expect(sessions).toContain("orch-testop-docs-lane-1");
		expect(sessions).toContain("orch-testop-api-lane-1");
		expect(sessions).toContain("orch-testop-frontend-lane-1");
	});

	it("6.2: lane IDs are unique across repos for same lane number", () => {
		const laneIds = FIXTURE_REPO_IDS.map(repoId =>
			generateLaneId(1, repoId),
		);

		expect(new Set(laneIds).size).toBe(3);
		expect(laneIds).toContain("docs/lane-1");
		expect(laneIds).toContain("api/lane-1");
		expect(laneIds).toContain("frontend/lane-1");
	});

	it("6.3: branch names are unique across repos for same operator+lane", () => {
		const opId = "testop";
		const batchId = "20260316T120000";
		const branches = FIXTURE_REPO_IDS.map(repoId => {
			// Branch name uses repoId-scoped laneId
			const laneId = generateLaneId(1, repoId);
			// Simulate generateBranchName pattern: task/{opId}-{laneId}-{batchId}
			return `task/${opId}-${laneId.replace("/", "-")}-${batchId}`;
		});

		expect(new Set(branches).size).toBe(3);
	});

	it("6.4: workspace-mode session name contains repoId segment", () => {
		const session = generateTmuxSessionName("orch", 2, "alice", "api");
		expect(session).toBe("orch-alice-api-lane-2");

		// Verify all segments are parseable
		expect(session).toContain("orch");
		expect(session).toContain("alice");
		expect(session).toContain("api");
		expect(session).toContain("lane-2");
	});

	it("6.5: repo-mode session name does NOT contain repoId (backward compat)", () => {
		const session = generateTmuxSessionName("orch", 1, "alice");
		expect(session).toBe("orch-alice-lane-1");
		expect(session).not.toContain("undefined");
	});

	it("6.6: lane ID format: repo-mode vs workspace-mode", () => {
		const repoMode = generateLaneId(1);
		expect(repoMode).toBe("lane-1");

		const workspaceMode = generateLaneId(1, "api");
		expect(workspaceMode).toBe("api/lane-1");
	});

	it("6.7: static fixture lane IDs follow workspace-mode convention", () => {
		for (const lane of fixtureState.lanes) {
			expect(lane.laneId).toMatch(/^(docs|api|frontend)\/lane-\d+$/);
			expect(lane.repoId).toBeDefined();
			expect(lane.laneId).toContain(lane.repoId!);
		}
	});

	it("6.8: static fixture session names follow workspace-mode convention", () => {
		for (const lane of fixtureState.lanes) {
			expect(lane.tmuxSessionName).toMatch(/^orch-\w+-\w+-lane-\d+$/);
			expect(lane.tmuxSessionName).toContain(lane.repoId!);
		}
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 7.x — Repo-aware persisted state validation and upconversion
// ═══════════════════════════════════════════════════════════════════════

describe("7.x: Repo-aware persisted state — validation and upconversion", () => {
	it("7.1: validatePersistedState accepts v2 workspace-mode state", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);
		const validated = validatePersistedState(data);

		expect(validated.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(validated.mode).toBe("workspace");
		expect(validated.tasks.every(t => t.resolvedRepoId !== undefined)).toBe(true);
		expect(validated.lanes.every(l => l.repoId !== undefined)).toBe(true);
	});

	it("7.2: v1→v2 upconversion adds mode=repo and preserves fields", () => {
		const v1State: Record<string, unknown> = {
			schemaVersion: 1,
			phase: "paused",
			batchId: "20260315T100000",
			baseBranch: "main",
			startedAt: 1000,
			updatedAt: 2000,
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			wavePlan: [["TP-100"]],
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					tmuxSessionName: "orch-lane-1",
					worktreePath: "/wt-1",
					branch: "task/lane-1",
					taskIds: ["TP-100"],
				},
			],
			tasks: [
				{
					taskId: "TP-100",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					status: "running",
					taskFolder: "/tasks/TP-100",
					startedAt: 1000,
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
		};

		const validated = validatePersistedState(v1State);

		// After upconversion (v1→v2→v3):
		expect(validated.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(validated.mode).toBe("repo");
		// Task/lane repo fields should be undefined (v1 = repo mode)
		expect(validated.tasks[0].repoId).toBeUndefined();
		expect(validated.tasks[0].resolvedRepoId).toBeUndefined();
		expect(validated.lanes[0].repoId).toBeUndefined();
	});

	it("7.3: validatePersistedState rejects invalid task repoId type", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);
		// Corrupt a task's repoId to a non-string
		data.tasks[0].repoId = 123;

		expect(() => validatePersistedState(data)).toThrow(/repoId/);
	});

	it("7.4: validatePersistedState rejects invalid lane repoId type", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);
		// Corrupt a lane's repoId to a non-string
		data.lanes[0].repoId = 42;

		expect(() => validatePersistedState(data)).toThrow(/repoId/);
	});

	it("7.5: validatePersistedState rejects missing mode in v2", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);
		delete data.mode;

		expect(() => validatePersistedState(data)).toThrow(/mode/);
	});

	it("7.6: validatePersistedState rejects invalid mode value", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);
		data.mode = "invalid-mode";

		expect(() => validatePersistedState(data)).toThrow(/mode/);
	});

	it("7.7: upconvertV1toV2 is idempotent", () => {
		const obj: Record<string, unknown> = {
			schemaVersion: 2,
			mode: "workspace",
			baseBranch: "develop",
		};
		const before = { ...obj };
		upconvertV1toV2(obj);

		expect(obj.schemaVersion).toBe(before.schemaVersion);
		expect(obj.mode).toBe(before.mode);
		expect(obj.baseBranch).toBe(before.baseBranch);
	});

	it("7.8: validatePersistedState validates repoResults in merge records", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
		);

		// Corrupt repoResults to have invalid status
		data.mergeResults[0].repoResults[0].status = "invalid";

		expect(() => validatePersistedState(data)).toThrow(/repoResults/);
	});

	it("7.9: workspace batch state with all tasks succeeded validates correctly", () => {
		// Build a completed workspace-mode state from scratch
		const completedState: Record<string, unknown> = {
			schemaVersion: 2,
			phase: "completed",
			batchId: "20260316T150000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: 1000,
			updatedAt: 5000,
			endedAt: 5000,
			currentWaveIndex: 2,
			totalWaves: 3,
			wavePlan: [
				["SH-001", "AP-001", "UI-001"],
				["AP-002", "UI-002"],
				["SH-002"],
			],
			lanes: [
				{
					laneNumber: 1,
					laneId: "docs/lane-1",
					tmuxSessionName: "orch-op-docs-lane-1",
					worktreePath: "/wt-1",
					branch: "task/op-docs-lane-1-20260316T150000",
					taskIds: ["SH-001"],
					repoId: "docs",
				},
			],
			tasks: [
				{
					taskId: "SH-001",
					laneNumber: 1,
					sessionName: "orch-op-docs-lane-1",
					status: "succeeded",
					taskFolder: "/tasks/SH-001",
					startedAt: 1000,
					endedAt: 2000,
					doneFileFound: true,
					exitReason: "Completed",
					resolvedRepoId: "docs",
				},
			],
			mergeResults: [],
			totalTasks: 1,
			succeededTasks: 1,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			blockedTaskIds: [],
			lastError: null,
			errors: [],
		};

		const validated = validatePersistedState(completedState);
		expect(validated.phase).toBe("completed");
		expect(validated.mode).toBe("workspace");
		expect(validated.tasks[0].resolvedRepoId).toBe("docs");
	});

	it("7.10: resume eligibility is NOT affected by mode (paused is resumable regardless)", () => {
		// Workspace mode
		const wsState: PersistedBatchState = {
			...fixtureState,
			mode: "workspace",
		};
		expect(checkResumeEligibility(wsState).eligible).toBe(true);

		// Repo mode
		const repoState: PersistedBatchState = {
			...fixtureState,
			mode: "repo",
		};
		expect(checkResumeEligibility(repoState).eligible).toBe(true);
	});
});

// Use a variable to reference fixtureState in this scope
const fixtureState: PersistedBatchState = JSON.parse(
	readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
);
