/**
 * Polyrepo Fixture Acceptance Tests — TP-012 Step 0
 *
 * Validates that the polyrepo fixture builder produces a correct,
 * self-consistent workspace topology. These tests serve as the
 * acceptance criteria for Step 0 and as a smoke test for the
 * fixture builder used by Step 1 regression tests.
 *
 * Test categories:
 *   1.x — Fixture topology (filesystem structure, git repos, non-git root)
 *   2.x — Workspace config validity (loads and validates correctly)
 *   3.x — Task discovery and routing (PROMPT.md → resolvedRepoId)
 *   4.x — Dependency graph and wave shape (cross-repo deps, 3-wave plan)
 *   5.x — Static batch-state fixture validation (polyrepo resume state)
 *   6.x — ParsedTask builder (fixture helper for downstream tests)
 *
 * Run: npx vitest run extensions/tests/polyrepo-fixture.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";

import {
	buildPolyrepoFixture,
	buildFixtureParsedTasks,
	buildFixtureDiscovery,
	FIXTURE_TASK_IDS,
	FIXTURE_REPO_IDS,
	type PolyrepoFixture,
} from "./fixtures/polyrepo-builder.ts";

import {
	resolveTaskRouting,
	runDiscovery,
} from "../taskplane/discovery.ts";

import {
	buildDependencyGraph,
	computeWaves,
	groupTasksByRepo,
} from "../taskplane/waves.ts";

import type { ParsedTask } from "../taskplane/types.ts";

// ── Shared Fixture ───────────────────────────────────────────────────

let fixture: PolyrepoFixture;

beforeAll(() => {
	fixture = buildPolyrepoFixture();
});

afterAll(() => {
	fixture.cleanup();
});

// ── 1.x: Fixture Topology ───────────────────────────────────────────

describe("1.x: Fixture topology", () => {
	it("1.1: workspace root exists and is NOT a git repo", () => {
		expect(existsSync(fixture.workspaceRoot)).toBe(true);
		expect(existsSync(join(fixture.workspaceRoot, ".git"))).toBe(false);
	});

	it("1.2: all three repos exist and ARE git repos", () => {
		for (const repoId of FIXTURE_REPO_IDS) {
			const repoPath = fixture.repoPaths[repoId];
			expect(existsSync(repoPath)).toBe(true);
			expect(existsSync(join(repoPath, ".git"))).toBe(true);

			// Verify git is functional in each repo
			const result = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
				cwd: repoPath,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
			expect(result).toBe("true");
		}
	});

	it("1.3: shared tasks root exists with all area subdirectories", () => {
		expect(existsSync(fixture.tasksRoot)).toBe(true);
		for (const [areaName, areaPath] of Object.entries(fixture.areaPaths)) {
			expect(existsSync(areaPath)).toBe(true);
		}
	});

	it("1.4: all 6 task folders exist with PROMPT.md files", () => {
		for (const taskId of FIXTURE_TASK_IDS) {
			const taskFolder = fixture.taskFolders[taskId];
			expect(existsSync(taskFolder)).toBe(true);
			expect(existsSync(join(taskFolder, "PROMPT.md"))).toBe(true);
		}
	});

	it("1.5: workspace config file exists on disk", () => {
		const configPath = join(fixture.workspaceRoot, ".pi", "taskplane-workspace.yaml");
		expect(existsSync(configPath)).toBe(true);
	});

	it("1.6: task runner config file exists on disk", () => {
		const configPath = join(fixture.workspaceRoot, ".pi", "task-runner.yaml");
		expect(existsSync(configPath)).toBe(true);
	});
});

// ── 2.x: Workspace Config Validity ──────────────────────────────────

describe("2.x: Workspace config validity", () => {
	it("2.1: workspaceConfig has mode 'workspace'", () => {
		expect(fixture.workspaceConfig.mode).toBe("workspace");
	});

	it("2.2: workspaceConfig has all 3 repos", () => {
		expect(fixture.workspaceConfig.repos.size).toBe(3);
		expect(fixture.workspaceConfig.repos.has("docs")).toBe(true);
		expect(fixture.workspaceConfig.repos.has("api")).toBe(true);
		expect(fixture.workspaceConfig.repos.has("frontend")).toBe(true);
	});

	it("2.3: workspaceConfig default repo is 'docs'", () => {
		expect(fixture.workspaceConfig.routing.defaultRepo).toBe("docs");
	});

	it("2.4: workspaceConfig repo paths match fixture repoPaths", () => {
		for (const [id, path] of Object.entries(fixture.repoPaths)) {
			const repoConfig = fixture.workspaceConfig.repos.get(id);
			expect(repoConfig).toBeDefined();
			expect(repoConfig!.path).toBe(path);
		}
	});
});

// ── 3.x: Task Discovery and Routing ─────────────────────────────────

describe("3.x: Task discovery and routing", () => {
	it("3.1: runDiscovery finds all 6 tasks from disk", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		expect(result.errors.filter(e => e.code !== "DEP_SOURCE_FALLBACK")).toHaveLength(0);
		expect(result.pending.size).toBe(6);

		for (const taskId of FIXTURE_TASK_IDS) {
			expect(result.pending.has(taskId)).toBe(true);
		}
	});

	it("3.2: routing resolves each task to the expected repo", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		for (const [taskId, expectedRepo] of Object.entries(fixture.expectedRouting)) {
			const task = result.pending.get(taskId);
			expect(task).toBeDefined();
			expect(task!.resolvedRepoId).toBe(expectedRepo);
		}
	});

	it("3.3: prompt-level repo is parsed for tasks that declare it", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		// UI-001 and UI-002 declare Repo: frontend in PROMPT
		expect(result.pending.get("UI-001")!.promptRepoId).toBe("frontend");
		expect(result.pending.get("UI-002")!.promptRepoId).toBe("frontend");

		// Others don't declare prompt-level repo
		expect(result.pending.get("SH-001")!.promptRepoId).toBeUndefined();
		expect(result.pending.get("AP-001")!.promptRepoId).toBeUndefined();
		expect(result.pending.get("AP-002")!.promptRepoId).toBeUndefined();
		expect(result.pending.get("SH-002")!.promptRepoId).toBeUndefined();
	});

	it("3.4: area-level repo_id fallback works for tasks without prompt repo", () => {
		const result = runDiscovery("all", fixture.taskAreas, fixture.workspaceRoot, {
			workspaceConfig: fixture.workspaceConfig,
		});

		// AP-001 has no prompt repo, area is api-tasks with repo_id: api
		expect(result.pending.get("AP-001")!.promptRepoId).toBeUndefined();
		expect(result.pending.get("AP-001")!.resolvedRepoId).toBe("api");

		// SH-001 has no prompt repo, area is shared-tasks with repo_id: docs
		expect(result.pending.get("SH-001")!.promptRepoId).toBeUndefined();
		expect(result.pending.get("SH-001")!.resolvedRepoId).toBe("docs");
	});
});

// ── 4.x: Dependency Graph and Wave Shape ─────────────────────────────

describe("4.x: Dependency graph and wave shape", () => {
	it("4.1: dependency graph has correct edges", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const graph = buildDependencyGraph(pending, new Set());

		// All 6 tasks are in the graph
		expect(graph.nodes.size).toBe(6);

		// Check dependency edges
		expect(graph.dependencies.get("SH-001") ?? []).toEqual([]);
		expect(graph.dependencies.get("AP-001") ?? []).toEqual([]);
		expect(graph.dependencies.get("UI-001") ?? []).toEqual([]);
		expect((graph.dependencies.get("AP-002") ?? []).sort()).toEqual(["AP-001"]);
		expect((graph.dependencies.get("UI-002") ?? []).sort()).toEqual(["AP-001", "UI-001"]);
		expect((graph.dependencies.get("SH-002") ?? []).sort()).toEqual(["AP-002", "UI-002"]);
	});

	it("4.2: cross-repo dependencies are captured correctly", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const graph = buildDependencyGraph(pending, new Set());

		// UI-002 (frontend) depends on AP-001 (api) — cross-repo
		const ui002Deps = graph.dependencies.get("UI-002") ?? [];
		expect(ui002Deps).toContain("AP-001");

		// SH-002 (docs) depends on AP-002 (api) and UI-002 (frontend) — both cross-repo
		const sh002Deps = graph.dependencies.get("SH-002") ?? [];
		expect(sh002Deps).toContain("AP-002");
		expect(sh002Deps).toContain("UI-002");
	});

	it("4.3: wave computation produces expected 3-wave plan", () => {
		const pending = buildFixtureParsedTasks(fixture);
		const completed = new Set<string>();
		const graph = buildDependencyGraph(pending, completed);
		const waveResult = computeWaves(graph, completed, pending);

		expect(waveResult.errors).toHaveLength(0);
		expect(waveResult.waves).toHaveLength(3);

		// Wave 1: all independent tasks (sorted alphabetically)
		const wave1TaskIds = waveResult.waves[0].sort();
		expect(wave1TaskIds).toEqual(["AP-001", "SH-001", "UI-001"]);

		// Wave 2: tasks that depend on wave 1
		const wave2TaskIds = waveResult.waves[1].sort();
		expect(wave2TaskIds).toEqual(["AP-002", "UI-002"]);

		// Wave 3: final task depending on wave 2
		const wave3TaskIds = waveResult.waves[2].sort();
		expect(wave3TaskIds).toEqual(["SH-002"]);
	});

	it("4.4: groupTasksByRepo separates tasks by resolved repo", () => {
		const pending = buildFixtureParsedTasks(fixture);

		// Group wave 1 tasks
		const wave1Groups = groupTasksByRepo(["SH-001", "AP-001", "UI-001"], pending);
		expect(wave1Groups.length).toBe(3); // 3 repos

		const repoIds = wave1Groups.map(g => g.repoId).sort();
		expect(repoIds).toEqual(["api", "docs", "frontend"]);

		// Each group has exactly 1 task in wave 1
		for (const group of wave1Groups) {
			expect(group.taskIds.length).toBe(1);
		}

		// Group wave 2 tasks
		const wave2Groups = groupTasksByRepo(["AP-002", "UI-002"], pending);
		expect(wave2Groups.length).toBe(2); // api and frontend
		const wave2RepoIds = wave2Groups.map(g => g.repoId).sort();
		expect(wave2RepoIds).toEqual(["api", "frontend"]);
	});
});

// ── 5.x: Static Batch-State Fixture ──────────────────────────────────

describe("5.x: Static batch-state fixture (v2-polyrepo)", () => {
	const fixtureData = JSON.parse(
		readFileSync(join(__dirname, "fixtures", "batch-state-v2-polyrepo.json"), "utf-8"),
	);

	it("5.1: fixture has schema version 2 and workspace mode", () => {
		expect(fixtureData.schemaVersion).toBe(2);
		expect(fixtureData.mode).toBe("workspace");
	});

	it("5.2: fixture has 6 tasks across 3 repos", () => {
		expect(fixtureData.tasks.length).toBe(6);
		const resolvedRepos = new Set(fixtureData.tasks.map((t: any) => t.resolvedRepoId));
		expect(resolvedRepos.size).toBe(3);
		expect(resolvedRepos.has("docs")).toBe(true);
		expect(resolvedRepos.has("api")).toBe(true);
		expect(resolvedRepos.has("frontend")).toBe(true);
	});

	it("5.3: fixture has 3-wave plan", () => {
		expect(fixtureData.wavePlan.length).toBe(3);
		expect(fixtureData.wavePlan[0].sort()).toEqual(["AP-001", "SH-001", "UI-001"]);
		expect(fixtureData.wavePlan[1].sort()).toEqual(["AP-002", "UI-002"]);
		expect(fixtureData.wavePlan[2]).toEqual(["SH-002"]);
	});

	it("5.4: wave 1 tasks are succeeded, wave 2 tasks are running, wave 3 pending", () => {
		const byId = Object.fromEntries(fixtureData.tasks.map((t: any) => [t.taskId, t]));
		// Wave 1
		expect(byId["SH-001"].status).toBe("succeeded");
		expect(byId["AP-001"].status).toBe("succeeded");
		expect(byId["UI-001"].status).toBe("succeeded");
		// Wave 2
		expect(byId["AP-002"].status).toBe("running");
		expect(byId["UI-002"].status).toBe("running");
		// Wave 3
		expect(byId["SH-002"].status).toBe("pending");
	});

	it("5.5: lanes have correct repoId assignments", () => {
		for (const lane of fixtureData.lanes) {
			expect(typeof lane.repoId).toBe("string");
			expect(["docs", "api", "frontend"]).toContain(lane.repoId);
		}
	});

	it("5.6: merge results include per-repo outcomes", () => {
		expect(fixtureData.mergeResults.length).toBe(1); // wave 0 completed
		const merge = fixtureData.mergeResults[0];
		expect(merge.status).toBe("succeeded");
		expect(merge.repoResults).toBeDefined();
		expect(merge.repoResults.length).toBe(3);
		const mergeRepoIds = merge.repoResults.map((r: any) => r.repoId).sort();
		expect(mergeRepoIds).toEqual(["api", "docs", "frontend"]);
	});

	it("5.7: fixture passes schema validation", () => {
		// Reimplement minimal validation to verify fixture is structurally valid
		expect(typeof fixtureData.schemaVersion).toBe("number");
		expect(typeof fixtureData.phase).toBe("string");
		expect(typeof fixtureData.batchId).toBe("string");
		expect(typeof fixtureData.mode).toBe("string");
		expect(Array.isArray(fixtureData.wavePlan)).toBe(true);
		expect(Array.isArray(fixtureData.lanes)).toBe(true);
		expect(Array.isArray(fixtureData.tasks)).toBe(true);
		expect(Array.isArray(fixtureData.mergeResults)).toBe(true);
		expect(Array.isArray(fixtureData.blockedTaskIds)).toBe(true);
		expect(Array.isArray(fixtureData.errors)).toBe(true);

		for (const task of fixtureData.tasks) {
			expect(typeof task.taskId).toBe("string");
			expect(typeof task.laneNumber).toBe("number");
			expect(typeof task.sessionName).toBe("string");
			expect(typeof task.status).toBe("string");
			expect(typeof task.taskFolder).toBe("string");
			expect(typeof task.doneFileFound).toBe("boolean");
			expect(typeof task.exitReason).toBe("string");
			if (task.resolvedRepoId !== undefined) {
				expect(typeof task.resolvedRepoId).toBe("string");
			}
		}

		for (const lane of fixtureData.lanes) {
			expect(typeof lane.laneNumber).toBe("number");
			expect(typeof lane.laneId).toBe("string");
			expect(typeof lane.tmuxSessionName).toBe("string");
			expect(typeof lane.worktreePath).toBe("string");
			expect(typeof lane.branch).toBe("string");
			expect(Array.isArray(lane.taskIds)).toBe(true);
			if (lane.repoId !== undefined) {
				expect(typeof lane.repoId).toBe("string");
			}
		}
	});
});

// ── 6.x: ParsedTask Builder ─────────────────────────────────────────

describe("6.x: ParsedTask builder", () => {
	it("6.1: buildFixtureParsedTasks produces all 6 tasks", () => {
		const tasks = buildFixtureParsedTasks(fixture);
		expect(tasks.size).toBe(6);
		for (const taskId of FIXTURE_TASK_IDS) {
			expect(tasks.has(taskId)).toBe(true);
		}
	});

	it("6.2: tasks have correct resolvedRepoId from expected routing", () => {
		const tasks = buildFixtureParsedTasks(fixture);
		for (const [taskId, expectedRepo] of Object.entries(fixture.expectedRouting)) {
			expect(tasks.get(taskId)!.resolvedRepoId).toBe(expectedRepo);
		}
	});

	it("6.3: tasks have correct dependencies", () => {
		const tasks = buildFixtureParsedTasks(fixture);
		for (const [taskId, expectedDeps] of Object.entries(fixture.expectedDeps)) {
			expect(tasks.get(taskId)!.dependencies.sort()).toEqual([...expectedDeps].sort());
		}
	});

	it("6.4: tasks have correct area names", () => {
		const tasks = buildFixtureParsedTasks(fixture);
		expect(tasks.get("AP-001")!.areaName).toBe("api-tasks");
		expect(tasks.get("AP-002")!.areaName).toBe("api-tasks");
		expect(tasks.get("UI-001")!.areaName).toBe("ui-tasks");
		expect(tasks.get("UI-002")!.areaName).toBe("ui-tasks");
		expect(tasks.get("SH-001")!.areaName).toBe("shared-tasks");
		expect(tasks.get("SH-002")!.areaName).toBe("shared-tasks");
	});

	it("6.5: tasks have correct sizes", () => {
		const tasks = buildFixtureParsedTasks(fixture);
		expect(tasks.get("SH-001")!.size).toBe("S");
		expect(tasks.get("AP-001")!.size).toBe("M");
		expect(tasks.get("UI-001")!.size).toBe("M");
		expect(tasks.get("AP-002")!.size).toBe("L");
		expect(tasks.get("UI-002")!.size).toBe("L");
		expect(tasks.get("SH-002")!.size).toBe("M");
	});

	it("6.6: buildFixtureDiscovery produces a DiscoveryResult", () => {
		const discovery = buildFixtureDiscovery(fixture);
		expect(discovery.pending.size).toBe(6);
		expect(discovery.completed.size).toBe(0);
		expect(discovery.errors).toHaveLength(0);
	});

	it("6.7: task folders point to actual fixture directories", () => {
		const tasks = buildFixtureParsedTasks(fixture);
		for (const [taskId, task] of tasks) {
			expect(existsSync(task.taskFolder)).toBe(true);
			expect(existsSync(task.promptPath)).toBe(true);
		}
	});
});
