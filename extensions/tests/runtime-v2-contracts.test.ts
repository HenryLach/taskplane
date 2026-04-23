/**
 * Runtime V2 Contract Tests — TP-102
 *
 * Behavioral tests for the foundational Runtime V2 type contracts:
 *   - PacketPaths resolution and validation
 *   - ExecutionUnit shape and field contracts
 *   - RuntimeAgentManifest validation
 *   - RuntimeAgentId generation
 *   - Runtime path helpers
 *   - Terminal status sets
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/runtime-v2-contracts.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import {
	resolvePacketPaths,
	validatePacketPaths,
	validateAgentManifest,
	buildRuntimeAgentId,
	runtimeRoot,
	runtimeAgentDir,
	runtimeManifestPath,
	runtimeAgentEventsPath,
	runtimeLaneSnapshotPath,
	runtimeRegistryPath,
	TERMINAL_AGENT_STATUSES,
	type ExecutionUnit,
	type RuntimeAgentManifest,
	type RuntimeLaneSnapshot,
	type RuntimeAgentEvent,
	type RuntimeAgentRole,
	type RuntimeAgentStatus,
	type PacketPaths,
	type AllocatedLane,
	type AllocatedTask,
	type ParsedTask,
} from "../taskplane/types.ts";

import {
	buildExecutionUnit,
	buildAgentIdFromLane,
	resolveRuntimeStateRoot,
} from "../taskplane/execution.ts";

// ── 1. PacketPaths ──────────────────────────────────────────────────

describe("1.x: resolvePacketPaths", () => {
	it("1.1: produces correct paths from a task folder", () => {
		const pp = resolvePacketPaths("/project/taskplane-tasks/TP-100-test");
		expect(pp.promptPath).toBe("/project/taskplane-tasks/TP-100-test/PROMPT.md");
		expect(pp.statusPath).toBe("/project/taskplane-tasks/TP-100-test/STATUS.md");
		expect(pp.donePath).toBe("/project/taskplane-tasks/TP-100-test/.DONE");
		expect(pp.reviewsDir).toBe("/project/taskplane-tasks/TP-100-test/.reviews");
		expect(pp.taskFolder).toBe("/project/taskplane-tasks/TP-100-test");
	});

	it("1.2: handles Windows-style paths", () => {
		const pp = resolvePacketPaths("C:/dev/taskplane/tasks/TP-001");
		expect(pp.promptPath).toBe("C:/dev/taskplane/tasks/TP-001/PROMPT.md");
		expect(pp.donePath).toBe("C:/dev/taskplane/tasks/TP-001/.DONE");
	});

	it("1.3: is a pure function with no side effects", () => {
		const pp1 = resolvePacketPaths("/a/b");
		const pp2 = resolvePacketPaths("/a/b");
		expect(pp1).toEqual(pp2);
	});
});

describe("1.x: validatePacketPaths", () => {
	it("1.4: accepts a valid PacketPaths object", () => {
		const pp = resolvePacketPaths("/tasks/TP-100");
		const errors = validatePacketPaths(pp);
		expect(errors).toEqual([]);
	});

	it("1.5: rejects null", () => {
		const errors = validatePacketPaths(null);
		expect(errors.length).toBeGreaterThan(0);
	});

	it("1.6: rejects missing fields", () => {
		const errors = validatePacketPaths({ promptPath: "/a", statusPath: "/b" });
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e: string) => e.includes("donePath"))).toBe(true);
		expect(errors.some((e: string) => e.includes("reviewsDir"))).toBe(true);
		expect(errors.some((e: string) => e.includes("taskFolder"))).toBe(true);
	});

	it("1.7: rejects empty strings", () => {
		const errors = validatePacketPaths({
			promptPath: "",
			statusPath: "/b",
			donePath: "/c",
			reviewsDir: "/d",
			taskFolder: "/e",
		});
		expect(errors.some((e: string) => e.includes("promptPath"))).toBe(true);
	});
});

// ── 2. RuntimeAgentManifest validation ──────────────────────────────

describe("2.x: validateAgentManifest", () => {
	function validManifest(): RuntimeAgentManifest {
		return {
			batchId: "20260330T120000",
			agentId: "orch-henrylach-lane-1-worker",
			role: "worker",
			laneNumber: 1,
			taskId: "TP-102",
			repoId: "default",
			pid: 12345,
			parentPid: 12000,
			startedAt: Date.now(),
			status: "running",
			cwd: "/dev/taskplane/.worktrees/lane-1",
			packet: resolvePacketPaths("/dev/taskplane/tasks/TP-102"),
		};
	}

	it("2.1: accepts a valid manifest", () => {
		const errors = validateAgentManifest(validManifest());
		expect(errors).toEqual([]);
	});

	it("2.2: rejects null", () => {
		const errors = validateAgentManifest(null);
		expect(errors).toEqual(["manifest must be a non-null object"]);
	});

	it("2.3: rejects missing batchId", () => {
		const m = validManifest();
		(m as any).batchId = "";
		expect(validateAgentManifest(m).some((e: string) => e.includes("batchId"))).toBe(true);
	});

	it("2.4: rejects invalid role", () => {
		const m = validManifest();
		(m as any).role = "supervisor";
		expect(validateAgentManifest(m).some((e: string) => e.includes("role"))).toBe(true);
	});

	it("2.5: rejects invalid status", () => {
		const m = validManifest();
		(m as any).status = "dormant";
		expect(validateAgentManifest(m).some((e: string) => e.includes("status"))).toBe(true);
	});

	it("2.6: rejects pid <= 0", () => {
		const m = validManifest();
		m.pid = 0;
		expect(validateAgentManifest(m).some((e: string) => e.includes("pid"))).toBe(true);
	});

	it("2.7: rejects non-finite startedAt", () => {
		const m = validManifest();
		(m as any).startedAt = Infinity;
		expect(validateAgentManifest(m).some((e: string) => e.includes("startedAt"))).toBe(true);
	});

	it("2.8: accepts all valid roles", () => {
		for (const role of ["worker", "reviewer", "merger", "lane-runner"] as RuntimeAgentRole[]) {
			const m = validManifest();
			m.role = role;
			expect(validateAgentManifest(m)).toEqual([]);
		}
	});

	it("2.9: accepts all valid statuses", () => {
		for (const status of ["spawning", "running", "wrapping_up", "exited", "crashed", "timed_out", "killed"] as RuntimeAgentStatus[]) {
			const m = validManifest();
			m.status = status;
			expect(validateAgentManifest(m)).toEqual([]);
		}
	});
});

// ── 3. RuntimeAgentId generation ────────────────────────────────────

describe("3.x: buildRuntimeAgentId", () => {
	it("3.1: worker ID follows convention", () => {
		const id = buildRuntimeAgentId("orch-henrylach", 1, "worker");
		expect(id).toBe("orch-henrylach-lane-1-worker");
	});

	it("3.2: reviewer ID follows convention", () => {
		const id = buildRuntimeAgentId("orch-henrylach", 2, "reviewer");
		expect(id).toBe("orch-henrylach-lane-2-reviewer");
	});

	it("3.3: merger ID uses merge index", () => {
		const id = buildRuntimeAgentId("orch-henrylach", null, "merger", 3);
		expect(id).toBe("orch-henrylach-merge-3");
	});

	it("3.4: lane-runner ID follows convention", () => {
		const id = buildRuntimeAgentId("orch-henrylach", 1, "lane-runner");
		expect(id).toBe("orch-henrylach-lane-1");
	});

	it("3.5: fallback for unknown role without lane number", () => {
		const id = buildRuntimeAgentId("orch-op", null, "worker");
		expect(id).toBe("orch-op-worker");
	});

	it("3.6: IDs are deterministic (same inputs = same output)", () => {
		const a = buildRuntimeAgentId("orch-x", 1, "worker");
		const b = buildRuntimeAgentId("orch-x", 1, "worker");
		expect(a).toBe(b);
	});

	it("3.7: different lanes produce different IDs", () => {
		const a = buildRuntimeAgentId("orch-x", 1, "worker");
		const b = buildRuntimeAgentId("orch-x", 2, "worker");
		expect(a).not.toBe(b);
	});

	it("3.8: different roles produce different IDs", () => {
		const a = buildRuntimeAgentId("orch-x", 1, "worker");
		const b = buildRuntimeAgentId("orch-x", 1, "reviewer");
		expect(a).not.toBe(b);
	});
});

// ── 4. Runtime path helpers ─────────────────────────────────────────

describe("4.x: runtime path helpers", () => {
	const stateRoot = "/project";
	const batchId = "20260330T120000";
	const agentId = "orch-henrylach-lane-1-worker";

	it("4.1: runtimeRoot", () => {
		expect(runtimeRoot(stateRoot, batchId)).toBe("/project/.pi/runtime/20260330T120000");
	});

	it("4.2: runtimeAgentDir", () => {
		expect(runtimeAgentDir(stateRoot, batchId, agentId)).toBe(
			"/project/.pi/runtime/20260330T120000/agents/orch-henrylach-lane-1-worker",
		);
	});

	it("4.3: runtimeManifestPath", () => {
		expect(runtimeManifestPath(stateRoot, batchId, agentId)).toBe(
			"/project/.pi/runtime/20260330T120000/agents/orch-henrylach-lane-1-worker/manifest.json",
		);
	});

	it("4.4: runtimeAgentEventsPath", () => {
		expect(runtimeAgentEventsPath(stateRoot, batchId, agentId)).toBe(
			"/project/.pi/runtime/20260330T120000/agents/orch-henrylach-lane-1-worker/events.jsonl",
		);
	});

	it("4.5: runtimeLaneSnapshotPath", () => {
		expect(runtimeLaneSnapshotPath(stateRoot, batchId, 3)).toBe(
			"/project/.pi/runtime/20260330T120000/lanes/lane-3.json",
		);
	});

	it("4.6: runtimeRegistryPath", () => {
		expect(runtimeRegistryPath(stateRoot, batchId)).toBe(
			"/project/.pi/runtime/20260330T120000/registry.json",
		);
	});

	it("4.7: Windows-style stateRoot works", () => {
		expect(runtimeRoot("C:/dev/taskplane", batchId)).toBe(
			"C:/dev/taskplane/.pi/runtime/20260330T120000",
		);
	});
});

// ── 5. Terminal agent statuses ──────────────────────────────────────

describe("5.x: TERMINAL_AGENT_STATUSES", () => {
	it("5.1: includes exited, crashed, timed_out, killed", () => {
		for (const s of ["exited", "crashed", "timed_out", "killed"] as const) {
			expect(TERMINAL_AGENT_STATUSES.has(s)).toBe(true);
		}
	});

	it("5.2: does not include running or spawning", () => {
		for (const s of ["running", "spawning", "wrapping_up"] as const) {
			expect(TERMINAL_AGENT_STATUSES.has(s)).toBe(false);
		}
	});
});

// ── 6. ExecutionUnit shape contract ─────────────────────────────────

describe("6.x: ExecutionUnit shape", () => {
	function validUnit(): ExecutionUnit {
		return {
			id: "TP-102",
			taskId: "TP-102",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			repoPaths: {
				default: "/dev/taskplane/.worktrees/lane-1",
			},
			worktreePath: "/dev/taskplane/.worktrees/lane-1",
			packet: resolvePacketPaths("/dev/taskplane/tasks/TP-102"),
			task: {
				taskId: "TP-102",
				taskName: "Test",
				reviewLevel: 2,
				size: "M",
				dependencies: [],
				fileScope: [],
				taskFolder: "/dev/taskplane/tasks/TP-102",
				promptPath: "/dev/taskplane/tasks/TP-102/PROMPT.md",
				areaName: "general",
				status: "pending",
			},
		};
	}

	it("6.1: whole-task unit has null segmentId", () => {
		const u = validUnit();
		expect(u.segmentId).toBe(null);
		expect(u.id).toBe(u.taskId);
	});

	it("6.2: segment unit uses taskId::repoId as id", () => {
		const u = validUnit();
		u.id = "TP-102::api";
		u.segmentId = "TP-102::api";
		u.executionRepoId = "api";
		u.packetHomeRepoId = "shared-libs";
		u.repoPaths = {
			api: "/repos/api-service/.worktrees/lane-1",
			"shared-libs": "/repos/shared-libs",
		};
		expect(u.id).toBe("TP-102::api");
		expect(u.executionRepoId).not.toBe(u.packetHomeRepoId);
	});

	it("6.3: packet paths are authoritative regardless of worktreePath", () => {
		const u = validUnit();
		// worktreePath points to one repo, packet paths point elsewhere
		u.worktreePath = "/repos/api-service/.worktrees/lane-1";
		u.packet = resolvePacketPaths("/repos/shared-libs/tasks/TP-102");
		expect(u.packet.taskFolder).toBe("/repos/shared-libs/tasks/TP-102");
		expect(u.worktreePath).not.toContain("shared-libs");
	});

	it("6.4: repoPaths carry execution and sibling repo paths", () => {
		const u = validUnit();
		u.executionRepoId = "api";
		u.packetHomeRepoId = "shared-libs";
		u.repoPaths = {
			api: "/repos/api-service/.worktrees/lane-1",
			"shared-libs": "/repos/shared-libs",
		};
		expect(u.repoPaths.api).toContain(".worktrees");
		expect(u.repoPaths["shared-libs"]).toBe("/repos/shared-libs");
	});

	it("6.5: packet paths contain all required fields", () => {
		const u = validUnit();
		expect(validatePacketPaths(u.packet)).toEqual([]);
	});
});

// ── 7. Bridge helpers (TP-102 Step 2) ───────────────────────────────

function makeParsedTask(overrides?: Partial<ParsedTask>): ParsedTask {
	return {
		taskId: "TP-102",
		taskName: "Test task",
		reviewLevel: 2,
		size: "M",
		dependencies: [],
		fileScope: [],
		taskFolder: "/project/taskplane-tasks/TP-102-test",
		promptPath: "/project/taskplane-tasks/TP-102-test/PROMPT.md",
		areaName: "general",
		status: "pending" as const,
		...overrides,
	};
}

function makeAllocatedTask(overrides?: Partial<ParsedTask>): AllocatedTask {
	return {
		taskId: "TP-102",
		order: 0,
		task: makeParsedTask(overrides),
		estimatedMinutes: 30,
	};
}

function makeAllocatedLane(overrides?: Partial<AllocatedLane>): AllocatedLane {
	return {
		laneNumber: 1,
		laneId: "lane-1",
		laneSessionId: "orch-henrylach-lane-1",
		worktreePath: "/project/.worktrees/op-batch/lane-1",
		branch: "task/henrylach-lane-1-batch",
		tasks: [makeAllocatedTask()],
		strategy: "affinity-first" as const,
		estimatedLoad: 2,
		estimatedMinutes: 30,
		...overrides,
	};
}

describe("7.x: buildExecutionUnit bridge", () => {
	it("7.1: produces an ExecutionUnit with correct packet paths for repo mode", () => {
		const lane = makeAllocatedLane();
		const task = makeAllocatedTask();
		const unit = buildExecutionUnit(lane, task, "/project");

		expect(unit.id).toBe("TP-102");
		expect(unit.taskId).toBe("TP-102");
		expect(unit.segmentId).toBe(null);
		expect(unit.executionRepoId).toBe("default");
		expect(unit.packetHomeRepoId).toBe("default");
		expect(unit.repoPaths.default).toBe(lane.worktreePath);
		expect(unit.worktreePath).toBe(lane.worktreePath);
		expect(unit.packet.statusPath).toContain("STATUS.md");
		expect(unit.packet.donePath).toContain(".DONE");
		expect(unit.packet.reviewsDir).toContain(".reviews");
		expect(unit.task).toBe(task.task);
	});

	it("7.2: uses packetRepoId from ParsedTask when available", () => {
		const lane = makeAllocatedLane({ repoId: "api" });
		const task = makeAllocatedTask({ packetRepoId: "shared-libs" });
		const unit = buildExecutionUnit(lane, task, "/project", true);

		expect(unit.executionRepoId).toBe("api");
		expect(unit.packetHomeRepoId).toBe("shared-libs");
	});

	it("7.3: maps participating repos to execution worktree and workspace roots", () => {
		const lane = makeAllocatedLane({
			repoId: "api",
			worktreePath: "/workspace/.worktrees/api-lane-1",
		});
		const task = makeAllocatedTask({
			packetRepoId: "shared-libs",
			participatingRepoIds: ["api", "shared-libs", "web-client"],
		});
		const workspaceConfig = {
			mode: "workspace",
			repos: new Map([
				["api", { path: "/workspace/repos/api" }],
				["shared-libs", { path: "/workspace/repos/shared-libs" }],
				["web-client", { path: "/workspace/repos/web-client" }],
			]),
			routing: { tasksRoot: "/workspace/tasks", defaultRepo: "api" },
			configPath: "/workspace/.pi/taskplane-workspace.yaml",
		} as any;
		const unit = buildExecutionUnit(lane, task, "/workspace/repos/api", true, workspaceConfig);

		expect(unit.repoPaths.api).toBe(lane.worktreePath);
		expect(unit.repoPaths["shared-libs"]).toBe("/workspace/repos/shared-libs");
		expect(unit.repoPaths["web-client"]).toBe("/workspace/repos/web-client");
	});

	it("7.3b: maps resolvedRepoIds before segment participation is materialized", () => {
		const lane = makeAllocatedLane({
			repoId: "api",
			worktreePath: "/workspace/.worktrees/api-lane-1",
		});
		const task = makeAllocatedTask({
			resolvedRepoId: "api",
			resolvedRepoIds: ["api", "shared-libs", "web-client"],
		});
		const workspaceConfig = {
			mode: "workspace",
			repos: new Map([
				["api", { path: "/workspace/repos/api" }],
				["shared-libs", { path: "/workspace/repos/shared-libs" }],
				["web-client", { path: "/workspace/repos/web-client" }],
			]),
			routing: { tasksRoot: "/workspace/tasks", defaultRepo: "api" },
			configPath: "/workspace/.pi/taskplane-workspace.yaml",
		} as any;
		const unit = buildExecutionUnit(lane, task, "/workspace/repos/api", true, workspaceConfig);

		expect(unit.repoPaths.api).toBe(lane.worktreePath);
		expect(unit.repoPaths["shared-libs"]).toBe("/workspace/repos/shared-libs");
		expect(unit.repoPaths["web-client"]).toBe("/workspace/repos/web-client");
	});

	it("7.4: uses segment ID when activeSegmentId is set", () => {
		const task = makeAllocatedTask({ activeSegmentId: "TP-102::api" });
		const lane = makeAllocatedLane();
		const unit = buildExecutionUnit(lane, task, "/project");

		expect(unit.segmentId).toBe("TP-102::api");
		expect(unit.id).toBe("TP-102::api");
	});

	it("7.4b: uses repoWorktrees path for the execution repo when available", () => {
		const lane = makeAllocatedLane({
			repoId: "shared-libs",
			worktreePath: "/workspace/.worktrees/api-lane-1",
			repoWorktrees: {
				api: { path: "/workspace/.worktrees/api-lane-1", branch: "task/api", laneNumber: 1, repoId: "api" },
				"shared-libs": { path: "/workspace/.worktrees/shared-libs-lane-1", branch: "task/shared", laneNumber: 1, repoId: "shared-libs" },
			},
		});
		const task = makeAllocatedTask({
			activeSegmentId: "TP-102::shared-libs",
			packetRepoId: "shared-libs",
			participatingRepoIds: ["api", "shared-libs"],
			taskFolder: "/workspace/tasks/TP-102",
		});
		const workspaceConfig = {
			mode: "workspace",
			repos: new Map([
				["api", { path: "/workspace/repos/api" }],
				["shared-libs", { path: "/workspace/repos/shared-libs" }],
			]),
			routing: { tasksRoot: "/workspace/tasks", defaultRepo: "api" },
			configPath: "/workspace/.pi/taskplane-workspace.yaml",
		} as any;

		const unit = buildExecutionUnit(lane, task, "/workspace/repos/api", true, workspaceConfig);

		expect(unit.executionRepoId).toBe("shared-libs");
		expect(unit.worktreePath).toBe("/workspace/.worktrees/shared-libs-lane-1");
		expect(unit.repoPaths["shared-libs"]).toBe("/workspace/.worktrees/shared-libs-lane-1");
		expect(unit.repoPaths.api).toBe("/workspace/.worktrees/api-lane-1");
		expect(unit.packet.taskFolder).toContain("/workspace/.worktrees/shared-libs-lane-1/");
	});

	it("7.5: packet paths are valid PacketPaths", () => {
		const unit = buildExecutionUnit(makeAllocatedLane(), makeAllocatedTask(), "/project");
		expect(validatePacketPaths(unit.packet)).toEqual([]);
	});
});

describe("7.x: buildAgentIdFromLane bridge", () => {
	it("7.5: worker ID appends -worker to laneSessionId", () => {
		const lane = makeAllocatedLane();
		expect(buildAgentIdFromLane(lane, "worker")).toBe("orch-henrylach-lane-1-worker");
	});

	it("7.6: reviewer ID appends -reviewer", () => {
		const lane = makeAllocatedLane();
		expect(buildAgentIdFromLane(lane, "reviewer")).toBe("orch-henrylach-lane-1-reviewer");
	});

	it("7.7: lane-runner ID equals laneSessionId", () => {
		const lane = makeAllocatedLane();
		expect(buildAgentIdFromLane(lane, "lane-runner")).toBe("orch-henrylach-lane-1");
	});

	it("7.8: merger ID uses prefix-merge-N pattern", () => {
		const lane = makeAllocatedLane();
		expect(buildAgentIdFromLane(lane, "merger", 2)).toBe("orch-henrylach-merge-2");
	});
});

describe("7.x: resolveRuntimeStateRoot", () => {
	it("7.9: returns workspaceRoot when provided", () => {
		expect(resolveRuntimeStateRoot("/repo", "/workspace")).toBe("/workspace");
	});

	it("7.10: returns repoRoot when no workspaceRoot", () => {
		expect(resolveRuntimeStateRoot("/repo")).toBe("/repo");
	});

	it("7.11: returns repoRoot when workspaceRoot is undefined", () => {
		expect(resolveRuntimeStateRoot("/repo", undefined)).toBe("/repo");
	});
});

// ── 8. Type exports existence checks ────────────────────────────────

describe("8.x: Type and utility export presence", () => {
	it("8.1: resolvePacketPaths is a function", () => {
		expect(typeof resolvePacketPaths).toBe("function");
	});

	it("8.2: validatePacketPaths is a function", () => {
		expect(typeof validatePacketPaths).toBe("function");
	});

	it("8.3: validateAgentManifest is a function", () => {
		expect(typeof validateAgentManifest).toBe("function");
	});

	it("8.4: buildRuntimeAgentId is a function", () => {
		expect(typeof buildRuntimeAgentId).toBe("function");
	});

	it("8.5: runtime path helpers are functions", () => {
		expect(typeof runtimeRoot).toBe("function");
		expect(typeof runtimeAgentDir).toBe("function");
		expect(typeof runtimeManifestPath).toBe("function");
		expect(typeof runtimeAgentEventsPath).toBe("function");
		expect(typeof runtimeLaneSnapshotPath).toBe("function");
		expect(typeof runtimeRegistryPath).toBe("function");
	});

	it("8.6: TERMINAL_AGENT_STATUSES is a Set", () => {
		expect(TERMINAL_AGENT_STATUSES instanceof Set).toBe(true);
	});

	it("8.7: bridge helpers are functions", () => {
		expect(typeof buildExecutionUnit).toBe("function");
		expect(typeof buildAgentIdFromLane).toBe("function");
		expect(typeof resolveRuntimeStateRoot).toBe("function");
	});
});
