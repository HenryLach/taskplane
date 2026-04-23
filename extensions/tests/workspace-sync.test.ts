import { afterEach, beforeEach, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "./expect.ts";
import { applyWorkspaceSync, collectWorkspaceSyncSummary, DEFAULT_SUBMODULE_POLICY } from "../taskplane/workspace.ts";

let testRoot: string;

beforeEach(() => {
	testRoot = mkdtempSync(join(tmpdir(), "tp-workspace-sync-"));
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

describe("workspace sync helper", () => {
	it("imports undeclared workspace repos for valid submodule basenames", () => {
		const superRepo = join(testRoot, "workspace-main");
		const subRepo = join(testRoot, "docs-src");
		initRepo(superRepo);
		initRepo(subRepo);
		addSubmodule(superRepo, subRepo, "vendor/docs");

		mkdirSync(join(superRepo, ".pi"), { recursive: true });
		const workspaceYamlPath = join(superRepo, ".pi", "taskplane-workspace.yaml");
		writeFileSync(workspaceYamlPath, [
			"repos:",
			"  main:",
			"    path: .",
			"routing:",
			"  tasks_root: taskplane-tasks",
			"  default_repo: main",
			"  task_packet_repo: main",
		].join("\n") + "\n", "utf-8");

		const workspaceConfig = {
			mode: "workspace",
			repos: new Map([["main", { id: "main", path: superRepo }]]),
			routing: {
				tasksRoot: join(superRepo, "taskplane-tasks"),
				defaultRepo: "main",
				taskPacketRepo: "main",
			},
			configPath: workspaceYamlPath,
		} as any;

		const summary = collectWorkspaceSyncSummary(superRepo, workspaceConfig, DEFAULT_SUBMODULE_POLICY, "all");
		expect(summary.importCandidates.map((candidate) => candidate.derivedRepoId)).toEqual(["docs"]);

		const result = applyWorkspaceSync(superRepo, superRepo, workspaceConfig, DEFAULT_SUBMODULE_POLICY, summary);
		expect(result.importedRepoIds).toEqual(["docs"]);
		expect(workspaceConfig.repos.has("docs")).toBe(true);
		expect(readFileSync(workspaceYamlPath, "utf-8")).toContain("docs:");
		expect(readFileSync(workspaceYamlPath, "utf-8")).toContain("path: vendor/docs");
	});

	it("initializes missing submodules when the drift policy is init-only", () => {
		const originalGitAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
		process.env.GIT_ALLOW_PROTOCOL = "file";
		try {
		const superRepo = join(testRoot, "repo-with-submodule");
		const subRepo = join(testRoot, "docs-src");
		const cloneRepo = join(testRoot, "repo-clone");
		initRepo(superRepo);
		initRepo(subRepo);
		addSubmodule(superRepo, subRepo, "vendor/docs");
		runGit(testRoot, ["clone", superRepo, cloneRepo]);
		runGit(cloneRepo, ["config", "protocol.file.allow", "always"]);

		const policy = {
			failureMode: "strict",
			onSubmoduleDrift: "init-only",
			repoIdStrategy: "path-basename",
		} as const;

		const before = collectWorkspaceSyncSummary(cloneRepo, null, policy, "all");
		expect(before.findings.some((finding) => finding.kind === "uninitialized-submodule")).toBe(true);

		const result = applyWorkspaceSync(cloneRepo, cloneRepo, null, policy, before);
		expect(result.warnings).toEqual([]);
		expect(result.initializedPaths).toEqual(["repo-clone:vendor/docs"]);

		const after = collectWorkspaceSyncSummary(cloneRepo, null, policy, "all");
		expect(after.findings.some((finding) => finding.kind === "uninitialized-submodule")).toBe(false);
		} finally {
			if (originalGitAllowProtocol === undefined) {
				delete process.env.GIT_ALLOW_PROTOCOL;
			} else {
				process.env.GIT_ALLOW_PROTOCOL = originalGitAllowProtocol;
			}
		}
	});

	it("syncs nested submodule findings through the nearest tracked parent path", () => {
		const originalGitAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
		process.env.GIT_ALLOW_PROTOCOL = "file";
		try {
			const superRepo = join(testRoot, "repo-with-nested-submodule");
			const childRepo = join(testRoot, "rebof3-simple");
			const nestedRepo = join(testRoot, "private-assets");
			const cloneRepo = join(testRoot, "repo-clone");

			initRepo(superRepo);
			initRepo(childRepo);
			initRepo(nestedRepo);
			addSubmodule(childRepo, nestedRepo, "external/private-assets");
			addSubmodule(superRepo, childRepo, "third_party/references/rebof3-simple");

			runGit(testRoot, ["clone", superRepo, cloneRepo]);
			runGit(cloneRepo, ["config", "protocol.file.allow", "always"]);
			runGit(cloneRepo, ["submodule", "update", "--init", "--", "third_party/references/rebof3-simple"]);

			const policy = {
				failureMode: "strict",
				onSubmoduleDrift: "recursive-on-drift",
				repoIdStrategy: "path-basename",
			} as const;

			const before = collectWorkspaceSyncSummary(cloneRepo, null, policy, "all");
			expect(before.findings.some((finding) =>
				finding.kind === "uninitialized-submodule" &&
				finding.submodulePath === "third_party/references/rebof3-simple/external/private-assets"
			)).toBe(true);

			const result = applyWorkspaceSync(cloneRepo, cloneRepo, null, policy, before);
			expect(result.warnings).toEqual([]);
			expect(result.initializedPaths).toContain(
				"repo-clone:third_party/references/rebof3-simple/external/private-assets",
			);

			const after = collectWorkspaceSyncSummary(cloneRepo, null, policy, "all");
			expect(after.findings.some((finding) =>
				finding.kind === "uninitialized-submodule" &&
				finding.submodulePath === "third_party/references/rebof3-simple/external/private-assets"
			)).toBe(false);
		} finally {
			if (originalGitAllowProtocol === undefined) {
				delete process.env.GIT_ALLOW_PROTOCOL;
			} else {
				process.env.GIT_ALLOW_PROTOCOL = originalGitAllowProtocol;
			}
		}
	});
});
