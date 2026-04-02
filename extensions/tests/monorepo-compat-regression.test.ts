/**
 * Monorepo Compatibility Regression Tests — TP-012 Step 2
 *
 * Guards that adding polyrepo/workspace-mode support does NOT change
 * existing monorepo (repo-mode) behavior.  Each section tests one
 * contract boundary:
 *
 *   8.1 — Repo-mode persisted state: mode="repo", no repo fields on
 *         tasks/lanes
 *   8.2 — Repo-mode discovery: no routing applied, resolvedRepoId
 *         remains undefined
 *   8.3 — Repo-mode naming: lane IDs and session names are un-scoped
 *         (no repoId segment)
 *   8.4 — Repo-mode serialization: round-trip preserves mode=repo with
 *         no repo fields
 *   8.5 — Repo-mode resume: v1→v2 upconvert and resume eligibility
 *         are unaffected by mode
 *   8.6 — Repo-mode merge: groupLanesByRepo returns a single default
 *         group
 *   8.7 — Repo-mode wave computation: groupTasksByRepo returns a
 *         single default group
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/monorepo-compat-regression.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

// ── Production modules (direct imports) ─────────────────────────────

import { runDiscovery, formatDiscoveryResults } from "../taskplane/discovery.ts";
import {
	buildDependencyGraph,
	computeWaves,
	groupTasksByRepo,
	generateLaneId,
	generateLaneSessionId,
	assignTasksToLanes,
} from "../taskplane/waves.ts";
import {
	serializeBatchState,
	validatePersistedState,
	upconvertV1toV2,
	seedPendingOutcomesForAllocatedLanes,
} from "../taskplane/persistence.ts";
import { groupLanesByRepo } from "../taskplane/merge.ts";
import {
	checkResumeEligibility,
	reconcileTaskStates,
	computeResumePoint,
	reconstructAllocatedLanes,
} from "../taskplane/resume.ts";
import {
	freshOrchBatchState,
	BATCH_STATE_SCHEMA_VERSION,
} from "../taskplane/types.ts";
import type {
	AllocatedLane,
	AllocatedTask,
	LaneTaskOutcome,
	OrchBatchRuntimeState,
	ParsedTask,
	PersistedBatchState,
	TaskArea,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

beforeEach(() => {
	testRoot = join(tmpdir(), `tp012-monorepo-compat-${Date.now()}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

function makeTestDir(suffix: string): string {
	counter++;
	const dir = join(testRoot, `test-${counter}-${suffix}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Build a minimal valid monorepo ParsedTask (no repo fields). */
function monoTask(taskId: string, opts?: Partial<ParsedTask>): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 1,
		size: opts?.size ?? "M",
		dependencies: opts?.dependencies ?? [],
		fileScope: opts?.fileScope ?? [],
		taskFolder: opts?.taskFolder ?? `/tasks/${taskId}`,
		promptPath: opts?.promptPath ?? `/tasks/${taskId}/PROMPT.md`,
		areaName: opts?.areaName ?? "default",
		status: opts?.status ?? "pending",
		// Deliberately no promptRepoId, no resolvedRepoId — repo mode
	};
}

/** Build a monorepo AllocatedLane (no repoId). */
function monoLane(
	laneNum: number,
	tasks: AllocatedTask[],
): AllocatedLane {
	return {
		laneNumber: laneNum,
		laneId: `lane-${laneNum}`,
		laneSessionId: `orch-op-lane-${laneNum}`,
		worktreePath: `/worktrees/wt-${laneNum}`,
		branch: `task/op-lane-${laneNum}-20260316T120000`,
		tasks,
		strategy: "affinity-first",
		estimatedLoad: tasks.length * 2,
		estimatedMinutes: tasks.length * 60,
		// No repoId — repo mode
	};
}

function monoAllocatedTask(taskId: string, order: number, parsed: ParsedTask): AllocatedTask {
	return {
		taskId,
		order,
		task: parsed,
		estimatedMinutes: 60,
	};
}

/**
 * Minimal valid PROMPT.md for a monorepo task — no Execution Target,
 * no Repo: declaration.
 */
function monorepoPrompt(taskId: string, taskName: string, deps: string = "**None**"): string {
	return `# Task: ${taskId} - ${taskName}

**Created:** 2026-03-16
**Size:** M

## Dependencies

${deps}

## Steps

### Step 0: Implement

- [ ] Do it

---
`;
}


// ═══════════════════════════════════════════════════════════════════════
// 8.1 — Repo-mode persisted state defaults
// ═══════════════════════════════════════════════════════════════════════

describe("8.1: Repo-mode state — mode=repo, no repo fields", () => {
	it("8.1.1: freshOrchBatchState defaults to mode=repo", () => {
		const state = freshOrchBatchState();
		expect(state.mode).toBe("repo");
	});

	it("8.1.2: batch-state-valid.json fixture is mode=repo with no task repo fields", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-valid.json"), "utf-8"),
		);
		const validated = validatePersistedState(data);

		expect(validated.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(validated.mode).toBe("repo");

		// No repo fields on any task
		for (const task of validated.tasks) {
			expect(task.repoId).toBeUndefined();
			expect(task.resolvedRepoId).toBeUndefined();
		}

		// No repoId on any lane
		for (const lane of validated.lanes) {
			expect(lane.repoId).toBeUndefined();
		}
	});

	it("8.1.3: repo-mode state has no mergeResults with repoResults", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-valid.json"), "utf-8"),
		);
		const validated = validatePersistedState(data);

		for (const mr of validated.mergeResults) {
			// repo-mode merge results should NOT have repoResults
			expect(mr.repoResults).toBeUndefined();
		}
	});

	it("8.1.4: legacy tmux-only lane records are normalized to laneSessionId", () => {
		const data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-valid.json"), "utf-8"),
		);
		(data.lanes[0] as Record<string, unknown>).tmuxSessionName = "orch-legacy-lane-1";
		delete data.lanes[0].laneSessionId;

		const validated = validatePersistedState(data);
		expect(validated.lanes[0].laneSessionId).toBe("orch-legacy-lane-1");
		expect((validated.lanes[0] as Record<string, unknown>).tmuxSessionName).toBeUndefined();
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 8.2 — Repo-mode discovery: no routing
// ═══════════════════════════════════════════════════════════════════════

describe("8.2: Repo-mode discovery — no routing applied", () => {
	it("8.2.1: runDiscovery without workspaceConfig leaves resolvedRepoId undefined", () => {
		const areaDir = makeTestDir("monorepo-discovery");
		const taskDir = join(areaDir, "TP-900-monorepo-task");
		mkdirSync(taskDir, { recursive: true });
		writeFileSync(join(taskDir, "PROMPT.md"), monorepoPrompt("TP-900", "Monorepo Task"), "utf-8");

		const taskAreas: Record<string, TaskArea> = {
			default: { path: areaDir, prefix: "TP", context: "" },
		};

		// No workspaceConfig = repo mode
		const result = runDiscovery("all", taskAreas, areaDir);

		expect(result.pending.size).toBe(1);
		const task = result.pending.get("TP-900")!;
		expect(task.promptRepoId).toBeUndefined();
		expect(task.resolvedRepoId).toBeUndefined();
	});

	it("8.2.2: repo-mode discovery errors contain no routing errors", () => {
		const areaDir = makeTestDir("monorepo-no-routing-errors");
		const taskDir = join(areaDir, "TP-901-mono-task");
		mkdirSync(taskDir, { recursive: true });
		writeFileSync(join(taskDir, "PROMPT.md"), monorepoPrompt("TP-901", "Mono Task"), "utf-8");

		const taskAreas: Record<string, TaskArea> = {
			default: { path: areaDir, prefix: "TP", context: "" },
		};

		const result = runDiscovery("all", taskAreas, areaDir);

		// No routing errors (TASK_REPO_UNKNOWN, TASK_REPO_UNRESOLVED)
		const routingErrors = result.errors.filter(
			e => e.code === "TASK_REPO_UNKNOWN" || e.code === "TASK_REPO_UNRESOLVED",
		);
		expect(routingErrors).toHaveLength(0);
	});

	it("8.2.3: prompt with Repo: in repo mode — parsed but NOT routed", () => {
		const areaDir = makeTestDir("monorepo-prompt-with-repo");
		const taskDir = join(areaDir, "TP-902-has-repo");
		mkdirSync(taskDir, { recursive: true });
		writeFileSync(
			join(taskDir, "PROMPT.md"),
			`# Task: TP-902 - Has Repo

**Size:** M

## Dependencies

**None**

## Execution Target

Repo: api

## Steps

### Step 0: Implement

- [ ] Do it

---
`,
			"utf-8",
		);

		const taskAreas: Record<string, TaskArea> = {
			default: { path: areaDir, prefix: "TP", context: "" },
		};

		// repo mode — no workspaceConfig
		const result = runDiscovery("all", taskAreas, areaDir);

		const task = result.pending.get("TP-902")!;
		// promptRepoId is parsed from PROMPT even in repo mode
		expect(task.promptRepoId).toBe("api");
		// But resolvedRepoId is NOT set (no routing in repo mode)
		expect(task.resolvedRepoId).toBeUndefined();
	});

	it("8.2.4: formatDiscoveryResults in repo mode shows no repo annotation", () => {
		const areaDir = makeTestDir("monorepo-format-no-repo");
		const taskDir = join(areaDir, "TP-903-format-test");
		mkdirSync(taskDir, { recursive: true });
		writeFileSync(join(taskDir, "PROMPT.md"), monorepoPrompt("TP-903", "Format Test"), "utf-8");

		const taskAreas: Record<string, TaskArea> = {
			default: { path: areaDir, prefix: "TP", context: "" },
		};

		const result = runDiscovery("all", taskAreas, areaDir);
		const output = formatDiscoveryResults(result);

		expect(output).toContain("TP-903");
		expect(output).not.toContain("repo:");
	});

	it("8.2.5: multi-task repo-mode discovery with dependencies", () => {
		const areaDir = makeTestDir("monorepo-multi-task");

		// Task 1: no deps
		const taskDir1 = join(areaDir, "TP-910-first");
		mkdirSync(taskDir1, { recursive: true });
		writeFileSync(join(taskDir1, "PROMPT.md"), monorepoPrompt("TP-910", "First"), "utf-8");

		// Task 2: depends on TP-910
		const taskDir2 = join(areaDir, "TP-911-second");
		mkdirSync(taskDir2, { recursive: true });
		writeFileSync(
			join(taskDir2, "PROMPT.md"),
			monorepoPrompt("TP-911", "Second", "- **Requires:** TP-910"),
			"utf-8",
		);

		const taskAreas: Record<string, TaskArea> = {
			default: { path: areaDir, prefix: "TP", context: "" },
		};

		const result = runDiscovery("all", taskAreas, areaDir);

		expect(result.pending.size).toBe(2);

		const task1 = result.pending.get("TP-910")!;
		expect(task1.resolvedRepoId).toBeUndefined();
		expect(task1.dependencies).toHaveLength(0);

		const task2 = result.pending.get("TP-911")!;
		expect(task2.resolvedRepoId).toBeUndefined();
		expect(task2.dependencies).toContain("TP-910");
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 8.3 — Repo-mode naming: un-scoped IDs
// ═══════════════════════════════════════════════════════════════════════

describe("8.3: Repo-mode naming — no repoId segments", () => {
	it("8.3.1: generateLaneId without repoId produces un-scoped ID", () => {
		const id = generateLaneId(1);
		expect(id).toBe("lane-1");
		expect(id).not.toContain("/");
	});

	it("8.3.2: generateLaneId with undefined repoId produces un-scoped ID", () => {
		const id = generateLaneId(3, undefined);
		expect(id).toBe("lane-3");
		expect(id).not.toContain("/");
	});

	it("8.3.3: generateLaneSessionId without repoId has no repoId segment", () => {
		const name = generateLaneSessionId("orch", 1, "alice");
		expect(name).toBe("orch-alice-lane-1");
		expect(name).not.toContain("undefined");
	});

	it("8.3.4: generateLaneSessionId with undefined repoId has no repoId segment", () => {
		const name = generateLaneSessionId("orch", 2, "bob", undefined);
		expect(name).toBe("orch-bob-lane-2");
		expect(name).not.toContain("undefined");
	});

	it("8.3.5: multiple repo-mode lane IDs are unique", () => {
		const ids = [1, 2, 3].map(n => generateLaneId(n));
		expect(new Set(ids).size).toBe(3);
		expect(ids).toEqual(["lane-1", "lane-2", "lane-3"]);
	});

	it("8.3.6: multiple repo-mode session names are unique", () => {
		const names = [1, 2, 3].map(n => generateLaneSessionId("orch", n, "alice"));
		expect(new Set(names).size).toBe(3);
		for (const name of names) {
			expect(name).toMatch(/^orch-alice-lane-\d+$/);
		}
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 8.4 — Repo-mode serialization round-trip
// ═══════════════════════════════════════════════════════════════════════

describe("8.4: Repo-mode serialization — round-trip preserves mode=repo", () => {
	it("8.4.1: serialize repo-mode state → validate round-trip", () => {
		const t1 = monoTask("TP-800");
		const t2 = monoTask("TP-801", { dependencies: ["TP-800"] });

		const lane = monoLane(1, [
			monoAllocatedTask("TP-800", 0, t1),
			monoAllocatedTask("TP-801", 1, t2),
		]);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T120000",
			baseBranch: "main",
			mode: "repo",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 2,
			totalTasks: 2,
			currentLanes: [lane],
		};

		const wavePlan = [["TP-800"], ["TP-801"]];
		const json = serializeBatchState(batchState, wavePlan, [lane], []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		// Schema basics
		expect(parsed.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(parsed.mode).toBe("repo");
		expect(parsed.phase).toBe("executing");

		// Tasks have no repo fields
		expect(parsed.tasks).toHaveLength(2);
		for (const task of parsed.tasks) {
			expect(task.repoId).toBeUndefined();
			expect(task.resolvedRepoId).toBeUndefined();
		}

		// Lanes have no repoId
		for (const persistedLane of parsed.lanes) {
			expect(persistedLane.repoId).toBeUndefined();
		}

		// Validate round-trip
		const validated = validatePersistedState(JSON.parse(json));
		expect(validated.mode).toBe("repo");
		expect(validated.tasks).toHaveLength(2);
	});

	it("8.4.2: serialize → validate → reconstruct lanes preserves repo-mode shape", () => {
		const t1 = monoTask("TP-810");
		const lane = monoLane(1, [monoAllocatedTask("TP-810", 0, t1)]);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T130000",
			baseBranch: "main",
			mode: "repo",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 1,
			totalTasks: 1,
			currentLanes: [lane],
		};

		const json = serializeBatchState(batchState, [["TP-810"]], [lane], []);
		const parsed = JSON.parse(json) as PersistedBatchState;

		// Reconstruct lanes from persisted state
		const reconstructed = reconstructAllocatedLanes(parsed.lanes, parsed.tasks);
		expect(reconstructed).toHaveLength(1);
		expect(reconstructed[0].repoId).toBeUndefined();
		expect(reconstructed[0].laneId).toBe("lane-1");
	});

	it("8.4.3: serialized repo-mode task records have correct field set", () => {
		const t1 = monoTask("TP-820");
		const lane = monoLane(1, [monoAllocatedTask("TP-820", 0, t1)]);
		const outcomes: LaneTaskOutcome[] = [];
		seedPendingOutcomesForAllocatedLanes([lane], outcomes);

		const batchState: OrchBatchRuntimeState = {
			...freshOrchBatchState(),
			phase: "executing",
			batchId: "20260316T140000",
			baseBranch: "main",
			mode: "repo",
			startedAt: Date.now(),
			currentWaveIndex: 0,
			totalWaves: 1,
			totalTasks: 1,
			currentLanes: [lane],
		};

		const json = serializeBatchState(batchState, [["TP-820"]], [lane], outcomes);
		const parsed = JSON.parse(json);

		// Verify the task record has the standard fields but no repo fields
		const taskRecord = parsed.tasks[0];
		expect(taskRecord.taskId).toBe("TP-820");
		expect(taskRecord.status).toBe("pending");
		expect(typeof taskRecord.laneNumber).toBe("number");
		expect(typeof taskRecord.sessionName).toBe("string");
		expect(typeof taskRecord.doneFileFound).toBe("boolean");
		// repo fields absent
		expect(taskRecord.repoId).toBeUndefined();
		expect(taskRecord.resolvedRepoId).toBeUndefined();
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 8.5 — Repo-mode resume: v1→v2 upconvert and eligibility
// ═══════════════════════════════════════════════════════════════════════

describe("8.5: Repo-mode resume — v1→v2 upconvert and mode-agnostic eligibility", () => {
	it("8.5.1: v1→v2 upconvert adds mode=repo, preserves all fields", () => {
		const v1Data = JSON.parse(
			readFileSync(join(__dirname, "fixtures", "batch-state-v1-valid.json"), "utf-8"),
		);
		expect(v1Data.schemaVersion).toBe(1);
		expect(v1Data.mode).toBeUndefined();

		const validated = validatePersistedState(v1Data);

		expect(validated.schemaVersion).toBe(BATCH_STATE_SCHEMA_VERSION);
		expect(validated.mode).toBe("repo");
		expect(validated.tasks.length).toBeGreaterThan(0);

		// v1 tasks should NOT have repo fields
		for (const task of validated.tasks) {
			expect(task.repoId).toBeUndefined();
			expect(task.resolvedRepoId).toBeUndefined();
		}
		for (const lane of validated.lanes) {
			expect(lane.repoId).toBeUndefined();
		}
	});

	it("8.5.2: upconvertV1toV2 is idempotent on v2 state", () => {
		const obj: Record<string, unknown> = {
			schemaVersion: 2,
			mode: "repo",
			baseBranch: "main",
		};
		upconvertV1toV2(obj);
		expect(obj.schemaVersion).toBe(2);
		expect(obj.mode).toBe("repo");
		expect(obj.baseBranch).toBe("main");
	});

	it("8.5.3: checkResumeEligibility works for repo-mode paused state", () => {
		const repoState: PersistedBatchState = {
			schemaVersion: BATCH_STATE_SCHEMA_VERSION,
			phase: "paused",
			batchId: "20260316T120000",
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: 1000,
			updatedAt: 2000,
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			wavePlan: [["TP-100"]],
			lanes: [{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-op-lane-1",
				worktreePath: "/wt-1",
				branch: "task/op-lane-1-20260316T120000",
				taskIds: ["TP-100"],
			}],
			tasks: [{
				taskId: "TP-100",
				laneNumber: 1,
				sessionName: "orch-op-lane-1",
				status: "running",
				taskFolder: "/tasks/TP-100",
				startedAt: 1000,
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
		};

		const eligibility = checkResumeEligibility(repoState);
		expect(eligibility.eligible).toBe(true);
		expect(eligibility.phase).toBe("paused");
	});

	it("8.5.4: reconcileTaskStates works for repo-mode state", () => {
		const repoState: PersistedBatchState = {
			schemaVersion: BATCH_STATE_SCHEMA_VERSION,
			phase: "paused",
			batchId: "20260316T120000",
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: 1000,
			updatedAt: 2000,
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			wavePlan: [["TP-100"]],
			lanes: [{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-op-lane-1",
				worktreePath: "/wt-1",
				branch: "task/op-lane-1-20260316T120000",
				taskIds: ["TP-100"],
			}],
			tasks: [{
				taskId: "TP-100",
				laneNumber: 1,
				sessionName: "orch-op-lane-1",
				status: "running",
				taskFolder: "/tasks/TP-100",
				startedAt: 1000,
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
		};

		// Simulate: task completed, session dead
		const aliveSessions = new Set<string>();
		const doneTaskIds = new Set(["TP-100"]);

		const reconciled = reconcileTaskStates(repoState, aliveSessions, doneTaskIds);

		expect(reconciled).toHaveLength(1);
		expect(reconciled[0].taskId).toBe("TP-100");
		expect(reconciled[0].action).toBe("mark-complete");
		expect(reconciled[0].doneFileFound).toBe(true);
	});

	it("8.5.5: computeResumePoint works for repo-mode completed batch", () => {
		const repoState: PersistedBatchState = {
			schemaVersion: BATCH_STATE_SCHEMA_VERSION,
			phase: "paused",
			batchId: "20260316T120000",
			baseBranch: "main",
			orchBranch: "",
			mode: "repo",
			startedAt: 1000,
			updatedAt: 2000,
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			wavePlan: [["TP-100"]],
			lanes: [{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-op-lane-1",
				worktreePath: "/wt-1",
				branch: "task/op-lane-1-20260316T120000",
				taskIds: ["TP-100"],
			}],
			tasks: [{
				taskId: "TP-100",
				laneNumber: 1,
				sessionName: "orch-op-lane-1",
				status: "running",
				taskFolder: "/tasks/TP-100",
				startedAt: 1000,
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
		};

		const aliveSessions = new Set<string>();
		const doneTaskIds = new Set(["TP-100"]);
		const reconciled = reconcileTaskStates(repoState, aliveSessions, doneTaskIds);
		const resumePoint = computeResumePoint(repoState, reconciled);

		// TP-037: All tasks complete BUT merge never happened (mergeResults: [])
		// → wave flagged for merge retry, resumeWaveIndex = 0
		expect(resumePoint.resumeWaveIndex).toBe(0);
		expect(resumePoint.mergeRetryWaveIndexes).toEqual([0]);
		expect(resumePoint.completedTaskIds).toContain("TP-100");
		expect(resumePoint.failedTaskIds).toHaveLength(0);
	});

	it("8.5.6: reconstructAllocatedLanes from repo-mode state has no repoId", () => {
		const persistedLanes = [{
			laneNumber: 1,
			laneId: "lane-1",
			laneSessionId: "orch-op-lane-1",
			worktreePath: "/wt-1",
			branch: "task/op-lane-1-20260316T120000",
			taskIds: ["TP-100"],
		}];
		const persistedTasks = [{
			taskId: "TP-100",
			laneNumber: 1,
			sessionName: "orch-op-lane-1",
			status: "succeeded" as const,
			taskFolder: "/tasks/TP-100",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: true,
			exitReason: "done",
		}];

		const lanes = reconstructAllocatedLanes(persistedLanes, persistedTasks);

		expect(lanes).toHaveLength(1);
		expect(lanes[0].repoId).toBeUndefined();
		expect(lanes[0].laneId).toBe("lane-1");
		expect(lanes[0].tasks[0].task?.resolvedRepoId).toBeUndefined();
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 8.6 — Repo-mode merge: groupLanesByRepo returns single default group
// ═══════════════════════════════════════════════════════════════════════

describe("8.6: Repo-mode merge — groupLanesByRepo returns single default group", () => {
	it("8.6.1: lanes without repoId grouped as single default repo", () => {
		const t1 = monoTask("TP-700");
		const t2 = monoTask("TP-701");
		const lanes: AllocatedLane[] = [
			monoLane(1, [monoAllocatedTask("TP-700", 0, t1)]),
			monoLane(2, [monoAllocatedTask("TP-701", 0, t2)]),
		];

		const groups = groupLanesByRepo(lanes);

		// In repo mode, all lanes should be in a single group with repoId=undefined
		expect(groups).toHaveLength(1);
		expect(groups[0].repoId).toBeUndefined();
		expect(groups[0].lanes).toHaveLength(2);
	});

	it("8.6.2: single lane without repoId grouped correctly", () => {
		const t1 = monoTask("TP-710");
		const lanes: AllocatedLane[] = [
			monoLane(1, [monoAllocatedTask("TP-710", 0, t1)]),
		];

		const groups = groupLanesByRepo(lanes);

		expect(groups).toHaveLength(1);
		expect(groups[0].repoId).toBeUndefined();
		expect(groups[0].lanes).toHaveLength(1);
	});
});


// ═══════════════════════════════════════════════════════════════════════
// 8.7 — Repo-mode wave computation: groupTasksByRepo returns single group
// ═══════════════════════════════════════════════════════════════════════

describe("8.7: Repo-mode waves — groupTasksByRepo returns single default group", () => {
	it("8.7.1: tasks without resolvedRepoId form single default group", () => {
		const pending = new Map<string, ParsedTask>();
		pending.set("TP-600", monoTask("TP-600"));
		pending.set("TP-601", monoTask("TP-601"));
		pending.set("TP-602", monoTask("TP-602"));

		const groups = groupTasksByRepo(["TP-600", "TP-601", "TP-602"], pending);

		expect(groups).toHaveLength(1);
		expect(groups[0].repoId).toBeUndefined();
		expect(groups[0].taskIds.sort()).toEqual(["TP-600", "TP-601", "TP-602"]);
	});

	it("8.7.2: assignTasksToLanes in repo mode produces un-scoped lane assignments", () => {
		const pending = new Map<string, ParsedTask>();
		pending.set("TP-610", monoTask("TP-610", { size: "M" }));
		pending.set("TP-611", monoTask("TP-611", { size: "S" }));

		const assignments = assignTasksToLanes(
			["TP-610", "TP-611"],
			pending,
			3, // maxLanes
			"affinity-first",
			{ S: 1, M: 2, L: 4 },
		);

		// Assignments should have no repo context
		for (const a of assignments) {
			expect(typeof a.lane).toBe("number");
			expect(a.lane).toBeGreaterThan(0);
		}
	});

	it("8.7.3: buildDependencyGraph + computeWaves works in repo mode", () => {
		const pending = new Map<string, ParsedTask>();
		pending.set("TP-620", monoTask("TP-620"));
		pending.set("TP-621", monoTask("TP-621", { dependencies: ["TP-620"] }));
		pending.set("TP-622", monoTask("TP-622", { dependencies: ["TP-621"] }));

		const graph = buildDependencyGraph(pending);
		const completed = new Set<string>();
		const result = computeWaves(graph, completed, pending);

		expect(result.errors).toHaveLength(0);
		expect(result.waves).toHaveLength(3);
		expect(result.waves[0]).toEqual(["TP-620"]);
		expect(result.waves[1]).toEqual(["TP-621"]);
		expect(result.waves[2]).toEqual(["TP-622"]);
	});

	it("8.7.4: wave computation with parallel tasks in repo mode", () => {
		const pending = new Map<string, ParsedTask>();
		pending.set("TP-630", monoTask("TP-630"));
		pending.set("TP-631", monoTask("TP-631"));
		pending.set("TP-632", monoTask("TP-632", { dependencies: ["TP-630", "TP-631"] }));

		const graph = buildDependencyGraph(pending);
		const completed = new Set<string>();
		const result = computeWaves(graph, completed, pending);

		expect(result.errors).toHaveLength(0);
		expect(result.waves).toHaveLength(2);
		expect(result.waves[0].sort()).toEqual(["TP-630", "TP-631"]);
		expect(result.waves[1]).toEqual(["TP-632"]);
	});
});
