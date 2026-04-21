/**
 * Workspace configuration loading and validation.
 *
 * Detects workspace mode by checking for `.pi/taskplane-workspace.yaml`.
 * When the file is present, it must be valid — invalid files are fatal.
 * When absent, `loadWorkspaceConfig()` returns null and `buildExecutionContext()`
 * decides repo-mode eligibility (cwd must be a git repository).
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
 * 12. routing.task_packet_repo valid (or compat fallback) → WORKSPACE_TASK_PACKET_REPO_NOT_FOUND
 * 13. routing.tasks_root inside packet-home repo → WORKSPACE_TASKS_ROOT_OUTSIDE_PACKET_REPO
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
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, relative, resolve } from "path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import { listConfiguredSubmodulePaths, listGitlinkPaths, listSubmoduleStatus, runGit } from "./git.ts";
import { WORKSPACE_MESSAGES } from "./messages.ts";
import {
	type PreflightCheck,
	type PointerResolution,
	type SubmodulePolicy,
	type WorkspaceConfig,
	WorkspaceConfigError,
	type WorkspaceRepoConfig,
	type WorkspaceRepoImportCandidate,
	type WorkspaceRoutingConfig,
	type WorkspaceSyncApplyResult,
	type WorkspaceSyncBadgeStatus,
	type WorkspaceSyncFinding,
	type WorkspaceSyncSummary,
	pointerFilePath,
	workspaceConfigPath,
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

/**
 * True when `childPath` is the same path as `parentPath` or contained within it.
 * Uses canonicalized paths for cross-platform, case-insensitive comparison.
 */
function isPathWithinContainer(childPath: string, parentPath: string): boolean {
	const child = canonicalizePath(childPath, "");
	const parent = canonicalizePath(parentPath, "");
	return child === parent || child.startsWith(`${parent}/`);
}

function isCrossPlatformAbsolutePath(rawPath: string): boolean {
	const trimmed = rawPath.trim();
	const normalized = trimmed.replace(/\\/g, "/");
	return (
		isAbsolute(trimmed) ||
		isAbsolute(normalized) ||
		/^[A-Za-z]:\//.test(normalized)
	);
}


// ── Pointer Resolution ───────────────────────────────────────────────

/**
 * Resolve the workspace pointer file to find config and agent roots.
 *
 * The pointer file (`<workspace-root>/.pi/taskplane-pointer.json`) tells
 * Taskplane where to find project config and agent overrides in workspace
 * (polyrepo) mode. It's created by `taskplane init` and is local-only
 * (not committed to git).
 *
 * **Repo mode:** Returns null. The pointer is workspace-only — in repo
 * mode it is never read, even if a file happens to exist on disk.
 *
 * **Workspace mode:** Reads and validates the pointer, then resolves
 * config and agent roots. All failures are non-fatal:
 * - Missing pointer file → warn + fallback
 * - Malformed JSON → warn + fallback
 * - Missing required fields → warn + fallback
 * - Unknown config_repo (not in WorkspaceConfig.repos) → warn + fallback
 * - Path traversal in config_path → warn + fallback
 *
 * Fallback paths: `<workspace-root>/.pi/` for config,
 * `<workspace-root>/.pi/agents/` for agents.
 *
 * State/sidecar paths are NOT affected by the pointer and are not
 * included in the return value — they always live at
 * `<workspace-root>/.pi/` regardless.
 *
 * @param workspaceRoot - Absolute path to the workspace root directory
 * @param workspaceConfig - Loaded workspace config (null = repo mode → returns null)
 * @returns PointerResolution with resolved paths, or null in repo mode
 */
export function resolvePointer(
	workspaceRoot: string,
	workspaceConfig: WorkspaceConfig | null,
): PointerResolution | null {
	// ── Repo mode: pointer is ignored entirely ───────────────────
	if (workspaceConfig === null) {
		return null;
	}

	const fallbackConfigRoot = resolve(workspaceRoot, ".pi");
	const fallbackAgentRoot = resolve(workspaceRoot, ".pi", "agents");

	const filePath = pointerFilePath(workspaceRoot);

	// ── 1. File existence ────────────────────────────────────────
	if (!existsSync(filePath)) {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerNotFound(filePath),
		};
	}

	// ── 2. Read file ─────────────────────────────────────────────
	let rawContent: string;
	try {
		rawContent = readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerReadError(filePath, msg),
		};
	}

	// ── 3. Parse JSON ────────────────────────────────────────────
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawContent);
	} catch {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerInvalidJson(filePath),
		};
	}

	// ── 4. Validate shape ────────────────────────────────────────
	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerInvalidShape(filePath),
		};
	}

	const doc = parsed as Record<string, unknown>;
	const configRepo = doc.config_repo;
	const configPath = doc.config_path;

	if (!configRepo || typeof configRepo !== "string" || configRepo.trim() === "") {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerMissingConfigRepo(filePath),
		};
	}

	if (!configPath || typeof configPath !== "string" || configPath.trim() === "") {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerMissingConfigPath(filePath),
		};
	}

	// ── 5. Guard path traversal ──────────────────────────────────
	const normalizedConfigPath = configPath.trim().replace(/\\/g, "/");

	// Reject absolute paths (POSIX `/...` and Windows `C:/...`, `\\...`)
	if (isCrossPlatformAbsolutePath(configPath)) {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerAbsoluteConfigPath(filePath, configPath),
		};
	}

	// Reject traversal sequences
	if (
		normalizedConfigPath.startsWith("..") ||
		normalizedConfigPath.includes("/../") ||
		normalizedConfigPath.endsWith("/..")
	) {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerTraversalConfigPath(filePath, configPath),
		};
	}

	// ── 6. Resolve config_repo against workspace repos map ──────
	const repoId = configRepo.trim();
	const repoConfig = workspaceConfig.repos.get(repoId);
	if (!repoConfig) {
		const available = Array.from(workspaceConfig.repos.keys()).join(", ");
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerUnknownConfigRepo(filePath, repoId, available),
		};
	}

	// ── 7. Build resolved paths + containment check ──────────────
	const resolvedConfigRoot = resolve(repoConfig.path, normalizedConfigPath);

	// Verify the resolved path is within the repo root (defense-in-depth)
	const rel = relative(repoConfig.path, resolvedConfigRoot);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		return {
			used: false,
			configRoot: fallbackConfigRoot,
			agentRoot: fallbackAgentRoot,
			warning: WORKSPACE_MESSAGES.pointerEscapedConfigPath(filePath, configPath),
		};
	}

	const resolvedAgentRoot = resolve(resolvedConfigRoot, "agents");

	return {
		used: true,
		configRoot: resolvedConfigRoot,
		agentRoot: resolvedAgentRoot,
	};
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
			WORKSPACE_MESSAGES.workspaceConfigReadError(msg),
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
			WORKSPACE_MESSAGES.workspaceConfigParseError(msg),
			undefined,
			configFile,
		);
	}

	// ── 4. Top-level schema validation ───────────────────────────
	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			WORKSPACE_MESSAGES.workspaceConfigMustBeMapping(),
			undefined,
			configFile,
		);
	}
	const doc = parsed as Record<string, unknown>;

	if (!doc.repos || typeof doc.repos !== "object" || Array.isArray(doc.repos)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			WORKSPACE_MESSAGES.workspaceConfigMissingReposMapping(),
			undefined,
			configFile,
		);
	}
	if (!doc.routing || typeof doc.routing !== "object" || Array.isArray(doc.routing)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_SCHEMA_INVALID",
			WORKSPACE_MESSAGES.workspaceConfigMissingRoutingMapping(),
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
			WORKSPACE_MESSAGES.workspaceConfigMissingRepos(),
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
				WORKSPACE_MESSAGES.workspaceConfigInvalidRepoEntry(repoId),
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
				WORKSPACE_MESSAGES.workspaceConfigMissingRepoPath(repoId),
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
				WORKSPACE_MESSAGES.workspaceConfigRepoPathNotFound(repoId, absolutePath),
				repoId,
				absolutePath,
			);
		}

		// 6c. path is a git repo root
		const gitDirCheck = runGit(["rev-parse", "--git-dir"], absolutePath);
		if (!gitDirCheck.ok) {
			throw new WorkspaceConfigError(
				"WORKSPACE_REPO_NOT_GIT",
				WORKSPACE_MESSAGES.workspaceConfigRepoNotGit(repoId, absolutePath),
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
					WORKSPACE_MESSAGES.workspaceConfigRepoNotRoot(repoId, toplevelCheck.stdout.trim(), absolutePath),
					repoId,
					absolutePath,
				);
			}
		}

		// 7. Collect for duplicate detection (checked after loop)
		if (normalizedPaths.has(normalizedPath)) {
			throw new WorkspaceConfigError(
				"WORKSPACE_DUPLICATE_REPO_PATH",
				WORKSPACE_MESSAGES.workspaceConfigDuplicateRepoPath(normalizedPaths.get(normalizedPath), repoId, absolutePath),
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
			WORKSPACE_MESSAGES.workspaceConfigMissingTasksRoot(),
			undefined,
			configFile,
		);
	}

	// 9. routing.tasks_root exists on disk
	const tasksRootAbsolute = resolveAbsolutePath(rawTasksRoot.trim(), workspaceRoot);
	if (!existsSync(tasksRootAbsolute)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_TASKS_ROOT_NOT_FOUND",
			WORKSPACE_MESSAGES.workspaceConfigTasksRootNotFound(tasksRootAbsolute),
			undefined,
			tasksRootAbsolute,
		);
	}

	// 10. routing.default_repo present
	const rawDefaultRepo = rawRouting.default_repo;
	if (!rawDefaultRepo || typeof rawDefaultRepo !== "string" || rawDefaultRepo.trim() === "") {
		throw new WorkspaceConfigError(
			"WORKSPACE_MISSING_DEFAULT_REPO",
			WORKSPACE_MESSAGES.workspaceConfigMissingDefaultRepo(),
			undefined,
			configFile,
		);
	}

	// 11. routing.default_repo references a valid repo ID
	const defaultRepoId = rawDefaultRepo.trim();
	if (!repos.has(defaultRepoId)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_DEFAULT_REPO_NOT_FOUND",
			WORKSPACE_MESSAGES.workspaceConfigUnknownDefaultRepo(defaultRepoId, Array.from(repos.keys()).join(", ")),
			undefined,
			configFile,
		);
	}

	// 12. routing.task_packet_repo (required by v1 contract)
	// Compatibility policy: if omitted, default to routing.default_repo and
	// emit a warning so legacy configs remain deterministic.
	const hasTaskPacketRepo = Object.prototype.hasOwnProperty.call(rawRouting, "task_packet_repo");
	const rawTaskPacketRepo = rawRouting.task_packet_repo;
	let taskPacketRepoId = defaultRepoId;

	if (hasTaskPacketRepo) {
		if (typeof rawTaskPacketRepo !== "string" || rawTaskPacketRepo.trim() === "") {
			throw new WorkspaceConfigError(
				"WORKSPACE_SCHEMA_INVALID",
				WORKSPACE_MESSAGES.workspaceConfigInvalidTaskPacketRepo(),
				undefined,
				configFile,
			);
		}
		taskPacketRepoId = rawTaskPacketRepo.trim();
	} else {
		console.error(WORKSPACE_MESSAGES.workspaceConfigCompatibilityTaskPacketRepo(configFile, defaultRepoId));
	}

	if (!repos.has(taskPacketRepoId)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_TASK_PACKET_REPO_NOT_FOUND",
			WORKSPACE_MESSAGES.workspaceConfigUnknownTaskPacketRepo(taskPacketRepoId, Array.from(repos.keys()).join(", ")),
			undefined,
			configFile,
		);
	}

	// 13. tasks_root must be inside repos[task_packet_repo].path
	const packetRepoPath = repos.get(taskPacketRepoId)!.path;
	if (!isPathWithinContainer(tasksRootAbsolute, packetRepoPath)) {
		throw new WorkspaceConfigError(
			"WORKSPACE_TASKS_ROOT_OUTSIDE_PACKET_REPO",
			WORKSPACE_MESSAGES.workspaceConfigTasksRootOutsidePacketRepo(tasksRootAbsolute, taskPacketRepoId, packetRepoPath),
			undefined,
			tasksRootAbsolute,
		);
	}

	// ── 14. routing.strict (optional boolean, default false) ─────
	const rawStrict = rawRouting.strict;
	if (rawStrict !== undefined) {
		// null (from bare `strict:` or `strict: null` in YAML) is rejected
		// to prevent fail-open: governance controls must be explicit.
		if (rawStrict === null || typeof rawStrict !== "boolean") {
			throw new WorkspaceConfigError(
				"WORKSPACE_SCHEMA_INVALID",
				WORKSPACE_MESSAGES.workspaceConfigInvalidStrict(rawStrict),
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
		taskPacketRepo: taskPacketRepoId,
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


// ── Cross-Config Validation ─────────────────────────────────────────

/**
 * Enforce that every configured task area resolves inside workspace routing.tasksRoot.
 *
 * This is a cross-config invariant and therefore runs after both workspace and
 * task-runner configs are loaded.
 */
export function validateTaskAreasWithinTasksRoot(
	workspaceRoot: string,
	workspaceConfig: WorkspaceConfig,
	taskRunnerConfig: import("./types.ts").TaskRunnerConfig,
): void {
	const tasksRoot = workspaceConfig.routing.tasksRoot;
	const areaEntries = Object.entries(taskRunnerConfig.task_areas ?? {}).sort((a, b) =>
		a[0].localeCompare(b[0])
	);

	for (const [areaName, area] of areaEntries) {
		const areaPathRaw = (area?.path ?? "").trim();
		const areaAbsolute = resolveAbsolutePath(areaPathRaw, workspaceRoot);
		if (!isPathWithinContainer(areaAbsolute, tasksRoot)) {
			throw new WorkspaceConfigError(
				"WORKSPACE_TASK_AREA_OUTSIDE_TASKS_ROOT",
				WORKSPACE_MESSAGES.workspaceTaskAreaOutsideTasksRoot(areaName, areaAbsolute, tasksRoot),
				undefined,
				areaAbsolute,
			);
		}
	}
}


// ── Workspace Sync Helpers ──────────────────────────────────────────

export const DEFAULT_SUBMODULE_POLICY: SubmodulePolicy = {
	failureMode: "permissive",
	onSubmoduleDrift: "manual",
	repoIdStrategy: "path-basename",
};

export const WORKSPACE_REPO_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function normalizeWorkspaceSyncPath(pathValue: string): string {
	return resolve(pathValue).replace(/\\/g, "/");
}

function plannerSyncCommand(targetLabel = "<target>"): string {
	return `/orch-plan ${targetLabel} --sync`;
}

function workspaceSyncFindingStatus(policy: SubmodulePolicy): PreflightCheck["status"] {
	return policy.failureMode === "strict" ? "fail" : "warn";
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
	const rel = relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
	if (rel && rel !== "." && !rel.startsWith("../") && rel !== "..") {
		return rel;
	}
	return absolutePath.replace(/\\/g, "/");
}

function writeYamlFileAtomically(filePath: string, content: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, filePath);
}

function groupPathsByRepo(findings: WorkspaceSyncFinding[], kinds: WorkspaceSyncFinding["kind"][]): Map<string, string[]> {
	const grouped = new Map<string, string[]>();
	const kindSet = new Set(kinds);
	for (const finding of findings) {
		if (!finding.submodulePath || !kindSet.has(finding.kind)) continue;
		const paths = grouped.get(finding.repoRoot) ?? [];
		paths.push(finding.submodulePath);
		grouped.set(finding.repoRoot, paths);
	}
	for (const [repoRoot, paths] of grouped) {
		grouped.set(repoRoot, [...new Set(paths)].sort((left, right) => left.localeCompare(right)));
	}
	return grouped;
}

function collapseToTrackedSubmoduleRoots(repoRoot: string, paths: string[]): string[] {
	const trackedPaths = [...new Set([...listConfiguredSubmodulePaths(repoRoot), ...listGitlinkPaths(repoRoot)])]
		.sort((left, right) => right.length - left.length || left.localeCompare(right));
	if (trackedPaths.length === 0) {
		return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
	}

	const collapsed = paths.map((pathValue) => {
		for (const trackedPath of trackedPaths) {
			if (pathValue === trackedPath || pathValue.startsWith(`${trackedPath}/`)) {
				return trackedPath;
			}
		}
		return pathValue;
	});

	return [...new Set(collapsed)].sort((left, right) => left.localeCompare(right));
}

export function collectWorkspaceSyncSummary(
	repoRoot: string | undefined,
	workspaceConfig: WorkspaceConfig | null | undefined,
	policy: SubmodulePolicy,
	targetLabel?: string,
): WorkspaceSyncSummary {
	const findings: WorkspaceSyncFinding[] = [];
	const repoEntries = new Map<string, { label: string; root: string }>();
	const workspaceRepoPaths = new Map<string, string>();
	const workspaceRepoIds = new Map<string, WorkspaceRepoConfig>();

	if (workspaceConfig) {
		for (const [repoId, repoConfig] of workspaceConfig.repos) {
			repoEntries.set(normalizeWorkspaceSyncPath(repoConfig.path), { label: repoId, root: repoConfig.path });
			workspaceRepoPaths.set(normalizeWorkspaceSyncPath(repoConfig.path), repoId);
			workspaceRepoIds.set(repoId, repoConfig);
			if (!WORKSPACE_REPO_ID_PATTERN.test(repoId)) {
				findings.push({
					name: `workspace-repo-id:${repoId}`,
					kind: "workspace-repo-id",
					status: workspaceSyncFindingStatus(policy),
					repoLabel: repoId,
					repoRoot: repoConfig.path,
					message: WORKSPACE_MESSAGES.workspaceRepoIdPolicyMessage(repoId),
					hint: WORKSPACE_MESSAGES.workspaceRepoIdPolicyHint(),
				});
			}
		}
	} else if (repoRoot) {
		repoEntries.set(normalizeWorkspaceSyncPath(repoRoot), { label: basename(repoRoot), root: repoRoot });
	}

	const collisionCandidates = new Map<string, WorkspaceRepoImportCandidate[]>();
	let trackedSubmodules = 0;

	for (const { label, root } of [...repoEntries.values()].sort((left, right) => left.label.localeCompare(right.label))) {
		const configuredPaths = listConfiguredSubmodulePaths(root);
		const gitlinkPaths = listGitlinkPaths(root);
		const statuses = listSubmoduleStatus(root);
		const statusByPath = new Map(statuses.map((entry) => [entry.path, entry]));
		const allPaths = [...new Set([...configuredPaths, ...gitlinkPaths, ...statuses.map((entry) => entry.path)])]
			.sort((left, right) => left.localeCompare(right));

		trackedSubmodules += allPaths.length;

		for (const submodulePath of allPaths) {
			const absolutePath = resolve(root, submodulePath);
			const mappedRepoId = workspaceRepoPaths.get(normalizeWorkspaceSyncPath(absolutePath));

			if (workspaceConfig && !mappedRepoId && policy.repoIdStrategy === "path-basename") {
				const derivedRepoId = basename(submodulePath).trim().toLowerCase();
				if (!WORKSPACE_REPO_ID_PATTERN.test(derivedRepoId)) {
					findings.push({
						name: `submodule-import:${label}:${submodulePath}`,
						kind: "invalid-derived-repo-id",
						status: workspaceSyncFindingStatus(policy),
						repoLabel: label,
						repoRoot: root,
						submodulePath,
						absolutePath,
						derivedRepoId,
						message: WORKSPACE_MESSAGES.workspaceInvalidDerivedRepoIdMessage(label, submodulePath, derivedRepoId),
						hint: WORKSPACE_MESSAGES.workspaceInvalidDerivedRepoIdHint(targetLabel, submodulePath),
					});
				} else {
					const existingRepo = workspaceRepoIds.get(derivedRepoId);
					if (existingRepo && normalizeWorkspaceSyncPath(existingRepo.path) !== normalizeWorkspaceSyncPath(absolutePath)) {
						findings.push({
							name: `submodule-repo-id:${derivedRepoId}:${label}:${submodulePath}`,
							kind: "repo-id-collision",
							status: workspaceSyncFindingStatus(policy),
							repoLabel: label,
							repoRoot: root,
							submodulePath,
							absolutePath,
							derivedRepoId,
							message: WORKSPACE_MESSAGES.workspaceRepoIdCollisionMessage(label, submodulePath, derivedRepoId, existingRepo.path),
							hint: WORKSPACE_MESSAGES.workspaceRepoIdCollisionHint(targetLabel, submodulePath),
						});
					} else {
						const candidate: WorkspaceRepoImportCandidate = {
							repoLabel: label,
							repoRoot: root,
							submodulePath,
							absolutePath,
							derivedRepoId,
						};
						const candidates = collisionCandidates.get(derivedRepoId) ?? [];
						candidates.push(candidate);
						collisionCandidates.set(derivedRepoId, candidates);
						findings.push({
							name: `submodule-import:${label}:${submodulePath}`,
							kind: "missing-workspace-repo",
							status: workspaceSyncFindingStatus(policy),
							repoLabel: label,
							repoRoot: root,
							submodulePath,
							absolutePath,
							derivedRepoId,
							message: WORKSPACE_MESSAGES.workspaceMissingRepoMessage(label, submodulePath),
							hint: WORKSPACE_MESSAGES.workspaceMissingRepoHint(targetLabel, submodulePath, derivedRepoId),
						});
					}
				}
			}

			const status = statusByPath.get(submodulePath);
			if (status?.state === "uninitialized") {
				findings.push({
					name: `submodule-state:${label}:${submodulePath}`,
					kind: "uninitialized-submodule",
					status: workspaceSyncFindingStatus(policy),
					repoLabel: label,
					repoRoot: root,
					submodulePath,
					absolutePath,
					message: WORKSPACE_MESSAGES.workspaceUninitializedSubmoduleMessage(label, submodulePath),
					hint: WORKSPACE_MESSAGES.uninitializedSubmoduleHint(policy, root, submodulePath, targetLabel),
				});
				continue;
			}

			if (status?.state === "drifted" || status?.state === "conflict") {
				findings.push({
					name: `submodule-state:${label}:${submodulePath}`,
					kind: status.state === "conflict" ? "conflicted-submodule" : "drifted-submodule",
					status: workspaceSyncFindingStatus(policy),
					repoLabel: label,
					repoRoot: root,
					submodulePath,
					absolutePath,
					message: WORKSPACE_MESSAGES.workspaceDriftedSubmoduleMessage(label, submodulePath, status.state === "conflict"),
					hint: WORKSPACE_MESSAGES.driftedSubmoduleHint(policy, root, submodulePath, targetLabel),
				});
			}
		}
	}

	const importCandidates: WorkspaceRepoImportCandidate[] = [];
	for (const [derivedRepoId, candidates] of [...collisionCandidates.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
		if (candidates.length === 1) {
			importCandidates.push(candidates[0]);
			continue;
		}
		findings.push({
			name: `submodule-repo-id:${derivedRepoId}`,
			kind: "repo-id-collision",
			status: workspaceSyncFindingStatus(policy),
			repoLabel: derivedRepoId,
			repoRoot: candidates[0]?.repoRoot ?? repoRoot ?? process.cwd(),
			derivedRepoId,
			message: WORKSPACE_MESSAGES.workspaceRepoCollisionMessage(derivedRepoId),
			hint: WORKSPACE_MESSAGES.workspaceRepoCollisionHint(targetLabel, candidates),
		});
	}

	findings.sort((left, right) => left.name.localeCompare(right.name));
	importCandidates.sort((left, right) => left.derivedRepoId.localeCompare(right.derivedRepoId));

	return {
		trackedSubmodules,
		findings,
		importCandidates,
	};
}

export function workspaceSyncSummaryToChecks(summary: WorkspaceSyncSummary): PreflightCheck[] {
	if (summary.findings.length === 0) {
		return [{
			name: "submodules",
			status: "pass",
			message: summary.trackedSubmodules > 0
				? WORKSPACE_MESSAGES.workspaceNoSubmoduleIssues(summary.trackedSubmodules)
				: WORKSPACE_MESSAGES.workspaceNoSubmodules(),
		}];
	}
	return summary.findings.map((finding) => ({
		name: finding.name,
		status: finding.status,
		message: finding.message,
		hint: finding.hint,
	}));
}

export function buildWorkspaceSyncBadgeStatus(summary: WorkspaceSyncSummary): WorkspaceSyncBadgeStatus {
	if (summary.trackedSubmodules === 0) {
		return {
			state: "none",
			trackedSubmodules: 0,
			label: WORKSPACE_MESSAGES.workspaceSyncBadgeNoneLabel(),
			detail: WORKSPACE_MESSAGES.workspaceSyncBadgeNoneDetail(),
		};
	}
	return {
		state: "clean",
		trackedSubmodules: summary.trackedSubmodules,
		label: WORKSPACE_MESSAGES.workspaceSyncBadgeCleanLabel(summary.trackedSubmodules),
		detail: WORKSPACE_MESSAGES.workspaceSyncBadgeCleanDetail(),
	};
}

export function applyWorkspaceSync(
	workspaceRoot: string,
	_repoRoot: string,
	workspaceConfig: WorkspaceConfig | null | undefined,
	policy: SubmodulePolicy,
	summary: WorkspaceSyncSummary,
): WorkspaceSyncApplyResult {
	const result: WorkspaceSyncApplyResult = {
		importedRepoIds: [],
		initializedPaths: [],
		updatedPaths: [],
		warnings: [],
		changed: false,
	};

	if (summary.importCandidates.length > 0 && workspaceConfig?.configPath) {
		const parsed = yamlParse(readFileSync(workspaceConfig.configPath, "utf-8")) as Record<string, unknown> | null;
		const document = parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? { ...parsed }
			: {};
		const existingRepos = document.repos && typeof document.repos === "object" && !Array.isArray(document.repos)
			? { ...(document.repos as Record<string, unknown>) }
			: {};

		for (const candidate of summary.importCandidates) {
			if (existingRepos[candidate.derivedRepoId] !== undefined) continue;
			existingRepos[candidate.derivedRepoId] = {
				path: relativeWorkspacePath(workspaceRoot, candidate.absolutePath),
			};
			workspaceConfig.repos.set(candidate.derivedRepoId, {
				id: candidate.derivedRepoId,
				path: candidate.absolutePath,
			});
			result.importedRepoIds.push(candidate.derivedRepoId);
			result.changed = true;
		}

		if (result.importedRepoIds.length > 0) {
			const sortedRepos: Record<string, unknown> = {};
			for (const [repoId, repoValue] of Object.entries(existingRepos).sort((left, right) => left[0].localeCompare(right[0]))) {
				sortedRepos[repoId] = repoValue;
			}
			document.repos = sortedRepos;
			writeYamlFileAtomically(workspaceConfig.configPath, `${yamlStringify(document)}`.trimEnd() + "\n");
		}
	}

	const initGroups = groupPathsByRepo(summary.findings, ["uninitialized-submodule"]);
	const updateGroups = groupPathsByRepo(summary.findings, ["drifted-submodule", "conflicted-submodule"]);

	if (policy.onSubmoduleDrift === "init-only") {
		for (const [root, paths] of initGroups) {
			if (paths.length === 0) continue;
			const commandPaths = collapseToTrackedSubmoduleRoots(root, paths);
			const gitResult = runGit(["submodule", "update", "--init", "--", ...commandPaths], root);
			if (!gitResult.ok) {
				result.warnings.push(WORKSPACE_MESSAGES.workspaceSyncInitFailure(root, gitResult.stderr || gitResult.stdout || "git submodule update failed"));
				continue;
			}
			result.initializedPaths.push(...paths.map((pathValue) => `${basename(root)}:${pathValue}`));
			result.changed = true;
		}
	} else if (policy.onSubmoduleDrift === "recursive-on-drift") {
		const recursiveGroups = new Map<string, string[]>();
		for (const [root, paths] of initGroups) {
			recursiveGroups.set(root, [...paths]);
		}
		for (const [root, paths] of updateGroups) {
			const current = recursiveGroups.get(root) ?? [];
			recursiveGroups.set(root, [...current, ...paths]);
		}
		for (const [root, paths] of recursiveGroups) {
			const uniquePaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
			if (uniquePaths.length === 0) continue;
			const commandPaths = collapseToTrackedSubmoduleRoots(root, uniquePaths);
			const gitResult = runGit(["submodule", "update", "--init", "--recursive", "--", ...commandPaths], root);
			if (!gitResult.ok) {
				result.warnings.push(WORKSPACE_MESSAGES.workspaceSyncRecursiveFailure(root, gitResult.stderr || gitResult.stdout || "git submodule update failed"));
				continue;
			}
			const rootLabel = basename(root);
			for (const pathValue of uniquePaths) {
				const key = `${rootLabel}:${pathValue}`;
				if (initGroups.get(root)?.includes(pathValue)) {
					result.initializedPaths.push(key);
				}
				if (updateGroups.get(root)?.includes(pathValue)) {
					result.updatedPaths.push(key);
				}
			}
			result.changed = true;
		}
	} else if (initGroups.size > 0 || updateGroups.size > 0) {
		result.warnings.push(WORKSPACE_MESSAGES.workspaceSyncManualModeWarning());
	}

	return result;
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
 * @throws WorkspaceConfigError if workspace config is present but invalid,
 *   or when no workspace config exists and `cwd` is not a git repository.
 */
function isInsideGitRepo(cwd: string): boolean {
	const probe = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
	return probe.ok && probe.stdout.trim() === "true";
}

export function buildExecutionContext(
	cwd: string,
	loadOrchConfig: (root: string, pointerConfigRoot?: string) => import("./types.ts").OrchestratorConfig,
	loadTaskConfig: (root: string, pointerConfigRoot?: string) => import("./types.ts").TaskRunnerConfig,
): import("./types.ts").ExecutionContext {
	const workspaceConfig = loadWorkspaceConfig(cwd);

	if (workspaceConfig === null) {
		// Deterministic mode guard: without workspace config, repo mode is only
		// valid when cwd is a git repository.
		if (!isInsideGitRepo(cwd)) {
			const wsConfigFile = workspaceConfigPath(cwd);
			throw new WorkspaceConfigError(
				"WORKSPACE_SETUP_REQUIRED",
				WORKSPACE_MESSAGES.workspaceSetupRequired(wsConfigFile, cwd),
				undefined,
				cwd,
			);
		}

		// Repo mode: pointer is ignored entirely. Config loads from cwd.
		const orchestratorConfig = loadOrchConfig(cwd);
		const taskRunnerConfig = loadTaskConfig(cwd);

		return {
			workspaceRoot: cwd,
			repoRoot: cwd,
			mode: "repo",
			workspaceConfig: null,
			orchestratorConfig,
			taskRunnerConfig,
			pointer: null,
		};
	}

	// Workspace mode: resolve pointer once, pass configRoot to config loaders.
	const pointer = resolvePointer(cwd, workspaceConfig);

	// Log pointer warning once at startup (non-fatal).
	if (pointer && pointer.warning) {
		console.error(WORKSPACE_MESSAGES.pointerWarningLog(pointer.warning));
	}

	const pointerConfigRoot = pointer?.configRoot;
	const orchestratorConfig = loadOrchConfig(cwd, pointerConfigRoot);
	const taskRunnerConfig = loadTaskConfig(cwd, pointerConfigRoot);

	// Cross-config invariant: every task-area path must live under routing.tasks_root.
	validateTaskAreasWithinTasksRoot(cwd, workspaceConfig, taskRunnerConfig);

	const defaultRepo = workspaceConfig.repos.get(workspaceConfig.routing.defaultRepo)!;
	return {
		workspaceRoot: cwd,
		repoRoot: defaultRepo.path,
		mode: "workspace",
		workspaceConfig,
		orchestratorConfig,
		taskRunnerConfig,
		pointer,
	};
}
