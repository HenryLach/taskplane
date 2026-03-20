/**
 * Unified config loader for taskplane-config.json with YAML fallback
 * and user preferences (Layer 2) merge.
 *
 * Layer 1 — Project config precedence:
 *   1. `.pi/taskplane-config.json` exists and is valid → use it
 *   2. `.pi/taskplane-config.json` exists but malformed → throw with clear error
 *   3. `.pi/taskplane-config.json` exists but unsupported configVersion → throw
 *   4. JSON absent + one/both YAML files present → read YAML, map to unified shape
 *   5. None present → return cloned defaults
 *
 * Layer 2 — User preferences:
 *   After loading Layer 1, reads `~/.pi/agent/taskplane/preferences.json`
 *   (or `$PI_CODING_AGENT_DIR/taskplane/preferences.json`) and applies
 *   allowlisted user-scoped fields on top. Unknown keys are ignored.
 *   Malformed preferences fall back to defaults silently.
 *
 * Path resolution:
 *   Resolves config paths relative to `configRoot`. Callers should pass
 *   the project root (or TASKPLANE_WORKSPACE_ROOT fallback) as `configRoot`.
 *
 * All returned objects are deep-cloned from defaults — no cross-call mutation.
 *
 * @module config/loader
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as yamlParse } from "yaml";

import {
	CONFIG_VERSION,
	PROJECT_CONFIG_FILENAME,
	DEFAULT_PROJECT_CONFIG,
	DEFAULT_TASK_RUNNER_SECTION,
	DEFAULT_ORCHESTRATOR_SECTION,
	DEFAULT_USER_PREFERENCES,
	USER_PREFERENCES_FILENAME,
	USER_PREFERENCES_SUBDIR,
} from "./config-schema.ts";
import type {
	TaskplaneConfig,
	TaskRunnerSection,
	OrchestratorSection,
	UserPreferences,
} from "./config-schema.ts";


// ── Error Types ──────────────────────────────────────────────────────

/**
 * Error codes for config loading failures.
 *
 * - CONFIG_JSON_MALFORMED: File exists but is not valid JSON
 * - CONFIG_VERSION_UNSUPPORTED: configVersion is not supported by this version
 * - CONFIG_VERSION_MISSING: configVersion field is missing from JSON
 */
export type ConfigLoadErrorCode =
	| "CONFIG_JSON_MALFORMED"
	| "CONFIG_VERSION_UNSUPPORTED"
	| "CONFIG_VERSION_MISSING";

export class ConfigLoadError extends Error {
	code: ConfigLoadErrorCode;

	constructor(code: ConfigLoadErrorCode, message: string) {
		super(message);
		this.name = "ConfigLoadError";
		this.code = code;
	}
}


// ── Deep Clone Helper ────────────────────────────────────────────────

/** Deep clone a config object to avoid cross-call mutation. */
function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}


// ── Deep Merge Helper ────────────────────────────────────────────────

/**
 * Deep merge `source` into `target`. Arrays are replaced, not merged.
 * Only merges plain objects (not arrays, dates, etc).
 * Returns `target` for chaining.
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = (target as any)[key];
		if (
			srcVal !== null &&
			srcVal !== undefined &&
			typeof srcVal === "object" &&
			!Array.isArray(srcVal) &&
			tgtVal !== null &&
			tgtVal !== undefined &&
			typeof tgtVal === "object" &&
			!Array.isArray(tgtVal)
		) {
			deepMerge(tgtVal, srcVal);
		} else if (srcVal !== undefined) {
			(target as any)[key] = srcVal;
		}
	}
	return target;
}


// ── YAML snake_case → camelCase Mapping ──────────────────────────────

/**
 * Convert a snake_case key to camelCase.
 * e.g., "max_worker_iterations" → "maxWorkerIterations"
 */
function snakeToCamel(s: string): string {
	return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Convert structural keys from snake_case to camelCase, recursively.
 * Used for sections where ALL keys are structural schema keys (no
 * user-defined dictionary keys).
 */
function convertStructuralKeys(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (Array.isArray(obj)) return obj.map(convertStructuralKeys);
	if (typeof obj !== "object") return obj;

	const result: Record<string, any> = {};
	for (const [key, val] of Object.entries(obj)) {
		const camelKey = snakeToCamel(key);
		if (val !== null && typeof val === "object" && !Array.isArray(val)) {
			result[camelKey] = convertStructuralKeys(val);
		} else if (Array.isArray(val)) {
			result[camelKey] = val.map(convertStructuralKeys);
		} else {
			result[camelKey] = val;
		}
	}
	return result;
}

/**
 * Convert a record/dictionary section where outer keys are user-defined
 * identifiers (preserve verbatim) but inner keys are structural (convert).
 */
function convertRecordSection(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj !== "object" || Array.isArray(obj)) return obj;

	const result: Record<string, any> = {};
	for (const [key, val] of Object.entries(obj)) {
		// Preserve user-defined key verbatim, convert structural inner keys
		if (val !== null && typeof val === "object" && !Array.isArray(val)) {
			result[key] = convertStructuralKeys(val);
		} else {
			result[key] = val;
		}
	}
	return result;
}

/**
 * Convert a flat record/dictionary where both keys and values are
 * user-defined (preserve everything verbatim). Used for sections like
 * `reference_docs`, `self_doc_targets`, `testing.commands` where
 * keys are identifiers and values are strings.
 */
function preserveRecord(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj !== "object" || Array.isArray(obj)) return obj;
	return { ...obj };
}

// ── Section-aware YAML mapping ───────────────────────────────────────

/**
 * Map a raw task-runner YAML object to the camelCase TaskRunnerSection shape.
 *
 * Knows which sections contain user-defined record keys vs. structural keys:
 * - Structural-only: project, paths, worker, reviewer, context, standards
 * - Record with structural inner keys: task_areas, standards_overrides
 * - Flat record (preserve all keys): testing.commands, reference_docs,
 *   self_doc_targets
 * - Array (preserve): never_load, protected_docs
 */
function mapTaskRunnerYaml(raw: any): Partial<TaskRunnerSection> {
	const result: any = {};

	// Structural sections — all keys are schema-defined
	if (raw.project) result.project = convertStructuralKeys(raw.project);
	if (raw.paths) result.paths = convertStructuralKeys(raw.paths);
	if (raw.worker) result.worker = convertStructuralKeys(raw.worker);
	if (raw.reviewer) result.reviewer = convertStructuralKeys(raw.reviewer);
	if (raw.context) result.context = convertStructuralKeys(raw.context);
	if (raw.standards) result.standards = convertStructuralKeys(raw.standards);

	// Testing: commands is a flat user-defined record
	if (raw.testing) {
		result.testing = {};
		if (raw.testing.commands) {
			result.testing.commands = preserveRecord(raw.testing.commands);
		}
	}

	// Record sections with structural inner keys
	if (raw.task_areas) result.taskAreas = convertRecordSection(raw.task_areas);
	if (raw.standards_overrides) result.standardsOverrides = convertRecordSection(raw.standards_overrides);

	// Flat record sections (keys are identifiers, values are strings)
	if (raw.reference_docs) result.referenceDocs = preserveRecord(raw.reference_docs);
	if (raw.self_doc_targets) result.selfDocTargets = preserveRecord(raw.self_doc_targets);

	// Array sections (preserve verbatim)
	if (raw.never_load) result.neverLoad = [...raw.never_load];
	if (raw.protected_docs) result.protectedDocs = [...raw.protected_docs];

	// Quality gate (structural — all keys are schema-defined)
	if (raw.quality_gate) result.qualityGate = convertStructuralKeys(raw.quality_gate);

	return result;
}

/**
 * Map a raw orchestrator YAML object to the camelCase OrchestratorSection shape.
 *
 * Knows which sections contain user-defined record keys:
 * - Structural: orchestrator, dependencies, merge, failure, monitoring
 * - Record with structural inner keys: (none)
 * - Flat record (preserve keys): pre_warm.commands, assignment.size_weights
 */
function mapOrchestratorYaml(raw: any): Partial<OrchestratorSection> {
	const result: any = {};

	// Structural sections
	if (raw.orchestrator) result.orchestrator = convertStructuralKeys(raw.orchestrator);
	if (raw.dependencies) result.dependencies = convertStructuralKeys(raw.dependencies);
	if (raw.merge) result.merge = convertStructuralKeys(raw.merge);
	if (raw.failure) result.failure = convertStructuralKeys(raw.failure);
	if (raw.monitoring) result.monitoring = convertStructuralKeys(raw.monitoring);

	// assignment: strategy is structural, size_weights is a user-defined record
	if (raw.assignment) {
		result.assignment = {};
		if (raw.assignment.strategy !== undefined) result.assignment.strategy = raw.assignment.strategy;
		if (raw.assignment.size_weights) result.assignment.sizeWeights = preserveRecord(raw.assignment.size_weights);
	}

	// pre_warm: auto_detect is structural, commands is user-defined, always is array
	if (raw.pre_warm) {
		result.preWarm = {};
		if (raw.pre_warm.auto_detect !== undefined) result.preWarm.autoDetect = raw.pre_warm.auto_detect;
		if (raw.pre_warm.commands) result.preWarm.commands = preserveRecord(raw.pre_warm.commands);
		if (raw.pre_warm.always) result.preWarm.always = [...raw.pre_warm.always];
	}

	// verification: all keys are structural (TP-032)
	if (raw.verification) result.verification = convertStructuralKeys(raw.verification);

	return result;
}


// ── Config File Path Resolution ──────────────────────────────────────

/**
 * Resolve the path to a config file under the given root.
 *
 * Supports two directory layouts:
 *   1. Standard layout: `<root>/.pi/<filename>` — used by repo mode and
 *      workspace root, where config files live under the `.pi/` subdirectory.
 *   2. Flat layout: `<root>/<filename>` — used by pointer-resolved config
 *      roots (e.g., `<configRepo>/.taskplane/task-runner.yaml`), where
 *      `taskplane init` scaffolds files directly in the config path.
 *
 * Standard layout is checked first for backward compatibility. If neither
 * exists, returns the standard-layout path (callers check existence).
 */
function resolveConfigFilePath(configRoot: string, filename: string): string {
	const standardPath = join(configRoot, ".pi", filename);
	if (existsSync(standardPath)) return standardPath;

	const flatPath = join(configRoot, filename);
	if (existsSync(flatPath)) return flatPath;

	// Default to standard path — callers handle non-existence
	return standardPath;
}

// ── JSON Loading ─────────────────────────────────────────────────────

/**
 * Attempt to load and validate `taskplane-config.json`.
 *
 * Checks both standard layout (`<root>/.pi/taskplane-config.json`) and
 * flat layout (`<root>/taskplane-config.json`) — see `resolveConfigFilePath`.
 *
 * Returns the parsed config or null if the file doesn't exist.
 * Throws ConfigLoadError for malformed JSON or unsupported versions.
 */
function loadJsonConfig(configRoot: string): TaskplaneConfig | null {
	const jsonPath = resolveConfigFilePath(configRoot, PROJECT_CONFIG_FILENAME);
	if (!existsSync(jsonPath)) return null;

	let raw: string;
	try {
		raw = readFileSync(jsonPath, "utf-8");
	} catch {
		return null; // Can't read file — treat as absent
	}

	let parsed: any;
	try {
		parsed = JSON.parse(raw);
	} catch (e: any) {
		throw new ConfigLoadError(
			"CONFIG_JSON_MALFORMED",
			`Failed to parse ${jsonPath}: ${e.message ?? "invalid JSON"}`,
		);
	}

	// Validate configVersion
	if (parsed.configVersion === undefined || parsed.configVersion === null) {
		throw new ConfigLoadError(
			"CONFIG_VERSION_MISSING",
			`${jsonPath} is missing required field "configVersion". ` +
			`Expected configVersion: ${CONFIG_VERSION}.`,
		);
	}

	if (parsed.configVersion !== CONFIG_VERSION) {
		throw new ConfigLoadError(
			"CONFIG_VERSION_UNSUPPORTED",
			`${jsonPath} has configVersion ${parsed.configVersion}, but this version of Taskplane ` +
			`only supports configVersion ${CONFIG_VERSION}. Please upgrade Taskplane.`,
		);
	}

	// Deep merge with cloned defaults
	const config = deepClone(DEFAULT_PROJECT_CONFIG);
	if (parsed.taskRunner) {
		deepMerge(config.taskRunner, parsed.taskRunner);
	}
	if (parsed.orchestrator) {
		deepMerge(config.orchestrator, parsed.orchestrator);
	}

	return config;
}


// ── YAML Loading ─────────────────────────────────────────────────────

/**
 * Load task-runner settings from `task-runner.yaml`.
 *
 * Checks both standard layout (`<root>/.pi/task-runner.yaml`) and
 * flat layout (`<root>/task-runner.yaml`) — see `resolveConfigFilePath`.
 * Maps snake_case YAML keys to the camelCase TaskRunnerSection shape.
 * Uses section-aware mapping that preserves user-defined record keys.
 * Returns cloned defaults if the file doesn't exist or is malformed.
 */
function loadTaskRunnerYaml(configRoot: string): TaskRunnerSection {
	const yamlPath = resolveConfigFilePath(configRoot, "task-runner.yaml");
	if (!existsSync(yamlPath)) return deepClone(DEFAULT_TASK_RUNNER_SECTION);

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return deepClone(DEFAULT_TASK_RUNNER_SECTION);

		// Section-aware mapping: structural keys → camelCase, record keys → preserved
		const mapped = mapTaskRunnerYaml(loaded);

		// Deep merge with cloned defaults
		const section = deepClone(DEFAULT_TASK_RUNNER_SECTION);
		deepMerge(section, mapped);

		// Post-process taskAreas: trim repoId, drop whitespace-only values
		// (matches legacy loadTaskRunnerConfig behavior from config.ts)
		if (section.taskAreas) {
			for (const area of Object.values(section.taskAreas)) {
				if (area.repoId !== undefined) {
					const trimmed = typeof area.repoId === "string" ? area.repoId.trim() : "";
					if (trimmed) {
						area.repoId = trimmed;
					} else {
						delete area.repoId;
					}
				}
			}
		}

		return section;
	} catch {
		return deepClone(DEFAULT_TASK_RUNNER_SECTION);
	}
}

/**
 * Load orchestrator settings from `task-orchestrator.yaml`.
 *
 * Checks both standard layout (`<root>/.pi/task-orchestrator.yaml`) and
 * flat layout (`<root>/task-orchestrator.yaml`) — see `resolveConfigFilePath`.
 * Maps snake_case YAML keys to the camelCase OrchestratorSection shape.
 * Uses section-aware mapping that preserves user-defined record keys.
 * Returns cloned defaults if the file doesn't exist or is malformed.
 */
function loadOrchestratorYaml(configRoot: string): OrchestratorSection {
	const yamlPath = resolveConfigFilePath(configRoot, "task-orchestrator.yaml");
	if (!existsSync(yamlPath)) return deepClone(DEFAULT_ORCHESTRATOR_SECTION);

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return deepClone(DEFAULT_ORCHESTRATOR_SECTION);

		// Section-aware mapping: structural keys → camelCase, record keys → preserved
		const mapped = mapOrchestratorYaml(loaded);

		// Deep merge with cloned defaults
		const section = deepClone(DEFAULT_ORCHESTRATOR_SECTION);
		deepMerge(section, mapped);

		return section;
	} catch {
		return deepClone(DEFAULT_ORCHESTRATOR_SECTION);
	}
}


// ── User Preferences (Layer 2) ───────────────────────────────────────

/**
 * Resolve the absolute path to the user preferences file.
 *
 * Resolution order:
 *   1. `PI_CODING_AGENT_DIR` env → `<value>/taskplane/preferences.json`
 *   2. `os.homedir()/.pi/agent/taskplane/preferences.json`
 *
 * Uses `os.homedir()` for cross-platform home resolution
 * (USERPROFILE on Windows, HOME on Unix) and `path.join()` for separators.
 */
export function resolveUserPreferencesPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (agentDir) {
		return join(agentDir, USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
	}
	return join(homedir(), ".pi", "agent", USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
}

/**
 * Load user preferences from `~/.pi/agent/taskplane/preferences.json`.
 *
 * Behavior:
 * - If file doesn't exist: auto-create with empty defaults `{}`, return defaults
 * - If file is malformed JSON: log warning, return defaults (non-destructive)
 * - Unknown keys are silently ignored (only allowlisted fields extracted)
 * - Returns a fresh UserPreferences object on each call
 *
 * @returns Parsed UserPreferences (only recognized fields)
 */
export function loadUserPreferences(): UserPreferences {
	const prefsPath = resolveUserPreferencesPath();

	if (!existsSync(prefsPath)) {
		// Auto-create with empty defaults on first access
		try {
			const dir = join(prefsPath, "..");
			mkdirSync(dir, { recursive: true });
			writeFileSync(prefsPath, JSON.stringify(DEFAULT_USER_PREFERENCES, null, 2) + "\n", "utf-8");
		} catch {
			// Best-effort; if we can't create, just return defaults
		}
		return { ...DEFAULT_USER_PREFERENCES };
	}

	let raw: string;
	try {
		raw = readFileSync(prefsPath, "utf-8");
	} catch {
		return { ...DEFAULT_USER_PREFERENCES };
	}

	let parsed: any;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Malformed JSON — return defaults without overwriting (non-destructive)
		return { ...DEFAULT_USER_PREFERENCES };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ...DEFAULT_USER_PREFERENCES };
	}

	// Extract only allowlisted fields — unknown keys are ignored
	return extractAllowlistedPreferences(parsed);
}

/**
 * Extract only recognized/allowlisted fields from a raw parsed object.
 * Unknown keys are silently dropped — this is the Layer 2 boundary guardrail.
 */
function extractAllowlistedPreferences(raw: Record<string, any>): UserPreferences {
	const prefs: UserPreferences = {};

	if (typeof raw.operatorId === "string") prefs.operatorId = raw.operatorId;
	if (typeof raw.tmuxPrefix === "string") prefs.tmuxPrefix = raw.tmuxPrefix;
	if (raw.spawnMode === "tmux" || raw.spawnMode === "subprocess") prefs.spawnMode = raw.spawnMode;
	if (typeof raw.workerModel === "string") prefs.workerModel = raw.workerModel;
	if (typeof raw.reviewerModel === "string") prefs.reviewerModel = raw.reviewerModel;
	if (typeof raw.mergeModel === "string") prefs.mergeModel = raw.mergeModel;
	if (typeof raw.dashboardPort === "number" && Number.isFinite(raw.dashboardPort)) {
		prefs.dashboardPort = raw.dashboardPort;
	}

	return prefs;
}

/**
 * Apply user preferences (Layer 2) onto a project config (Layer 1).
 *
 * Only allowlisted fields are applied. User preferences win for Layer 2
 * fields; all other config fields (Layer 1) are left untouched.
 *
 * Mutates `config` in place and returns it for chaining.
 *
 * Empty-string preference values are treated as "not set" and do NOT
 * override the project config value. This lets users clear a preference
 * by deleting the field or setting it to "".
 *
 * Mapping table:
 *   prefs.operatorId    → config.orchestrator.orchestrator.operatorId
 *   prefs.tmuxPrefix    → config.orchestrator.orchestrator.tmuxPrefix
 *   prefs.spawnMode     → config.orchestrator.orchestrator.spawnMode
 *   prefs.workerModel   → config.taskRunner.worker.model
 *   prefs.reviewerModel → config.taskRunner.reviewer.model
 *   prefs.mergeModel    → config.orchestrator.merge.model
 *   prefs.dashboardPort → (no config target yet — stored only)
 */
export function applyUserPreferences(config: TaskplaneConfig, prefs: UserPreferences): TaskplaneConfig {
	// Helper: only apply non-empty string values
	const applyStr = (val: string | undefined, setter: (v: string) => void) => {
		if (val !== undefined && val !== "") setter(val);
	};

	applyStr(prefs.operatorId, (v) => { config.orchestrator.orchestrator.operatorId = v; });
	applyStr(prefs.tmuxPrefix, (v) => { config.orchestrator.orchestrator.tmuxPrefix = v; });
	applyStr(prefs.workerModel, (v) => { config.taskRunner.worker.model = v; });
	applyStr(prefs.reviewerModel, (v) => { config.taskRunner.reviewer.model = v; });
	applyStr(prefs.mergeModel, (v) => { config.orchestrator.merge.model = v; });

	// spawnMode: enum — apply if defined (not a string-empty check)
	if (prefs.spawnMode !== undefined) {
		config.orchestrator.orchestrator.spawnMode = prefs.spawnMode;
	}

	// dashboardPort: no config schema target yet — intentionally not applied
	// It can be read directly from loadUserPreferences() by consumers that need it.

	return config;
}


// ── Unified Loader ───────────────────────────────────────────────────

/**
 * Check whether any config files exist under the given root.
 *
 * Supports both standard layout (`<root>/.pi/<file>`) and flat layout
 * (`<root>/<file>`). Returns true if any recognized config file is found
 * in either location. This allows pointer-resolved roots (e.g.,
 * `<configRepo>/.taskplane/`) where files are scaffolded directly
 * without a `.pi/` subdirectory.
 */
function hasConfigFiles(root: string): boolean {
	const files = [PROJECT_CONFIG_FILENAME, "task-runner.yaml", "task-orchestrator.yaml"];
	for (const f of files) {
		if (existsSync(join(root, ".pi", f)) || existsSync(join(root, f))) return true;
	}
	return false;
}

/**
 * Resolve the config root directory.
 *
 * In workspace mode, workers run in repo worktrees — not the workspace root.
 * TASKPLANE_WORKSPACE_ROOT tells us where config files actually live.
 * The pointer file (`taskplane-pointer.json`) can redirect config loading
 * to a specific repo's config path.
 *
 * Resolution order:
 *   1. If `cwd` has actual config files → use cwd (local override wins)
 *   2. If `pointerConfigRoot` is set and has config files → use it (pointer redirect)
 *   3. If TASKPLANE_WORKSPACE_ROOT is set and has config files → use it (legacy fallback)
 *   4. Fall back to cwd (loaders will return defaults)
 *
 * We check for actual config files — not just the `.pi/` directory —
 * because worktrees may have a sidecar `.pi` without config files.
 *
 * @param cwd - Current working directory (project root or worktree)
 * @param pointerConfigRoot - Resolved config root from pointer file (optional, workspace mode only)
 */
export function resolveConfigRoot(cwd: string, pointerConfigRoot?: string): string {
	// Prefer cwd if it has actual config files (local override always wins)
	if (hasConfigFiles(cwd)) return cwd;

	// Pointer-resolved config root — workspace mode with valid pointer
	if (pointerConfigRoot && hasConfigFiles(pointerConfigRoot)) return pointerConfigRoot;

	// Workspace mode fallback — check for actual config files at workspace root
	const wsRoot = process.env.TASKPLANE_WORKSPACE_ROOT;
	if (wsRoot && hasConfigFiles(wsRoot)) return wsRoot;

	// Fall back to cwd even without config files — loaders will return defaults
	return cwd;
}

/**
 * Load the unified project configuration.
 *
 * Precedence (layered):
 *   Layer 1 — Project config:
 *     1. `.pi/taskplane-config.json` — JSON-first (new format)
 *     2. `.pi/task-runner.yaml` + `.pi/task-orchestrator.yaml` — YAML fallback
 *     3. Defaults — if no config files exist
 *
 *   Layer 2 — User preferences (applied on top of Layer 1):
 *     Reads `~/.pi/agent/taskplane/preferences.json` and overrides only
 *     allowlisted user-scoped fields. See `applyUserPreferences()` for
 *     the field mapping.
 *
 * Config root resolution order:
 *   1. cwd has config files → use cwd (local override)
 *   2. pointerConfigRoot has config files → use it (pointer redirect, workspace mode)
 *   3. TASKPLANE_WORKSPACE_ROOT has config files → use it (legacy fallback)
 *   4. Fall back to cwd (loaders will return defaults)
 *
 * @param cwd - Current working directory (project root or worktree)
 * @param pointerConfigRoot - Resolved config root from pointer file (optional).
 *   Callers in workspace mode should resolve the pointer via `resolvePointer()`
 *   and pass `result.configRoot` here. In repo mode, omit or pass undefined.
 * @returns Unified TaskplaneConfig — always a fresh deep-cloned object
 * @throws ConfigLoadError if JSON exists but is malformed or has unsupported version
 */
export function loadProjectConfig(cwd: string, pointerConfigRoot?: string): TaskplaneConfig {
	const configRoot = resolveConfigRoot(cwd, pointerConfigRoot);

	// Layer 1: Project config
	let config: TaskplaneConfig;

	// Try JSON first
	const jsonConfig = loadJsonConfig(configRoot);
	if (jsonConfig !== null) {
		config = jsonConfig;
	} else {
		// Fall back to YAML
		const taskRunner = loadTaskRunnerYaml(configRoot);
		const orchestrator = loadOrchestratorYaml(configRoot);
		config = {
			configVersion: CONFIG_VERSION,
			taskRunner,
			orchestrator,
		};
	}

	// Layer 2: User preferences (allowlisted fields only)
	const prefs = loadUserPreferences();
	applyUserPreferences(config, prefs);

	return config;
}

/**
 * Load Layer 1 config only (project config without user preferences).
 *
 * Returns the project config merged with defaults, but WITHOUT applying
 * Layer 2 user preferences. Used by the settings TUI write-back to
 * bootstrap a JSON config file from YAML-only projects without
 * accidentally embedding user preferences into the project config.
 *
 * @param cwd - Current working directory (project root or worktree)
 * @param pointerConfigRoot - Optional pointer-resolved config root (workspace mode)
 * @returns Layer 1 TaskplaneConfig — always a fresh deep-cloned object
 * @throws ConfigLoadError if JSON exists but is malformed or has unsupported version
 */
export function loadLayer1Config(cwd: string, pointerConfigRoot?: string): TaskplaneConfig {
	const configRoot = resolveConfigRoot(cwd, pointerConfigRoot);

	// Try JSON first
	const jsonConfig = loadJsonConfig(configRoot);
	if (jsonConfig !== null) {
		return jsonConfig;
	}

	// Fall back to YAML
	const taskRunner = loadTaskRunnerYaml(configRoot);
	const orchestrator = loadOrchestratorYaml(configRoot);
	return {
		configVersion: CONFIG_VERSION,
		taskRunner,
		orchestrator,
	};
}


// ── Backward-Compatible Adapters ─────────────────────────────────────

// The following adapter functions convert the unified camelCase config
// back to the snake_case shapes expected by existing consumers.

/**
 * Adapter: produce the legacy `OrchestratorConfig` (snake_case) from unified config.
 *
 * Uses explicit field mapping instead of generic recursive key conversion
 * to preserve record/dictionary keys verbatim (e.g., sizeWeights S/M/L,
 * preWarm.commands keys, etc.).
 */
export function toOrchestratorConfig(config: TaskplaneConfig): import("./types.ts").OrchestratorConfig {
	const o = config.orchestrator;
	return {
		orchestrator: {
			max_lanes: o.orchestrator.maxLanes,
			worktree_location: o.orchestrator.worktreeLocation,
			worktree_prefix: o.orchestrator.worktreePrefix,
			batch_id_format: o.orchestrator.batchIdFormat,
			spawn_mode: o.orchestrator.spawnMode,
			tmux_prefix: o.orchestrator.tmuxPrefix,
			operator_id: o.orchestrator.operatorId,
			integration: o.orchestrator.integration,
		},
		dependencies: {
			source: o.dependencies.source,
			cache: o.dependencies.cache,
		},
		assignment: {
			strategy: o.assignment.strategy,
			// Preserve dictionary keys verbatim (S, M, L, XL, etc.)
			size_weights: { ...o.assignment.sizeWeights },
		},
		pre_warm: {
			auto_detect: o.preWarm.autoDetect,
			// Preserve user-defined command keys verbatim
			commands: { ...o.preWarm.commands },
			always: [...o.preWarm.always],
		},
		merge: {
			model: o.merge.model,
			tools: o.merge.tools,
			verify: [...o.merge.verify],
			order: o.merge.order,
			timeout_minutes: o.merge.timeoutMinutes ?? 10,
		},
		failure: {
			on_task_failure: o.failure.onTaskFailure,
			on_merge_failure: o.failure.onMergeFailure,
			stall_timeout: o.failure.stallTimeout,
			max_worker_minutes: o.failure.maxWorkerMinutes,
			abort_grace_period: o.failure.abortGracePeriod,
		},
		monitoring: {
			poll_interval: o.monitoring.pollInterval,
		},
		verification: {
			enabled: o.verification.enabled,
			mode: o.verification.mode,
			flaky_reruns: o.verification.flakyReruns,
		},
	};
}

/**
 * Adapter: produce the legacy `TaskRunnerConfig` (snake_case subset) from unified config.
 *
 * The orchestrator's `TaskRunnerConfig` is a subset: { task_areas, reference_docs }.
 * This adapter maps the unified shape back to that contract.
 *
 * Special handling for `repoId`: whitespace-only values are treated as undefined,
 * and non-empty values are trimmed — matching the original YAML loader behavior.
 */
export function toTaskRunnerConfig(config: TaskplaneConfig): import("./types.ts").TaskRunnerConfig {
	// task_areas needs snake_case keys inside each area too (repoId → repo_id)
	const taskAreas: Record<string, import("./types.ts").TaskArea> = {};
	for (const [name, area] of Object.entries(config.taskRunner.taskAreas)) {
		const ta: import("./types.ts").TaskArea = {
			path: area.path,
			prefix: area.prefix,
			context: area.context,
		};
		// repoId: only set if non-empty after trim (matches original YAML loader)
		if (area.repoId && typeof area.repoId === "string" && area.repoId.trim()) {
			ta.repoId = area.repoId.trim();
		}
		taskAreas[name] = ta;
	}

	// Include testing_commands for baseline fingerprinting (TP-032).
	// Only set the field when there are actual commands configured.
	const testingCommands = config.taskRunner.testing?.commands;
	const hasTestingCommands = testingCommands && Object.keys(testingCommands).length > 0;

	return {
		task_areas: taskAreas,
		reference_docs: { ...config.taskRunner.referenceDocs },
		...(hasTestingCommands ? { testing_commands: { ...testingCommands } } : {}),
	};
}

/**
 * Adapter: produce the legacy task-runner `TaskConfig` (snake_case) from unified config.
 *
 * The task-runner extension has its own `TaskConfig` interface with snake_case keys.
 * This adapter maps the unified shape back to that contract.
 */
export function toTaskConfig(config: TaskplaneConfig): {
	project: { name: string; description: string };
	paths: { tasks: string; architecture?: string };
	testing: { commands: Record<string, string> };
	standards: { docs: string[]; rules: string[] };
	standards_overrides: Record<string, { docs?: string[]; rules?: string[] }>;
	task_areas: Record<string, { path: string; [key: string]: any }>;
	worker: { model: string; tools: string; thinking: string; spawn_mode?: "subprocess" | "tmux" };
	reviewer: { model: string; tools: string; thinking: string };
	context: {
		worker_context_window: number;
		warn_percent: number;
		kill_percent: number;
		max_worker_iterations: number;
		max_review_cycles: number;
		no_progress_limit: number;
		max_worker_minutes?: number;
	};
	quality_gate: {
		enabled: boolean;
		review_model: string;
		max_review_cycles: number;
		max_fix_cycles: number;
		pass_threshold: "no_critical" | "no_important" | "all_clear";
	};
} {
	const tr = config.taskRunner;

	// Build standards_overrides with snake_case outer structure
	const stdOverrides: Record<string, { docs?: string[]; rules?: string[] }> = {};
	for (const [key, val] of Object.entries(tr.standardsOverrides)) {
		stdOverrides[key] = { docs: val.docs, rules: val.rules };
	}

	// Build task_areas
	const taskAreas: Record<string, { path: string; [key: string]: any }> = {};
	for (const [key, val] of Object.entries(tr.taskAreas)) {
		taskAreas[key] = { path: val.path, prefix: val.prefix, context: val.context };
		if (val.repoId) (taskAreas[key] as any).repo_id = val.repoId;
	}

	return {
		project: { ...tr.project },
		paths: { ...tr.paths },
		testing: { commands: { ...tr.testing.commands } },
		standards: { docs: [...tr.standards.docs], rules: [...tr.standards.rules] },
		standards_overrides: stdOverrides,
		task_areas: taskAreas,
		worker: {
			model: tr.worker.model,
			tools: tr.worker.tools,
			thinking: tr.worker.thinking,
			spawn_mode: tr.worker.spawnMode,
		},
		reviewer: { model: tr.reviewer.model, tools: tr.reviewer.tools, thinking: tr.reviewer.thinking },
		context: {
			worker_context_window: tr.context.workerContextWindow,
			warn_percent: tr.context.warnPercent,
			kill_percent: tr.context.killPercent,
			max_worker_iterations: tr.context.maxWorkerIterations,
			max_review_cycles: tr.context.maxReviewCycles,
			no_progress_limit: tr.context.noProgressLimit,
			max_worker_minutes: tr.context.maxWorkerMinutes,
		},
		quality_gate: {
			enabled: tr.qualityGate.enabled,
			review_model: tr.qualityGate.reviewModel,
			max_review_cycles: tr.qualityGate.maxReviewCycles,
			max_fix_cycles: tr.qualityGate.maxFixCycles,
			pass_threshold: tr.qualityGate.passThreshold,
		},
	};
}
