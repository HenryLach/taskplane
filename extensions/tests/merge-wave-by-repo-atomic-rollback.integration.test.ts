import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect } from "./expect.ts";

const agentHostModuleUrl = new URL("../taskplane/agent-host.ts", import.meta.url).href;
const settingsLoaderModuleUrl = new URL("../taskplane/settings-loader.ts", import.meta.url).href;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function extractPromptSection(prompt: string, title: string): string {
	const match = prompt.match(new RegExp(`## ${title}\\n([^\\n]+)`));
	if (!match) {
		throw new Error(`Missing ${title} section in merge prompt`);
	}
	return match[1].trim();
}

function extractResultFile(prompt: string): string {
	const match = prompt.match(/result_file:\s+(.+)/);
	if (!match) {
		throw new Error("Missing result_file in merge prompt");
	}
	return match[1].trim();
}

const mockSpawnAgent = mock.fn((opts: Record<string, unknown>) => {
	const prompt = String(opts.prompt ?? "");
	const cwd = String(opts.cwd ?? "");
	const sourceBranch = extractPromptSection(prompt, "Source Branch");
	const targetBranch = extractPromptSection(prompt, "Target Branch");
	const resultFilePath = extractResultFile(prompt);

	const result = (() => {
		if (!sourceBranch.includes("lane-web")) {
			git(cwd, ["merge", "--no-ff", "--no-edit", sourceBranch]);
			const mergeCommit = git(cwd, ["rev-parse", "HEAD"]);
			return {
				status: "SUCCESS",
				source_branch: sourceBranch,
				target_branch: targetBranch,
				merge_commit: mergeCommit,
				conflicts: [],
				verification: { ran: false, passed: true, output: "" },
			};
		}

		return {
			status: "BUILD_FAILURE",
			source_branch: sourceBranch,
			target_branch: targetBranch,
			merge_commit: "",
			conflicts: [],
			verification: { ran: true, passed: false, output: "simulated merge-agent failure" },
		};
	})();

	mkdirSync(dirname(resultFilePath), { recursive: true });
	writeFileSync(resultFilePath, JSON.stringify(result, null, 2), "utf-8");

	return {
		promise: Promise.resolve({
			exitCode: 0,
			signal: null,
			durationMs: 1,
			killed: false,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUsd: 0,
			toolCalls: 0,
			lastTool: "",
			retries: 0,
			compactions: 0,
			contextUsage: null,
			error: null,
			agentEnded: true,
			stderrTail: "",
		}),
		kill: () => {},
	};
});

mock.module(agentHostModuleUrl, {
	namedExports: {
		spawnAgent: mockSpawnAgent,
	},
});

mock.module(settingsLoaderModuleUrl, {
	namedExports: {
		loadPiSettingsPackages: () => [],
		filterExcludedExtensions: (packages: unknown[]) => packages ?? [],
	},
});

const { mergeWaveByRepo } = await import(new URL("../taskplane/merge.ts", import.meta.url).href);
const { DEFAULT_ORCHESTRATOR_CONFIG } = await import("../taskplane/types.ts");

let fixtureRoot = "";

function initRepo(name: string, taskId: string): string {
	const repoDir = mkdtempSync(join(tmpdir(), `tp-merge-${name}-`));
	git(repoDir, ["init", "--initial-branch=main"]);
	git(repoDir, ["config", "user.email", "test@example.com"]);
	git(repoDir, ["config", "user.name", "Taskplane Test"]);
	mkdirSync(join(repoDir, "tasks", taskId), { recursive: true });
	writeFileSync(join(repoDir, "README.md"), `# ${name}\n`, "utf-8");
	writeFileSync(join(repoDir, "tasks", taskId, "PROMPT.md"), `# ${taskId}\n`, "utf-8");
	git(repoDir, ["add", "."]);
	git(repoDir, ["commit", "-m", "initial commit"]);
	return repoDir;
}

function initPlainRepo(repoDir: string): void {
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

function createLaneBranch(repoDir: string, branchName: string, relPath: string, content: string): string {
	git(repoDir, ["checkout", "-b", branchName]);
	writeFileSync(join(repoDir, relPath), content, "utf-8");
	git(repoDir, ["add", relPath]);
	git(repoDir, ["commit", "-m", `update ${relPath}`]);
	const branchHead = git(repoDir, ["rev-parse", "HEAD"]);
	git(repoDir, ["checkout", "main"]);
	return branchHead;
}

function makeTask(taskId: string, repoRoot: string) {
	return {
		taskId,
		taskName: `Task ${taskId}`,
		reviewLevel: 1,
		size: "M",
		dependencies: [],
		fileScope: [],
		taskFolder: join(repoRoot, "tasks", taskId),
		promptPath: join(repoRoot, "tasks", taskId, "PROMPT.md"),
		areaName: "default",
		status: "pending",
	};
}

function makeLane(laneNumber: number, repoId: string, repoRoot: string, branch: string, taskId: string) {
	return {
		laneNumber,
		laneId: `${repoId}/lane-${laneNumber}`,
		laneSessionId: `orch-${repoId}-lane-${laneNumber}`,
		worktreePath: repoRoot,
		branch,
		tasks: [
			{
				taskId,
				order: 0,
				task: makeTask(taskId, repoRoot),
				estimatedMinutes: 5,
			},
		],
		strategy: "affinity-first",
		estimatedLoad: 1,
		estimatedMinutes: 5,
		repoId,
	};
}

describe("mergeWaveByRepo cross-repo atomic rollback", () => {
	beforeEach(() => {
		fixtureRoot = mkdtempSync(join(tmpdir(), "tp-merge-wave-by-repo-"));
		mkdirSync(join(fixtureRoot, ".pi"), { recursive: true });
		mockSpawnAgent.mock.resetCalls();
	});

	afterEach(() => {
		if (fixtureRoot) {
			rmSync(fixtureRoot, { recursive: true, force: true });
		}
	});

	it("rolls back an already-advanced repo when another repo merge fails", async () => {
		const apiRepo = initRepo("api", "TP-700");
		const webRepo = initRepo("web", "TP-701");

		const apiInitialHead = git(apiRepo, ["rev-parse", "refs/heads/main"]);
		const webInitialHead = git(webRepo, ["rev-parse", "refs/heads/main"]);

		createLaneBranch(apiRepo, "task/lane-api", "api.txt", "api branch change\n");
		createLaneBranch(webRepo, "task/lane-web", "web.txt", "web branch change\n");

		const allocatedLanes = [
			makeLane(1, "api", apiRepo, "task/lane-api", "TP-700"),
			makeLane(2, "web", webRepo, "task/lane-web", "TP-701"),
		];

		const waveResult = {
			waveIndex: 0,
			startedAt: Date.now(),
			endedAt: Date.now(),
			laneResults: [
				{ laneNumber: 1, laneId: "api/lane-1", tasks: [{ taskId: "TP-700", status: "succeeded" }], overallStatus: "succeeded", startTime: Date.now(), endTime: Date.now() },
				{ laneNumber: 2, laneId: "web/lane-2", tasks: [{ taskId: "TP-701", status: "succeeded" }], overallStatus: "succeeded", startTime: Date.now(), endTime: Date.now() },
			],
			policyApplied: "skip-dependents",
			stoppedEarly: false,
			failedTaskIds: [],
			skippedTaskIds: [],
			succeededTaskIds: ["TP-700", "TP-701"],
			blockedTaskIds: [],
			laneCount: 2,
			overallStatus: "succeeded",
			finalMonitorState: null,
			allocatedLanes,
		} as any;

		const workspaceConfig = {
			repos: new Map([
				["api", { path: apiRepo }],
				["web", { path: webRepo }],
			]),
		} as any;

		const config = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			merge: {
				...DEFAULT_ORCHESTRATOR_CONFIG.merge,
				verify: [],
			},
			verification: {
				...DEFAULT_ORCHESTRATOR_CONFIG.verification,
				enabled: false,
			},
		};

		const result = await mergeWaveByRepo(
			allocatedLanes as any,
			waveResult,
			0,
			config,
			apiRepo,
			"20260422T120000",
			"main",
			workspaceConfig,
			fixtureRoot,
			fixtureRoot,
			undefined,
			null,
			false,
			"v2",
		);

		expect(mockSpawnAgent.mock.calls.length).toBe(2);
		expect(result.status).toBe("failed");
		expect(result.rollbackFailed).toBeUndefined();
		expect(result.failureReason).toContain("Cross-repo atomic merge rolled back 1 repo group(s).");

		const apiRepoOutcome = result.repoResults.find((entry) => entry.repoId === "api");
		const webRepoOutcome = result.repoResults.find((entry) => entry.repoId === "web");
		expect(apiRepoOutcome).toBeDefined();
		expect(webRepoOutcome).toBeDefined();
		expect(apiRepoOutcome!.status).toBe("failed");
		expect(apiRepoOutcome!.failureReason).toContain("cross_repo_atomic_rollback");
		expect(webRepoOutcome!.status).toBe("failed");
		expect(webRepoOutcome!.failureReason).toContain("simulated merge-agent failure");

		const transactionRecords = result.transactionRecords ?? [];
		expect(transactionRecords).toHaveLength(2);
		const apiTxn = transactionRecords.find((record) => record.repoId === "api");
		const webTxn = transactionRecords.find((record) => record.repoId === "web");
		expect(apiTxn).toBeDefined();
		expect(webTxn).toBeDefined();
		expect(apiTxn!.status).toBe("rolled_back");
		expect(apiTxn!.rollbackAttempted).toBe(true);
		expect(apiTxn!.rollbackResult).toContain("cross_repo_atomic_rollback to");
		expect(webTxn!.status).toBe("merge_failed");

		const apiCurrentHead = git(apiRepo, ["rev-parse", "refs/heads/main"]);
		const webCurrentHead = git(webRepo, ["rev-parse", "refs/heads/main"]);
		expect(apiCurrentHead).toBe(apiInitialHead);
		expect(webCurrentHead).toBe(webInitialHead);

		const persistedApiTxnPath = join(
			fixtureRoot,
			".pi",
			"verification",
			apiTxn!.opId,
			`txn-${apiTxn!.waveTransactionId}-repo-api-lane-${apiTxn!.laneNumber}.json`,
		);
		const persistedApiTxn = JSON.parse(readFileSync(persistedApiTxnPath, "utf-8"));
		expect(persistedApiTxn.status).toBe("rolled_back");
		expect(persistedApiTxn.rollbackAttempted).toBe(true);
		expect(result.persistenceErrors).toBeUndefined();
	});

	it("merges a published submodule gitlink update without tripping the safety guard", async () => {
		const repo = initRepo("submodule-host", "TP-710");
		const submoduleOrigin = join(fixtureRoot, "submodule-origin");
		initPlainRepo(submoduleOrigin);
		git(submoduleOrigin, ["config", "receive.denyCurrentBranch", "updateInstead"]);
		writeFileSync(join(submoduleOrigin, "lib.txt"), "base\n", "utf-8");
		commitAll(submoduleOrigin, "initial submodule commit");

		addSubmodule(repo, submoduleOrigin, "libs/my_lib");
		git(join(repo, "libs", "my_lib"), ["config", "user.email", "test@example.com"]);
		git(join(repo, "libs", "my_lib"), ["config", "user.name", "Taskplane Test"]);

		const initialHead = git(repo, ["rev-parse", "refs/heads/main"]);

		git(repo, ["checkout", "-b", "task/lane-submodule"]);
		writeFileSync(join(repo, "libs", "my_lib", "lib.txt"), "base\npublished change\n", "utf-8");
		git(join(repo, "libs", "my_lib"), ["add", "lib.txt"]);
		git(join(repo, "libs", "my_lib"), ["commit", "-m", "published submodule commit"]);
		const publishedCommit = git(join(repo, "libs", "my_lib"), ["rev-parse", "HEAD"]);
		git(join(repo, "libs", "my_lib"), ["push", "origin", "HEAD:main"]);
		git(repo, ["add", "libs/my_lib"]);
		git(repo, ["commit", "-m", "advance submodule gitlink"]);
		git(repo, ["checkout", "main"]);
		git(repo, ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"]);

		const allocatedLanes = [
			makeLane(1, "submodule", repo, "task/lane-submodule", "TP-710"),
		];

		const waveResult = {
			waveIndex: 0,
			startedAt: Date.now(),
			endedAt: Date.now(),
			laneResults: [
				{ laneNumber: 1, laneId: "submodule/lane-1", tasks: [{ taskId: "TP-710", status: "succeeded" }], overallStatus: "succeeded", startTime: Date.now(), endTime: Date.now() },
			],
			policyApplied: "skip-dependents",
			stoppedEarly: false,
			failedTaskIds: [],
			skippedTaskIds: [],
			succeededTaskIds: ["TP-710"],
			blockedTaskIds: [],
			laneCount: 1,
			overallStatus: "succeeded",
			finalMonitorState: null,
			allocatedLanes,
		} as any;

		const workspaceConfig = {
			repos: new Map([
				["submodule", { path: repo }],
			]),
		} as any;

		const config = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			merge: {
				...DEFAULT_ORCHESTRATOR_CONFIG.merge,
				verify: [],
			},
			verification: {
				...DEFAULT_ORCHESTRATOR_CONFIG.verification,
				enabled: false,
			},
		};

		const result = await mergeWaveByRepo(
			allocatedLanes as any,
			waveResult,
			0,
			config,
			repo,
			"20260422T130000",
			"main",
			workspaceConfig,
			fixtureRoot,
			fixtureRoot,
			undefined,
			null,
			false,
			"v2",
		);

		expect(result.status).toBe("succeeded");
		expect(result.failureReason).toBeNull();
		expect(result.repoResults).toHaveLength(1);
		expect(result.repoResults[0].status).toBe("succeeded");

		const transactionRecords = result.transactionRecords ?? [];
		expect(transactionRecords).toHaveLength(1);
		expect(transactionRecords[0].status).toBe("committed");

		const currentHead = git(repo, ["rev-parse", "refs/heads/main"]);
		expect(currentHead).not.toBe(initialHead);

		const mergedGitlink = git(repo, ["rev-parse", "refs/heads/main:libs/my_lib"]);
		expect(mergedGitlink).toBe(publishedCommit);
	});

	it("rolls back an unpublished submodule gitlink update after merge-time validation fails", async () => {
		const repo = initRepo("submodule-host-unpublished", "TP-711");
		const submoduleOrigin = join(fixtureRoot, "submodule-origin-unpublished");
		initPlainRepo(submoduleOrigin);
		git(submoduleOrigin, ["config", "receive.denyCurrentBranch", "updateInstead"]);
		writeFileSync(join(submoduleOrigin, "lib.txt"), "base\n", "utf-8");
		commitAll(submoduleOrigin, "initial submodule commit");

		addSubmodule(repo, submoduleOrigin, "libs/my_lib");
		git(join(repo, "libs", "my_lib"), ["config", "user.email", "test@example.com"]);
		git(join(repo, "libs", "my_lib"), ["config", "user.name", "Taskplane Test"]);

		const initialHead = git(repo, ["rev-parse", "refs/heads/main"]);
		const initialGitlink = git(repo, ["rev-parse", "refs/heads/main:libs/my_lib"]);

		git(repo, ["checkout", "-b", "task/lane-submodule-unpublished"]);
		writeFileSync(join(repo, "libs", "my_lib", "lib.txt"), "base\nunpublished change\n", "utf-8");
		git(join(repo, "libs", "my_lib"), ["add", "lib.txt"]);
		git(join(repo, "libs", "my_lib"), ["commit", "-m", "unpublished submodule commit"]);
		const unpublishedCommit = git(join(repo, "libs", "my_lib"), ["rev-parse", "HEAD"]);
		git(repo, ["add", "libs/my_lib"]);
		git(repo, ["commit", "-m", "advance unpublished submodule gitlink"]);
		git(repo, ["checkout", "main"]);
		git(repo, ["-c", "protocol.file.allow=always", "submodule", "update", "--init", "--recursive"]);

		const allocatedLanes = [
			makeLane(1, "submodule", repo, "task/lane-submodule-unpublished", "TP-711"),
		];

		const waveResult = {
			waveIndex: 0,
			startedAt: Date.now(),
			endedAt: Date.now(),
			laneResults: [
				{ laneNumber: 1, laneId: "submodule/lane-1", tasks: [{ taskId: "TP-711", status: "succeeded" }], overallStatus: "succeeded", startTime: Date.now(), endTime: Date.now() },
			],
			policyApplied: "skip-dependents",
			stoppedEarly: false,
			failedTaskIds: [],
			skippedTaskIds: [],
			succeededTaskIds: ["TP-711"],
			blockedTaskIds: [],
			laneCount: 1,
			overallStatus: "succeeded",
			finalMonitorState: null,
			allocatedLanes,
		} as any;

		const workspaceConfig = {
			repos: new Map([
				["submodule", { path: repo }],
			]),
		} as any;

		const config = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			merge: {
				...DEFAULT_ORCHESTRATOR_CONFIG.merge,
				verify: [],
			},
			verification: {
				...DEFAULT_ORCHESTRATOR_CONFIG.verification,
				enabled: false,
			},
		};

		const result = await mergeWaveByRepo(
			allocatedLanes as any,
			waveResult,
			0,
			config,
			repo,
			"20260422T131000",
			"main",
			workspaceConfig,
			fixtureRoot,
			fixtureRoot,
			undefined,
			null,
			false,
			"v2",
		);

		expect(result.status).toBe("failed");
		expect(result.failureReason).toContain("Post-merge submodule gitlink validation failed");
		expect(result.repoResults).toHaveLength(1);
		expect(result.repoResults[0].status).toBe("failed");
		expect(result.repoResults[0].failureReason).toContain("Post-merge submodule gitlink validation failed");

		const transactionRecords = result.transactionRecords ?? [];
		expect(transactionRecords).toHaveLength(1);
		expect(transactionRecords[0].status).toBe("rolled_back");
		expect(transactionRecords[0].rollbackAttempted).toBe(true);
		expect(transactionRecords[0].rollbackResult).toBe("success");

		const currentHead = git(repo, ["rev-parse", "refs/heads/main"]);
		expect(currentHead).toBe(initialHead);

		const currentGitlink = git(repo, ["rev-parse", "refs/heads/main:libs/my_lib"]);
		expect(currentGitlink).toBe(initialGitlink);
		expect(currentGitlink).not.toBe(unpublishedCommit);
	});
});