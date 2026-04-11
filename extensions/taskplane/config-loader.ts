/**
 * Unified config loader for taskplane-config.json with YAML fallback.
 *
 * Effective precedence:
 *   1. Schema defaults (internal)
 *   2. Global preferences (`~/.pi/agent/taskplane/preferences.json`)
 *   3. Project overrides (`taskplane-config.json` or YAML fallback)
 *
 * Project config is treated as sparse overrides. Missing project fields
 * fall through to global preferences, then schema defaults.
 *
 * Global preferences parsing is allowlist-based. Unknown top-level keys are
 * ignored, and malformed preferences fall back to defaults silently.
 *
 * Path resolution:
 *   Resolves config paths relative to `configRoot`. Callers should pass
 *   the project root (or TASKPLANE_WORKSPACE_ROOT fallback) as `configRoot`.
 *
 * All returned objects are deep-cloned from defaults — no cross-call mutation.
 *
 * @module config/loader
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { parse as yamlParse } from "yaml";

import {
	CONFIG_VERSION,
	PROJECT_CONFIG_FILENAME,
	DEFAULT_PROJECT_CONFIG,
	DEFAULT_GLOBAL_PREFERENCES,
	DEFAULT_BOOTSTRAP_GLOBAL_PREFERENCES,
	GLOBAL_PREFERENCES_FILENAME,
	GLOBAL_PREFERENCES_SUBDIR,
} from "./config-schema.ts";
import type {
	TaskplaneConfig,
	TaskRunnerSection,
	OrchestratorSection,
	WorkspaceSectionConfig,
	GlobalPreferences,
} from "./config-schema.ts";


// ── Error Types ──────────────────────────────────────────────────────

/**
 * Error codes for config loading failures.
 *
 * - CONFIG_JSON_MALFORMED: File exists but is not valid JSON
 * - CONFIG_VERSION_UNSUPPORTED: configVersion is not supported by this version
 * - CONFIG_VERSION_MISSING: configVersion field is missing from JSON
 * - CONFIG_LEGACY_FIELD: removed TMUX-era field/value detected; migration required
 */
export type ConfigLoadErrorCode =
	| "CONFIG_JSON_MALFORMED"
	| "CONFIG_VERSION_UNSUPPORTED"
	| "CONFIG_VERSION_MISSING"
	| "CONFIG_LEGACY_FIELD";

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

function hasOwn(obj: unknown, key: string): boolean {
	return !!obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key);
}

function normalizeInheritAlias(value: string): string {
	return value.trim().toLowerCase() === "inherit" ? "" : value;
}

/**
 * Normalize explicit "inherit" aliases to empty-string inheritance semantics.
 *
 * Empty string is the canonical value meaning "inherit from active session"
 * for per-agent model/thinking overrides.
 */
function normalizeInheritanceAliases(config: TaskplaneConfig): void {
	const normalizeField = (obj: Record<string, any>, key: string) => {
		if (typeof obj[key] === "string") {
			obj[key] = normalizeInheritAlias(obj[key]);
		}
	};

	normalizeField(config.taskRunner.worker as Record<string, any>, "model");
	normalizeField(config.taskRunner.worker as Record<string, any>, "thinking");
	normalizeField(config.taskRunner.reviewer as Record<string, any>, "model");
	normalizeField(config.taskRunner.reviewer as Record<string, any>, "thinking");
	normalizeField(config.orchestrator.merge as Record<string, any>, "model");
	normalizeField(config.orchestrator.merge as Record<string, any>, "thinking");
	normalizeField(config.orchestrator.supervisor as Record<string, any>, "model");
	normalizeField(config.taskRunner.qualityGate as Record<string, any>, "reviewModel");
}

// throwLegacyFieldError removed — replaced by auto-migration functions that fix config in-place

/**
 * Auto-migrate legacy TMUX fields in project config.
 * Renames fields in-place and writes back to disk instead of crashing.
 * @returns true if any migrations were applied
 */
/** Track whether project config migration has already run for this load cycle. */
let _projectMigrationDone = false;

/**
 * Auto-migrate legacy TMUX fields in global preferences.
 *
 * Same precedence: new key wins if both exist.
 * Writes back atomically (tmp + rename).
 *
 * @returns true if any migrations were applied
 */
function migrateGlobalPreferences(raw: Record<string, any>, prefsPath: string): boolean {
	let migrated = false;
	if (hasOwn(raw, "tmuxPrefix")) {
		if (!hasOwn(raw, "sessionPrefix") || raw.sessionPrefix === undefined) {
			raw.sessionPrefix = raw.tmuxPrefix;
		}
		delete raw.tmuxPrefix;
		console.error(`[taskplane] Auto-migrated global preference: tmuxPrefix → sessionPrefix`);
		migrated = true;
	}
	if (raw.spawnMode === "tmux") {
		raw.spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated global preference: spawnMode "tmux" → "subprocess"`);
		migrated = true;
	}
	if (raw.orchestrator?.orchestrator?.spawnMode === "tmux") {
		raw.orchestrator.orchestrator.spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated global preference: orchestrator.orchestrator.spawnMode "tmux" → "subprocess"`);
		migrated = true;
	}
	if (raw.taskRunner?.worker?.spawnMode === "tmux") {
		raw.taskRunner.worker.spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated global preference: taskRunner.worker.spawnMode "tmux" → "subprocess"`);
		migrated = true;
	}
	if (migrated) {
		try {
			const tmpPath = prefsPath + ".migration-tmp";
			writeFileSync(tmpPath, JSON.stringify(raw, null, 2) + "\n");
			renameSync(tmpPath, prefsPath);
			console.error(`[taskplane] Preferences file updated: ${prefsPath}`);
		} catch (err) {
			console.error(`[taskplane] Warning: could not persist preferences migration to disk: ${err instanceof Error ? err.message : err}`);
		}
	}
	return migrated;
}

/** Reset migration guard (for testing). @internal */
export function _resetMigrationGuard(): void { _projectMigrationDone = false; }


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

	// Model fallback (scalar — "inherit" or "fail")
	if (raw.model_fallback) result.modelFallback = raw.model_fallback;

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

	// supervisor: all keys are structural (TP-041)
	if (raw.supervisor) result.supervisor = convertStructuralKeys(raw.supervisor);

	return result;
}

/**
 * Normalize a workspace section loaded from JSON/YAML into camelCase shape.
 *
 * Compatibility: if `routing.taskPacketRepo` is missing, defaults to
 * `routing.defaultRepo` and emits a warning message.
 */
function normalizeWorkspaceSection(
	rawWorkspace: any,
	sourcePath: string,
): WorkspaceSectionConfig | undefined {
	if (!rawWorkspace || typeof rawWorkspace !== "object" || Array.isArray(rawWorkspace)) {
		return undefined;
	}

	const rawRepos = rawWorkspace.repos;
	if (!rawRepos || typeof rawRepos !== "object" || Array.isArray(rawRepos)) {
		return undefined;
	}

	const rawRouting = rawWorkspace.routing;
	if (!rawRouting || typeof rawRouting !== "object" || Array.isArray(rawRouting)) {
		return undefined;
	}

	const repos: WorkspaceSectionConfig["repos"] = {};
	for (const [repoId, repoVal] of Object.entries(rawRepos as Record<string, any>)) {
		if (!repoVal || typeof repoVal !== "object" || Array.isArray(repoVal)) continue;
		const repoObj = repoVal as Record<string, any>;
		if (typeof repoObj.path !== "string" || repoObj.path.trim() === "") continue;
		repos[repoId] = {
			path: repoObj.path,
			...(typeof repoObj.defaultBranch === "string" && repoObj.defaultBranch.trim()
				? { defaultBranch: repoObj.defaultBranch }
				: {}),
		};
	}

	const defaultRepo = typeof rawRouting.defaultRepo === "string" ? rawRouting.defaultRepo.trim() : "";
	const tasksRoot = typeof rawRouting.tasksRoot === "string" ? rawRouting.tasksRoot.trim() : "";
	let taskPacketRepo = typeof rawRouting.taskPacketRepo === "string" ? rawRouting.taskPacketRepo.trim() : "";

	if (!taskPacketRepo && defaultRepo) {
		taskPacketRepo = defaultRepo;
		console.error(
			`[taskplane] config compatibility: workspace.routing.taskPacketRepo is missing in ${sourcePath}; defaulting to workspace.routing.defaultRepo ('${defaultRepo}'). Add workspace.routing.taskPacketRepo explicitly.`,
		);
	}

	if (!tasksRoot || !defaultRepo || !taskPacketRepo) {
		return undefined;
	}

	const strict = rawRouting.strict === true;

	return {
		repos,
		routing: {
			tasksRoot,
			defaultRepo,
			taskPacketRepo,
			...(strict ? { strict: true } : {}),
		},
	};
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
function loadJsonConfig(configRoot: string): Partial<TaskplaneConfig> | null {
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

	const overrides: Partial<TaskplaneConfig> = {};
	if (parsed.taskRunner && typeof parsed.taskRunner === "object" && !Array.isArray(parsed.taskRunner)) {
		overrides.taskRunner = deepClone(parsed.taskRunner);
	}
	if (parsed.orchestrator && typeof parsed.orchestrator === "object" && !Array.isArray(parsed.orchestrator)) {
		overrides.orchestrator = deepClone(parsed.orchestrator);
	}
	if (parsed.workspace) {
		const normalizedWorkspace = normalizeWorkspaceSection(parsed.workspace, jsonPath);
		if (normalizedWorkspace) {
			overrides.workspace = normalizedWorkspace;
		}
	}

	return overrides;
}


// ── YAML Loading ─────────────────────────────────────────────────────

/**
 * Load task-runner settings from `task-runner.yaml`.
 *
 * Checks both standard layout (`<root>/.pi/task-runner.yaml`) and
 * flat layout (`<root>/task-runner.yaml`) — see `resolveConfigFilePath`.
 * Maps snake_case YAML keys to the camelCase TaskRunnerSection shape.
 * Uses section-aware mapping that preserves user-defined record keys.
 * Returns sparse overrides (empty object when missing/malformed).
 */
function loadTaskRunnerYaml(configRoot: string): Partial<TaskRunnerSection> {
	const yamlPath = resolveConfigFilePath(configRoot, "task-runner.yaml");
	if (!existsSync(yamlPath)) return {};

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return {};

		// Section-aware mapping: structural keys → camelCase, record keys → preserved
		const mapped = mapTaskRunnerYaml(loaded);

		// Post-process taskAreas: trim repoId, drop whitespace-only values
		// (matches legacy loadTaskRunnerConfig behavior from config.ts)
		if (mapped.taskAreas) {
			for (const area of Object.values(mapped.taskAreas)) {
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

		return mapped;
	} catch {
		return {};
	}
}

/**
 * Load orchestrator settings from `task-orchestrator.yaml`.
 *
 * Checks both standard layout (`<root>/.pi/task-orchestrator.yaml`) and
 * flat layout (`<root>/task-orchestrator.yaml`) — see `resolveConfigFilePath`.
 * Maps snake_case YAML keys to the camelCase OrchestratorSection shape.
 * Uses section-aware mapping that preserves user-defined record keys.
 * Returns sparse overrides (empty object when missing/malformed).
 */
function loadOrchestratorYaml(configRoot: string): Partial<OrchestratorSection> {
	const yamlPath = resolveConfigFilePath(configRoot, "task-orchestrator.yaml");
	if (!existsSync(yamlPath)) return {};

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return {};

		// Section-aware mapping: structural keys → camelCase, record keys → preserved
		return mapOrchestratorYaml(loaded);
	} catch {
		return {};
	}
}

/**
 * Load optional workspace routing config from legacy `taskplane-workspace.yaml`.
 *
 * This file is fallback-only for workspace metadata when JSON `workspace`
 * section is not present. Malformed files are ignored here — strict validation
 * still happens in workspace runtime loading (`workspace.ts`).
 */
function loadWorkspaceYaml(configRoot: string): WorkspaceSectionConfig | undefined {
	const yamlPath = resolveConfigFilePath(configRoot, "taskplane-workspace.yaml");
	if (!existsSync(yamlPath)) return undefined;

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return undefined;

		const converted = convertStructuralKeys(loaded);
		return normalizeWorkspaceSection(converted, yamlPath);
	} catch {
		return undefined;
	}
}


// ── Global Preferences (Layer 2) ─────────────────────────────────────

/**
 * Resolve the absolute path to the global preferences file.
 *
 * Resolution order:
 *   1. `PI_CODING_AGENT_DIR` env → `<value>/taskplane/preferences.json`
 *   2. `os.homedir()/.pi/agent/taskplane/preferences.json`
 *
 * Uses `os.homedir()` for cross-platform home resolution
 * (USERPROFILE on Windows, HOME on Unix) and `path.join()` for separators.
 */
export function resolveGlobalPreferencesPath(): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (agentDir) {
		return join(agentDir, GLOBAL_PREFERENCES_SUBDIR, GLOBAL_PREFERENCES_FILENAME);
	}
	return join(homedir(), ".pi", "agent", GLOBAL_PREFERENCES_SUBDIR, GLOBAL_PREFERENCES_FILENAME);
}

/** Result envelope for global preferences loading. */
export interface GlobalPreferencesLoadResult {
	preferences: GlobalPreferences;
	wasBootstrapped: boolean;
}

/** Persist preferences JSON atomically (temp file + rename). */
function writePreferencesAtomically(prefsPath: string, prefs: GlobalPreferences): void {
	const tmpPath = `${prefsPath}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmpPath, JSON.stringify(prefs, null, 2) + "\n", "utf-8");
	renameSync(tmpPath, prefsPath);
}

/**
 * Write first-install bootstrap preferences to disk and return the in-memory seed.
 */
function bootstrapGlobalPreferencesFile(prefsPath: string): GlobalPreferences {
	const bootstrapPrefs = deepClone(DEFAULT_BOOTSTRAP_GLOBAL_PREFERENCES);
	try {
		const dir = join(prefsPath, "..");
		mkdirSync(dir, { recursive: true });
		writePreferencesAtomically(prefsPath, bootstrapPrefs);
	} catch {
		// Best-effort; if we can't create, still return bootstrap defaults in-memory.
	}
	return bootstrapPrefs;
}

/**
 * Load global preferences plus bootstrap metadata.
 *
 * Behavior:
 * - If file doesn't exist: bootstrap preferences on disk and mark bootstrapped
 * - If file is empty/malformed/invalid: re-bootstrap preferences and mark bootstrapped
 * - Unknown keys are silently ignored (allowlist extraction)
 */
export function loadGlobalPreferencesWithMeta(): GlobalPreferencesLoadResult {
	const prefsPath = resolveGlobalPreferencesPath();

	if (!existsSync(prefsPath)) {
		return {
			preferences: bootstrapGlobalPreferencesFile(prefsPath),
			wasBootstrapped: true,
		};
	}

	let raw: string;
	try {
		raw = readFileSync(prefsPath, "utf-8");
	} catch {
		return { preferences: deepClone(DEFAULT_GLOBAL_PREFERENCES), wasBootstrapped: false };
	}

	if (!raw.trim()) {
		return {
			preferences: bootstrapGlobalPreferencesFile(prefsPath),
			wasBootstrapped: true,
		};
	}

	let parsed: any;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			preferences: bootstrapGlobalPreferencesFile(prefsPath),
			wasBootstrapped: true,
		};
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
		return {
			preferences: bootstrapGlobalPreferencesFile(prefsPath),
			wasBootstrapped: true,
		};
	}

	return {
		preferences: extractAllowlistedPreferences(parsed, prefsPath),
		wasBootstrapped: false,
	};
}

/**
 * Load global preferences from `~/.pi/agent/taskplane/preferences.json`.
 *
 * @returns Parsed GlobalPreferences (only recognized fields)
 */
export function loadGlobalPreferences(): GlobalPreferences {
	return loadGlobalPreferencesWithMeta().preferences;
}

/**
 * Extract only recognized/allowlisted fields from a raw parsed object.
 * Unknown keys are silently dropped — this is the Layer 2 boundary guardrail.
 */
function normalizePreferenceThinkingMode(value: unknown): string {
	const cleaned = String(value ?? "").trim().toLowerCase();
	if (!cleaned || cleaned === "inherit") return "";
	if (cleaned === "on") return "high";
	if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(cleaned)) {
		return cleaned;
	}
	return "";
}

function extractInitAgentDefaults(rawInitDefaults: unknown): GlobalPreferences["initAgentDefaults"] | undefined {
	if (!rawInitDefaults || typeof rawInitDefaults !== "object" || Array.isArray(rawInitDefaults)) {
		return undefined;
	}

	const raw = rawInitDefaults as Record<string, unknown>;
	const extracted: NonNullable<GlobalPreferences["initAgentDefaults"]> = {};

	if (typeof raw.workerModel === "string") extracted.workerModel = raw.workerModel;
	if (typeof raw.reviewerModel === "string") extracted.reviewerModel = raw.reviewerModel;
	if (typeof raw.mergeModel === "string") extracted.mergeModel = raw.mergeModel;
	if (raw.workerThinking !== undefined) extracted.workerThinking = normalizePreferenceThinkingMode(raw.workerThinking);
	if (raw.reviewerThinking !== undefined) extracted.reviewerThinking = normalizePreferenceThinkingMode(raw.reviewerThinking);
	if (raw.mergeThinking !== undefined) extracted.mergeThinking = normalizePreferenceThinkingMode(raw.mergeThinking);

	return Object.keys(extracted).length > 0 ? extracted : undefined;
}

function extractConfigOverrideSection(rawSection: unknown): Record<string, any> | undefined {
	if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) {
		return undefined;
	}
	return deepClone(rawSection as Record<string, any>);
}

function extractAllowlistedPreferences(raw: Record<string, any>, prefsPath: string): GlobalPreferences {
	migrateGlobalPreferences(raw, prefsPath);

	const prefs: GlobalPreferences = {};

	const taskRunnerOverrides = extractConfigOverrideSection(raw.taskRunner);
	if (taskRunnerOverrides) {
		prefs.taskRunner = taskRunnerOverrides as GlobalPreferences["taskRunner"];
	}

	const orchestratorOverrides = extractConfigOverrideSection(raw.orchestrator);
	if (orchestratorOverrides) {
		prefs.orchestrator = orchestratorOverrides as GlobalPreferences["orchestrator"];
	}

	const workspaceOverrides = extractConfigOverrideSection(raw.workspace);
	if (workspaceOverrides) {
		prefs.workspace = workspaceOverrides as GlobalPreferences["workspace"];
	}

	// Legacy flat aliases (backward compatibility for existing preferences.json files)
	if (typeof raw.operatorId === "string") prefs.operatorId = raw.operatorId;
	if (typeof raw.sessionPrefix === "string") {
		prefs.sessionPrefix = raw.sessionPrefix;
	}
	if (raw.spawnMode === "subprocess") {
		prefs.spawnMode = "subprocess";
	}
	if (typeof raw.workerModel === "string") prefs.workerModel = raw.workerModel;
	if (typeof raw.reviewerModel === "string") prefs.reviewerModel = raw.reviewerModel;
	if (typeof raw.mergeModel === "string") prefs.mergeModel = raw.mergeModel;
	if (typeof raw.mergeThinking === "string") prefs.mergeThinking = raw.mergeThinking;
	if (typeof raw.supervisorModel === "string") prefs.supervisorModel = raw.supervisorModel;

	// Preferences-only fields (intentionally not merged into runtime config)
	if (typeof raw.dashboardPort === "number" && Number.isFinite(raw.dashboardPort)) {
		prefs.dashboardPort = raw.dashboardPort;
	}
	const initAgentDefaults = extractInitAgentDefaults(raw.initAgentDefaults);
	if (initAgentDefaults) {
		prefs.initAgentDefaults = initAgentDefaults;
	}

	return prefs;
}

/**
 * Apply global preferences (Layer 2) onto a project config (Layer 1).
 *
 * Merge order inside Layer 2:
 *   1. Legacy flat aliases (for backward compatibility)
 *   2. Config-shaped nested overrides (`taskRunner` / `orchestrator` / `workspace`)
 *      Nested overrides intentionally win when both styles are present.
 *
 * Preferences-only fields (`dashboardPort`, `initAgentDefaults`) are preserved
 * in `GlobalPreferences` but intentionally not merged into runtime config.
 */
export function applyGlobalPreferences(config: TaskplaneConfig, prefs: GlobalPreferences): TaskplaneConfig {
	// Helper: only apply non-empty string values
	const applyStr = (val: string | undefined, setter: (v: string) => void) => {
		if (val !== undefined && val !== "") setter(val);
	};

	// 1) Legacy flat aliases
	applyStr(prefs.operatorId, (v) => { config.orchestrator.orchestrator.operatorId = v; });
	applyStr(prefs.sessionPrefix, (v) => { config.orchestrator.orchestrator.sessionPrefix = v; });
	applyStr(prefs.workerModel, (v) => { config.taskRunner.worker.model = v; });
	applyStr(prefs.reviewerModel, (v) => { config.taskRunner.reviewer.model = v; });
	applyStr(prefs.mergeModel, (v) => { config.orchestrator.merge.model = v; });
	applyStr(prefs.mergeThinking, (v) => { config.orchestrator.merge.thinking = v; });
	applyStr(prefs.supervisorModel, (v) => { config.orchestrator.supervisor.model = v; });

	// spawnMode: enum — apply if defined (not a string-empty check)
	if (prefs.spawnMode !== undefined) {
		if (prefs.spawnMode === "tmux") {
			prefs.spawnMode = "subprocess";
			console.error(`[taskplane] Auto-migrated runtime preference: spawnMode "tmux" → "subprocess"`);
		}
		config.orchestrator.orchestrator.spawnMode = prefs.spawnMode;
	}

	// 2) Config-shaped nested overrides
	if (prefs.taskRunner) {
		deepMerge(config.taskRunner as Record<string, any>, prefs.taskRunner as Record<string, any>);
	}
	if (prefs.orchestrator) {
		deepMerge(config.orchestrator as Record<string, any>, prefs.orchestrator as Record<string, any>);
	}
	if (prefs.workspace) {
		if (!config.workspace || typeof config.workspace !== "object") {
			config.workspace = {} as TaskplaneConfig["workspace"];
		}
		deepMerge(config.workspace as Record<string, any>, prefs.workspace as Record<string, any>);
	}

	// Runtime safety: nested legacy values may arrive through config-shaped overrides.
	if ((config.orchestrator.orchestrator as Record<string, any>).spawnMode === "tmux") {
		config.orchestrator.orchestrator.spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated runtime global preference: orchestrator.orchestrator.spawnMode "tmux" → "subprocess"`);
	}
	if ((config.taskRunner.worker as Record<string, any>).spawnMode === "tmux") {
		config.taskRunner.worker.spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated runtime global preference: taskRunner.worker.spawnMode "tmux" → "subprocess"`);
	}

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
 *
 * Includes optional workspace YAML (`taskplane-workspace.yaml`) so
 * workspace-only roots participate in config-root resolution.
 */
export function hasConfigFiles(root: string): boolean {
	// Check for actual project config files (not workspace YAML — that's a
	// coordination file, not a project config). Without this distinction,
	// workspace root's .pi/taskplane-workspace.yaml causes resolveConfigRoot
	// to short-circuit before checking the pointer-resolved config root (#424).
	const files = [
		PROJECT_CONFIG_FILENAME,
		"task-runner.yaml",
		"task-orchestrator.yaml",
	];
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

function mergeProjectOverrides(config: TaskplaneConfig, overrides: Partial<TaskplaneConfig>): void {
	if (overrides.taskRunner) {
		deepMerge(config.taskRunner as Record<string, any>, overrides.taskRunner as Record<string, any>);
	}
	if (overrides.orchestrator) {
		deepMerge(config.orchestrator as Record<string, any>, overrides.orchestrator as Record<string, any>);
	}
	if (overrides.workspace) {
		if (!config.workspace || typeof config.workspace !== "object") {
			config.workspace = {} as TaskplaneConfig["workspace"];
		}
		deepMerge(config.workspace as Record<string, any>, overrides.workspace as Record<string, any>);
	}
}

function migrateProjectOverrides(overrides: Partial<TaskplaneConfig>, configRoot: string): boolean {
	if (_projectMigrationDone) return false;

	let migrated = false;
	const orchestratorCore = overrides.orchestrator?.orchestrator as Record<string, unknown> | undefined;
	if (orchestratorCore && hasOwn(orchestratorCore, "tmuxPrefix")) {
		const currentPrefix = orchestratorCore.sessionPrefix;
		const isDefault = currentPrefix === undefined || currentPrefix === "orch";
		if (isDefault) {
			(orchestratorCore as any).sessionPrefix = orchestratorCore.tmuxPrefix;
		}
		delete orchestratorCore.tmuxPrefix;
		console.error(`[taskplane] Auto-migrated: orchestrator.orchestrator.tmuxPrefix → sessionPrefix`);
		migrated = true;
	}
	if (orchestratorCore?.spawnMode === "tmux") {
		(orchestratorCore as any).spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated: orchestrator.orchestrator.spawnMode "tmux" → "subprocess"`);
		migrated = true;
	}

	const workerConfig = overrides.taskRunner?.worker as Record<string, unknown> | undefined;
	if (workerConfig?.spawnMode === "tmux") {
		(workerConfig as any).spawnMode = "subprocess";
		console.error(`[taskplane] Auto-migrated: taskRunner.worker.spawnMode "tmux" → "subprocess"`);
		migrated = true;
	}

	if (migrated) {
		try {
			const jsonPath = resolveConfigFilePath(configRoot, PROJECT_CONFIG_FILENAME);
			if (existsSync(jsonPath)) {
				const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
				if (raw.orchestrator?.orchestrator?.tmuxPrefix !== undefined) {
					const rawPrefix = raw.orchestrator.orchestrator.sessionPrefix;
					if (rawPrefix === undefined || rawPrefix === "orch") {
						raw.orchestrator.orchestrator.sessionPrefix = raw.orchestrator.orchestrator.tmuxPrefix;
					}
					delete raw.orchestrator.orchestrator.tmuxPrefix;
				}
				if (raw.orchestrator?.orchestrator?.spawnMode === "tmux") {
					raw.orchestrator.orchestrator.spawnMode = "subprocess";
				}
				if (raw.taskRunner?.worker?.spawnMode === "tmux") {
					raw.taskRunner.worker.spawnMode = "subprocess";
				}

				const tmpPath = jsonPath + ".migration-tmp";
				writeFileSync(tmpPath, JSON.stringify(raw, null, 2) + "\n");
				renameSync(tmpPath, jsonPath);
				console.error(`[taskplane] Config file updated: ${jsonPath}`);
			}
		} catch (err) {
			console.error(`[taskplane] Warning: could not persist config migration to disk: ${err instanceof Error ? err.message : err}`);
		}
	}

	_projectMigrationDone = true;
	return migrated;
}

export function loadProjectOverrides(configRoot: string): Partial<TaskplaneConfig> {
	const jsonOverrides = loadJsonConfig(configRoot);
	if (jsonOverrides !== null) {
		return jsonOverrides;
	}

	const taskRunner = loadTaskRunnerYaml(configRoot);
	const orchestrator = loadOrchestratorYaml(configRoot);
	const workspace = loadWorkspaceYaml(configRoot);

	const overrides: Partial<TaskplaneConfig> = {};
	if (Object.keys(taskRunner).length > 0) overrides.taskRunner = taskRunner;
	if (Object.keys(orchestrator).length > 0) overrides.orchestrator = orchestrator;
	if (workspace) overrides.workspace = workspace;
	return overrides;
}

/**
 * Load the unified project configuration.
 *
 * Precedence (layered):
 *   1. Schema defaults
 *   2. Global preferences (`~/.pi/agent/taskplane/preferences.json`)
 *   3. Project overrides (`taskplane-config.json` or YAML fallback)
 *
 * Project config is treated as sparse overrides. Missing fields in project
 * config fall through to global preferences, then schema defaults.
 */
export function loadProjectConfig(cwd: string, pointerConfigRoot?: string): TaskplaneConfig {
	const configRoot = resolveConfigRoot(cwd, pointerConfigRoot);
	const config = deepClone(DEFAULT_PROJECT_CONFIG);

	// Layer 2 baseline: global preferences on top of defaults
	const prefs = loadGlobalPreferences();
	applyGlobalPreferences(config, prefs);

	// Layer 1 project overrides: sparse config merged on top
	const overrides = loadProjectOverrides(configRoot);
	_projectMigrationDone = false;
	migrateProjectOverrides(overrides, configRoot);
	mergeProjectOverrides(config, overrides);

	normalizeInheritanceAliases(config);
	return config;
}

/**
 * Load project overrides merged with schema defaults, without applying
 * global preferences. Used by settings write-back code paths that must
 * avoid embedding global baseline values into project config.
 */
export function loadLayer1Config(cwd: string, pointerConfigRoot?: string): TaskplaneConfig {
	const configRoot = resolveConfigRoot(cwd, pointerConfigRoot);
	const config = deepClone(DEFAULT_PROJECT_CONFIG);
	const overrides = loadProjectOverrides(configRoot);

	_projectMigrationDone = false;
	migrateProjectOverrides(overrides, configRoot);
	mergeProjectOverrides(config, overrides);

	normalizeInheritanceAliases(config);
	return config;
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
			sessionPrefix: o.orchestrator.sessionPrefix,
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
			thinking: o.merge.thinking,
			verify: [...o.merge.verify],
			order: o.merge.order,
			timeout_minutes: o.merge.timeoutMinutes ?? 90,
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
		model_fallback: config.taskRunner.modelFallback ?? "inherit",
		reviewer: {
			model: config.taskRunner.reviewer.model,
			thinking: config.taskRunner.reviewer.thinking,
			tools: config.taskRunner.reviewer.tools,
		},
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
	worker: { model: string; tools: string; thinking: string; spawn_mode?: "subprocess" };
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
