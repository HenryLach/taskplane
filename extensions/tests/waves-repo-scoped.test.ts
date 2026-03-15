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
 *   5. generateLaneId() / generateTmuxSessionName() — repo-aware naming
 *
 * Run: npx vitest run extensions/tests/waves-repo-scoped.test.ts
 */

import { describe, it, expect, vi } from "vitest";

// Import the functions under test directly from waves.ts
import {
	resolveRepoRoot,
	resolveBaseBranch,
	groupTasksByRepo,
	generateLaneId,
	generateTmuxSessionName,
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

function makeParsedTask(taskId: string, opts?: { resolvedRepoId?: string; size?: string }): ParsedTask {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 1,
		size: opts?.size || "M",
		dependencies: [],
		fileScope: [],
		taskFolder: `/tasks/${taskId}`,
		promptPath: `/tasks/${taskId}/PROMPT.md`,
		areaName: "default",
		status: "pending",
		resolvedRepoId: opts?.resolvedRepoId,
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

// ── 5. generateTmuxSessionName() ─────────────────────────────────────

describe("generateTmuxSessionName", () => {
	it("generates repo-mode format with opId when repoId is undefined", () => {
		expect(generateTmuxSessionName("orch", 1, "henrylach")).toBe("orch-henrylach-lane-1");
		expect(generateTmuxSessionName("orch", 3, "op")).toBe("orch-op-lane-3");
	});

	it("generates workspace-mode format with opId when repoId is set", () => {
		expect(generateTmuxSessionName("orch", 1, "henrylach", "api")).toBe("orch-henrylach-api-lane-1");
		expect(generateTmuxSessionName("orch", 2, "ci-runner", "frontend")).toBe("orch-ci-runner-frontend-lane-2");
	});

	it("uses custom prefix with opId", () => {
		expect(generateTmuxSessionName("tp", 1, "op", "api")).toBe("tp-op-api-lane-1");
	});
});
