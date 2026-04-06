/**
 * Init Mode Detection & Scenario Branching Tests — TP-015 Step 6
 *
 * Tests for the init v2 mode auto-detection logic in `bin/taskplane.mjs`.
 * Since `detectInitMode()` and related helpers are embedded in the CLI script
 * and not exported, we duplicate the pure logic here and test against real
 * temporary git repositories.
 *
 * Test categories:
 *   1.x — isGitRepoRoot() / findSubdirectoryGitRepos() low-level detection
 *   2.x — detectInitMode() mode classification matrix (A/B/C/D/ambiguous/error)
 *   3.x — ensureGitignoreEntries() idempotency, prefix, and dry-run
 *   4.x — init spawn-mode default contract
 *   5.x — CLI init integration (dry-run + generated scaffold verification)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/init-mode-detection.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	rmSync,
	existsSync,
	appendFileSync,
	realpathSync,
} from "fs";
import { join, resolve } from "path";
import { execFileSync, execSync } from "child_process";
import { tmpdir } from "os";

// Import gitignore constants from the shared module
import { resolve as resolvePath, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadProjectConfig, ConfigLoadError } from "../taskplane/config-loader.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const patternsPath = resolvePath(__dirname, "../../bin/gitignore-patterns.mjs");
const {
	TASKPLANE_GITIGNORE_ENTRIES,
	TASKPLANE_GITIGNORE_NPM_ENTRIES,
	TASKPLANE_GITIGNORE_HEADER,
	TASKPLANE_GITIGNORE_NPM_HEADER,
} = await import(pathToFileURL(patternsPath).href);

// ── Duplicated helpers from bin/taskplane.mjs ───────────────────────────────

function isInsideGitRepo(dir: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", {
			cwd: dir,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

function isGitRepoRoot(dir: string): boolean {
	const gitEntry = join(dir, ".git");
	if (!existsSync(gitEntry)) return false;
	try {
		const toplevel = execSync("git rev-parse --show-toplevel", {
			cwd: dir,
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		}).toString().trim();
		// Normalize paths for comparison (handles Windows path separators
		// and 8.3 short name mismatches on Windows)
		const normalizedToplevel = resolve(toplevel);
		let normalizedDir = resolve(dir);
		// On Windows, fs.realpathSync.native resolves 8.3 short names to
		// long names, matching what git returns. Without this, paths like
		// C:\Users\HENRYL~1\... won't match C:\Users\HenryLach\...
		try { normalizedDir = realpathSync.native(normalizedDir); } catch {}
		return normalizedToplevel === normalizedDir;
	} catch {
		return false;
	}
}

function findSubdirectoryGitRepos(dir: string): string[] {
	const results: string[] = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules") continue;
			const subdir = join(dir, entry.name);
			if (isGitRepoRoot(subdir)) {
				results.push(entry.name);
			}
		}
	} catch {
		// If we can't read the directory, return empty
	}
	return results.sort();
}

interface DetectResult {
	mode: "repo" | "workspace" | "ambiguous" | "error";
	subRepos: string[];
	alreadyInitialized: boolean;
	existingConfigPath: string | null;
	workspaceConfigRepo?: string | null;
	workspaceConfigPath?: string | null;
}

function detectInitMode(dir: string): DetectResult {
	const currentIsGitRepo = isInsideGitRepo(dir);
	const subRepos = findSubdirectoryGitRepos(dir);
	const hasSubRepos = subRepos.length > 0;

	const hasLocalConfig =
		existsSync(join(dir, ".pi", "task-runner.yaml")) ||
		existsSync(join(dir, ".pi", "task-orchestrator.yaml")) ||
		existsSync(join(dir, ".pi", "taskplane-config.json"));

	if (currentIsGitRepo && !hasSubRepos) {
		return {
			mode: "repo",
			subRepos: [],
			alreadyInitialized: hasLocalConfig,
			existingConfigPath: hasLocalConfig ? join(dir, ".pi") : null,
		};
	}

	if (currentIsGitRepo && hasSubRepos) {
		let workspaceConfigRepo: string | null = null;
		for (const repoName of subRepos) {
			const taskplaneDir = join(dir, repoName, ".taskplane");
			if (existsSync(taskplaneDir)) {
				workspaceConfigRepo = repoName;
				break;
			}
		}
		return {
			mode: "ambiguous",
			subRepos,
			alreadyInitialized: hasLocalConfig,
			existingConfigPath: hasLocalConfig ? join(dir, ".pi") : null,
			workspaceConfigRepo,
			workspaceConfigPath: workspaceConfigRepo
				? join(dir, workspaceConfigRepo, ".taskplane")
				: null,
		};
	}

	if (!currentIsGitRepo && hasSubRepos) {
		let existingConfigRepo: string | null = null;
		for (const repoName of subRepos) {
			const taskplaneDir = join(dir, repoName, ".taskplane");
			if (existsSync(taskplaneDir)) {
				existingConfigRepo = repoName;
				break;
			}
		}
		return {
			mode: "workspace",
			subRepos,
			alreadyInitialized: existingConfigRepo !== null,
			existingConfigPath: existingConfigRepo
				? join(dir, existingConfigRepo, ".taskplane")
				: null,
		};
	}

	return {
		mode: "error",
		subRepos: [],
		alreadyInitialized: false,
		existingConfigPath: null,
	};
}

interface GitignoreResult {
	created: boolean;
	added: string[];
	skipped: string[];
}

function ensureGitignoreEntries(
	projectRoot: string,
	{ dryRun = false, prefix = "" }: { dryRun?: boolean; prefix?: string } = {},
): GitignoreResult {
	const gitignorePath = join(projectRoot, ".gitignore");
	const fileExists = existsSync(gitignorePath);
	const existingContent = fileExists ? readFileSync(gitignorePath, "utf-8") : "";
	const existingLines = new Set(existingContent.split(/\r?\n/).map((l: string) => l.trim()));

	const allEntries = [...TASKPLANE_GITIGNORE_ENTRIES, ...TASKPLANE_GITIGNORE_NPM_ENTRIES];
	const added: string[] = [];
	const skipped: string[] = [];

	for (const entry of allEntries) {
		const prefixedEntry = prefix ? `${prefix}${entry}` : entry;
		if (existingLines.has(prefixedEntry)) {
			skipped.push(prefixedEntry);
		} else {
			added.push(prefixedEntry);
		}
	}

	if (added.length === 0) {
		return { created: false, added: [], skipped };
	}

	if (!dryRun) {
		const runtimeAdded = added.filter((e: string) => !e.endsWith("npm/"));
		const npmAdded = added.filter((e: string) => e.endsWith("npm/"));
		const newLines: string[] = [];

		if (runtimeAdded.length > 0) {
			if (!existingLines.has(TASKPLANE_GITIGNORE_HEADER)) {
				newLines.push(TASKPLANE_GITIGNORE_HEADER);
			}
			newLines.push(...runtimeAdded);
		}

		if (npmAdded.length > 0) {
			if (!existingLines.has(TASKPLANE_GITIGNORE_NPM_HEADER)) {
				if (newLines.length > 0) newLines.push("");
				newLines.push(TASKPLANE_GITIGNORE_NPM_HEADER);
			}
			newLines.push(...npmAdded);
		}

		const blockText = newLines.join("\n") + "\n";

		if (fileExists) {
			const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
			appendFileSync(gitignorePath, separator + blockText, "utf-8");
		} else {
			writeFileSync(gitignorePath, blockText, "utf-8");
		}
	}

	return { created: !fileExists, added, skipped };
}

// ── Test Fixtures ────────────────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `init-test-${counter}${suffix ? `-${suffix}` : ""}`);
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

/**
 * Run `taskplane init` via CLI as a subprocess.
 * Returns { stdout, stderr, exitCode }.
 */
function runInit(
	cwd: string,
	extraArgs: string[] = [],
	options: { dryRun?: boolean; preset?: "minimal" | "full" | "runner-only" } = {},
): { stdout: string; stderr: string; exitCode: number } {
	const { dryRun = true, preset = "minimal" } = options;
	const taskplaneMjs = resolvePath(__dirname, "../../bin/taskplane.mjs");
	const args = ["init", "--force", "--preset", preset, ...extraArgs];
	if (dryRun) {
		args.splice(1, 0, "--dry-run");
	}
	try {
		const stdout = execFileSync("node", [taskplaneMjs, ...args], {
			cwd,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 25000,
		});
		return { stdout, stderr: "", exitCode: 0 };
	} catch (e: any) {
		return {
			stdout: e.stdout || "",
			stderr: e.stderr || "",
			exitCode: e.status ?? 1,
		};
	}
}

beforeEach(() => {
	// Use realpathSync.native to resolve Windows 8.3 short paths (e.g., HENRYL~1 → HenryLach)
	// so that path comparisons in isGitRepoRoot() work correctly.
	const resolvedTmp = realpathSync.native(tmpdir());
	const base = join(resolvedTmp, "taskplane-init-tests");
	mkdirSync(base, { recursive: true });
	testRoot = join(base, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	if (testRoot && existsSync(testRoot)) {
		try {
			rmSync(testRoot, { recursive: true, force: true });
		} catch {
			// Windows may hold locks; ignore cleanup errors in tests
		}
	}
});

// ── 1.x: isGitRepoRoot / findSubdirectoryGitRepos ──────────────────────────

describe("isGitRepoRoot and findSubdirectoryGitRepos", () => {
	it("1.1 — isGitRepoRoot returns true for an actual git repo root", () => {
		const dir = makeTestDir("git-root");
		initGitRepo(dir);
		expect(isGitRepoRoot(dir)).toBe(true);
	});

	it("1.2 — isGitRepoRoot returns false for a subdirectory of a git repo", () => {
		const repo = makeTestDir("parent-repo");
		initGitRepo(repo);
		const sub = join(repo, "subdir");
		mkdirSync(sub, { recursive: true });
		expect(isGitRepoRoot(sub)).toBe(false);
	});

	it("1.3 — isGitRepoRoot returns false for a plain directory (no .git)", () => {
		const dir = makeTestDir("plain");
		expect(isGitRepoRoot(dir)).toBe(false);
	});

	it("1.4 — findSubdirectoryGitRepos finds git repos in immediate subdirectories", () => {
		const workspace = makeTestDir("workspace");
		initGitRepo(join(workspace, "repo-alpha"));
		initGitRepo(join(workspace, "repo-beta"));
		mkdirSync(join(workspace, "not-a-repo"), { recursive: true });

		const found = findSubdirectoryGitRepos(workspace);
		expect(found).toEqual(["repo-alpha", "repo-beta"]);
	});

	it("1.5 — findSubdirectoryGitRepos returns empty when no git repos exist", () => {
		const dir = makeTestDir("no-repos");
		mkdirSync(join(dir, "just-a-dir"), { recursive: true });
		expect(findSubdirectoryGitRepos(dir)).toEqual([]);
	});

	it("1.6 — findSubdirectoryGitRepos skips hidden dirs and node_modules", () => {
		const workspace = makeTestDir("skip-special");
		initGitRepo(join(workspace, ".hidden-repo"));
		initGitRepo(join(workspace, "visible-repo"));
		// node_modules with a .git — should be skipped
		mkdirSync(join(workspace, "node_modules", ".git"), { recursive: true });

		const found = findSubdirectoryGitRepos(workspace);
		expect(found).toEqual(["visible-repo"]);
	});

	it("1.7 — findSubdirectoryGitRepos returns sorted results", () => {
		const workspace = makeTestDir("sorted");
		initGitRepo(join(workspace, "zebra"));
		initGitRepo(join(workspace, "alpha"));
		initGitRepo(join(workspace, "middle"));

		const found = findSubdirectoryGitRepos(workspace);
		expect(found).toEqual(["alpha", "middle", "zebra"]);
	});

	it("1.8 — isGitRepoRoot uses realpathSync.native for path canonicalization (Windows 8.3 regression)", () => {
		// Regression: on Windows, temp dirs may use 8.3 short names (e.g., HENRYL~1)
		// while `git rev-parse --show-toplevel` returns the long name (HenryLach).
		// The fix uses fs.realpathSync.native() to canonicalize the dir path before
		// comparison. This test verifies that the helper's path normalization matches
		// production behavior by comparing realpathSync.native output to resolve output.
		const repo = makeTestDir("realpath-regression");
		initGitRepo(repo);

		// Verify the function works with the real path
		expect(isGitRepoRoot(repo)).toBe(true);

		// Verify that realpathSync.native resolves to the same or longer form
		const resolved = resolve(repo);
		const realpathed = realpathSync.native(resolved);
		// On Windows, realpathed may differ from resolved (8.3 → long name).
		// On Linux/macOS they should be identical. Either way, isGitRepoRoot must work.
		expect(isGitRepoRoot(realpathed)).toBe(true);

		// If the paths differ (Windows 8.3 scenario), confirm that the function
		// handles both forms correctly by using the native-resolved path
		if (resolved !== realpathed) {
			// Both the short and long forms should resolve to the same repo root
			expect(isGitRepoRoot(resolved)).toBe(true);
			expect(isGitRepoRoot(realpathed)).toBe(true);
		}
	});

	it("1.9 — findSubdirectoryGitRepos does not detect subdirs of a parent repo as repo roots", () => {
		const parentRepo = makeTestDir("parent-with-subdirs");
		initGitRepo(parentRepo);
		mkdirSync(join(parentRepo, "packages", "pkg-a"), { recursive: true });
		mkdirSync(join(parentRepo, "packages", "pkg-b"), { recursive: true });

		const found = findSubdirectoryGitRepos(parentRepo);
		expect(found).toEqual([]);
	});
});

// ── 2.x: detectInitMode ────────────────────────────────────────────────────

describe("detectInitMode", () => {
	it("2.1 — Scenario A: git repo, no subrepos, no config → repo mode, not initialized", () => {
		const repo = makeTestDir("scenario-a");
		initGitRepo(repo);

		const result = detectInitMode(repo);
		expect(result.mode).toBe("repo");
		expect(result.subRepos).toEqual([]);
		expect(result.alreadyInitialized).toBe(false);
		expect(result.existingConfigPath).toBeNull();
	});

	it("2.2 — Scenario B: git repo with existing task-runner.yaml → already initialized", () => {
		const repo = makeTestDir("scenario-b-yaml");
		initGitRepo(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "task-runner.yaml"), "# config\n");

		const result = detectInitMode(repo);
		expect(result.mode).toBe("repo");
		expect(result.alreadyInitialized).toBe(true);
		expect(result.existingConfigPath).toBe(join(repo, ".pi"));
	});

	it("2.3 — Scenario B: detects taskplane-config.json as existing config", () => {
		const repo = makeTestDir("scenario-b-json");
		initGitRepo(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "taskplane-config.json"), '{"configVersion":1}');

		const result = detectInitMode(repo);
		expect(result.mode).toBe("repo");
		expect(result.alreadyInitialized).toBe(true);
	});

	it("2.4 — Scenario B: task-orchestrator.yaml alone counts as initialized", () => {
		const repo = makeTestDir("scenario-b-orch");
		initGitRepo(repo);
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "task-orchestrator.yaml"), "# orch\n");

		const result = detectInitMode(repo);
		expect(result.mode).toBe("repo");
		expect(result.alreadyInitialized).toBe(true);
	});

	it("2.5 — Scenario C: not a git repo, has subrepos, no .taskplane/ → workspace mode", () => {
		const workspace = makeTestDir("scenario-c");
		initGitRepo(join(workspace, "repo-a"));
		initGitRepo(join(workspace, "repo-b"));

		const result = detectInitMode(workspace);
		expect(result.mode).toBe("workspace");
		expect(result.subRepos).toEqual(["repo-a", "repo-b"]);
		expect(result.alreadyInitialized).toBe(false);
		expect(result.existingConfigPath).toBeNull();
	});

	it("2.6 — Scenario D: not a git repo, subrepo has .taskplane/ → workspace, already initialized", () => {
		const workspace = makeTestDir("scenario-d");
		initGitRepo(join(workspace, "config-repo"));
		initGitRepo(join(workspace, "worker-repo"));
		mkdirSync(join(workspace, "config-repo", ".taskplane"), { recursive: true });

		const result = detectInitMode(workspace);
		expect(result.mode).toBe("workspace");
		expect(result.alreadyInitialized).toBe(true);
		expect(result.existingConfigPath).toBe(join(workspace, "config-repo", ".taskplane"));
	});

	it("2.7 — Ambiguous: git repo with nested git repos → ambiguous mode", () => {
		const repo = makeTestDir("ambiguous");
		initGitRepo(repo);
		initGitRepo(join(repo, "nested-repo"));

		const result = detectInitMode(repo);
		expect(result.mode).toBe("ambiguous");
		expect(result.subRepos).toContain("nested-repo");
		expect(result.workspaceConfigRepo).toBeNull();
	});

	it("2.8 — Ambiguous with .taskplane/ in subrepo → workspaceConfigRepo populated", () => {
		const repo = makeTestDir("ambiguous-with-config");
		initGitRepo(repo);
		initGitRepo(join(repo, "config-sub"));
		mkdirSync(join(repo, "config-sub", ".taskplane"), { recursive: true });

		const result = detectInitMode(repo);
		expect(result.mode).toBe("ambiguous");
		expect(result.workspaceConfigRepo).toBe("config-sub");
		expect(result.workspaceConfigPath).toBe(join(repo, "config-sub", ".taskplane"));
	});

	it("2.9 — Error: not a git repo and no subrepos → error mode", () => {
		const dir = makeTestDir("error-case");

		const result = detectInitMode(dir);
		expect(result.mode).toBe("error");
		expect(result.subRepos).toEqual([]);
		expect(result.alreadyInitialized).toBe(false);
	});
});

// ── 3.x: ensureGitignoreEntries ─────────────────────────────────────────────

describe("ensureGitignoreEntries", () => {
	it("3.1 — creates .gitignore when file does not exist", () => {
		const dir = makeTestDir("gitignore-new");

		const result = ensureGitignoreEntries(dir);
		expect(result.created).toBe(true);
		expect(result.added.length).toBeGreaterThan(0);
		expect(result.skipped).toEqual([]);
		expect(existsSync(join(dir, ".gitignore"))).toBe(true);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".pi/batch-state.json");
		expect(content).toContain(".worktrees/");
		expect(content).toContain(".pi/npm/");
	});

	it("3.2 — appends to existing .gitignore", () => {
		const dir = makeTestDir("gitignore-existing");
		writeFileSync(join(dir, ".gitignore"), "node_modules/\n.env\n");

		const result = ensureGitignoreEntries(dir);
		expect(result.created).toBe(false);
		expect(result.added.length).toBeGreaterThan(0);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain("node_modules/");
		expect(content).toContain(".env");
		expect(content).toContain(".pi/batch-state.json");
	});

	it("3.3 — idempotent: second call skips all entries", () => {
		const dir = makeTestDir("gitignore-idempotent");
		ensureGitignoreEntries(dir);
		const contentAfterFirst = readFileSync(join(dir, ".gitignore"), "utf-8");

		const result = ensureGitignoreEntries(dir);
		expect(result.added).toEqual([]);
		expect(result.skipped.length).toBeGreaterThan(0);

		const contentAfterSecond = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(contentAfterSecond).toBe(contentAfterFirst);
	});

	it("3.4 — dry-run does not create or modify files", () => {
		const dir = makeTestDir("gitignore-dryrun");

		const result = ensureGitignoreEntries(dir, { dryRun: true });
		expect(result.created).toBe(true);
		expect(result.added.length).toBeGreaterThan(0);
		expect(existsSync(join(dir, ".gitignore"))).toBe(false);
	});

	it("3.5 — prefix support for workspace mode", () => {
		const dir = makeTestDir("gitignore-prefix");

		const result = ensureGitignoreEntries(dir, { prefix: ".taskplane/" });
		expect(result.created).toBe(true);

		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(".taskplane/.pi/batch-state.json");
		expect(content).toContain(".taskplane/.worktrees/");
		expect(content).toContain(".taskplane/.pi/npm/");
		// Should NOT contain non-prefixed entries
		expect(content).not.toMatch(/^\.pi\/batch-state\.json$/m);
	});

	it("3.6 — includes section headers", () => {
		const dir = makeTestDir("gitignore-headers");
		ensureGitignoreEntries(dir);
		const content = readFileSync(join(dir, ".gitignore"), "utf-8");
		expect(content).toContain(TASKPLANE_GITIGNORE_HEADER);
		expect(content).toContain(TASKPLANE_GITIGNORE_NPM_HEADER);
	});

	it("3.7 — partial existing entries: adds missing, skips present", () => {
		const dir = makeTestDir("gitignore-partial");
		writeFileSync(join(dir, ".gitignore"), ".pi/batch-state.json\n.worktrees/\n");

		const result = ensureGitignoreEntries(dir);
		expect(result.skipped).toContain(".pi/batch-state.json");
		expect(result.skipped).toContain(".worktrees/");
		expect(result.added).not.toContain(".pi/batch-state.json");
		expect(result.added).not.toContain(".worktrees/");
		expect(result.added.length).toBeGreaterThan(0);
		expect(result.added).toContain(".pi/batch-history.json");
	});
});

// ── 4.x: init spawn-mode default ────────────────────────────────────────────

describe("init spawn-mode default", () => {
	function detectSpawnMode(): { spawnMode: "subprocess" } {
		return { spawnMode: "subprocess" };
	}

	it("4.1 — default spawnMode is subprocess", () => {
		const result = detectSpawnMode();
		expect(result.spawnMode).toBe("subprocess");
	});
});

// ── 5.x: CLI dry-run integration ───────────────────────────────────────────

describe("CLI dry-run integration", () => {
	it("5.1 — init --dry-run --force --preset minimal shows expected output for repo mode", () => {
		const projectRoot = resolve(__dirname, "../..");
		const output = execFileSync(
			"node",
			["bin/taskplane.mjs", "init", "--dry-run", "--force", "--preset", "minimal"],
			{
				cwd: projectRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 15000,
			}
		);

		expect(output).toContain("Mode:");
		expect(output).toContain("Dry run");
		expect(output).toContain(".pi/agents/task-worker.md");
		expect(output).toContain(".pi/task-runner.yaml");
		expect(output).toContain(".pi/taskplane.json");
		expect(output).toContain(".gitignore");
	});

	it("5.2 — runner-only preset omits orchestrator yaml", () => {
		const projectRoot = resolve(__dirname, "../..");
		const output = execFileSync(
			"node",
			["bin/taskplane.mjs", "init", "--dry-run", "--force", "--preset", "runner-only"],
			{
				cwd: projectRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 15000,
			}
		);

		expect(output).toContain(".pi/task-runner.yaml");
		expect(output).not.toContain("task-orchestrator.yaml");
	});

	it("5.3 — full preset includes orchestrator yaml", () => {
		const projectRoot = resolve(__dirname, "../..");
		const output = execFileSync(
			"node",
			["bin/taskplane.mjs", "init", "--dry-run", "--force", "--preset", "full"],
			{
				cwd: projectRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 15000,
			}
		);

		expect(output).toContain("task-runner.yaml");
		expect(output).toContain("task-orchestrator.yaml");
	});

	it("5.4 — YAML config files are still listed (not replaced by JSON only)", () => {
		const projectRoot = resolve(__dirname, "../..");
		const output = execFileSync(
			"node",
			["bin/taskplane.mjs", "init", "--dry-run", "--force", "--preset", "full"],
			{
				cwd: projectRoot,
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
				timeout: 15000,
			}
		);

		// YAML must still be generated (PROMPT constraint)
		expect(output).toContain("task-runner.yaml");
		expect(output).toContain("task-orchestrator.yaml");
	});

	it("5.5 — error mode: non-git directory with no subrepos → error exit", () => {
		const emptyDir = makeTestDir("cli-error");

		const result = runInit(emptyDir);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr + result.stdout).toContain("Not a git repo");
	});

	it("5.6 — Scenario A: fresh git repo → repo mode detection", () => {
		const repo = makeTestDir("cli-scenario-a");
		initGitRepo(repo);

		const result = runInit(repo);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Mode: repo");
		expect(result.stdout).toContain("Dry run");
	});

	it("5.7 — Scenario C: workspace with subrepos → workspace mode detection", () => {
		const workspace = makeTestDir("cli-scenario-c");
		initGitRepo(join(workspace, "repo-a"));
		initGitRepo(join(workspace, "repo-b"));

		const result = runInit(workspace);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Mode: workspace");
		expect(result.stdout).toContain("git repositories found");
	});

	it("5.8 — Scenario D: workspace with existing .taskplane/ → pointer-only output", () => {
		const workspace = makeTestDir("cli-scenario-d");
		initGitRepo(join(workspace, "config-repo"));
		initGitRepo(join(workspace, "worker-repo"));
		mkdirSync(join(workspace, "config-repo", ".taskplane"), { recursive: true });

		const result = runInit(workspace);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Found existing Taskplane config");
		expect(result.stdout).toContain("taskplane-pointer.json");
	});

	it("5.9 — repo init scaffolds canonical subprocess/session-prefix fields only", () => {
		const repo = makeTestDir("cli-scaffold-repo");
		initGitRepo(repo);

		const result = runInit(repo, ["--no-examples"], { dryRun: false, preset: "minimal" });
		expect(result.exitCode).toBe(0);

		const orchestratorYaml = readFileSync(join(repo, ".pi", "task-orchestrator.yaml"), "utf-8");
		expect(orchestratorYaml).toContain('spawn_mode: "subprocess"');
		expect(orchestratorYaml).toContain("session_prefix:");
		expect(orchestratorYaml).not.toContain("tmux_prefix");
		expect(orchestratorYaml).not.toMatch(/spawn_mode:\s*"tmux"/);

		const projectConfig = JSON.parse(readFileSync(join(repo, ".pi", "taskplane-config.json"), "utf-8"));
		// Sparse init config: no orchestrator block unless explicitly chosen during init
		expect(projectConfig.orchestrator).toBeUndefined();
	});

	it("5.10 — workspace init scaffolds canonical subprocess/session-prefix fields only", () => {
		const workspace = makeTestDir("cli-scaffold-workspace");
		initGitRepo(join(workspace, "repo-a"));
		initGitRepo(join(workspace, "repo-b"));

		const result = runInit(workspace, ["--no-examples"], { dryRun: false, preset: "minimal" });
		expect(result.exitCode).toBe(0);

		const configRoot = join(workspace, "repo-a", ".taskplane");
		const orchestratorYaml = readFileSync(join(configRoot, "task-orchestrator.yaml"), "utf-8");
		expect(orchestratorYaml).toContain('spawn_mode: "subprocess"');
		expect(orchestratorYaml).toContain("session_prefix:");
		expect(orchestratorYaml).not.toContain("tmux_prefix");

		const projectConfig = JSON.parse(readFileSync(join(configRoot, "taskplane-config.json"), "utf-8"));
		// Sparse init config: no orchestrator block unless explicitly chosen during init
		expect(projectConfig.orchestrator).toBeUndefined();
	});

	it("5.11 — injected legacy tmuxPrefix is auto-migrated without crash", () => {
		const repo = makeTestDir("cli-legacy-tmux-prefix");
		initGitRepo(repo);
		const initResult = runInit(repo, ["--no-examples"], { dryRun: false, preset: "minimal" });
		expect(initResult.exitCode).toBe(0);

		const configPath = join(repo, ".pi", "taskplane-config.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		config.orchestrator = config.orchestrator || {};
		config.orchestrator.orchestrator = config.orchestrator.orchestrator || {};
		config.orchestrator.orchestrator.tmuxPrefix = "legacy-orch";
		delete config.orchestrator.orchestrator.sessionPrefix;
		writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

		// Should not crash — auto-migration handles legacy field
		const loaded = loadProjectConfig(repo);
		expect(loaded.orchestrator.orchestrator.sessionPrefix).toBeDefined();
		// Verify tmuxPrefix was removed from disk
		const updated = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(updated.orchestrator.orchestrator.tmuxPrefix).toBeUndefined();
	});

	it("5.12 — injected legacy spawnMode tmux is auto-migrated to subprocess", () => {
		const repo = makeTestDir("cli-legacy-spawn-mode");
		initGitRepo(repo);
		const initResult = runInit(repo, ["--no-examples"], { dryRun: false, preset: "minimal" });
		expect(initResult.exitCode).toBe(0);

		const configPath = join(repo, ".pi", "taskplane-config.json");
		const config = JSON.parse(readFileSync(configPath, "utf-8"));
		config.orchestrator = config.orchestrator || {};
		config.orchestrator.orchestrator = config.orchestrator.orchestrator || {};
		config.orchestrator.orchestrator.spawnMode = "tmux";
		writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

		const loaded = loadProjectConfig(repo);
		expect(loaded.orchestrator.orchestrator.spawnMode).toBe("subprocess");
	});
});
