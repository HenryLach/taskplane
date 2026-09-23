import { afterEach, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCanonicalTaskPaths } from "../taskplane/execution.ts";
import { resolvePointer } from "../taskplane/workspace.ts";
import type { WorkspaceConfig } from "../taskplane/types.ts";

describe("portable task and pointer paths", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "tp-portable-paths-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const backslashes = (path: string) => path.replace(/\//g, "\\");
	const forwardSlashes = (path: string) => path.replace(/\\/g, "/");

	function writeMarkers(folder: string) {
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, ".DONE"), "done");
		writeFileSync(join(folder, "STATUS.md"), "completed");
	}

	function assertMarkers(result: ReturnType<typeof resolveCanonicalTaskPaths>, folder: string) {
		assert.equal(result.taskFolderResolved, folder);
		assert.equal(result.donePath, join(folder, ".DONE"));
		assert.equal(result.statusPath, join(folder, "STATUS.md"));
		assert.ok(existsSync(result.donePath));
		assert.ok(existsSync(result.statusPath));
	}

	it("rejects Windows absolute pointer paths in the Linux CI test selection", () => {
		mkdirSync(join(root, ".pi"));
		const config = {
			repos: new Map([["infra", { path: join(root, "infra") }]]),
		} as unknown as WorkspaceConfig;
		for (const configPath of ["C:/config", "D:\\config", "\\\\server\\share\\config"]) {
			writeFileSync(
				join(root, ".pi", "taskplane-pointer.json"),
				JSON.stringify({ config_repo: "infra", config_path: configPath }),
			);
			const result = resolvePointer(root, config);
			assert.equal(result?.used, false, configPath);
			assert.match(result?.warning ?? "", /absolute paths not allowed/);
			assert.equal(result?.configRoot, join(root, ".pi"));
		}
	});

	for (const workspaceMode of [false, true]) {
		it(`finds worktree markers when input separators differ (workspace=${workspaceMode})`, () => {
			const repo = join(root, "repo");
			const worktree = join(root, "worktree");
			const expected = join(worktree, "tasks", "TEST-001");
			writeMarkers(expected);
			const result = resolveCanonicalTaskPaths(
				backslashes(join(repo, "tasks", "TEST-001")),
				backslashes(worktree),
				forwardSlashes(repo),
				workspaceMode,
			);
			assertMarkers(result, expected);
		});
	}

	it("keeps external task markers at their canonical location outside workspace mode", () => {
		const externalTask = join(root, "external", "TEST-002");
		writeMarkers(externalTask);
		const result = resolveCanonicalTaskPaths(
			backslashes(externalTask),
			join(root, "worktree"),
			join(root, "repo"),
		);
		assertMarkers(result, externalTask);
	});

	it("uses the task directory name for cross-repo workspace copies", () => {
		const worktree = join(root, "worktree");
		const expected = join(worktree, ".taskplane-tasks", "TEST-003");
		writeMarkers(expected);
		const result = resolveCanonicalTaskPaths(
			backslashes(join(root, "packet-repo", "tasks", "TEST-003")),
			backslashes(worktree),
			join(root, "execution-repo"),
			true,
		);
		assertMarkers(result, expected);
	});

	it("finds archived markers after translating the worktree path", () => {
		const repo = join(root, "repo");
		const worktree = join(root, "worktree");
		const archived = join(worktree, "tasks", "archive", "TEST-004");
		writeMarkers(archived);
		const result = resolveCanonicalTaskPaths(
			backslashes(join(repo, "tasks", "TEST-004")),
			backslashes(worktree),
			backslashes(repo),
		);
		assertMarkers(result, archived);
	});
});
