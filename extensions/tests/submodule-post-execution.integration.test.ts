/**
 * Post-execution submodule safety tests
 *
 * Validates that Runtime V2 refuses to checkpoint task artifacts when a task
 * leaves a submodule pointing at a local-only commit.
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "./expect.ts";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const mockExecuteTaskV2 = mock.fn();
const laneRunnerModuleUrl = new URL("../taskplane/lane-runner.ts", import.meta.url).href;

mock.module(laneRunnerModuleUrl, {
	namedExports: {
		executeTaskV2: mockExecuteTaskV2,
	},
});

const { detectUnsafeSubmoduleStates, detectUnreachableGitlinks } = await import("../taskplane/git.ts");
const { executeLaneV2 } = await import("../taskplane/execution.ts");
const { DEFAULT_ORCHESTRATOR_CONFIG } = await import("../taskplane/types.ts");

type AllocatedLane = import("../taskplane/types.ts").AllocatedLane;
type AllocatedTask = import("../taskplane/types.ts").AllocatedTask;
type ParsedTask = import("../taskplane/types.ts").ParsedTask;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	}).trim();
}

function initRepo(repoDir: string): void {
	mkdirSync(repoDir, { recursive: true });
	git(repoDir, ["init", "--initial-branch=main"]);
	git(repoDir, ["config", "user.email", "test@example.com"]);
	git(repoDir, ["config", "user.name", "Taskplane Test"]);
}

function commitAll(repoDir: string, message: string): void {
	git(repoDir, ["add", "."]);
	git(repoDir, ["commit", "-m", message]);
}

function addSubmodule(superRepo: string, subRepo: string, submodulePath: string): void {
	git(superRepo, ["-c", "protocol.file.allow=always", "submodule", "add", subRepo, submodulePath]);
	commitAll(superRepo, `add ${submodulePath}`);
}

function cloneRepo(sourceRepo: string, targetRepo: string): void {
	git(process.cwd(), ["clone", sourceRepo, targetRepo]);
	git(targetRepo, ["config", "user.email", "test@example.com"]);
	git(targetRepo, ["config", "user.name", "Taskplane Test"]);
	git(targetRepo, ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"]);
}

function publishLaneSubmoduleCommit(): string {
	const submoduleDir = join(laneRepo, "libs", "my_lib");
	const publishedCommit = git(submoduleDir, ["rev-parse", "HEAD"]);
	git(submoduleDir, ["push", "origin", "HEAD:main"]);
	return publishedCommit;
}

function makeParsedTask(taskFolder: string): ParsedTask {
	return {
		taskId: "TP-001",
		taskName: "Task TP-001",
		reviewLevel: 1,
		size: "M",
		dependencies: [],
		fileScope: [],
		taskFolder,
		promptPath: join(taskFolder, "PROMPT.md"),
		areaName: "default",
		status: "pending",
		resolvedRepoId: "default",
	};
}

function makeAllocatedTask(taskFolder: string): AllocatedTask {
	return {
		taskId: "TP-001",
		order: 0,
		task: makeParsedTask(taskFolder),
		estimatedMinutes: 10,
	};
}

function makeAllocatedLane(worktreePath: string, taskFolder: string): AllocatedLane {
	return {
		laneNumber: 1,
		laneId: "lane-1",
		laneSessionId: "orch-op-lane-1",
		worktreePath,
		branch: "task/op-lane-1-20260422T000000",
		tasks: [makeAllocatedTask(taskFolder)],
		strategy: "affinity-first",
		estimatedLoad: 1,
		estimatedMinutes: 10,
	};
}

let testRoot = "";
let superRepo = "";
let subRepo = "";
let laneRepo = "";

beforeEach(() => {
	testRoot = mkdtempSync(join(tmpdir(), "tp-submodule-post-exec-"));
	superRepo = join(testRoot, "super");
	subRepo = join(testRoot, "submodule-origin");
	laneRepo = join(testRoot, "lane-clone");
	mockExecuteTaskV2.mock.resetCalls();

	initRepo(subRepo);
	git(subRepo, ["config", "receive.denyCurrentBranch", "updateInstead"]);
	writeFileSync(join(subRepo, "lib.txt"), "base\n", "utf-8");
	commitAll(subRepo, "initial submodule commit");

	initRepo(superRepo);
	mkdirSync(join(superRepo, "tasks", "TP-001"), { recursive: true });
	writeFileSync(join(superRepo, "tasks", "TP-001", "PROMPT.md"), "# TP-001\n", "utf-8");
	writeFileSync(join(superRepo, "tasks", "TP-001", "STATUS.md"), "status\n", "utf-8");
	commitAll(superRepo, "initial super commit");
	addSubmodule(superRepo, subRepo, "libs/my_lib");

	cloneRepo(superRepo, laneRepo);
	git(join(laneRepo, "libs", "my_lib"), ["config", "user.email", "test@example.com"]);
	git(join(laneRepo, "libs", "my_lib"), ["config", "user.name", "Taskplane Test"]);
	writeFileSync(join(laneRepo, "libs", "my_lib", "lib.txt"), "base\nlocal change\n", "utf-8");
	git(join(laneRepo, "libs", "my_lib"), ["add", "lib.txt"]);
	git(join(laneRepo, "libs", "my_lib"), ["commit", "-m", "local only submodule commit"]);

	mockExecuteTaskV2.mock.mockImplementation(async () => ({
		outcome: {
			taskId: "TP-001",
			status: "succeeded",
			segmentId: null,
			startTime: 100,
			endTime: 200,
			exitReason: "done",
			sessionName: "orch-op-lane-1-worker",
			doneFileFound: true,
			laneNumber: 1,
		},
		iterations: 1,
		costUsd: 0,
		totalTokens: 0,
	}));
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

describe("post-execution submodule safety", () => {
	it("detects unpublished submodule commits in a worktree", () => {
		const findings = detectUnsafeSubmoduleStates(laneRepo);
		expect(findings).toHaveLength(1);
		expect(findings[0].path).toBe("libs/my_lib");
		expect(findings[0].kind).toBe("unpublished-commit");
	});

	it("marks an otherwise successful task failed before checkpointing an unsafe submodule gitlink", async () => {
		const lane = makeAllocatedLane(laneRepo, join(laneRepo, "tasks", "TP-001"));
		const result = await executeLaneV2(
			lane,
			DEFAULT_ORCHESTRATOR_CONFIG,
			laneRepo,
			{ paused: false },
		);

		expect(mockExecuteTaskV2.mock.calls.length).toBe(1);
		expect(result.overallStatus).toBe("failed");
		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].status).toBe("failed");
		expect(result.tasks[0].exitReason).toContain("Unsafe submodule state after task success");
		expect(result.tasks[0].exitReason).toContain("libs/my_lib");

		const checkpointLog = git(laneRepo, ["log", "--oneline", "--grep", "checkpoint: TP-001 task artifacts"]);
		expect(checkpointLog).toBe("");
	});

	it("allows a published submodule commit to checkpoint cleanly", async () => {
		const publishedCommit = publishLaneSubmoduleCommit();
		git(laneRepo, ["add", "libs/my_lib"]);

		expect(detectUnsafeSubmoduleStates(laneRepo)).toEqual([]);
		expect(detectUnreachableGitlinks(laneRepo)).toEqual([]);

		const lane = makeAllocatedLane(laneRepo, join(laneRepo, "tasks", "TP-001"));
		const result = await executeLaneV2(
			lane,
			DEFAULT_ORCHESTRATOR_CONFIG,
			laneRepo,
			{ paused: false },
		);

		expect(result.overallStatus).toBe("succeeded");
		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].status).toBe("succeeded");

		const checkpointLog = git(laneRepo, ["log", "--oneline", "--grep", "checkpoint: TP-001 task artifacts"]);
		expect(checkpointLog).not.toBe("");

		const stagedGitlink = git(laneRepo, ["rev-parse", "HEAD:libs/my_lib"]);
		expect(stagedGitlink).toBe(publishedCommit);
	});

	it("detects unreachable staged gitlinks for merge-time validation", () => {
		git(laneRepo, ["add", "libs/my_lib"]);
		const findings = detectUnreachableGitlinks(laneRepo);
		expect(findings).toHaveLength(1);
		expect(findings[0].path).toBe("libs/my_lib");
		expect(findings[0].gitlinkCommit.length).toBeGreaterThanOrEqual(8);
	});
});