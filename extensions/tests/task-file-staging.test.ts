import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ensureTaskFilesCommitted, executeWave } from "../taskplane/execution.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";
import type { ParsedTask, WorkspaceConfig } from "../taskplane/types.ts";

const allocationReached = new Error("stop before spawning workers");

describe("task file staging in the packet-home repository (#479)", () => {
	const orchBranch = "orch/test-batch";
	let root: string;
	let api: string;
	let docs: string;
	let workspace: WorkspaceConfig;

	function git(repo: string, ...args: string[]): string {
		return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim();
	}

	function createRepo(name: string): string {
		const repo = join(root, name);
		mkdirSync(repo);
		git(repo, "init", "-b", "main");
		git(repo, "config", "user.name", "Test User");
		git(repo, "config", "user.email", "test@example.com");
		git(repo, "config", "commit.gpgsign", "false");
		writeFileSync(join(repo, "README.md"), "initial\n");
		git(repo, "add", "README.md");
		git(repo, "commit", "-m", "initial");
		git(repo, "branch", orchBranch);
		return repo;
	}

	function createTask(repo: string, taskId = "TEST-001"): ParsedTask {
		const taskFolder = join(repo, "tasks", taskId);
		mkdirSync(taskFolder, { recursive: true });
		const promptPath = join(taskFolder, "PROMPT.md");
		writeFileSync(promptPath, "# Implement the API change\n");
		writeFileSync(join(taskFolder, "STATUS.md"), "- [ ] Implement\n");
		return {
			taskId,
			taskName: taskId,
			taskFolder,
			promptPath,
			reviewLevel: 1,
			size: "S",
			dependencies: [],
			fileScope: [],
			areaName: "tasks",
			status: "pending",
			resolvedRepoId: "api",
		};
	}

	function pending(...tasks: ParsedTask[]): Map<string, ParsedTask> {
		return new Map(tasks.map((task) => [task.taskId, task]));
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "tp-task-staging-"));
		api = createRepo("api");
		docs = createRepo("docs");
		workspace = {
			mode: "workspace",
			repos: new Map([
				["api", { id: "api", path: api }],
				["docs", { id: "docs", path: docs }],
			]),
			routing: { tasksRoot: join(docs, "tasks"), defaultRepo: "api", taskPacketRepo: "docs" },
			configPath: join(root, ".pi", "taskplane-workspace.yaml"),
		};
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("stages the current wave in the packet repo while preserving both checkouts and indexes", () => {
		const task = createTask(docs);
		const laterTask = createTask(docs, "TEST-002");
		const before = new Map<string, { head: string; index: Buffer; status: string }>();
		for (const repo of [api, docs]) {
			writeFileSync(join(repo, "unrelated.txt"), "staged user work\n");
			git(repo, "add", "unrelated.txt");
			writeFileSync(join(repo, "README.md"), "unstaged user work\n");
			const status = git(repo, "status", "--porcelain");
			before.set(repo, {
				head: git(repo, "rev-parse", "HEAD"),
				index: readFileSync(join(repo, ".git", "index")),
				status,
			});
		}

		ensureTaskFilesCommitted([task.taskId], pending(task, laterTask), api, 1, orchBranch, workspace);

		assert.equal(
			git(docs, "show", `${orchBranch}:tasks/TEST-001/PROMPT.md`),
			"# Implement the API change",
		);
		assert.equal(git(docs, "show", `${orchBranch}:tasks/TEST-001/STATUS.md`), "- [ ] Implement");
		assert.equal(
			git(docs, "diff", "--name-only", `main..${orchBranch}`),
			"tasks/TEST-001/PROMPT.md\ntasks/TEST-001/STATUS.md",
		);
		assert.equal(git(api, "rev-parse", orchBranch), before.get(api)!.head);
		for (const repo of [api, docs]) {
			assert.equal(git(repo, "rev-parse", "HEAD"), before.get(repo)!.head);
			assert.deepEqual(readFileSync(join(repo, ".git", "index")), before.get(repo)!.index);
			assert.equal(git(repo, "status", "--porcelain"), before.get(repo)!.status);
		}

		const worktree = join(root, "packet-lane");
		git(docs, "worktree", "add", "--detach", worktree, orchBranch);
		assert.equal(
			readFileSync(join(worktree, "tasks", task.taskId, "PROMPT.md"), "utf8"),
			readFileSync(task.promptPath, "utf8"),
		);
	});

	it("threads the workspace context through wave preflight before allocating lanes", async () => {
		const task = createTask(docs);
		await assert.rejects(
			executeWave(
				[task.taskId],
				1,
				pending(task),
				DEFAULT_ORCHESTRATOR_CONFIG,
				api,
				"test-batch",
				{ paused: false },
				{ dependencies: new Map(), dependents: new Map(), nodes: new Set([task.taskId]) },
				orchBranch,
				undefined,
				() => {
					// Exercise real allocation, then stop before any worker can spawn.
					throw allocationReached;
				},
				workspace,
			),
			allocationReached,
		);
		assert.equal(
			git(docs, "show", `${orchBranch}:tasks/TEST-001/PROMPT.md`),
			"# Implement the API change",
		);
	});

	it("includes modifications to tracked task files in the packet repo", () => {
		const task = createTask(docs);
		git(docs, "add", "tasks");
		git(docs, "commit", "-m", "add task");
		git(docs, "branch", "-f", orchBranch, "HEAD");
		const mainTip = git(docs, "rev-parse", "HEAD");
		writeFileSync(join(task.taskFolder, "STATUS.md"), "- [x] Implement\n");

		ensureTaskFilesCommitted([task.taskId], pending(task), api, 2, orchBranch, workspace);

		assert.equal(git(docs, "show", `${orchBranch}:tasks/TEST-001/STATUS.md`), "- [x] Implement");
		assert.equal(git(docs, "show", "HEAD:tasks/TEST-001/STATUS.md"), "- [ ] Implement");
		assert.equal(git(docs, "rev-parse", "HEAD"), mainTip);
	});

	it("preserves repo-mode staging when workspace context is absent", () => {
		const task = createTask(api);
		const mainTip = git(api, "rev-parse", "HEAD");

		ensureTaskFilesCommitted([task.taskId], pending(task), api, 1, orchBranch);

		assert.equal(
			git(api, "show", `${orchBranch}:tasks/TEST-001/PROMPT.md`),
			"# Implement the API change",
		);
		assert.equal(git(api, "rev-parse", "HEAD"), mainTip);
	});

	it("rejects an unknown packet repo before changing any branch", () => {
		const task = createTask(api);
		workspace.routing.taskPacketRepo = "missing";
		const mainTip = git(api, "rev-parse", "HEAD");

		assert.throws(
			() => ensureTaskFilesCommitted([task.taskId], pending(task), api, 1, orchBranch, workspace),
			/Task packet repository.*missing.*not configured/,
		);
		assert.equal(git(api, "rev-parse", orchBranch), mainTip);
		assert.equal(git(api, "rev-parse", "HEAD"), mainTip);
	});
});
