/**
 * Waves Repo-Scoped Tests — TP-004 Step 1
 *
 * Tests for repo-scoped lane allocation helpers and workspace-mode
 * behavior in allocateLanes().
 *
 * Test categories:
 *   1. resolveRepoRoot() — repo mode, workspace mode, missing repoId
 *   2. resolveBaseBranch() — fallback chain: per-repo → detected → batch
 *   3. groupTasksByRepo() — repo mode grouping, workspace mode grouping
 *   4. allocateLanes() repo mode regression — unchanged behavior
 *   5. generateLaneId() / generateLaneSessionId() — repo-aware naming
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/waves-repo-scoped.test.ts
 */

// Import the functions under test directly from waves.ts
import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import {
	resolveRepoRoot,
	resolveBaseBranch,
	groupTasksByRepo,
	generateLaneId,
	generateLaneSessionId,
	buildTaskSegmentPlans,
	inferTaskRepoOrder,
	enforceGlobalLaneCap,
} from "../taskplane/waves.ts";

import type {
	WorkspaceConfig,
	WorkspaceRepoConfig,
	ParsedTask,
} from "../taskplane/types.ts";

// ── Test Helpers ──────────────────────────────────────────────────────

function makeWorkspaceConfig(repos: Record<string, { path: string; defaultBranch?: string }>): WorkspaceConfig {
	const repoMap = new Map<string, WorkspaceRepoConfig>();
	for (const [id, cfg] of Object.entries(repos)) {
		repoMap.set(id, { id, path: cfg.path, defaultBranch: cfg.defaultBranch });
	}
	return {
		mode: "workspace",
		repos: repoMap,
		routing: {
			tasksRoot: "/workspace/tasks",
			defaultRepo: Object.keys(repos)[0] || "default",
		},
		configPath: "/workspace/.pi/taskplane-workspace.yaml",
	};
}

function makeParsedTask(
	taskId: string,
	opts?: {
		resolvedRepoId?: string;
		size?: string;
		dependencies?: string[];
		fileScope?: string[];
		explicitSegmentDag?: ParsedTask["explicitSegmentDag"];
	},
): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 1,
		size: opts?.size || "M",
		dependencies: opts?.dependencies || [],
		fileScope: opts?.fileScope || [],
		taskFolder: `/tasks/${taskId}`,
		promptPath: `/tasks/${taskId}/PROMPT.md`,
		areaName: "default",
		status: "pending",
		resolvedRepoId: opts?.resolvedRepoId,
		explicitSegmentDag: opts?.explicitSegmentDag,
	};
}

// ── 1. resolveRepoRoot() ─────────────────────────────────────────────

describe("resolveRepoRoot", () => {
	it("returns default repoRoot when workspaceConfig is null", () => {
		expect(resolveRepoRoot(undefined, "/repo", null)).toBe("/repo");
	});

	it("returns default repoRoot when workspaceConfig is undefined", () => {
		expect(resolveRepoRoot(undefined, "/repo", undefined)).toBe("/repo");
	});

	it("returns default repoRoot when repoId is undefined (repo mode)", () => {
		const wsCfg = makeWorkspaceConfig({ api: { path: "/repos/api" } });
		expect(resolveRepoRoot(undefined, "/repo", wsCfg)).toBe("/repo");
	});

	it("returns repo path from workspace config when repoId is set", () => {
		const wsCfg = makeWorkspaceConfig({
			api: { path: "/repos/api" },
			frontend: { path: "/repos/frontend" },
		});
		expect(resolveRepoRoot("api", "/repo", wsCfg)).toBe("/repos/api");
		expect(resolveRepoRoot("frontend", "/repo", wsCfg)).toBe("/repos/frontend");
	});

	it("returns default repoRoot for unknown repoId (defensive fallback)", () => {
		const wsCfg = makeWorkspaceConfig({ api: { path: "/repos/api" } });
		// The function falls back to defaultRepoRoot for unknown repoId
		expect(resolveRepoRoot("unknown", "/repo", wsCfg)).toBe("/repo");
	});
});

// ── 2. resolveBaseBranch() ───────────────────────────────────────────

describe("resolveBaseBranch", () => {
	it("returns batchBaseBranch when workspaceConfig is null (repo mode)", () => {
		expect(resolveBaseBranch(undefined, "/repo", "main", null)).toBe("main");
	});

	it("returns batchBaseBranch when repoId is undefined (repo mode)", () => {
		const wsCfg = makeWorkspaceConfig({ api: { path: "/repos/api", defaultBranch: "develop" } });
		expect(resolveBaseBranch(undefined, "/repo", "main", wsCfg)).toBe("main");
	});

	it("returns per-repo defaultBranch when set in workspace config", () => {
		const wsCfg = makeWorkspaceConfig({
			api: { path: "/repos/api", defaultBranch: "develop" },
			frontend: { path: "/repos/frontend", defaultBranch: "staging" },
		});
		expect(resolveBaseBranch("api", "/repos/api", "main", wsCfg)).toBe("develop");
		expect(resolveBaseBranch("frontend", "/repos/frontend", "main", wsCfg)).toBe("staging");
	});

	it("falls back to batchBaseBranch when no defaultBranch and no repoId in config", () => {
		const wsCfg = makeWorkspaceConfig({
			api: { path: "/repos/api" }, // no defaultBranch
		});
		// getCurrentBranch would be called but since we're not in a real git repo,
		// it will fail and fall back to batchBaseBranch
		expect(resolveBaseBranch("api", "/repos/api", "main", wsCfg)).toBe("main");
	});
});

// ── 3. groupTasksByRepo() ────────────────────────────────────────────

describe("groupTasksByRepo", () => {
	it("groups all tasks into single group when no resolvedRepoId (repo mode)", () => {
		const pending = new Map<string, ParsedTask>([
			["T-001", makeParsedTask("T-001")],
			["T-002", makeParsedTask("T-002")],
			["T-003", makeParsedTask("T-003")],
		]);

		const groups = groupTasksByRepo(["T-001", "T-002", "T-003"], pending);
		expect(groups).toHaveLength(1);
		expect(groups[0].repoId).toBeUndefined();
		expect(groups[0].taskIds).toEqual(["T-001", "T-002", "T-003"]);
	});

	it("groups tasks by resolvedRepoId in workspace mode", () => {
		const pending = new Map<string, ParsedTask>([
			["T-001", makeParsedTask("T-001", { resolvedRepoId: "api" })],
			["T-002", makeParsedTask("T-002", { resolvedRepoId: "frontend" })],
			["T-003", makeParsedTask("T-003", { resolvedRepoId: "api" })],
		]);

		const groups = groupTasksByRepo(["T-001", "T-002", "T-003"], pending);
		expect(groups).toHaveLength(2);

		// Groups sorted by repoId: "api" before "frontend"
		expect(groups[0].repoId).toBe("api");
		expect(groups[0].taskIds).toEqual(["T-001", "T-003"]);

		expect(groups[1].repoId).toBe("frontend");
		expect(groups[1].taskIds).toEqual(["T-002"]);
	});

	it("sorts tasks within each group alphabetically", () => {
		const pending = new Map<string, ParsedTask>([
			["Z-001", makeParsedTask("Z-001", { resolvedRepoId: "api" })],
			["A-001", makeParsedTask("A-001", { resolvedRepoId: "api" })],
			["M-001", makeParsedTask("M-001", { resolvedRepoId: "api" })],
		]);

		const groups = groupTasksByRepo(["Z-001", "A-001", "M-001"], pending);
		expect(groups[0].taskIds).toEqual(["A-001", "M-001", "Z-001"]);
	});

	it("puts tasks without resolvedRepoId in the default group (first)", () => {
		const pending = new Map<string, ParsedTask>([
			["T-001", makeParsedTask("T-001")], // no repoId
			["T-002", makeParsedTask("T-002", { resolvedRepoId: "api" })],
		]);

		const groups = groupTasksByRepo(["T-001", "T-002"], pending);
		expect(groups).toHaveLength(2);

		// Empty string sorts first, so default group comes first
		expect(groups[0].repoId).toBeUndefined(); // default group
		expect(groups[0].taskIds).toEqual(["T-001"]);

		expect(groups[1].repoId).toBe("api");
		expect(groups[1].taskIds).toEqual(["T-002"]);
	});

	it("handles empty wave", () => {
		const pending = new Map<string, ParsedTask>();
		const groups = groupTasksByRepo([], pending);
		expect(groups).toEqual([]);
	});
});

// ── 4. generateLaneId() ──────────────────────────────────────────────

describe("generateLaneId", () => {
	it("generates repo-mode format when repoId is undefined", () => {
		expect(generateLaneId(1)).toBe("lane-1");
		expect(generateLaneId(3)).toBe("lane-3");
	});

	it("generates workspace-mode format when repoId is set", () => {
		expect(generateLaneId(1, "api")).toBe("api/lane-1");
		expect(generateLaneId(2, "frontend")).toBe("frontend/lane-2");
	});
});

// ── 5. generateLaneSessionId() ─────────────────────────────────────

describe("generateLaneSessionId", () => {
	it("generates repo-mode format with opId when repoId is undefined", () => {
		expect(generateLaneSessionId("orch", 1, "henrylach")).toBe("orch-henrylach-lane-1");
		expect(generateLaneSessionId("orch", 3, "op")).toBe("orch-op-lane-3");
	});

	it("generates workspace-mode format with opId when repoId is set", () => {
		expect(generateLaneSessionId("orch", 1, "henrylach", "api")).toBe("orch-henrylach-api-lane-1");
		expect(generateLaneSessionId("orch", 2, "ci-runner", "frontend")).toBe("orch-ci-runner-frontend-lane-2");
	});

	it("uses custom prefix with opId", () => {
		expect(generateLaneSessionId("tp", 1, "op", "api")).toBe("tp-op-api-lane-1");
	});
});

// ── 6. Segment planning (TP-080) ───────────────────────────────────

describe("segment planning", () => {
	it("infers deterministic multi-repo order from fileScope first appearance + dependency repos", () => {
		const pending = new Map<string, ParsedTask>([
			["DEP-001", makeParsedTask("DEP-001", { resolvedRepoId: "infra" })],
			["HINT-001", makeParsedTask("HINT-001", { resolvedRepoId: "web" })],
			["HINT-002", makeParsedTask("HINT-002", { resolvedRepoId: "docs" })],
			[
				"TP-900",
				makeParsedTask("TP-900", {
					resolvedRepoId: "api",
					dependencies: ["DEP-001"],
					fileScope: ["web/src/app.ts", "api/src/route.ts", "docs/readme.md"],
				}),
			],
		]);

		const knownRepoIds = new Set(["api", "web", "docs", "infra"]);
		const inferred = inferTaskRepoOrder(pending.get("TP-900")!, pending, knownRepoIds);
		expect(inferred.repoIds).toEqual(["web", "api", "docs", "infra"]);
		expect(inferred.usedFallback).toBe(false);

		const plans = buildTaskSegmentPlans(pending);
		const plan = plans.get("TP-900")!;
		expect(plan.mode).toBe("inferred-sequential");
		expect(plan.segments.map((s) => s.repoId)).toEqual(["web", "api", "docs", "infra"]);
		expect(plan.edges.map((e) => `${e.fromSegmentId}->${e.toSegmentId}`)).toEqual([
			"TP-900::api->TP-900::docs",
			"TP-900::docs->TP-900::infra",
			"TP-900::web->TP-900::api",
		]);
		expect(plan.edges.every((e) => e.provenance === "inferred")).toBe(true);
	});

	it("uses workspace repo IDs to infer cross-repo file-scope touches for a single task", () => {
		const pending = new Map<string, ParsedTask>([
			[
				"TP-905",
				makeParsedTask("TP-905", {
					resolvedRepoId: "api",
					fileScope: ["api/src/a.ts", "web/src/b.ts", "src/noise.ts"],
				}),
			],
		]);

		const withoutWorkspaceHints = buildTaskSegmentPlans(pending).get("TP-905")!;
		expect(withoutWorkspaceHints.segments.map((s) => s.repoId)).toEqual(["api"]);

		const withWorkspaceHints = buildTaskSegmentPlans(pending, {
			workspaceRepoIds: ["api", "web"],
		}).get("TP-905")!;
		expect(withWorkspaceHints.mode).toBe("inferred-sequential");
		expect(withWorkspaceHints.segments.map((s) => s.repoId)).toEqual(["api", "web"]);
		expect(withWorkspaceHints.edges.map((e) => `${e.fromSegmentId}->${e.toSegmentId}`)).toEqual([
			"TP-905::api->TP-905::web",
		]);
	});

	it("falls back to singleton repo segment when there are no multi-repo signals", () => {
		const pending = new Map<string, ParsedTask>([
			["TP-901", makeParsedTask("TP-901", { resolvedRepoId: "backend", fileScope: [], dependencies: [] })],
			["TP-902", makeParsedTask("TP-902", { fileScope: ["src/index.ts", "lib/util.ts"], dependencies: [] })],
		]);

		const plans = buildTaskSegmentPlans(pending);
		const p901 = plans.get("TP-901")!;
		expect(p901.mode).toBe("repo-singleton");
		expect(p901.segments.map((s) => s.segmentId)).toEqual(["TP-901::backend"]);
		expect(p901.edges).toEqual([]);

		const p902 = plans.get("TP-902")!;
		expect(p902.mode).toBe("repo-singleton");
		expect(p902.segments.map((s) => s.segmentId)).toEqual(["TP-902::default"]);
	});

	it("preserves explicit DAG authority in mixed explicit + inferred tasks", () => {
		const pending = new Map<string, ParsedTask>([
			[
				"TP-910",
				makeParsedTask("TP-910", {
					explicitSegmentDag: {
						repoIds: ["api", "web"],
						edges: [{ fromRepoId: "api", toRepoId: "web" }],
					},
				}),
			],
			[
				"TP-911",
				makeParsedTask("TP-911", {
					fileScope: ["docs/README.md", "api/src/main.ts"],
				}),
			],
		]);

		const plans = buildTaskSegmentPlans(pending);
		const explicitPlan = plans.get("TP-910")!;
		expect(explicitPlan.mode).toBe("explicit-dag");
		expect(explicitPlan.edges).toEqual([
			{
				fromSegmentId: "TP-910::api",
				toSegmentId: "TP-910::web",
				provenance: "explicit",
				reason: "prompt:segment-dag",
			},
		]);

		const inferredPlan = plans.get("TP-911")!;
		expect(inferredPlan.mode).toBe("inferred-sequential");
		expect(inferredPlan.edges.every((e) => e.provenance === "inferred")).toBe(true);
	});

	it("buildTaskSegmentPlans map ordering is deterministic regardless of input map insertion", () => {
		const taskA = makeParsedTask("TP-001", { fileScope: ["api/src/a.ts"] });
		const taskB = makeParsedTask("TP-002", { fileScope: ["web/src/b.ts"] });

		const pendingAB = new Map<string, ParsedTask>([
			["TP-001", taskA],
			["TP-002", taskB],
		]);
		const pendingBA = new Map<string, ParsedTask>([
			["TP-002", taskB],
			["TP-001", taskA],
		]);

		const plansAB = buildTaskSegmentPlans(pendingAB);
		const plansBA = buildTaskSegmentPlans(pendingBA);

		expect([...plansAB.keys()]).toEqual(["TP-001", "TP-002"]);
		expect([...plansBA.keys()]).toEqual(["TP-001", "TP-002"]);
		expect(JSON.stringify([...plansAB.entries()])).toBe(JSON.stringify([...plansBA.entries()]));
	});
});

// ── TP-148: enforceGlobalLaneCap() ────────────────────────────────

describe("enforceGlobalLaneCap", () => {
	function makeEntry(
		globalLane: number,
		localLane: number,
		repoId: string | undefined,
		taskIds: string[],
	) {
		return {
			globalLane,
			localLane,
			repoId,
			assignments: taskIds.map((taskId) => ({
				taskId,
				lane: localLane,
				task: makeParsedTask(taskId, { resolvedRepoId: repoId }),
			})),
		};
	}

	it("no-ops when total lanes <= maxLanes", () => {
		const entries = [
			makeEntry(1, 1, "api", ["TP-001"]),
			makeEntry(2, 2, "api", ["TP-002"]),
			makeEntry(3, 1, "web", ["TP-003"]),
		];
		enforceGlobalLaneCap(entries, 4);
		expect(entries.length).toBe(3);
	});

	it("reduces total lanes to maxLanes with 3 repos", () => {
		// 3 repos, each with 2 lanes = 6 total. maxLanes=4 → must reduce to 4.
		const entries = [
			makeEntry(1, 1, "api", ["TP-001"]),
			makeEntry(2, 2, "api", ["TP-002"]),
			makeEntry(3, 1, "frontend", ["TP-003"]),
			makeEntry(4, 2, "frontend", ["TP-004"]),
			makeEntry(5, 1, "shared", ["TP-005"]),
			makeEntry(6, 2, "shared", ["TP-006"]),
		];
		enforceGlobalLaneCap(entries, 4);
		expect(entries.length).toBe(4);
		// All task IDs should still be present across lanes
		const allTaskIds = entries.flatMap((e) => e.assignments.map((a) => a.taskId)).sort();
		expect(allTaskIds).toEqual(["TP-001", "TP-002", "TP-003", "TP-004", "TP-005", "TP-006"]);
	});

	it("preserves at least 1 lane per repo", () => {
		// 3 repos with 1 lane each = 3 total. maxLanes=2 → can't go below 3 (1 per repo).
		const entries = [
			makeEntry(1, 1, "api", ["TP-001"]),
			makeEntry(2, 1, "frontend", ["TP-002"]),
			makeEntry(3, 1, "shared", ["TP-003"]),
		];
		enforceGlobalLaneCap(entries, 2);
		expect(entries.length).toBe(3); // can't reduce below 1 per repo
	});

	it("renumbers global lanes sequentially after reduction", () => {
		const entries = [
			makeEntry(1, 1, "api", ["TP-001"]),
			makeEntry(2, 2, "api", ["TP-002"]),
			makeEntry(3, 1, "web", ["TP-003"]),
			makeEntry(4, 2, "web", ["TP-004"]),
		];
		enforceGlobalLaneCap(entries, 2);
		expect(entries.length).toBe(2);
		expect(entries.map((e) => e.globalLane)).toEqual([1, 2]);
	});

	it("reduces from the repo with the most lanes first", () => {
		// api has 3 lanes, web has 1 lane = 4 total. maxLanes=3 → reduce api.
		const entries = [
			makeEntry(1, 1, "api", ["TP-001"]),
			makeEntry(2, 2, "api", ["TP-002"]),
			makeEntry(3, 3, "api", ["TP-003"]),
			makeEntry(4, 1, "web", ["TP-004"]),
		];
		enforceGlobalLaneCap(entries, 3);
		expect(entries.length).toBe(3);
		// api should now have 2 lanes, web still has 1
		const apiEntries = entries.filter((e) => e.repoId === "api");
		const webEntries = entries.filter((e) => e.repoId === "web");
		expect(apiEntries.length).toBe(2);
		expect(webEntries.length).toBe(1);
	});
});
