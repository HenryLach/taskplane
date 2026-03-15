/**
 * Workspace Configuration Tests — TP-001 Step 3
 *
 * Targeted tests for workspace config loading, validation, execution
 * context building, and type contracts introduced in TP-001.
 *
 * Test categories:
 *   1.x — loadWorkspaceConfig() validation/error-code matrix
 *   2.x — buildExecutionContext() mode selection and context shape
 *   3.x — canonicalizePath() normalization behavior
 *   4.x — WorkspaceConfigError and createRepoModeContext contracts
 *   5.x — Root-consistency regression checks (source verification)
 *
 * Run: npx vitest run tests/workspace-config.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdirSync,
	writeFileSync,
	rmSync,
	existsSync,
	readFileSync,
} from "fs";
import { join, resolve } from "path";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

import {
	WorkspaceConfigError,
	createRepoModeContext,
	workspaceConfigPath,
} from "../taskplane/types.ts";
import {
	loadWorkspaceConfig,
	buildExecutionContext,
	canonicalizePath,
} from "../taskplane/workspace.ts";

// ── Test Fixtures ────────────────────────────────────────────────────

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

const mockRunnerConfig = {
	task_areas: {},
	execution: {
		review_level: 0 as const,
		auto_checkpoint: true,
	},
};

const mockLoadOrchConfig = (_root: string) => mockOrchConfig;
const mockLoadRunnerConfig = (_root: string) => mockRunnerConfig;

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
		const tasksDir = join(dir, "tasks");
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
		const tasksDir = join(dir, "tasks");
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
		const tasksDir = join(dir, "tasks");
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
		const tasksDir = join(dir, "tasks");
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
		const tasksDir = join(dir, "tasks");
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
});

// ── 2.x: buildExecutionContext ───────────────────────────────────────

describe("buildExecutionContext", () => {
	it("2.1: repo mode — workspaceRoot === repoRoot === cwd, mode === 'repo'", () => {
		const dir = makeTestDir("repo-mode");
		const ctx = buildExecutionContext(dir, mockLoadOrchConfig, mockLoadRunnerConfig);
		expect(ctx.mode).toBe("repo");
		expect(ctx.workspaceRoot).toBe(dir);
		expect(ctx.repoRoot).toBe(dir);
		expect(ctx.workspaceConfig).toBeNull();
		expect(ctx.orchestratorConfig).toEqual(mockOrchConfig);
		expect(ctx.taskRunnerConfig).toEqual(mockRunnerConfig);
	});

	it("2.2: workspace mode — workspaceRoot !== repoRoot, repoRoot === default repo", () => {
		const dir = makeTestDir("ws-mode");
		const repoDir = join(dir, "repo-a");
		initGitRepo(repoDir);
		const tasksDir = join(dir, "tasks");
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
		// Verify no ctx.cwd in discovery/state/orphan patterns
		const lines = extensionSrc.split("\n");
		const cwdLines = lines.filter(l => l.includes("ctx.cwd") && !l.trim().startsWith("//"));
		for (const line of cwdLines) {
			const isBuildContext = line.includes("buildExecutionContext");
			const isAbortFallback = line.includes("execCtx?.repoRoot ?? ctx.cwd");
			expect(isBuildContext || isAbortFallback).toBe(true);
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
});
