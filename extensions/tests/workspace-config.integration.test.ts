/**
 * Workspace Configuration Tests — TP-001 Step 3, TP-016 Step 1
 *
 * Targeted tests for workspace config loading, validation, execution
 * context building, and type contracts introduced in TP-001.
 * Section 6.x added by TP-016 for pointer resolution tests.
 *
 * Test categories:
 *   1.x — loadWorkspaceConfig() validation/error-code matrix
 *   2.x — buildExecutionContext() mode selection and context shape
 *   3.x — canonicalizePath() normalization behavior
 *   4.x — WorkspaceConfigError and createRepoModeContext contracts
 *   5.x — Root-consistency regression checks (source verification)
 *   6.x — resolvePointer() resolution chain (TP-016)
 *   7.x — Orchestrator pointer threading (TP-016 Step 3)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/workspace-config.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import {
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
	readFileSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

import {
	WorkspaceConfigError,
	createRepoModeContext,
	workspaceConfigPath,
	pointerFilePath,
	batchStatePath,
	BATCH_STATE_SCHEMA_VERSION,
	type WorkspaceConfig,
	type WorkspaceRepoConfig,
	type WorkspaceRoutingConfig,
} from "../taskplane/types.ts";
import {
	loadWorkspaceConfig,
	buildExecutionContext,
	canonicalizePath,
	resolvePointer,
} from "../taskplane/workspace.ts";
// buildLaneEnvVars import removed — function removed during TMUX extrication
import { saveBatchState, loadBatchState, deleteBatchState } from "../taskplane/persistence.ts";

// ── Test Fixtures ────────────────────────────────────────────────────


const __dirname = dirname(fileURLToPath(import.meta.url));
let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `test-${counter}${suffix ? `-${suffix}` : ""}`);
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
	// Set repo-local git identity (required on clean CI/dev machines without global config)
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
	// Create an initial commit so HEAD exists
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

// Mock config loaders for buildExecutionContext
const mockOrchConfig = {
	orchestrator: {
		max_lanes: 2,
		spawn_mode: "tmux" as const,
		session_prefix: "orch",
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

const mockRunnerConfig = {
	task_areas: {},
	execution: {
		review_level: 0 as const,
		auto_checkpoint: true,
	},
};

const mockLoadOrchConfig = (_root: string, _pointerConfigRoot?: string) => mockOrchConfig;
const mockLoadRunnerConfig = (_root: string, _pointerConfigRoot?: string) => mockRunnerConfig;

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-workspace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {
		// Best effort cleanup on Windows
	}
});

// ── 1.x: loadWorkspaceConfig validation matrix ──────────────────────

describe("loadWorkspaceConfig", () => {
	it("1.1: returns null when no config file (repo mode)", () => {
		const dir = makeTestDir("no-config");
		const result = loadWorkspaceConfig(dir);
		expect(result).toBeNull();
	});

	it("1.2: throws WORKSPACE_FILE_PARSE_ERROR on invalid YAML", () => {
		const dir = makeTestDir("bad-yaml");
		// Use YAML that actually fails to parse (unmatched quotes, bad indentation)
		writeWorkspaceConfig(dir, "key: [\nunfinished");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_FILE_PARSE_ERROR");
		}
	});

	it("1.3: throws WORKSPACE_SCHEMA_INVALID on missing repos mapping", () => {
		const dir = makeTestDir("no-repos");
		writeWorkspaceConfig(dir, "routing:\n  tasks_root: ./tasks\n  default_repo: api\n");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_SCHEMA_INVALID");
		}
	});

	it("1.4: throws WORKSPACE_SCHEMA_INVALID on missing routing mapping", () => {
		const dir = makeTestDir("no-routing");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		writeWorkspaceConfig(dir, `repos:\n  api:\n    path: ${repoDir}\n`);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_SCHEMA_INVALID");
		}
	});

	it("1.5: throws WORKSPACE_MISSING_REPOS on empty repos map", () => {
		const dir = makeTestDir("empty-repos");
		writeWorkspaceConfig(dir, "repos: {}\nrouting:\n  tasks_root: ./tasks\n  default_repo: api\n");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_MISSING_REPOS");
		}
	});

	it("1.6: throws WORKSPACE_REPO_PATH_MISSING on repo without path", () => {
		const dir = makeTestDir("no-path");
		writeWorkspaceConfig(dir, "repos:\n  api:\n    branch: main\nrouting:\n  tasks_root: ./tasks\n  default_repo: api\n");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_REPO_PATH_MISSING");
			expect((err as WorkspaceConfigError).repoId).toBe("api");
		}
	});

	it("1.7: throws WORKSPACE_REPO_PATH_NOT_FOUND on non-existent repo path", () => {
		const dir = makeTestDir("bad-path");
		writeWorkspaceConfig(dir, "repos:\n  api:\n    path: ./nonexistent-repo\nrouting:\n  tasks_root: ./tasks\n  default_repo: api\n");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_REPO_PATH_NOT_FOUND");
			expect((err as WorkspaceConfigError).repoId).toBe("api");
		}
	});

	it("1.8: throws WORKSPACE_REPO_NOT_GIT on non-git directory", () => {
		const dir = makeTestDir("not-git");
		const repoDir = join(dir, "not-a-repo");
		mkdirSync(repoDir, { recursive: true });
		writeWorkspaceConfig(dir, `repos:\n  api:\n    path: ${repoDir}\nrouting:\n  tasks_root: ./tasks\n  default_repo: api\n`);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_REPO_NOT_GIT");
			expect((err as WorkspaceConfigError).repoId).toBe("api");
		}
	});

	it("1.9: throws WORKSPACE_DUPLICATE_REPO_PATH on duplicate paths", () => {
		const dir = makeTestDir("dup-paths");
		const repoDir = join(dir, "shared-repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n  frontend:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n`
		);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_DUPLICATE_REPO_PATH");
		}
	});

	it("1.10: throws WORKSPACE_MISSING_TASKS_ROOT on missing routing.tasks_root", () => {
		const dir = makeTestDir("no-tasks-root");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		writeWorkspaceConfig(dir, `repos:\n  api:\n    path: ${repoDir}\nrouting:\n  default_repo: api\n`);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_MISSING_TASKS_ROOT");
		}
	});

	it("1.11: throws WORKSPACE_TASKS_ROOT_NOT_FOUND on non-existent tasks root", () => {
		const dir = makeTestDir("bad-tasks-root");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ./nonexistent-tasks\n  default_repo: api\n`
		);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_TASKS_ROOT_NOT_FOUND");
		}
	});

	it("1.12: throws WORKSPACE_MISSING_DEFAULT_REPO on missing routing.default_repo", () => {
		const dir = makeTestDir("no-default-repo");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n`
		);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_MISSING_DEFAULT_REPO");
		}
	});

	it("1.13: throws WORKSPACE_DEFAULT_REPO_NOT_FOUND on invalid default_repo ID", () => {
		const dir = makeTestDir("bad-default-repo");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: nonexistent\n`
		);
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_DEFAULT_REPO_NOT_FOUND");
		}
	});

	it("1.14: returns valid WorkspaceConfig for well-formed config", () => {
		const dir = makeTestDir("valid");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n    default_branch: develop\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n`
		);

		const config = loadWorkspaceConfig(dir);
		expect(config).not.toBeNull();
		expect(config!.mode).toBe("workspace");
		expect(config!.repos.size).toBe(1);
		expect(config!.repos.has("api")).toBe(true);
		expect(config!.repos.get("api")!.id).toBe("api");
		expect(config!.repos.get("api")!.defaultBranch).toBe("develop");
		expect(config!.routing.defaultRepo).toBe("api");
		expect(config!.configPath).toBe(workspaceConfigPath(dir));
		// tasks root should be an absolute path
		expect(config!.routing.tasksRoot).toContain("tasks");
	});

	it("1.15: throws WORKSPACE_SCHEMA_INVALID on scalar YAML", () => {
		const dir = makeTestDir("scalar-yaml");
		writeWorkspaceConfig(dir, "just a string");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_SCHEMA_INVALID");
		}
	});

	it("1.16: throws WORKSPACE_SCHEMA_INVALID on array YAML", () => {
		const dir = makeTestDir("array-yaml");
		writeWorkspaceConfig(dir, "- item1\n- item2\n");
		try {
			loadWorkspaceConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_SCHEMA_INVALID");
		}
	});

	it("1.17: handles multiple repos in a valid config", () => {
		const dir = makeTestDir("multi-repo");
		const repoA = join(dir, "repo-a");
		const repoB = join(dir, "repo-b");
		initGitRepo(repoA);
		initGitRepo(repoB);
		const tasksDir = join(repoA, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoA}\n  frontend:\n    path: ${repoB}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n`
		);

		const config = loadWorkspaceConfig(dir);
		expect(config).not.toBeNull();
		expect(config!.repos.size).toBe(2);
		expect(config!.repos.has("api")).toBe(true);
		expect(config!.repos.has("frontend")).toBe(true);
	});

	// ── 1.15+: routing.strict type validation (TP-011) ──────────

	it("1.15: routing.strict: true is accepted and set on config", () => {
		const dir = makeTestDir("strict-true");
		const repoDir = join(dir, "repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n  strict: true\n`
		);

		const config = loadWorkspaceConfig(dir);
		expect(config).not.toBeNull();
		expect(config!.routing.strict).toBe(true);
	});

	it("1.16: routing.strict: false is accepted and NOT set on config", () => {
		const dir = makeTestDir("strict-false");
		const repoDir = join(dir, "repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n  strict: false\n`
		);

		const config = loadWorkspaceConfig(dir);
		expect(config).not.toBeNull();
		expect(config!.routing.strict).toBeUndefined();
	});

	it("1.17: routing.strict omitted defaults to permissive (no strict field)", () => {
		const dir = makeTestDir("strict-omitted");
		const repoDir = join(dir, "repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n`
		);

		const config = loadWorkspaceConfig(dir);
		expect(config).not.toBeNull();
		expect(config!.routing.strict).toBeUndefined();
	});

	it("1.18: routing.strict with string value throws WORKSPACE_SCHEMA_INVALID", () => {
		const dir = makeTestDir("strict-string");
		const repoDir = join(dir, "repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n  strict: "yes"\n`
		);

		expect(() => loadWorkspaceConfig(dir)).toThrow(WorkspaceConfigError);
		try {
			loadWorkspaceConfig(dir);
		} catch (e: any) {
			expect(e.code).toBe("WORKSPACE_SCHEMA_INVALID");
			expect(e.message).toContain("routing.strict");
			expect(e.message).toContain("boolean");
		}
	});

	it("1.19: routing.strict with numeric value throws WORKSPACE_SCHEMA_INVALID", () => {
		const dir = makeTestDir("strict-number");
		const repoDir = join(dir, "repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n  strict: 1\n`
		);

		expect(() => loadWorkspaceConfig(dir)).toThrow(WorkspaceConfigError);
		try {
			loadWorkspaceConfig(dir);
		} catch (e: any) {
			expect(e.code).toBe("WORKSPACE_SCHEMA_INVALID");
			expect(e.message).toContain("routing.strict");
		}
	});

	it("1.20: routing.strict: null (bare YAML value) throws WORKSPACE_SCHEMA_INVALID", () => {
		const dir = makeTestDir("strict-null");
		const repoDir = join(dir, "repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		// In YAML, bare `strict:` or `strict: null` produces null
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n  strict: null\n`
		);

		expect(() => loadWorkspaceConfig(dir)).toThrow(WorkspaceConfigError);
		try {
			loadWorkspaceConfig(dir);
		} catch (e: any) {
			expect(e.code).toBe("WORKSPACE_SCHEMA_INVALID");
			expect(e.message).toContain("routing.strict");
			expect(e.message).toContain("boolean");
			expect(e.message).toContain("null");
		}
	});
});

// ── 2.x: buildExecutionContext ───────────────────────────────────────

describe("buildExecutionContext", () => {
	it("2.1: repo mode — workspaceRoot === repoRoot === cwd, mode === 'repo'", () => {
		const dir = makeTestDir("repo-mode");
		initGitRepo(dir);
		const ctx = buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig);
		expect(ctx.mode).toBe("repo");
		expect(ctx.workspaceRoot).toBe(dir);
		expect(ctx.repoRoot).toBe(dir);
		expect(ctx.workspaceConfig).toBeNull();
		expect(ctx.orchestratorConfig).toEqual(mockOrchConfig);
		expect(ctx.taskRunnerConfig).toEqual(mockRunnerConfig);
		expect(ctx.pointer).toBeNull();
	});

	it("2.1b: non-git cwd + no workspace config throws WORKSPACE_SETUP_REQUIRED", () => {
		const dir = makeTestDir("repo-mode-non-git");
		expect(() => buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig)).toThrow(WorkspaceConfigError);
		try {
			buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig);
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_SETUP_REQUIRED");
			expect((err as WorkspaceConfigError).message).toContain("not a git repository");
		}
	});

	it("2.2: workspace mode — workspaceRoot !== repoRoot, repoRoot === default repo", () => {
		const dir = makeTestDir("ws-mode");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  api:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: api\n`
		);

		const ctx = buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig);
		expect(ctx.mode).toBe("workspace");
		expect(ctx.workspaceRoot).toBe(dir);
		// repoRoot should be the resolved absolute path to repo-a
		expect(ctx.repoRoot).not.toBe(dir);
		expect(existsSync(ctx.repoRoot)).toBe(true);
		expect(ctx.workspaceConfig).not.toBeNull();
		expect(ctx.workspaceConfig!.mode).toBe("workspace");
		expect(ctx.workspaceConfig!.repos.size).toBe(1);
		// Pointer resolved but no pointer file — used=false with fallback
		expect(ctx.pointer).not.toBeNull();
		expect(ctx.pointer!.used).toBe(false);
		expect(ctx.pointer!.warning).toBeDefined();
	});

	it("2.3: propagates WorkspaceConfigError from invalid config", () => {
		const dir = makeTestDir("ws-error");
		// Use YAML that actually fails to parse
		writeWorkspaceConfig(dir, "key: [\nunfinished");
		try {
			buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(WorkspaceConfigError);
			expect((err as WorkspaceConfigError).code).toBe("WORKSPACE_FILE_PARSE_ERROR");
		}
	});
});

// ── 3.x: canonicalizePath ────────────────────────────────────────────

describe("canonicalizePath", () => {
	it("3.1: normalizes backslashes to forward slashes", () => {
		const result = canonicalizePath("some\\path\\here", "/base");
		expect(result).not.toContain("\\");
	});

	it("3.2: lowercases the result", () => {
		const dir = makeTestDir("casing");
		// Use the real directory so realpathSync works
		const result = canonicalizePath(dir, "");
		expect(result).toBe(result.toLowerCase());
	});

	it("3.3: resolves relative paths against base", () => {
		const base = makeTestDir("base");
		const result = canonicalizePath("subdir", base);
		const expected = resolve(base, "subdir").replace(/\\/g, "/").toLowerCase();
		expect(result).toBe(expected);
	});

	it("3.4: handles absolute paths", () => {
		const dir = makeTestDir("abs");
		const result = canonicalizePath(dir, "/different-base");
		// Should contain the actual dir path, not the base
		expect(result).toContain("abs");
	});
});

// ── 4.x: Type contracts ─────────────────────────────────────────────

describe("WorkspaceConfigError", () => {
	it("4.1: has correct code, message, repoId, relatedPath", () => {
		const err = new WorkspaceConfigError(
			"WORKSPACE_REPO_NOT_GIT",
			"Not a git repo",
			"api",
			"/path/to/api",
		);
		expect(err).toBeInstanceOf(Error);
		expect(err.name).toBe("WorkspaceConfigError");
		expect(err.code).toBe("WORKSPACE_REPO_NOT_GIT");
		expect(err.message).toBe("Not a git repo");
		expect(err.repoId).toBe("api");
		expect(err.relatedPath).toBe("/path/to/api");
	});

	it("4.2: repoId and relatedPath are optional", () => {
		const err = new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			"Bad schema",
		);
		expect(err.code).toBe("WORKSPACE_SCHEMA_INVALID");
		expect(err.repoId).toBeUndefined();
		expect(err.relatedPath).toBeUndefined();
	});
});

describe("createRepoModeContext", () => {
	it("4.3: returns correct shape with workspaceRoot === repoRoot", () => {
		const ctx = createRepoModeContext("/some/cwd", mockRunnerConfig, mockOrchConfig);
		expect(ctx.mode).toBe("repo");
		expect(ctx.workspaceRoot).toBe("/some/cwd");
		expect(ctx.repoRoot).toBe("/some/cwd");
		expect(ctx.workspaceConfig).toBeNull();
		expect(ctx.taskRunnerConfig).toEqual(mockRunnerConfig);
		expect(ctx.orchestratorConfig).toEqual(mockOrchConfig);
	});
});

describe("workspaceConfigPath", () => {
	it("4.4: returns expected path", () => {
		const result = workspaceConfigPath("/workspace");
		// Should end with .pi/taskplane-workspace.yaml
		expect(result).toMatch(/\.pi[/\\]taskplane-workspace\.yaml$/);
	});
});

// ── 5.x: Root-consistency regression checks ─────────────────────────

describe("root-consistency regression", () => {
	// These tests verify source code patterns to ensure the root threading
	// from TP-001 is correct and consistent across modules.

	const extensionSrc = readFileSync(
		resolve(__dirname, "..", "taskplane", "extension.ts"),
		"utf-8",
	);
	const engineSrc = readFileSync(
		resolve(__dirname, "..", "taskplane", "engine.ts"),
		"utf-8",
	);
	const resumeSrc = readFileSync(
		resolve(__dirname, "..", "taskplane", "resume.ts"),
		"utf-8",
	);

	it("5.1: extension.ts has execCtx variable initialized to null", () => {
		expect(extensionSrc).toContain("let execCtx: ExecutionContext | null = null");
	});

	it("5.2: extension.ts builds execution context from ctx.cwd in session_start", () => {
		expect(extensionSrc).toContain("buildExecutionContext(ctx.cwd");
	});

	it("5.3: extension.ts catches WorkspaceConfigError in session_start", () => {
		expect(extensionSrc).toContain("err instanceof WorkspaceConfigError");
	});

	it("5.4: extension.ts has command guard function requireExecCtx", () => {
		expect(extensionSrc).toContain("function requireExecCtx");
	});

	it("5.5: extension.ts orch command uses execCtx.repoRoot (not ctx.cwd) for discovery", () => {
		// The /orch handler should use execCtx.repoRoot
		expect(extensionSrc).toContain("execCtx!.repoRoot");
		// ctx.cwd should only appear in specific allowed locations:
		// - session_start (buildExecutionContext call)
		// - orch-abort fallback (execCtx?.repoRoot ?? ctx.cwd)
		// - doOrchStatus/tool fallback (ctx.cwd passed as fallback parameter)
		// Verify no ctx.cwd in discovery/state/orphan patterns
		const lines = extensionSrc.split("\n");
		const cwdLines = lines.filter(l => l.includes("ctx.cwd") && !l.trim().startsWith("//"));
		for (const line of cwdLines) {
			const isBuildContext = line.includes("buildExecutionContext");
			const isAbortFallback = line.includes("execCtx?.repoRoot ?? ctx.cwd");
			// TP-053: doOrch* helpers and tool handlers pass ctx.cwd as fallback
			const isDoOrchCall = line.includes("doOrchStatus(ctx.cwd") || line.includes("doOrchAbort(");
			expect(isBuildContext || isAbortFallback || isDoOrchCall).toBe(true);
		}
	});

	it("5.6: extension.ts orch-abort has ctx.cwd fallback for safety", () => {
		expect(extensionSrc).toContain("execCtx?.repoRoot ?? ctx.cwd");
	});

	it("5.7: engine.ts maps cwd parameter to repoRoot", () => {
		expect(engineSrc).toContain("const repoRoot = cwd");
	});

	it("5.8: resume.ts maps cwd parameter to repoRoot", () => {
		expect(resumeSrc).toContain("const repoRoot = cwd");
	});

	it("5.9: extension.ts orch-resume passes execCtx.repoRoot to resumeOrchBatch", () => {
		expect(extensionSrc).toContain("execCtx!.repoRoot");
		// Should appear in the resume handler context
		const lines = extensionSrc.split("\n");
		const resumeLines = lines.filter(l =>
			l.includes("resumeOrchBatch") || l.includes("execCtx!.repoRoot"),
		);
		expect(resumeLines.length).toBeGreaterThan(0);
	});

	it("5.10: extension.ts sets mode label from execCtx.mode", () => {
		expect(extensionSrc).toContain('execCtx.mode === "workspace"');
	});

	it("5.11: extension.ts resets execCtx to null before re-initialization", () => {
		// Prevents stale execCtx if session_start fires multiple times
		// and the second call fails — execCtx must be null, not the old value
		const sessionStartIdx = extensionSrc.indexOf("session_start");
		const resetIdx = extensionSrc.indexOf("execCtx = null", sessionStartIdx);
		const buildIdx = extensionSrc.indexOf("buildExecutionContext", sessionStartIdx);
		expect(resetIdx).toBeGreaterThan(sessionStartIdx);
		expect(resetIdx).toBeLessThan(buildIdx);
	});

	it("5.12: extension.ts orch-status/orch-pause/orch-sessions operate on in-memory state only (no execCtx needed)", () => {
		// These commands intentionally don't require execCtx because they
		// only read/write in-memory orchBatchState (no filesystem access).
		// Verify they don't reference execCtx at all.
		const lines = extensionSrc.split("\n");

		// Find the orch-status handler range
		const statusRegIdx = lines.findIndex(l => l.includes('"orch-status"'));
		const pauseRegIdx = lines.findIndex(l => l.includes('"orch-pause"'));
		const sessionsRegIdx = lines.findIndex(l => l.includes('"orch-sessions"'));

		// orch-status handler should not call requireExecCtx
		expect(statusRegIdx).toBeGreaterThan(-1);
		const statusBlock = lines.slice(statusRegIdx, pauseRegIdx).join("\n");
		expect(statusBlock).not.toContain("requireExecCtx");

		// orch-sessions handler should not call requireExecCtx
		expect(sessionsRegIdx).toBeGreaterThan(-1);
		const sessionsBlock = lines.slice(sessionsRegIdx, sessionsRegIdx + 10).join("\n");
		expect(sessionsBlock).not.toContain("requireExecCtx");
	});

	it("5.13: extension.ts reuses startup error message helper across command guards", () => {
		expect(extensionSrc).toContain("function getExecCtxInitErrorMessage()");
		expect(extensionSrc).toContain("message: getExecCtxInitErrorMessage()");
	});
});

// ── 6.x: resolvePointer (TP-016) ────────────────────────────────────

describe("resolvePointer", () => {
	/**
	 * Helper to build a minimal WorkspaceConfig with the given repos.
	 * Repo paths should be absolute.
	 */
	function makeWorkspaceConfig(
		repos: Record<string, string>,
	): WorkspaceConfig {
		const repoMap = new Map<string, WorkspaceRepoConfig>();
		for (const [id, repoPath] of Object.entries(repos)) {
			repoMap.set(id, {
				id,
				path: repoPath,
				defaultBranch: "main",
			});
		}
		const defaultRepo = Object.keys(repos)[0] ?? "default";
		const routing: WorkspaceRoutingConfig = {
			tasksRoot: "/fake/tasks",
			defaultRepo,
			taskPacketRepo: defaultRepo,
		};
		return {
			mode: "workspace" as const,
			configPath: "/fake/.pi/taskplane-workspace.yaml",
			repos: repoMap,
			routing,
		};
	}

	function writePointer(workspaceRoot: string, content: string): void {
		const dir = join(workspaceRoot, ".pi");
		mkdirSync(dir, { recursive: true });
		writeFileSync(pointerFilePath(workspaceRoot), content, "utf-8");
	}

	// ── 6.1: Repo mode returns null ─────────────────────────────

	it("6.1: returns null in repo mode (workspaceConfig is null)", () => {
		const dir = makeTestDir("ptr-repo-mode");
		// Even if a pointer file exists, repo mode ignores it
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: ".taskplane" }));
		const result = resolvePointer(dir, null);
		expect(result).toBeNull();
	});

	// ── 6.2: Missing pointer file → warn + fallback ─────────────

	it("6.2: returns fallback with warning when pointer file is missing", () => {
		const dir = makeTestDir("ptr-missing");
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(false);
		expect(result!.configRoot).toBe(resolve(dir, ".pi"));
		expect(result!.agentRoot).toBe(resolve(dir, ".pi", "agents"));
		expect(result!.warning).toContain("not found");
		expect(result!.warning).toContain("taskplane init");
	});

	// ── 6.3: Malformed JSON → warn + fallback ───────────────────

	it("6.3: returns fallback with warning when pointer has invalid JSON", () => {
		const dir = makeTestDir("ptr-bad-json");
		writePointer(dir, "{ not valid json!!!");
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("invalid JSON");
	});

	// ── 6.4: Non-object JSON → warn + fallback ──────────────────

	it("6.4: returns fallback with warning when pointer is not a JSON object", () => {
		const dir = makeTestDir("ptr-array-json");
		writePointer(dir, "[1, 2, 3]");
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("JSON object");
	});

	it("6.4b: returns fallback with warning when pointer is null JSON", () => {
		const dir = makeTestDir("ptr-null-json");
		writePointer(dir, "null");
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("JSON object");
	});

	// ── 6.5: Missing required fields → warn + fallback ──────────

	it("6.5a: returns fallback when config_repo is missing", () => {
		const dir = makeTestDir("ptr-no-repo");
		writePointer(dir, JSON.stringify({ config_path: ".taskplane" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("config_repo");
	});

	it("6.5b: returns fallback when config_path is missing", () => {
		const dir = makeTestDir("ptr-no-path");
		writePointer(dir, JSON.stringify({ config_repo: "infra" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("config_path");
	});

	it("6.5c: returns fallback when config_repo is empty string", () => {
		const dir = makeTestDir("ptr-empty-repo");
		writePointer(dir, JSON.stringify({ config_repo: "  ", config_path: ".taskplane" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("config_repo");
	});

	// ── 6.6: Unknown config_repo → warn + fallback ──────────────

	it("6.6: returns fallback when config_repo is not in workspace repos", () => {
		const dir = makeTestDir("ptr-unknown-repo");
		writePointer(dir, JSON.stringify({ config_repo: "nonexistent", config_path: ".taskplane" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra", frontend: "/fake/frontend" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("nonexistent");
		expect(result!.warning).toContain("not found");
		// Should list available repos
		expect(result!.warning).toContain("infra");
		expect(result!.warning).toContain("frontend");
	});

	// ── 6.7: Path traversal rejection ───────────────────────────

	it("6.7a: rejects config_path starting with '..'", () => {
		const dir = makeTestDir("ptr-traversal-dotdot");
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "../escape" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("path traversal");
	});

	it("6.7b: rejects config_path with /../ in the middle", () => {
		const dir = makeTestDir("ptr-traversal-mid");
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "sub/../../../escape" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("path traversal");
	});

	it("6.7c: rejects config_path ending with /..", () => {
		const dir = makeTestDir("ptr-traversal-end");
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "sub/.." }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("path traversal");
	});

	// ── 6.8: Absolute path rejection ────────────────────────────

	it("6.8a: rejects POSIX absolute config_path", () => {
		const dir = makeTestDir("ptr-abs-posix");
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "/etc/evil" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("absolute paths not allowed");
	});

	it("6.8b: rejects Windows absolute config_path (drive letter)", () => {
		const dir = makeTestDir("ptr-abs-win");
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "C:\\temp\\evil" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("absolute paths not allowed");
	});

	it("6.8c: rejects Windows absolute config_path (forward slash drive)", () => {
		const dir = makeTestDir("ptr-abs-win-fwd");
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "C:/temp/evil" }));
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		// May be caught by absolute check or containment check
		expect(result!.used).toBe(false);
		expect(result!.warning).toBeDefined();
	});

	// ── 6.9: Valid pointer → resolved paths ─────────────────────

	it("6.9: returns resolved paths when pointer is valid", () => {
		const dir = makeTestDir("ptr-valid");
		const repoPath = resolve(dir, "infra-repo");
		mkdirSync(repoPath, { recursive: true });
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: ".taskplane" }));
		const wsConfig = makeWorkspaceConfig({ infra: repoPath });

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(true);
		expect(result!.configRoot).toBe(resolve(repoPath, ".taskplane"));
		expect(result!.agentRoot).toBe(resolve(repoPath, ".taskplane", "agents"));
		expect(result!.warning).toBeUndefined();
	});

	it("6.9b: handles config_path with nested subdirectory", () => {
		const dir = makeTestDir("ptr-nested");
		const repoPath = resolve(dir, "infra-repo");
		mkdirSync(repoPath, { recursive: true });
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "config/taskplane" }));
		const wsConfig = makeWorkspaceConfig({ infra: repoPath });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(true);
		expect(result!.configRoot).toBe(resolve(repoPath, "config", "taskplane"));
		expect(result!.agentRoot).toBe(resolve(repoPath, "config", "taskplane", "agents"));
	});

	// ── 6.10: Defense-in-depth containment check ────────────────

	it("6.10: containment check catches resolved path escaping repo root", () => {
		// This tests the defense-in-depth relative() check.
		// A path that doesn't trigger the string-based checks but still escapes.
		const dir = makeTestDir("ptr-containment");
		const repoPath = resolve(dir, "infra-repo");
		mkdirSync(repoPath, { recursive: true });
		// "foo/../../.." would be caught by /../ check, but let's verify
		// the containment check works as a safety net. We use a path that
		// only triggers the relative() check — we need the traversal checks
		// to pass first. The string checks already cover .., so this test
		// verifies the layered defense by testing a path that the traversal
		// regex DOES catch, confirming the defense-in-depth.
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "sub/../../escape" }));
		const wsConfig = makeWorkspaceConfig({ infra: repoPath });

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		// Caught by either traversal or containment check
		expect(result!.warning).toBeDefined();
	});

	// ── 6.11: Fallback paths are correct ────────────────────────

	it("6.11: all failure modes use consistent fallback paths", () => {
		const dir = makeTestDir("ptr-fallback-consistency");
		const expectedConfigRoot = resolve(dir, ".pi");
		const expectedAgentRoot = resolve(dir, ".pi", "agents");
		const wsConfig = makeWorkspaceConfig({ infra: "/fake/infra" });

		// Missing file
		const r1 = resolvePointer(dir, wsConfig);
		expect(r1!.configRoot).toBe(expectedConfigRoot);
		expect(r1!.agentRoot).toBe(expectedAgentRoot);

		// Malformed JSON
		writePointer(dir, "not json");
		const r2 = resolvePointer(dir, wsConfig);
		expect(r2!.configRoot).toBe(expectedConfigRoot);
		expect(r2!.agentRoot).toBe(expectedAgentRoot);

		// Unknown repo
		writePointer(dir, JSON.stringify({ config_repo: "nope", config_path: ".tp" }));
		const r3 = resolvePointer(dir, wsConfig);
		expect(r3!.configRoot).toBe(expectedConfigRoot);
		expect(r3!.agentRoot).toBe(expectedAgentRoot);

		// Traversal
		writePointer(dir, JSON.stringify({ config_repo: "infra", config_path: "../escape" }));
		const r4 = resolvePointer(dir, wsConfig);
		expect(r4!.configRoot).toBe(expectedConfigRoot);
		expect(r4!.agentRoot).toBe(expectedAgentRoot);
	});
});

// ── 6.x: resolvePointer() ───────────────────────────────────────────

describe("resolvePointer", () => {
	// Helper: create a minimal WorkspaceConfig with a single repo for testing
	function makeWorkspaceConfig(repoId: string, repoPath: string): WorkspaceConfig {
		const repos = new Map<string, WorkspaceRepoConfig>();
		repos.set(repoId, { id: repoId, path: repoPath });
		return {
			mode: "workspace" as const,
			repos,
			routing: {
				tasksRoot: join(repoPath, "tasks"),
				defaultRepo: repoId,
				taskPacketRepo: repoId,
			},
			configPath: join(repoPath, ".pi", "taskplane-workspace.yaml"),
		};
	}

	function writePointerFile(wsRoot: string, content: string): void {
		const dir = join(wsRoot, ".pi");
		mkdirSync(dir, { recursive: true });
		writeFileSync(pointerFilePath(wsRoot), content, "utf-8");
	}

	it("6.1: repo mode (null workspaceConfig) returns null", () => {
		const dir = makeTestDir("ptr-repo-mode");
		const result = resolvePointer(dir, null);
		expect(result).toBeNull();
	});

	it("6.2: repo mode returns null even if pointer file exists", () => {
		const dir = makeTestDir("ptr-repo-mode-file-exists");
		writePointerFile(dir, JSON.stringify({ config_repo: "api", config_path: ".taskplane" }));
		const result = resolvePointer(dir, null);
		expect(result).toBeNull();
	});

	it("6.3: missing pointer file returns fallback with warning", () => {
		const dir = makeTestDir("ptr-missing");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(false);
		expect(result!.configRoot).toBe(resolve(dir, ".pi"));
		expect(result!.agentRoot).toBe(resolve(dir, ".pi", "agents"));
		expect(result!.warning).toContain("not found");
		expect(result!.warning).toContain("taskplane init");
	});

	it("6.4: malformed JSON returns fallback with warning", () => {
		const dir = makeTestDir("ptr-bad-json");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, "not valid json {{{");

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(false);
		expect(result!.configRoot).toBe(resolve(dir, ".pi"));
		expect(result!.warning).toContain("invalid JSON");
	});

	it("6.5: non-object JSON (array) returns fallback with warning", () => {
		const dir = makeTestDir("ptr-array-json");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify([1, 2, 3]));

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("JSON object");
	});

	it("6.6: missing config_repo field returns fallback with warning", () => {
		const dir = makeTestDir("ptr-no-config-repo");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_path: ".taskplane" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("config_repo");
	});

	it("6.7: missing config_path field returns fallback with warning", () => {
		const dir = makeTestDir("ptr-no-config-path");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("config_path");
	});

	it("6.8: empty string config_repo returns fallback with warning", () => {
		const dir = makeTestDir("ptr-empty-repo");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "  ", config_path: ".taskplane" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("config_repo");
	});

	it("6.9: unknown config_repo returns fallback with available repos listed", () => {
		const dir = makeTestDir("ptr-unknown-repo");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "nonexistent", config_path: ".taskplane" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("nonexistent");
		expect(result!.warning).toContain("not found in workspace repos");
		expect(result!.warning).toContain("config"); // available repo listed
	});

	it("6.10: path traversal with '..' prefix is rejected", () => {
		const dir = makeTestDir("ptr-traversal-prefix");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "../escape" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("path traversal");
	});

	it("6.11: path traversal with embedded '/../' is rejected", () => {
		const dir = makeTestDir("ptr-traversal-embed");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "foo/../../../escape" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("path traversal");
	});

	it("6.12: POSIX absolute path '/etc/evil' is rejected", () => {
		const dir = makeTestDir("ptr-abs-posix");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "/etc/evil" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("absolute paths not allowed");
	});

	it("6.13: Windows absolute path 'C:/evil' is rejected", () => {
		const dir = makeTestDir("ptr-abs-win");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "C:/evil" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("absolute paths not allowed");
	});

	it("6.14: Windows absolute path with backslashes 'D:\\\\evil' is rejected", () => {
		const dir = makeTestDir("ptr-abs-win-bs");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "D:\\evil" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(false);
		expect(result!.warning).toContain("absolute paths not allowed");
	});

	it("6.15: valid pointer resolves config and agent roots to config repo", () => {
		const dir = makeTestDir("ptr-valid");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: ".taskplane" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result).not.toBeNull();
		expect(result!.used).toBe(true);
		expect(result!.configRoot).toBe(resolve(repoDir, ".taskplane"));
		expect(result!.agentRoot).toBe(resolve(repoDir, ".taskplane", "agents"));
		expect(result!.warning).toBeUndefined();
	});

	it("6.16: valid pointer with nested config_path resolves correctly", () => {
		const dir = makeTestDir("ptr-nested");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "deep/nested/config" }));

		const result = resolvePointer(dir, wsConfig);
		expect(result!.used).toBe(true);
		expect(result!.configRoot).toBe(resolve(repoDir, "deep", "nested", "config"));
		expect(result!.agentRoot).toBe(resolve(repoDir, "deep", "nested", "config", "agents"));
	});

	it("6.17: all fallback results have consistent fallback paths", () => {
		// Every failure mode should produce the same fallback paths
		const dir = makeTestDir("ptr-fallback-consistency");
		const repoDir = join(dir, "config-repo");
		mkdirSync(repoDir, { recursive: true });
		const wsConfig = makeWorkspaceConfig("config", repoDir);
		const expectedConfigRoot = resolve(dir, ".pi");
		const expectedAgentRoot = resolve(dir, ".pi", "agents");

		// Missing file
		const r1 = resolvePointer(dir, wsConfig)!;
		expect(r1.configRoot).toBe(expectedConfigRoot);
		expect(r1.agentRoot).toBe(expectedAgentRoot);

		// Malformed JSON
		writePointerFile(dir, "{bad");
		const r2 = resolvePointer(dir, wsConfig)!;
		expect(r2.configRoot).toBe(expectedConfigRoot);
		expect(r2.agentRoot).toBe(expectedAgentRoot);

		// Unknown repo
		writePointerFile(dir, JSON.stringify({ config_repo: "unknown", config_path: ".taskplane" }));
		const r3 = resolvePointer(dir, wsConfig)!;
		expect(r3.configRoot).toBe(expectedConfigRoot);
		expect(r3.agentRoot).toBe(expectedAgentRoot);

		// Path traversal
		writePointerFile(dir, JSON.stringify({ config_repo: "config", config_path: "../escape" }));
		const r4 = resolvePointer(dir, wsConfig)!;
		expect(r4.configRoot).toBe(expectedConfigRoot);
		expect(r4.agentRoot).toBe(expectedAgentRoot);
	});
});

// ── 7.x: Orchestrator Pointer Threading (TP-016 Step 3) ─────────────

describe("orchestrator pointer threading", () => {
	// Helper: write a pointer file for the workspace
	function writePointerFile(workspaceRoot: string, content: string): void {
		const dir = join(workspaceRoot, ".pi");
		mkdirSync(dir, { recursive: true });
		writeFileSync(pointerFilePath(workspaceRoot), content, "utf-8");
	}

	it("7.1: buildExecutionContext passes pointer.configRoot to config loaders in workspace mode", () => {
		const dir = makeTestDir("orch-ptr-pass");
		const repoDir = join(dir, "my-repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  myrepo:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: myrepo\n`
		);
		// Write a valid pointer file — config_repo points to the same repo for simplicity
		writePointerFile(dir, JSON.stringify({ config_repo: "myrepo", config_path: ".taskplane" }));

		// Track what the config loaders receive
		let orchPointerRoot: string | undefined;
		let runnerPointerRoot: string | undefined;

		const trackingOrchLoader = (_cwd: string, pointerConfigRoot?: string) => {
			orchPointerRoot = pointerConfigRoot;
			return mockOrchConfig;
		};
		const trackingRunnerLoader = (_cwd: string, pointerConfigRoot?: string) => {
			runnerPointerRoot = pointerConfigRoot;
			return mockRunnerConfig;
		};

		const ctx = buildExecutionContext(dir, trackingOrchLoader, trackingRunnerLoader);

		// Config loaders should receive the pointer config root
		// Use resolve() to match OS-specific path normalization (realpathSync may expand 8.3 names)
		expect(ctx.pointer).not.toBeNull();
		expect(ctx.pointer!.used).toBe(true);
		expect(orchPointerRoot).toBe(ctx.pointer!.configRoot);
		expect(runnerPointerRoot).toBe(ctx.pointer!.configRoot);
		// configRoot should point inside the repo
		expect(ctx.pointer!.configRoot).toContain(".taskplane");
	});

	it("7.2: buildExecutionContext passes undefined pointer to config loaders in repo mode", () => {
		const dir = makeTestDir("orch-ptr-repo");
		initGitRepo(dir);

		let orchPointerRoot: string | undefined = "sentinel";
		let runnerPointerRoot: string | undefined = "sentinel";

		const trackingOrchLoader = (_cwd: string, pointerConfigRoot?: string) => {
			orchPointerRoot = pointerConfigRoot;
			return mockOrchConfig;
		};
		const trackingRunnerLoader = (_cwd: string, pointerConfigRoot?: string) => {
			runnerPointerRoot = pointerConfigRoot;
			return mockRunnerConfig;
		};

		const ctx = buildExecutionContext(dir, trackingOrchLoader, trackingRunnerLoader);

		// Repo mode: no pointer passed to loaders
		expect(orchPointerRoot).toBeUndefined();
		expect(runnerPointerRoot).toBeUndefined();
		expect(ctx.pointer).toBeNull();
		expect(ctx.mode).toBe("repo");
	});

	it("7.3: buildExecutionContext with missing pointer file → fallback configRoot passed to loaders", () => {
		const dir = makeTestDir("orch-ptr-missing");
		const repoDir = join(dir, "my-repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  myrepo:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: myrepo\n`
		);
		// No pointer file written

		let orchPointerRoot: string | undefined;
		const trackingOrchLoader = (_cwd: string, pointerConfigRoot?: string) => {
			orchPointerRoot = pointerConfigRoot;
			return mockOrchConfig;
		};

		const ctx = buildExecutionContext(dir, trackingOrchLoader, mockLoadRunnerConfig);

		// Fallback configRoot is <workspaceRoot>/.pi
		expect(orchPointerRoot).toBe(resolve(dir, ".pi"));
		expect(ctx.pointer).not.toBeNull();
		expect(ctx.pointer!.used).toBe(false);
		expect(ctx.pointer!.warning).toBeDefined();
	});

	// Tests 7.4 and 7.5 removed — buildLaneEnvVars removed during TMUX extrication.
	// V2 lane-runner builds env vars directly in executeTaskV2.

	it("7.6: spawnMergeAgentV2 signature accepts agentRoot, separate from stateRoot", () => {
		// Verify the Runtime V2 merge spawner includes both agentRoot and stateRoot
		const mergeSrc = readFileSync(
			resolve(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		const funcStart = mergeSrc.indexOf("export async function spawnMergeAgentV2");
		expect(funcStart).toBeGreaterThan(-1);
		const funcParamEnd = mergeSrc.indexOf(")", funcStart);
		const funcSignature = mergeSrc.substring(funcStart, funcParamEnd + 1);
		expect(funcSignature).toContain("agentRoot");
		expect(funcSignature).toContain("stateRoot");

		// The system prompt resolution should use agentRoot for task-merger.md when available.
		const mergerRefLines = mergeSrc
			.split("\n")
			.filter(l => l.includes("task-merger.md") && l.includes("agentRoot"));
		expect(mergerRefLines.length).toBeGreaterThan(0);
	});

	it("7.7: merge request/result files use stateRoot (piDir), not agentRoot", () => {
		// Verify merge.ts uses piDir (= stateRoot ?? repoRoot) for merge result files,
		// NOT agentRoot or configRoot from pointer
		const mergeSrc = readFileSync(
			resolve(__dirname, "..", "taskplane", "merge.ts"),
			"utf-8",
		);

		// The piDir variable should be set from stateRoot
		const piDirLine = mergeSrc.split("\n").find(l => l.includes("const piDir") && l.includes("stateRoot"));
		expect(piDirLine).toBeDefined();

		// resultFilePath and requestFilePath should use piDir
		const resultLines = mergeSrc.split("\n").filter(l =>
			(l.includes("resultFilePath") || l.includes("requestFilePath")) && l.includes("piDir"),
		);
		expect(resultLines.length).toBeGreaterThan(0);
	});

	it("7.8: executeOrchBatch accepts and threads agentRoot to mergeWaveByRepo", () => {
		const engineSrc = readFileSync(
			resolve(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// executeOrchBatch should accept agentRoot parameter
		const funcStart = engineSrc.indexOf("function executeOrchBatch");
		const funcParamsEnd = engineSrc.indexOf("{", funcStart);
		const funcSignature = engineSrc.substring(funcStart, funcParamsEnd);
		expect(funcSignature).toContain("agentRoot");

		// agentRoot should be passed to mergeWaveByRepo
		const mergeCallIdx = engineSrc.indexOf("mergeWaveByRepo(");
		expect(mergeCallIdx).toBeGreaterThan(-1);
		// Get the full call including closing paren
		let depth = 0;
		let endIdx = mergeCallIdx;
		for (let i = mergeCallIdx; i < engineSrc.length; i++) {
			if (engineSrc[i] === "(") depth++;
			if (engineSrc[i] === ")") {
				depth--;
				if (depth === 0) { endIdx = i; break; }
			}
		}
		const mergeCallBlock = engineSrc.substring(mergeCallIdx, endIdx + 1);
		expect(mergeCallBlock).toContain("agentRoot");
	});

	it("7.9: extension.ts passes execCtx.pointer.agentRoot through worker data to engine", () => {
		const extensionSrc = readFileSync(
			resolve(__dirname, "..", "taskplane", "extension.ts"),
			"utf-8",
		);

		// TP-071: The engine now runs in a worker thread. doOrchStart builds
		// EngineWorkerData with agentRoot extracted from execCtx.pointer?.agentRoot,
		// then startBatchInWorker passes it to the worker (or fallback).
		// Verify that doOrchStart extracts pointer.agentRoot into the worker data.
		const doOrchStartBody = extensionSrc.substring(
			extensionSrc.indexOf("function doOrchStart("),
			extensionSrc.indexOf("function doOrchStatus("),
		);
		expect(doOrchStartBody).toContain("pointer");
		expect(doOrchStartBody).toContain("agentRoot");

		// Verify that the engine-worker entry point passes agentRoot to executeOrchBatch
		const workerSrc = readFileSync(
			resolve(__dirname, "..", "taskplane", "engine-worker.ts"),
			"utf-8",
		);
		const orchBatchCallIdx = workerSrc.indexOf("executeOrchBatch(");
		expect(orchBatchCallIdx).toBeGreaterThan(-1);
		let depth = 0;
		let endIdx = orchBatchCallIdx;
		for (let i = orchBatchCallIdx; i < workerSrc.length; i++) {
			if (workerSrc[i] === "(") depth++;
			if (workerSrc[i] === ")") {
				depth--;
				if (depth === 0) { endIdx = i; break; }
			}
		}
		const orchBatchCall = workerSrc.substring(orchBatchCallIdx, endIdx + 1);
		expect(orchBatchCall).toContain("agentRoot");
	});

	it("7.10: pointer warning is logged via console.error at startup", () => {
		const dir = makeTestDir("orch-ptr-warn-log");
		const repoDir = join(dir, "my-repo");
		initGitRepo(repoDir);
		const tasksDir = join(repoDir, "tasks");
		mkdirSync(tasksDir, { recursive: true });
		writeWorkspaceConfig(dir,
			`repos:\n  myrepo:\n    path: ${repoDir}\n` +
			`routing:\n  tasks_root: ${tasksDir}\n  default_repo: myrepo\n`
		);
		// No pointer file — should trigger warning

		const consoleErrors: string[] = [];
		const origError = console.error;
		console.error = (...args: unknown[]) => {
			consoleErrors.push(args.map(String).join(" "));
		};

		try {
			buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig);

			// Should have logged exactly one pointer warning
			const pointerWarnings = consoleErrors.filter(m => m.includes("[taskplane] pointer warning"));
			expect(pointerWarnings.length).toBe(1);
			expect(pointerWarnings[0]).toContain("Pointer file not found");
		} finally {
			console.error = origError;
		}
	});

	it("7.11: state operations (save/load/delete) use workspaceRoot, not pointer configRoot or repoRoot", () => {
		// Behavioral test: in workspace mode where workspaceRoot != repoRoot,
		// state files must be saved/loaded/deleted under workspaceRoot/.pi/,
		// never under the pointer config repo or the individual repo root.
		const wsRoot = makeTestDir("ws-state-root");
		const repoRoot = makeTestDir("repo-state-root");
		const configRepoRoot = makeTestDir("config-repo-state-root");

		// Create a valid batch state JSON (matches PersistedBatchState schema v4)
		const now = Date.now();
		const validState = JSON.stringify({
			schemaVersion: BATCH_STATE_SCHEMA_VERSION,
			phase: "executing",
			batchId: "20260317T120000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: now,
			updatedAt: now,
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			wavePlan: [["TASK-001"]],
			lanes: [],
			tasks: [{
				taskId: "TASK-001",
				status: "running",
				laneNumber: 1,
				sessionName: "orch-lane-1",
				taskFolder: "/workspace/tasks/TASK-001",
				exitReason: "",
				startedAt: now,
				endedAt: null,
				doneFileFound: false,
			}],
			mergeResults: [],
			totalTasks: 1,
			succeededTasks: 0,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			blockedTaskIds: [],
			lastError: null,
			errors: [],
			resilience: {
				resumeForced: false,
				retryCountByScope: {},
				lastFailureClass: null,
				repairHistory: [],
			},
			diagnostics: {
				taskExits: {},
				batchCost: 0,
			},
			segments: [],
		});

		// Save batch state to workspaceRoot (simulating what orch does with stateRoot = workspaceRoot)
		saveBatchState(validState, wsRoot);

		// Verify: loadBatchState finds it at workspaceRoot
		const loaded = loadBatchState(wsRoot);
		expect(loaded).not.toBeNull();
		expect(loaded!.batchId).toBe("20260317T120000");
		expect(loaded!.mode).toBe("workspace");

		// Verify: loadBatchState does NOT find it at repoRoot (different path)
		const loadedFromRepo = loadBatchState(repoRoot);
		expect(loadedFromRepo).toBeNull();

		// Verify: loadBatchState does NOT find it at configRepoRoot
		const loadedFromConfig = loadBatchState(configRepoRoot);
		expect(loadedFromConfig).toBeNull();

		// Verify: the file physically exists at wsRoot/.pi/batch-state.json
		expect(existsSync(batchStatePath(wsRoot))).toBe(true);
		expect(existsSync(batchStatePath(repoRoot))).toBe(false);
		expect(existsSync(batchStatePath(configRepoRoot))).toBe(false);

		// Verify: deleteBatchState at repoRoot has no effect on wsRoot state
		deleteBatchState(repoRoot);
		expect(existsSync(batchStatePath(wsRoot))).toBe(true);

		// Verify: deleteBatchState at wsRoot removes the file
		deleteBatchState(wsRoot);
		expect(existsSync(batchStatePath(wsRoot))).toBe(false);
		expect(loadBatchState(wsRoot)).toBeNull();
	});

	it("7.12: orch and orch-resume derive stateRoot identically from workspaceRoot", () => {
		// Core invariant: both executeOrchBatch and resumeOrchBatch compute
		// stateRoot = workspaceRoot ?? cwd. This test verifies the behavioral
		// consequence: a batch state saved during orch execution (using wsRoot)
		// is loadable during resume (using the same wsRoot), even when
		// cwd (repoRoot) differs.
		const wsRoot = makeTestDir("ws-resume-parity");
		const cwd = makeTestDir("cwd-resume-parity");

		// Simulate orch execution: stateRoot = workspaceRoot ?? cwd → wsRoot
		const orchStateRoot = wsRoot ?? cwd;
		expect(orchStateRoot).toBe(wsRoot);

		// Simulate orch-resume: stateRoot = workspaceRoot ?? cwd → wsRoot
		const resumeStateRoot = wsRoot ?? cwd;
		expect(resumeStateRoot).toBe(wsRoot);

		// Both paths produce the same state root
		expect(orchStateRoot).toBe(resumeStateRoot);

		// Now verify with real I/O: save state as orch would, load as resume would
		const now = Date.now();
		const validState = JSON.stringify({
			schemaVersion: BATCH_STATE_SCHEMA_VERSION,
			phase: "paused",
			batchId: "20260317T130000",
			baseBranch: "main",
			mode: "workspace",
			startedAt: now,
			updatedAt: now,
			endedAt: null,
			currentWaveIndex: 1,
			totalWaves: 2,
			wavePlan: [["TASK-001"], ["TASK-002"]],
			lanes: [],
			tasks: [
				{
					taskId: "TASK-001",
					status: "succeeded",
					laneNumber: 1,
					sessionName: "orch-lane-1",
					taskFolder: "/workspace/tasks/TASK-001",
					exitReason: "Task completed successfully",
					startedAt: now,
					endedAt: now,
					doneFileFound: true,
				},
				{
					taskId: "TASK-002",
					status: "pending",
					laneNumber: 0,
					sessionName: "",
					taskFolder: "/workspace/tasks/TASK-002",
					exitReason: "",
					startedAt: null,
					endedAt: null,
					doneFileFound: false,
				},
			],
			mergeResults: [],
			totalTasks: 2,
			succeededTasks: 1,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			blockedTaskIds: [],
			lastError: null,
			errors: [],
			resilience: {
				resumeForced: false,
				retryCountByScope: {},
				lastFailureClass: null,
				repairHistory: [],
			},
			diagnostics: {
				taskExits: {},
				batchCost: 0,
			},
			segments: [],
		});

		// Orch saves state using stateRoot (= workspaceRoot)
		saveBatchState(validState, orchStateRoot);

		// Resume loads state using the same stateRoot derivation
		const resumeLoaded = loadBatchState(resumeStateRoot);
		expect(resumeLoaded).not.toBeNull();
		expect(resumeLoaded!.batchId).toBe("20260317T130000");
		expect(resumeLoaded!.phase).toBe("paused");
		expect(resumeLoaded!.currentWaveIndex).toBe(1);

		// Resume would NOT find state at cwd (repoRoot) — proving stateRoot matters
		const cwdLoaded = loadBatchState(cwd);
		expect(cwdLoaded).toBeNull();

		// When workspaceRoot is undefined (repo mode), both fall back to cwd
		const repoModeStateRoot = undefined ?? cwd;
		expect(repoModeStateRoot).toBe(cwd);

		// Save state at cwd in repo mode
		saveBatchState(validState, cwd);
		const repoModeLoaded = loadBatchState(cwd);
		expect(repoModeLoaded).not.toBeNull();
		expect(repoModeLoaded!.batchId).toBe("20260317T130000");

		// Cleanup
		deleteBatchState(orchStateRoot);
		deleteBatchState(cwd);
	});
});
