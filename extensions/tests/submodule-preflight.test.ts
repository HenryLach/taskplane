import { afterEach, beforeEach, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "./expect.ts";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";
import { runPreflight } from "../taskplane/worktree.ts";

let testRoot: string;

beforeEach(() => {
	testRoot = mkdtempSync(join(tmpdir(), "tp-submodule-preflight-"));
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function initRepo(dir: string): void {
	mkdirSync(dir, { recursive: true });
	runGit(dir, ["init", "--initial-branch=main"]);
	runGit(dir, ["config", "user.name", "test"]);
	runGit(dir, ["config", "user.email", "test@test.local"]);
	writeFileSync(join(dir, "README.md"), "# test\n", "utf-8");
	runGit(dir, ["add", "README.md"]);
	runGit(dir, ["commit", "-m", "init"]);
}

function addSubmodule(superRepo: string, subRepo: string, submodulePath: string): void {
	runGit(superRepo, ["-c", "protocol.file.allow=always", "submodule", "add", subRepo, submodulePath]);
	runGit(superRepo, ["add", "."]);
	runGit(superRepo, ["commit", "-m", `add ${submodulePath}`]);
}

function findCheck(result: ReturnType<typeof runPreflight>, predicate: (check: (typeof result.checks)[number]) => boolean) {
	return result.checks.find(predicate);
}

describe("runPreflight submodule diagnostics", () => {
	it("warns for undeclared submodules whose basename import would derive an invalid repo ID", () => {
		const superRepo = join(testRoot, "workspace-main");
		const subRepo = join(testRoot, "docs-site-src");
		initRepo(superRepo);
		initRepo(subRepo);
		addSubmodule(superRepo, subRepo, "third_party/docs.site");

		const workspaceConfig = {
			mode: "workspace",
			repos: new Map([["main", { path: superRepo }]]),
			routing: {
				tasksRoot: join(superRepo, "taskplane-tasks"),
				defaultRepo: "main",
				taskPacketRepo: "main",
			},
			configPath: join(superRepo, ".pi", "taskplane-workspace.yaml"),
		} as any;

		const result = runPreflight(DEFAULT_ORCHESTRATOR_CONFIG, superRepo, {
			workspaceRoot: superRepo,
			workspaceConfig,
		});

		const invalidRepoIdCheck = findCheck(
			result,
			(check) => check.name === "submodule-import:main:third_party/docs.site",
		);
		expect(invalidRepoIdCheck).toBeDefined();
		expect(invalidRepoIdCheck?.status).toBe("warn");
		expect(invalidRepoIdCheck?.message).toContain("invalid repo ID 'docs.site'");
	});

	it("warns when a cloned repository has uninitialized submodules", () => {
		const superRepo = join(testRoot, "repo-with-submodule");
		const subRepo = join(testRoot, "docs-src");
		const cloneRepo = join(testRoot, "repo-clone");
		initRepo(superRepo);
		initRepo(subRepo);
		addSubmodule(superRepo, subRepo, "vendor/docs");
		runGit(testRoot, ["clone", superRepo, cloneRepo]);

		const result = runPreflight(DEFAULT_ORCHESTRATOR_CONFIG, cloneRepo, {
			workspaceRoot: cloneRepo,
		});

		const initCheck = findCheck(
			result,
			(check) => check.message.includes("vendor/docs") && check.message.includes("not initialized"),
		);
		expect(initCheck).toBeDefined();
		expect(initCheck?.status).toBe("warn");
	});

	it("fails drifted submodules when orchestrator.failure.submoduleFailureMode is strict", () => {
		const superRepo = join(testRoot, "strict-repo");
		const subRepo = join(testRoot, "strict-submodule");
		initRepo(superRepo);
		initRepo(subRepo);
		addSubmodule(superRepo, subRepo, "vendor/docs");

		mkdirSync(join(superRepo, ".pi"), { recursive: true });
		writeFileSync(
			join(superRepo, ".pi", "taskplane-config.json"),
			JSON.stringify({
				configVersion: 1,
				orchestrator: {
					failure: {
						submoduleFailureMode: "strict",
						onSubmoduleDrift: "recursive-on-drift",
					},
				},
			}, null, 2),
			"utf-8",
		);

		writeFileSync(join(subRepo, "CHANGELOG.md"), "drift\n", "utf-8");
		runGit(subRepo, ["add", "CHANGELOG.md"]);
		runGit(subRepo, ["commit", "-m", "drift"]);
		const driftSha = runGit(subRepo, ["rev-parse", "HEAD"]);

		const checkedOutSubmodule = join(superRepo, "vendor", "docs");
		runGit(checkedOutSubmodule, ["fetch", "origin"]);
		runGit(checkedOutSubmodule, ["checkout", driftSha]);

		const result = runPreflight(DEFAULT_ORCHESTRATOR_CONFIG, superRepo, {
			workspaceRoot: superRepo,
		});

		const driftCheck = findCheck(
			result,
			(check) => check.message.includes("vendor/docs") && check.message.includes("drifted"),
		);
		expect(driftCheck).toBeDefined();
		expect(driftCheck?.status).toBe("fail");
	});
});