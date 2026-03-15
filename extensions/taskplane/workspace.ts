/**
 * Workspace configuration loading and validation.
 *
 * Detects workspace mode by checking for `.pi/taskplane-workspace.yaml`.
 * When the file is absent, the orchestrator runs in repo mode (default).
 * When the file is present, it must be valid — invalid files are fatal.
 *
 * Validation order (deterministic, fail-fast):
 * 1. File existence check → absent = repo mode (return null)
 * 2. File read → WORKSPACE_FILE_READ_ERROR
 * 3. YAML parse → WORKSPACE_FILE_PARSE_ERROR
 * 4. Top-level schema → WORKSPACE_SCHEMA_INVALID
 * 5. repos map non-empty → WORKSPACE_MISSING_REPOS
 * 6. Per-repo validation (sorted key order):
 *    a. path present → WORKSPACE_REPO_PATH_MISSING
 *    b. path exists on disk → WORKSPACE_REPO_PATH_NOT_FOUND
 *    c. path is git repo → WORKSPACE_REPO_NOT_GIT
 * 7. Duplicate repo paths → WORKSPACE_DUPLICATE_REPO_PATH
 * 8. routing.tasks_root present → WORKSPACE_MISSING_TASKS_ROOT
 * 9. routing.tasks_root exists → WORKSPACE_TASKS_ROOT_NOT_FOUND
 * 10. routing.default_repo present → WORKSPACE_MISSING_DEFAULT_REPO
 * 11. routing.default_repo valid → WORKSPACE_DEFAULT_REPO_NOT_FOUND
 *
 * Path normalization rules:
 * - Relative paths are resolved against workspaceRoot.
 * - Existing paths are canonicalized via `fs.realpathSync.native()` to
 *   expand Windows 8.3 short names and resolve symlinks.
 * - All paths are forward-slash normalized and lowercased for comparison.
 * - This matches the precedent in `worktree.ts:normalizePath()`.
 *
 * Git repo validation:
 * - Uses `git rev-parse --git-dir` run inside the repo path.
 * - The path must be the repo root (not a subdirectory).
 *   We verify by checking that `git rev-parse --show-toplevel` matches
 *   the canonicalized path.
 *
 * @module orch/workspace
 */
import { readFileSync, existsSync, realpathSync } from "fs";
import { resolve } from "path";
import { parse as yamlParse } from "yaml";

import { runGit } from "./git.ts";
import {
	WorkspaceConfigError,
	workspaceConfigPath,
	type WorkspaceConfig,
	type WorkspaceRepoConfig,
	type WorkspaceRoutingConfig,
} from "./types.ts";


// ── Path Canonicalization ────────────────────────────────────────────

/**
 * Canonicalize a filesystem path for comparison and storage.
 *
 * Reuses the normalization pattern from `worktree.ts:normalizePath()`:
 * - `realpathSync.native()` expands Windows 8.3 short names when the path exists.
 * - Falls back to `resolve()` for non-existent paths.
 * - Forward-slash normalized and lowercased for platform-safe comparison.
 *
 * @param p - Path to canonicalize (absolute or relative)
 * @param base - Base directory for resolving relative paths
 * @returns Canonical absolute path (forward-slash, lowercased)
 */
export function canonicalizePath(p: string, base: string): string {
	const resolved = resolve(base, p);
	let expanded: string;
	try {
		expanded = realpathSync.native(resolved);
	} catch {
		// Path doesn't exist yet — fall back to resolve()
		expanded = resolved;
	}
	return expanded.replace(/\\/g, "/").toLowerCase();
}

/**
 * Canonicalize a path for storage (absolute, native separators, resolved symlinks).
 * Unlike canonicalizePath(), this preserves original case for display/config output.
 *
 * @param p - Path to resolve (absolute or relative)
 * @param base - Base directory for resolving relative paths
 * @returns Absolute resolved path (native separators preserved)
 */
function resolveAbsolutePath(p: string, base: string): string {
	const resolved = resolve(base, p);
	try {
		return realpathSync.native(resolved);
	} catch {
		return resolved;
	}
}


// ── Workspace Config Loading ─────────────────────────────────────────

/**
 * Load and validate workspace configuration from `.pi/taskplane-workspace.yaml`.
 *
 * Mode determination rules:
 * 1. No config file → return null (repo mode, non-fatal, silent).
 * 2. Config file present + invalid → throw WorkspaceConfigError (fatal).
 * 3. Config file present + valid → return WorkspaceConfig (workspace mode).
 *
 * @param workspaceRoot - Absolute path to the workspace root directory
 * @returns WorkspaceConfig if workspace mode, null if repo mode
 * @throws WorkspaceConfigError when config file is present but invalid
 */
export function loadWorkspaceConfig(workspaceRoot: string): WorkspaceConfig | null {
	const configFile = workspaceConfigPath(workspaceRoot);

	// ── 1. File existence check ──────────────────────────────────
	if (!existsSync(configFile)) {
		return null;
	}

	// ── 2. File read ─────────────────────────────────────────────
	let rawContent: string;
	try {
		rawContent = readFileSync(configFile, "utf-8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new WorkspaceConfigError(
			"WORKSPACE_FILE_READ_ERROR",
			`Cannot read workspace config file: ${msg}`,
			undefined,
			configFile,
		);
	}

	// ── 3. YAML parse ────────────────────────────────────────────
	let parsed: unknown;
	try {
		parsed = yamlParse(rawContent);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new WorkspaceConfigError(
			"WORKSPACE_FILE_PARSE_ERROR",
			`Invalid YAML in workspace config: ${msg}`,
			undefined,
			configFile,
		);
	}

	// ── 4. Top-level schema validation ───────────────────────────
	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			"Workspace config must be a YAML mapping (object), not a scalar or sequence.",
			undefined,
			configFile,
		);
	}
	const doc = parsed as Record<string, unknown>;

	if (!doc.repos || typeof doc.repos !== "object" || Array.isArray(doc.repos)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			"Workspace config must contain a 'repos' mapping.",
			undefined,
			configFile,
		);
	}
	if (!doc.routing || typeof doc.routing !== "object" || Array.isArray(doc.routing)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			"Workspace config must contain a 'routing' mapping.",
			undefined,
			configFile,
		);
	}

	// ── 5. Repos map non-empty ───────────────────────────────────
	const rawRepos = doc.repos as Record<string, unknown>;
	const repoKeys = Object.keys(rawRepos).sort(); // deterministic order
	if (repoKeys.length === 0) {
		throw new WorkspaceConfigError(
			"WORKSPACE_MISSING_REPOS",
			"Workspace config must define at least one repo under 'repos'.",
			undefined,
			configFile,
		);
	}

	// ── 6. Per-repo validation ───────────────────────────────────
	const repos = new Map<string, WorkspaceRepoConfig>();
	const normalizedPaths = new Map<string, string>(); // normalized → repoId (for duplicate detection)

	for (const repoId of repoKeys) {
		const rawRepo = rawRepos[repoId];
		if (rawRepo == null || typeof rawRepo !== "object" || Array.isArray(rawRepo)) {
			throw new WorkspaceConfigError(
				"WORKSPACE_SCHEMA_INVALID",
				`Repo '${repoId}' must be a YAML mapping with at least a 'path' field.`,
				repoId,
				configFile,
			);
		}
		const repoEntry = rawRepo as Record<string, unknown>;

		// 6a. path present and non-empty
		const rawPath = repoEntry.path;
		if (!rawPath || typeof rawPath !== "string" || rawPath.trim() === "") {
			throw new WorkspaceConfigError(
				"WORKSPACE_REPO_PATH_MISSING",
				`Repo '${repoId}' is missing a 'path' field.`,
				repoId,
				configFile,
			);
		}

		// 6b. path exists on disk
		const absolutePath = resolveAbsolutePath(rawPath.trim(), workspaceRoot);
		const normalizedPath = canonicalizePath(rawPath.trim(), workspaceRoot);
		if (!existsSync(absolutePath)) {
			throw new WorkspaceConfigError(
				"WORKSPACE_REPO_PATH_NOT_FOUND",
				`Repo '${repoId}' path does not exist: ${absolutePath}`,
				repoId,
				absolutePath,
			);
		}

		// 6c. path is a git repo root
		const gitDirCheck = runGit(["rev-parse", "--git-dir"], absolutePath);
		if (!gitDirCheck.ok) {
			throw new WorkspaceConfigError(
				"WORKSPACE_REPO_NOT_GIT",
				`Repo '${repoId}' path is not a git repository: ${absolutePath}`,
				repoId,
				absolutePath,
			);
		}
		// Verify we're at the root, not a subdirectory
		const toplevelCheck = runGit(["rev-parse", "--show-toplevel"], absolutePath);
		if (toplevelCheck.ok) {
			const toplevelNormalized = canonicalizePath(toplevelCheck.stdout.trim(), "");
			if (toplevelNormalized !== normalizedPath) {
				throw new WorkspaceConfigError(
					"WORKSPACE_REPO_NOT_GIT",
					`Repo '${repoId}' path is a subdirectory of a git repo, not the repo root. Expected root: ${toplevelCheck.stdout.trim()}, got: ${absolutePath}`,
					repoId,
					absolutePath,
				);
			}
		}

		// 7. Collect for duplicate detection (checked after loop)
		if (normalizedPaths.has(normalizedPath)) {
			throw new WorkspaceConfigError(
				"WORKSPACE_DUPLICATE_REPO_PATH",
				`Repos '${normalizedPaths.get(normalizedPath)}' and '${repoId}' share the same path: ${absolutePath}`,
				repoId,
				absolutePath,
			);
		}
		normalizedPaths.set(normalizedPath, repoId);

		// Build repo config
		const defaultBranch = typeof repoEntry.default_branch === "string" && repoEntry.default_branch.trim()
			? repoEntry.default_branch.trim()
			: undefined;

		repos.set(repoId, {
			id: repoId,
			path: absolutePath,
			defaultBranch,
		});
	}

	// ── 8–11. Routing validation ─────────────────────────────────
	const rawRouting = doc.routing as Record<string, unknown>;

	// 8. routing.tasks_root present
	const rawTasksRoot = rawRouting.tasks_root;
	if (!rawTasksRoot || typeof rawTasksRoot !== "string" || rawTasksRoot.trim() === "") {
		throw new WorkspaceConfigError(
			"WORKSPACE_MISSING_TASKS_ROOT",
			"Workspace config 'routing.tasks_root' is missing or empty.",
			undefined,
			configFile,
		);
	}

	// 9. routing.tasks_root exists on disk
	const tasksRootAbsolute = resolveAbsolutePath(rawTasksRoot.trim(), workspaceRoot);
	if (!existsSync(tasksRootAbsolute)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_TASKS_ROOT_NOT_FOUND",
			`routing.tasks_root path does not exist: ${tasksRootAbsolute}`,
			undefined,
			tasksRootAbsolute,
		);
	}

	// 10. routing.default_repo present
	const rawDefaultRepo = rawRouting.default_repo;
	if (!rawDefaultRepo || typeof rawDefaultRepo !== "string" || rawDefaultRepo.trim() === "") {
		throw new WorkspaceConfigError(
			"WORKSPACE_MISSING_DEFAULT_REPO",
			"Workspace config 'routing.default_repo' is missing or empty.",
			undefined,
			configFile,
		);
	}

	// 11. routing.default_repo references a valid repo ID
	const defaultRepoId = rawDefaultRepo.trim();
	if (!repos.has(defaultRepoId)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_DEFAULT_REPO_NOT_FOUND",
			`routing.default_repo '${defaultRepoId}' does not match any repo ID. Available repos: ${Array.from(repos.keys()).join(", ")}`,
			undefined,
			configFile,
		);
	}

	// ── 12. routing.strict (optional boolean, default false) ─────
	const rawStrict = rawRouting.strict;
	if (rawStrict !== undefined) {
		// null (from bare `strict:` or `strict: null` in YAML) is rejected
		// to prevent fail-open: governance controls must be explicit.
		if (rawStrict === null || typeof rawStrict !== "boolean") {
			throw new WorkspaceConfigError(
				"WORKSPACE_SCHEMA_INVALID",
				`routing.strict must be a boolean (true/false)${rawStrict === null ? ", got null (use true or false explicitly)" : `, got ${typeof rawStrict}: ${JSON.stringify(rawStrict)}`}`,
				undefined,
				configFile,
			);
		}
	}
	const strict = rawStrict === true;

	// ── Build routing config ─────────────────────────────────────
	const routing: WorkspaceRoutingConfig = {
		tasksRoot: tasksRootAbsolute,
		defaultRepo: defaultRepoId,
		...(strict ? { strict: true } : {}),
	};

	// ── Build and return WorkspaceConfig ─────────────────────────
	return {
		mode: "workspace",
		repos,
		routing,
		configPath: configFile,
	};
}


// ── Execution Context Builder ────────────────────────────────────────

/**
 * Build an ExecutionContext from the current working directory.
 *
 * This is the top-level entry point for Step 2 (wire orchestrator startup).
 * It loads all configs, detects workspace mode, and returns a unified context.
 *
 * @param cwd - Current working directory
 * @param loadOrchConfig - Orchestrator config loader (for testability)
 * @param loadTaskConfig - Task runner config loader (for testability)
 * @returns ExecutionContext ready for orchestrator consumption
 * @throws WorkspaceConfigError if workspace config is present but invalid
 */
export function buildExecutionContext(
	cwd: string,
	loadOrchConfig: (root: string) => import("./types.ts").OrchestratorConfig,
	loadTaskConfig: (root: string) => import("./types.ts").TaskRunnerConfig,
): import("./types.ts").ExecutionContext {
	const orchestratorConfig = loadOrchConfig(cwd);
	const taskRunnerConfig = loadTaskConfig(cwd);

	const workspaceConfig = loadWorkspaceConfig(cwd);

	if (workspaceConfig === null) {
		// Repo mode: cwd is both workspace root and repo root
		return {
			workspaceRoot: cwd,
			repoRoot: cwd,
			mode: "repo",
			workspaceConfig: null,
			taskRunnerConfig,
			orchestratorConfig,
		};
	}

	// Workspace mode: workspace root is cwd, repo root is the default repo
	const defaultRepo = workspaceConfig.repos.get(workspaceConfig.routing.defaultRepo)!;
	return {
		workspaceRoot: cwd,
		repoRoot: defaultRepo.path,
		mode: "workspace",
		workspaceConfig,
		taskRunnerConfig,
		orchestratorConfig,
	};
}
