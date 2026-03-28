/**
 * Packet-home routing contract tests (TP-079).
 *
 * Covers:
 * - routing.task_packet_repo parsing + compatibility fallback
 * - tasks_root containment in packet-home repo
 * - task-area containment in routing.tasks_root (cross-config validation)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";

import { loadWorkspaceConfig, buildExecutionContext } from "../taskplane/workspace.ts";
import { WorkspaceConfigError } from "../taskplane/types.ts";

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `packet-home-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function initGitRepo(dir: string): void {
	mkdirSync(dir, { recursive: true });
	execFileSync("git", ["init", "--initial-branch=main"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execFileSync("git", ["config", "user.name", "test"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execFileSync("git", ["config", "user.email", "test@test.local"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
	execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
		cwd: dir,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});
}

function writeWorkspaceConfig(workspaceRoot: string, content: string): void {
	const configDir = join(workspaceRoot, ".pi");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "taskplane-workspace.yaml"), content, "utf-8");
}

const mockOrchConfig = {
	orchestrator: {
		max_lanes: 2,
		spawn_mode: "subprocess" as const,
		tmux_prefix: "orch",
		monitor_interval: 5,
		abort_grace_period: 30,
		merge_mode: "sequential" as const,
		lane_session_idle_timeout: 0,
	},
	assignment: {
		strategy: "round-robin" as const,
		size_weights: { XS: 1, S: 2, M: 3, L: 5, XL: 8 },
	},
	dependencies: {
		source: "prompt" as const,
		cache: true,
	},
};

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-packet-home-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {
		// best effort
	}
});

describe("workspace routing.task_packet_repo contract", () => {
	it("loads explicit routing.task_packet_repo", () => {
		const wsRoot = makeTestDir("explicit");
		const repo = join(wsRoot, "repo-a");
		initGitRepo(repo);
		const tasks = join(repo, "taskplane-tasks");
		mkdirSync(tasks, { recursive: true });

		writeWorkspaceConfig(wsRoot,
			`repos:\n  api:\n    path: ${repo}\n` +
			`routing:\n  tasks_root: ${tasks}\n  default_repo: api\n  task_packet_repo: api\n`
		);

		const config = loadWorkspaceConfig(wsRoot);
		expect(config).not.toBeNull();
		expect(config!.routing.taskPacketRepo).toBe("api");
	});

	it("missing routing.task_packet_repo falls back to routing.default_repo", () => {
		const wsRoot = makeTestDir("fallback");
		const repo = join(wsRoot, "repo-a");
		initGitRepo(repo);
		const tasks = join(repo, "taskplane-tasks");
		mkdirSync(tasks, { recursive: true });

		writeWorkspaceConfig(wsRoot,
			`repos:\n  api:\n    path: ${repo}\n` +
			`routing:\n  tasks_root: ${tasks}\n  default_repo: api\n`
		);

		const config = loadWorkspaceConfig(wsRoot);
		expect(config).not.toBeNull();
		expect(config!.routing.taskPacketRepo).toBe("api");
	});

	it("throws WORKSPACE_TASK_PACKET_REPO_NOT_FOUND when task_packet_repo is unknown", () => {
		const wsRoot = makeTestDir("unknown-packet-repo");
		const repo = join(wsRoot, "repo-a");
		initGitRepo(repo);
		const tasks = join(repo, "taskplane-tasks");
		mkdirSync(tasks, { recursive: true });

		writeWorkspaceConfig(wsRoot,
			`repos:\n  api:\n    path: ${repo}\n` +
			`routing:\n  tasks_root: ${tasks}\n  default_repo: api\n  task_packet_repo: missing\n`
		);

		try {
			loadWorkspaceConfig(wsRoot);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_TASK_PACKET_REPO_NOT_FOUND");
			expect((err as WorkspaceConfigError).message).toContain("Available repos");
		}
	});

	it("throws WORKSPACE_TASKS_ROOT_OUTSIDE_PACKET_REPO when tasks_root escapes packet repo", () => {
		const wsRoot = makeTestDir("tasks-root-escape");
		const repoA = join(wsRoot, "repo-a");
		const repoB = join(wsRoot, "repo-b");
		initGitRepo(repoA);
		initGitRepo(repoB);
		const tasksInRepoA = join(repoA, "taskplane-tasks");
		mkdirSync(tasksInRepoA, { recursive: true });

		writeWorkspaceConfig(wsRoot,
			`repos:\n  api:\n    path: ${repoA}\n  docs:\n    path: ${repoB}\n` +
			`routing:\n  tasks_root: ${tasksInRepoA}\n  default_repo: api\n  task_packet_repo: docs\n`
		);

		try {
			loadWorkspaceConfig(wsRoot);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_TASKS_ROOT_OUTSIDE_PACKET_REPO");
			expect((err as WorkspaceConfigError).message).toContain("routing.tasks_root");
			expect((err as WorkspaceConfigError).message).toContain("task_packet_repo");
		}
	});
});

describe("cross-config task-area containment", () => {
	it("throws WORKSPACE_TASK_AREA_OUTSIDE_TASKS_ROOT when task area path escapes tasks_root", () => {
		const wsRoot = makeTestDir("area-escape");
		const repo = join(wsRoot, "repo-a");
		const outside = join(wsRoot, "outside-tasks");
		initGitRepo(repo);
		mkdirSync(outside, { recursive: true });

		const tasksRoot = join(repo, "taskplane-tasks");
		mkdirSync(tasksRoot, { recursive: true });

		writeWorkspaceConfig(wsRoot,
			`repos:\n  api:\n    path: ${repo}\n` +
			`routing:\n  tasks_root: ${tasksRoot}\n  default_repo: api\n  task_packet_repo: api\n`
		);

		const loadTaskConfig = () => ({
			task_areas: {
				main: {
					path: "outside-tasks",
					prefix: "TP",
					context: "outside-tasks/CONTEXT.md",
				},
			},
			reference_docs: {},
		});

		try {
			buildExecutionContext(wsRoot, () => mockOrchConfig as any, loadTaskConfig as any);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_TASK_AREA_OUTSIDE_TASKS_ROOT");
			expect((err as WorkspaceConfigError).message).toContain("task_areas.main.path");
		}
	});

	it("buildExecutionContext succeeds when all task areas are inside tasks_root", () => {
		const wsRoot = makeTestDir("area-valid");
		const repo = join(wsRoot, "repo-a");
		initGitRepo(repo);

		const tasksRoot = join(repo, "taskplane-tasks");
		const areaPath = join(tasksRoot, "general");
		mkdirSync(areaPath, { recursive: true });

		writeWorkspaceConfig(wsRoot,
			`repos:\n  api:\n    path: ${repo}\n` +
			`routing:\n  tasks_root: ${tasksRoot}\n  default_repo: api\n  task_packet_repo: api\n`
		);

		const loadTaskConfig = () => ({
			task_areas: {
				main: {
					path: "repo-a/taskplane-tasks/general",
					prefix: "TP",
					context: "repo-a/taskplane-tasks/CONTEXT.md",
				},
			},
			reference_docs: {},
		});

		const ctx = buildExecutionContext(wsRoot, () => mockOrchConfig as any, loadTaskConfig as any);
		expect(ctx.mode).toBe("workspace");
		expect(ctx.workspaceConfig!.routing.taskPacketRepo).toBe("api");
	});
});
