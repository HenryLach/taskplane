/**
 * Settings TUI — interactive configuration viewer and editor.
 *
 * Provides a `/settings` command that renders a two-level navigation:
 *   1. Section selector (12 sections)
 *   2. Per-section SettingsList with field display, source badges,
 *      and inline editing for enum/boolean/string/number fields
 *
 * Source detection reads raw config files (before defaults merge) to
 * determine whether each field value comes from project config, user
 * preferences, or schema defaults.
 *
 * Write-back targets the correct destination per field layer:
 *   - L1-only → project JSON, L2-only → preferences JSON,
 *   - L1+L2 → user chooses destination via ctx.ui.select()
 *
 * @module settings/tui
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { parse as yamlParse } from "yaml";

import {
	CONFIG_VERSION,
	DEFAULT_PROJECT_CONFIG,
	PROJECT_CONFIG_FILENAME,
	type TaskplaneConfig,
	type UserPreferences,
} from "./config-schema.ts";
import {
	loadUserPreferences,
	loadProjectConfig,
	loadLayer1Config,
	resolveConfigRoot,
	resolveUserPreferencesPath,
} from "./config-loader.ts";


// ── Types ────────────────────────────────────────────────────────────

/** Source of a field's current value */
export type FieldSource = "default" | "project" | "user";

/** Layer assignment for a field */
export type FieldLayer = "L1" | "L2" | "L1+L2";

/** UI control type for a field */
export type FieldControl = "toggle" | "input";

/** Field definition for the settings TUI */
export interface FieldDef {
	/** Dot-separated config path (e.g., "orchestrator.orchestrator.maxLanes") */
	configPath: string;
	/** Human-readable label */
	label: string;
	/** UI control type */
	control: FieldControl;
	/** Layer assignment */
	layer: FieldLayer;
	/** For toggle fields: list of allowed values */
	values?: string[];
	/** Field type for validation */
	fieldType: "string" | "number" | "boolean" | "enum";
	/** Whether the field is optional (can be unset) */
	optional?: boolean;
	/** For L1+L2 fields: the user preferences key */
	prefsKey?: keyof UserPreferences;
	/** Description shown when selected */
	description?: string;
}

/** Section definition */
export interface SectionDef {
	/** Section display name */
	name: string;
	/** Fields in this section */
	fields: FieldDef[];
	/** Whether this section is read-only (Advanced) */
	readOnly?: boolean;
}


// ── Section & Field Definitions ──────────────────────────────────────

/**
 * Canonical navigation map — 12 sections.
 * Order matches the Step 1 design in STATUS.md.
 */
export const SECTIONS: SectionDef[] = [
	{
		name: "Orchestrator",
		fields: [
			{ configPath: "orchestrator.orchestrator.maxLanes", label: "Max Lanes", control: "input", layer: "L1", fieldType: "number", description: "Maximum parallel execution lanes" },
			{ configPath: "orchestrator.orchestrator.worktreeLocation", label: "Worktree Location", control: "toggle", layer: "L1", fieldType: "enum", values: ["sibling", "subdirectory"], description: "Where lane worktree directories are created" },
			{ configPath: "orchestrator.orchestrator.worktreePrefix", label: "Worktree Prefix", control: "input", layer: "L1", fieldType: "string", description: "Prefix for worktree directory names" },
			{ configPath: "orchestrator.orchestrator.batchIdFormat", label: "Batch ID Format", control: "toggle", layer: "L1", fieldType: "enum", values: ["timestamp", "sequential"], description: "Batch ID format for logs/branch naming" },
			{ configPath: "orchestrator.orchestrator.spawnMode", label: "Spawn Mode", control: "toggle", layer: "L1+L2", fieldType: "enum", values: ["tmux", "subprocess"], prefsKey: "spawnMode", description: "How lane sessions are spawned" },
			{ configPath: "orchestrator.orchestrator.tmuxPrefix", label: "Tmux Prefix", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "tmuxPrefix", description: "Prefix for orchestrator tmux sessions" },
			{ configPath: "orchestrator.orchestrator.operatorId", label: "Operator ID", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "operatorId", description: "Operator identifier (empty = auto-detect)" },
		],
	},
	{
		name: "Dependencies",
		fields: [
			{ configPath: "orchestrator.dependencies.source", label: "Dep Source", control: "toggle", layer: "L1", fieldType: "enum", values: ["prompt", "agent"], description: "Dependency extraction source" },
			{ configPath: "orchestrator.dependencies.cache", label: "Dep Cache", control: "toggle", layer: "L1", fieldType: "boolean", values: ["true", "false"], description: "Cache dependency analysis results" },
		],
	},
	{
		name: "Assignment",
		fields: [
			{ configPath: "orchestrator.assignment.strategy", label: "Strategy", control: "toggle", layer: "L1", fieldType: "enum", values: ["affinity-first", "round-robin", "load-balanced"], description: "Lane assignment strategy" },
		],
	},
	{
		name: "Pre-Warm",
		fields: [
			{ configPath: "orchestrator.preWarm.autoDetect", label: "Auto-Detect", control: "toggle", layer: "L1", fieldType: "boolean", values: ["true", "false"], description: "Enable automatic pre-warm command detection" },
		],
	},
	{
		name: "Merge",
		fields: [
			{ configPath: "orchestrator.merge.model", label: "Merge Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "mergeModel", description: "Merge-agent model (empty = inherit session)" },
			{ configPath: "orchestrator.merge.tools", label: "Merge Tools", control: "input", layer: "L1", fieldType: "string", description: "Merge-agent tool allowlist" },
			{ configPath: "orchestrator.merge.order", label: "Merge Order", control: "toggle", layer: "L1", fieldType: "enum", values: ["fewest-files-first", "sequential"], description: "Lane merge ordering policy" },
			{ configPath: "orchestrator.merge.timeoutMinutes", label: "Merge Timeout (minutes)", control: "input", layer: "L1", fieldType: "number", description: "Max time for merge agent to complete. Increase for large batches (default: 10)" },
		],
	},
	{
		name: "Failure Policy",
		fields: [
			{ configPath: "orchestrator.failure.onTaskFailure", label: "On Task Failure", control: "toggle", layer: "L1", fieldType: "enum", values: ["skip-dependents", "stop-wave", "stop-all"], description: "Batch behavior when a task fails" },
			{ configPath: "orchestrator.failure.onMergeFailure", label: "On Merge Failure", control: "toggle", layer: "L1", fieldType: "enum", values: ["pause", "abort"], description: "Behavior when a merge step fails" },
			{ configPath: "orchestrator.failure.stallTimeout", label: "Stall Timeout (min)", control: "input", layer: "L1", fieldType: "number", description: "Stall detection threshold (minutes)" },
			{ configPath: "orchestrator.failure.maxWorkerMinutes", label: "Max Worker Min", control: "input", layer: "L1", fieldType: "number", description: "Max worker runtime budget per task (minutes)" },
			{ configPath: "orchestrator.failure.abortGracePeriod", label: "Abort Grace (sec)", control: "input", layer: "L1", fieldType: "number", description: "Graceful abort wait time (seconds)" },
		],
	},
	{
		name: "Monitoring",
		fields: [
			{ configPath: "orchestrator.monitoring.pollInterval", label: "Poll Interval (sec)", control: "input", layer: "L1", fieldType: "number", description: "Poll interval for lane/task monitoring (seconds)" },
		],
	},
	{
		name: "Worker",
		fields: [
			{ configPath: "taskRunner.worker.model", label: "Worker Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "workerModel", description: "Worker model (empty = inherit session)" },
			{ configPath: "taskRunner.worker.tools", label: "Worker Tools", control: "input", layer: "L1", fieldType: "string", description: "Worker tool allowlist" },
			{ configPath: "taskRunner.worker.thinking", label: "Worker Thinking", control: "input", layer: "L1", fieldType: "string", description: "Worker thinking mode" },
			{ configPath: "taskRunner.worker.spawnMode", label: "Worker Spawn Mode", control: "toggle", layer: "L1", fieldType: "enum", values: ["(inherit)", "subprocess", "tmux"], optional: true, description: "Worker spawn mode override (inherit = use orchestrator)" },
		],
	},
	{
		name: "Reviewer",
		fields: [
			{ configPath: "taskRunner.reviewer.model", label: "Reviewer Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "reviewerModel", description: "Reviewer model (empty = inherit session)" },
			{ configPath: "taskRunner.reviewer.tools", label: "Reviewer Tools", control: "input", layer: "L1", fieldType: "string", description: "Reviewer tool allowlist" },
			{ configPath: "taskRunner.reviewer.thinking", label: "Reviewer Thinking", control: "input", layer: "L1", fieldType: "string", description: "Reviewer thinking mode" },
		],
	},
	{
		name: "Context Limits",
		fields: [
			{ configPath: "taskRunner.context.workerContextWindow", label: "Context Window", control: "input", layer: "L1", fieldType: "number", description: "Worker context window size" },
			{ configPath: "taskRunner.context.warnPercent", label: "Warn %", control: "input", layer: "L1", fieldType: "number", description: "Context utilization warn threshold (%)" },
			{ configPath: "taskRunner.context.killPercent", label: "Kill %", control: "input", layer: "L1", fieldType: "number", description: "Context utilization hard-stop threshold (%)" },
			{ configPath: "taskRunner.context.maxWorkerIterations", label: "Max Iterations", control: "input", layer: "L1", fieldType: "number", description: "Max worker iterations per step" },
			{ configPath: "taskRunner.context.maxReviewCycles", label: "Max Review Cycles", control: "input", layer: "L1", fieldType: "number", description: "Max revise loops per review stage" },
			{ configPath: "taskRunner.context.noProgressLimit", label: "No Progress Limit", control: "input", layer: "L1", fieldType: "number", description: "Max no-progress iterations before failure" },
			{ configPath: "taskRunner.context.maxWorkerMinutes", label: "Max Worker Min (ctx)", control: "input", layer: "L1", fieldType: "number", optional: true, description: "Per-worker wall-clock cap (minutes, empty = no cap)" },
		],
	},
	{
		name: "User Preferences",
		fields: [
			{ configPath: "preferences.dashboardPort", label: "Dashboard Port", control: "input", layer: "L2", fieldType: "number", prefsKey: "dashboardPort", optional: true, description: "Dashboard server port" },
		],
	},
	{
		name: "Advanced (JSON Only)",
		readOnly: true,
		fields: [],  // Populated dynamically in getAdvancedItems()
	},
];


// ── Raw Config Readers (Source Detection) ────────────────────────────

/**
 * Resolve the path to a config file under the given root.
 *
 * Supports both standard layout (`<root>/.pi/<file>`) and flat layout
 * (`<root>/<file>`) used by pointer-resolved `.taskplane/` config roots.
 */
function resolveConfigFilePath(configRoot: string, filename: string): string {
	const standardPath = join(configRoot, ".pi", filename);
	if (existsSync(standardPath)) return standardPath;
	const flatPath = join(configRoot, filename);
	if (existsSync(flatPath)) return flatPath;
	return standardPath;
}

/**
 * Read the raw project config JSON as a plain object (no defaults merge).
 * Returns null if no JSON config exists. Does not throw on parse errors.
 */
export function readRawProjectJson(configRoot: string): Record<string, any> | null {
	const jsonPath = resolveConfigFilePath(configRoot, PROJECT_CONFIG_FILENAME);
	if (!existsSync(jsonPath)) return null;
	try {
		const raw = readFileSync(jsonPath, "utf-8");
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * Read raw YAML config files and merge into a single raw object
 * using the same path structure as the JSON config.
 * Returns null if no YAML files exist.
 */
export function readRawYamlConfigs(configRoot: string): Record<string, any> | null {
	const trPath = resolveConfigFilePath(configRoot, "task-runner.yaml");
	const orchPath = resolveConfigFilePath(configRoot, "task-orchestrator.yaml");
	const hasTr = existsSync(trPath);
	const hasOrch = existsSync(orchPath);
	if (!hasTr && !hasOrch) return null;

	const result: Record<string, any> = {};

	if (hasTr) {
		try {
			const raw = readFileSync(trPath, "utf-8");
			const parsed = yamlParse(raw);
			if (parsed && typeof parsed === "object") {
				result.taskRunner = convertYamlKeys(parsed, "taskRunner");
			}
		} catch { /* ignore */ }
	}

	if (hasOrch) {
		try {
			const raw = readFileSync(orchPath, "utf-8");
			const parsed = yamlParse(raw);
			if (parsed && typeof parsed === "object") {
				result.orchestrator = convertYamlKeys(parsed, "orchestrator");
			}
		} catch { /* ignore */ }
	}

	return Object.keys(result).length > 0 ? result : null;
}

/**
 * Simple snake_case to camelCase conversion for YAML key lookup.
 * Only converts top-level section keys we need for source detection.
 */
function convertYamlKeys(raw: any, section: "taskRunner" | "orchestrator"): Record<string, any> {
	const result: Record<string, any> = {};
	if (section === "taskRunner") {
		if (raw.worker) result.worker = snakeKeysToCamel(raw.worker);
		if (raw.reviewer) result.reviewer = snakeKeysToCamel(raw.reviewer);
		if (raw.context) result.context = snakeKeysToCamel(raw.context);
		if (raw.project) result.project = snakeKeysToCamel(raw.project);
		if (raw.paths) result.paths = snakeKeysToCamel(raw.paths);
		if (raw.testing) result.testing = raw.testing;
		if (raw.standards) result.standards = raw.standards;
		if (raw.standards_overrides) result.standardsOverrides = raw.standards_overrides;
		if (raw.task_areas) result.taskAreas = raw.task_areas;
		if (raw.reference_docs) result.referenceDocs = raw.reference_docs;
		if (raw.never_load) result.neverLoad = raw.never_load;
		if (raw.self_doc_targets) result.selfDocTargets = raw.self_doc_targets;
		if (raw.protected_docs) result.protectedDocs = raw.protected_docs;
	} else {
		if (raw.orchestrator) result.orchestrator = snakeKeysToCamel(raw.orchestrator);
		if (raw.dependencies) result.dependencies = snakeKeysToCamel(raw.dependencies);
		if (raw.assignment) {
			result.assignment = {};
			if (raw.assignment.strategy !== undefined) result.assignment.strategy = raw.assignment.strategy;
			if (raw.assignment.size_weights) result.assignment.sizeWeights = raw.assignment.size_weights;
		}
		if (raw.pre_warm) {
			result.preWarm = {};
			if (raw.pre_warm.auto_detect !== undefined) result.preWarm.autoDetect = raw.pre_warm.auto_detect;
			if (raw.pre_warm.commands) result.preWarm.commands = raw.pre_warm.commands;
			if (raw.pre_warm.always) result.preWarm.always = raw.pre_warm.always;
		}
		if (raw.merge) result.merge = snakeKeysToCamel(raw.merge);
		if (raw.failure) result.failure = snakeKeysToCamel(raw.failure);
		if (raw.monitoring) result.monitoring = snakeKeysToCamel(raw.monitoring);
	}
	return result;
}

/** Convert snake_case keys in a flat object to camelCase */
function snakeKeysToCamel(obj: Record<string, any>): Record<string, any> {
	const result: Record<string, any> = {};
	for (const [key, val] of Object.entries(obj)) {
		const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
		result[camelKey] = val;
	}
	return result;
}

/**
 * Read the raw user preferences JSON.
 */
function readRawPreferences(): Record<string, any> | null {
	const prefsPath = resolveUserPreferencesPath();
	if (!existsSync(prefsPath)) return null;
	try {
		const raw = readFileSync(prefsPath, "utf-8");
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}


// ── Write-Back ───────────────────────────────────────────────────────

/**
 * Set a nested value in an object by dot-path, creating intermediate
 * objects as needed. If `value` is undefined, deletes the leaf key
 * (for clearing optional fields).
 */
function setNestedValue(obj: Record<string, any>, path: string, value: any): void {
	const parts = path.split(".");
	let current = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (current[part] === undefined || current[part] === null || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part];
	}
	const leafKey = parts[parts.length - 1];
	if (value === undefined) {
		delete current[leafKey];
	} else {
		current[leafKey] = value;
	}
}

/**
 * Write a value to the project config JSON (Layer 1).
 *
 * Writes to the resolved config root using the active layout:
 * - standard: `<configRoot>/.pi/taskplane-config.json`
 * - flat: `<configRoot>/taskplane-config.json` (pointer `.taskplane/` roots)
 *
 * When no JSON config exists (YAML-only scenario), bootstraps the new
 * JSON file from the full current Layer 1 config (YAML values + defaults).
 * This preserves ALL existing YAML-set values — because JSON takes
 * precedence on next load, a partial skeleton would silently reset
 * non-edited fields to defaults.
 *
 * YAML files are preserved alongside the new JSON; the loader's
 * JSON-first precedence means the JSON file is authoritative going forward.
 *
 * Uses atomic tmp+rename write pattern to prevent partial writes.
 */
export function writeProjectConfigField(
	configRoot: string,
	configPath: string,
	value: any,
	pointerConfigRoot?: string,
): void {
	const resolvedRoot = resolveConfigRoot(configRoot, pointerConfigRoot);

	const hasStandardLayout =
		existsSync(join(resolvedRoot, ".pi", PROJECT_CONFIG_FILENAME)) ||
		existsSync(join(resolvedRoot, ".pi", "task-runner.yaml")) ||
		existsSync(join(resolvedRoot, ".pi", "task-orchestrator.yaml"));
	const hasFlatLayout =
		existsSync(join(resolvedRoot, PROJECT_CONFIG_FILENAME)) ||
		existsSync(join(resolvedRoot, "task-runner.yaml")) ||
		existsSync(join(resolvedRoot, "task-orchestrator.yaml"));
	const useFlatLayout = !hasStandardLayout && hasFlatLayout;

	const jsonPath = useFlatLayout
		? join(resolvedRoot, PROJECT_CONFIG_FILENAME)
		: join(resolvedRoot, ".pi", PROJECT_CONFIG_FILENAME);
	const tmpPath = jsonPath + ".tmp";

	// Ensure parent directory exists
	mkdirSync(dirname(jsonPath), { recursive: true });

	// Load existing JSON config, or bootstrap from full L1 config.
	// When YAML-only, we seed from loadLayer1Config to preserve all
	// YAML-sourced values (since JSON takes precedence on next load
	// and YAML values would otherwise be lost).
	let configObj: Record<string, any>;
	if (existsSync(jsonPath)) {
		try {
			const raw = readFileSync(jsonPath, "utf-8");
			configObj = JSON.parse(raw);
		} catch (e: any) {
			// Malformed JSON — cannot safely bootstrap because loadLayer1Config
			// would also fail on the same corrupt file. Surface the error so the
			// user can fix/delete the malformed JSON file first.
			throw new Error(
				`Cannot write settings: ${jsonPath} contains malformed JSON. ` +
				`Please fix or delete the file and try again. ` +
				`(Parse error: ${e.message ?? "unknown"})`,
			);
		}
	} else {
		// No JSON exists (possibly YAML-only) — bootstrap from full L1 config.
		// Deep-clone via JSON roundtrip since we mutate the object below.
		configObj = JSON.parse(JSON.stringify(loadLayer1Config(configRoot, pointerConfigRoot)));
	}

	// Set the value at the config path
	setNestedValue(configObj, configPath, value);

	// Atomic write: tmp + rename
	const json = JSON.stringify(configObj, null, 2) + "\n";
	writeFileSync(tmpPath, json, "utf-8");
	try {
		renameSync(tmpPath, jsonPath);
	} catch {
		// Windows fallback: direct write if rename fails
		writeFileSync(jsonPath, json, "utf-8");
		try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
	}
}

/**
 * Write a value to the user preferences JSON (Layer 2).
 *
 * Writes to `resolveUserPreferencesPath()`.
 * If `value` is undefined, deletes the key from the preferences file
 * (for clearing preferences).
 *
 * Uses atomic tmp+rename write pattern to prevent partial writes.
 */
export function writeUserPreference(
	prefsKey: keyof import("./config-schema.ts").UserPreferences,
	value: any,
): void {
	const prefsPath = resolveUserPreferencesPath();
	const tmpPath = prefsPath + ".tmp";

	// Ensure directory exists
	const prefsDir = dirname(prefsPath);
	if (!existsSync(prefsDir)) {
		mkdirSync(prefsDir, { recursive: true });
	}

	// Load existing prefs or create empty object
	let prefsObj: Record<string, any> = {};
	if (existsSync(prefsPath)) {
		try {
			const raw = readFileSync(prefsPath, "utf-8");
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				prefsObj = parsed;
			}
		} catch {
			// Malformed — start fresh (preserve what we can't parse)
			prefsObj = {};
		}
	}

	// Set or delete the value
	if (value === undefined) {
		delete prefsObj[prefsKey];
	} else {
		prefsObj[prefsKey] = value;
	}

	// Atomic write: tmp + rename
	const json = JSON.stringify(prefsObj, null, 2) + "\n";
	writeFileSync(tmpPath, json, "utf-8");
	try {
		renameSync(tmpPath, prefsPath);
	} catch {
		// Windows fallback: direct write if rename fails
		writeFileSync(prefsPath, json, "utf-8");
		try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
	}
}

/**
 * Convert a raw string value from the TUI into the appropriate typed
 * value for writing to config JSON.
 *
 * - Numbers: parse to number
 * - Booleans: parse "true"/"false" to boolean
 * - "(not set)" / "(inherit)": returns undefined (delete key)
 * - Strings: return as-is
 */
export function coerceValueForWrite(field: FieldDef, rawValue: string): any {
	// Strip source badge if present
	const cleaned = rawValue.replace(/\s+\((?:default|project|user)\)$/, "").trim();

	// Unset / inherit → undefined (delete key)
	if (cleaned === "(not set)" || cleaned === "(inherit)") {
		return undefined;
	}

	switch (field.fieldType) {
		case "number": {
			const num = Number(cleaned);
			return Number.isFinite(num) ? num : undefined;
		}
		case "boolean":
			return cleaned === "true";
		case "enum":
		case "string":
		default:
			return cleaned;
	}
}

/**
 * Determine the write destination for a field change.
 *
 * - L1-only → "project"
 * - L2-only → "prefs"
 * - L1+L2 → must be chosen by the user (returns null to signal "ask user")
 */
export type WriteDestination = "project" | "prefs";

export function getDefaultWriteDestination(field: FieldDef): WriteDestination | null {
	if (field.layer === "L1") return "project";
	if (field.layer === "L2") return "prefs";
	// L1+L2 → user must choose
	return null;
}

/**
 * Resolve the write action for a field change.
 *
 * Encapsulates the destination + confirmation decision tree from
 * showSectionSettingsLoop as a pure function for testability.
 *
 * @param field - The field being edited
 * @param destinationChoice - For L1+L2 fields: the user's choice from the
 *   destination select ("User preferences (personal)", "Project config (shared)",
 *   "Cancel", or null). Ignored for L1-only and L2-only fields.
 * @param projectConfirmed - For project-destination writes: whether the user
 *   confirmed the project config change. Ignored for prefs-destination writes.
 * @returns The resolved destination ("project" | "prefs") or "skip" if the
 *   user cancelled or declined confirmation.
 */
export function resolveWriteAction(
	field: FieldDef,
	destinationChoice: string | null,
	projectConfirmed: boolean,
): WriteDestination | "skip" {
	const defaultDest = getDefaultWriteDestination(field);
	let dest: WriteDestination | null = defaultDest;

	// L1+L2 fields: resolve from user's destination choice
	if (dest === null) {
		if (!destinationChoice || destinationChoice === "Cancel") return "skip";
		dest = destinationChoice.startsWith("User") ? "prefs" : "project";
	}

	// Confirmation gate for project config writes
	if (dest === "project" && !projectConfirmed) return "skip";

	return dest;
}


// ── Source Detection ─────────────────────────────────────────────────

/**
 * Get a nested value from an object by dot-path.
 * e.g., getNestedValue(obj, "orchestrator.orchestrator.maxLanes")
 */
function getNestedValue(obj: any, path: string): any {
	const parts = path.split(".");
	let current = obj;
	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") return undefined;
		current = current[part];
	}
	return current;
}

/**
 * Determine the source of a field's current value.
 *
 * Implements the source-badge rules from Step 1:
 * - For L1+L2 fields: check user prefs first (type-specific "is set" rules)
 * - Then check raw project config
 * - Fallback to default
 */
export function detectFieldSource(
	field: FieldDef,
	rawProjectConfig: Record<string, any> | null,
	rawPrefs: Record<string, any> | null,
): FieldSource {
	// L2 check for dual-layer and L2-only fields.
	// Type guards MUST match extractAllowlistedPreferences() in config-loader.ts
	// to avoid showing "(user)" for values that the merge layer would reject.
	if ((field.layer === "L1+L2" || field.layer === "L2") && field.prefsKey && rawPrefs) {
		const prefVal = rawPrefs[field.prefsKey];
		if (field.fieldType === "string") {
			// String rule: must be typeof string, non-empty → (user)
			// Matches: `typeof raw.X === "string"` AND applyUserPreferences `val !== "" `
			if (typeof prefVal === "string" && prefVal !== "") return "user";
		} else if (field.fieldType === "enum") {
			// Enum rule: must be a valid enum value from the field's values array.
			// Matches extractAllowlistedPreferences which checks exact enum membership
			// (e.g., raw.spawnMode === "tmux" || raw.spawnMode === "subprocess").
			if (prefVal !== undefined && field.values && field.values.includes(String(prefVal))) return "user";
		} else if (field.fieldType === "number") {
			// Number rule: must be typeof number and finite → (user)
			// Matches: `typeof raw.X === "number" && Number.isFinite(raw.X)`
			if (typeof prefVal === "number" && Number.isFinite(prefVal)) return "user";
		}
	}

	// L2-only fields have no project layer
	if (field.layer === "L2") return "default";

	// L1 check: look in raw project config
	if (rawProjectConfig) {
		const val = getNestedValue(rawProjectConfig, field.configPath);
		if (val !== undefined) return "project";
	}

	return "default";
}


// ── Value Formatting ─────────────────────────────────────────────────

/**
 * Get the display value for a field from the merged config.
 */
export function getFieldDisplayValue(
	field: FieldDef,
	mergedConfig: TaskplaneConfig,
	prefs: UserPreferences,
): string {
	// Special case: dashboardPort (L2-only, not in merged config)
	if (field.configPath === "preferences.dashboardPort") {
		const val = prefs.dashboardPort;
		return val !== undefined ? String(val) : "(not set)";
	}

	const val = getNestedValue(mergedConfig, field.configPath);

	// Optional fields may be undefined
	if (val === undefined) {
		if (field.optional && field.configPath === "taskRunner.worker.spawnMode") {
			return "(inherit)";
		}
		return "(not set)";
	}

	// Boolean fields: show "true"/"false"
	if (field.fieldType === "boolean") {
		return String(val);
	}

	return String(val);
}


// ── Validation ───────────────────────────────────────────────────────

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validate a user-entered value for a field.
 */
export function validateFieldInput(field: FieldDef, input: string): ValidationResult {
	// Empty input for optional fields = unset
	if (input.trim() === "" && field.optional) {
		return { valid: true };
	}

	// Empty input for required fields
	if (input.trim() === "" && !field.optional) {
		// String fields allow empty (e.g., model = "" means inherit)
		if (field.fieldType === "string") return { valid: true };
		return { valid: false, error: "Value required" };
	}

	switch (field.fieldType) {
		case "number": {
			const num = Number(input.trim());
			if (!Number.isFinite(num) || num <= 0) {
				return { valid: false, error: "Must be a positive integer" };
			}
			// Integer check for most number fields
			if (!Number.isInteger(num)) {
				return { valid: false, error: "Must be a whole number" };
			}
			return { valid: true };
		}
		case "enum": {
			if (field.values && !field.values.includes(input.trim())) {
				return { valid: false, error: `Must be one of: ${field.values.join(", ")}` };
			}
			return { valid: true };
		}
		case "string":
			return { valid: true };
		case "boolean": {
			if (input.trim() !== "true" && input.trim() !== "false") {
				return { valid: false, error: "Must be true or false" };
			}
			return { valid: true };
		}
		default:
			return { valid: true };
	}
}


// ── Advanced Section Items ───────────────────────────────────────────

export interface AdvancedItem {
	label: string;
	value: string;
	configPath: string;
}

/**
 * Build a Set of all config paths that are covered by editable sections.
 * Used to detect "uncovered" paths for the Advanced section.
 */
function buildCoveredPaths(): Set<string> {
	const covered = new Set<string>();
	for (const section of SECTIONS) {
		for (const field of section.fields) {
			covered.add(field.configPath);
		}
	}
	// Also mark the preferences-only path
	covered.add("preferences.dashboardPort");
	return covered;
}

/** Cached set of editable config paths */
const COVERED_PATHS = buildCoveredPaths();

/**
 * Convert a dot-path to a human-readable label.
 * e.g., "taskRunner.project.name" → "Project Name"
 *       "orchestrator.preWarm.commands" → "Pre-Warm Commands"
 */
function pathToLabel(path: string): string {
	const parts = path.split(".");
	// Take the last 1-2 meaningful segments (skip top-level "taskRunner"/"orchestrator")
	const meaningful = parts.slice(1); // Drop "taskRunner"/"orchestrator"/"configVersion"
	if (meaningful.length === 0) {
		// Top-level like "configVersion"
		return camelToTitle(parts[parts.length - 1]);
	}
	// For nested paths like "project.name", use last 2 segments if parent is a grouping
	if (meaningful.length >= 2) {
		return `${camelToTitle(meaningful[meaningful.length - 2])} ${camelToTitle(meaningful[meaningful.length - 1])}`;
	}
	return camelToTitle(meaningful[0]);
}

/** Convert camelCase to Title Case (e.g., "maxLanes" → "Max Lanes") */
function camelToTitle(str: string): string {
	return str
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (s) => s.toUpperCase())
		.trim();
}

/**
 * Get display items for the Advanced (JSON Only) section.
 *
 * Dynamically discovers all config paths NOT covered by editable sections
 * by recursively walking the merged config object. This ensures new fields
 * added to the schema are automatically surfaced for discoverability.
 */
export function getAdvancedItems(config: TaskplaneConfig): AdvancedItem[] {
	const items: AdvancedItem[] = [];

	// Walk the config object and collect uncovered leaf paths
	walkConfig(config, "", (path, value) => {
		if (COVERED_PATHS.has(path)) return; // Skip editable fields

		const label = pathToLabel(path);
		const display = summarizeValue(value);
		items.push({ label, value: display, configPath: path });
	});

	return items;
}

/**
 * Recursively walk a config object, calling the visitor for each "leaf" field.
 *
 * A "leaf" is either:
 * - A primitive (string, number, boolean)
 * - An array
 * - A Record/object that is a "data container" (not a known config subsection)
 *
 * Known subsection objects (like `taskRunner.worker`, `orchestrator.merge`)
 * are recursed into, not reported as leaves themselves.
 */
function walkConfig(
	obj: any,
	prefix: string,
	visitor: (path: string, value: any) => void,
): void {
	if (obj === null || obj === undefined) return;

	for (const [key, value] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${key}` : key;

		if (Array.isArray(value)) {
			// Arrays are leaf items (e.g., verify, docs, rules, neverLoad)
			visitor(path, value);
		} else if (typeof value === "object" && value !== null) {
			// Determine if this is a "config subsection" to recurse into,
			// or a "data Record" to report as a leaf.
			// Config subsections have known typed structure; data Records
			// are user-defined key-value maps.
			if (isConfigSubsection(path)) {
				walkConfig(value, path, visitor);
			} else {
				// Data Record — report as leaf
				visitor(path, value);
			}
		} else {
			// Primitive — report as leaf
			visitor(path, value);
		}
	}
}

/**
 * Known config subsection paths that should be recursed into
 * (not reported as Advanced items themselves).
 *
 * This list is derived from the TaskplaneConfig interface structure.
 * When the schema adds a new top-level subsection, add it here to
 * recurse properly. Unknown subsections default to being treated as
 * data Records (shown in Advanced), which is the safe default for
 * discoverability.
 */
const CONFIG_SUBSECTIONS = new Set([
	"taskRunner",
	"orchestrator",
	"taskRunner.project",
	"taskRunner.paths",
	"taskRunner.testing",
	"taskRunner.standards",
	"taskRunner.worker",
	"taskRunner.reviewer",
	"taskRunner.context",
	"orchestrator.orchestrator",
	"orchestrator.dependencies",
	"orchestrator.assignment",
	"orchestrator.preWarm",
	"orchestrator.merge",
	"orchestrator.failure",
	"orchestrator.monitoring",
]);

function isConfigSubsection(path: string): boolean {
	return CONFIG_SUBSECTIONS.has(path);
}

/**
 * Summarize a value for display in the Advanced section.
 */
function summarizeValue(value: any): string {
	if (value === undefined || value === null) return "(not set)";
	if (typeof value === "string") return value || "(empty)";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return summarizeArray(value);
	if (typeof value === "object") return summarizeRecord(value);
	return String(value);
}

function summarizeRecord(obj: Record<string, any>): string {
	const keys = Object.keys(obj);
	if (keys.length === 0) return "(empty)";
	if (keys.length <= 3) return keys.join(", ");
	return `${keys.length} entries`;
}

function summarizeArray(arr: any[]): string {
	if (arr.length === 0) return "(empty)";
	if (arr.length <= 3) return arr.map(String).join(", ");
	return `${arr.length} items`;
}


// ── TUI Rendering ────────────────────────────────────────────────────

/**
 * Open the settings TUI.
 *
 * This is the main entry point called from the /settings command handler.
 * Uses a two-level navigation:
 *   1. SelectList for section navigation
 *   2. SettingsList for per-section field display and editing
 *
 * @param ctx - Extension context for UI access
 * @param configRoot - Workspace/repo root (from execCtx.workspaceRoot)
 * @param pointerConfigRoot - Optional pointer-resolved config root (workspace mode)
 */
export async function openSettingsTui(
	ctx: ExtensionContext,
	configRoot: string,
	pointerConfigRoot?: string,
): Promise<void> {
	// Load current config state — refreshed each time we return to the top level
	await showSectionSelectorLoop(ctx, configRoot, pointerConfigRoot);
}

/**
 * Reload all config state from disk. Called after write-back to
 * refresh the TUI display.
 */
function loadConfigState(configRoot: string, pointerConfigRoot?: string): {
	mergedConfig: TaskplaneConfig;
	prefs: UserPreferences;
	rawProject: Record<string, any> | null;
	rawPrefs: Record<string, any> | null;
} {
	const resolvedRoot = resolveConfigRoot(configRoot, pointerConfigRoot);
	return {
		mergedConfig: loadProjectConfig(configRoot, pointerConfigRoot),
		prefs: loadUserPreferences(),
		rawProject: readRawProjectJson(resolvedRoot) || readRawYamlConfigs(resolvedRoot),
		rawPrefs: readRawPreferences(),
	};
}

/**
 * Top-level section selector loop.
 *
 * Re-loads config state each iteration so write-backs are reflected
 * immediately in the TUI.
 */
async function showSectionSelectorLoop(
	ctx: ExtensionContext,
	configRoot: string,
	pointerConfigRoot?: string,
): Promise<void> {
	while (true) {
		const state = loadConfigState(configRoot, pointerConfigRoot);

		const sectionItems: SelectItem[] = SECTIONS.map((section, i) => ({
			value: String(i),
			label: section.name,
			description: section.readOnly
				? "Read-only collection/record fields"
				: `${section.fields.length} setting${section.fields.length === 1 ? "" : "s"}`,
		}));

		const selectedSection = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();

			// Top border
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			// Title
			container.addChild(new Text(theme.fg("accent", theme.bold("⚙ Settings")), 1, 0));
			container.addChild(new Text(theme.fg("dim", "Navigate sections to view and edit configuration"), 1, 0));
			container.addChild(new Text("", 0, 0));

			// SelectList
			const selectList = new SelectList(sectionItems, Math.min(sectionItems.length, 14), {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			});
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);

			// Help text
			container.addChild(new Text("", 0, 0));
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc close"), 1, 0));

			// Bottom border
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
			};
		});

		if (selectedSection === null) return;  // User pressed Esc

		const sectionIndex = parseInt(selectedSection, 10);
		const section = SECTIONS[sectionIndex];

		if (section.readOnly) {
			await showAdvancedSection(ctx, state.mergedConfig);
		} else {
			await showSectionSettingsLoop(ctx, section, configRoot, pointerConfigRoot);
		}
	}
}

/**
 * Show the Advanced (JSON Only) section — read-only display.
 */
async function showAdvancedSection(
	ctx: ExtensionContext,
	mergedConfig: TaskplaneConfig,
): Promise<void> {
	const advItems = getAdvancedItems(mergedConfig);

	const settingsItems: SettingItem[] = advItems.map((item) => ({
		id: item.configPath,
		label: item.label,
		currentValue: item.value,
		description: `${item.configPath} — edit in .pi/taskplane-config.json`,
		// No `values` array = no toggle cycling
	}));

	await ctx.ui.custom((tui, theme, _kb, done) => {
		const container = new Container();

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Title
		container.addChild(new Text(theme.fg("accent", theme.bold("Advanced (JSON Only)")), 1, 0));
		container.addChild(new Text(theme.fg("dim", "These fields can only be edited directly in the config file"), 1, 0));
		container.addChild(new Text("", 0, 0));

		const settingsList = new SettingsList(
			settingsItems,
			Math.min(settingsItems.length + 2, 20),
			getSettingsListTheme(),
			() => {},  // onChange — no-op (read-only)
			() => done(undefined),  // onCancel
		);
		container.addChild(settingsList);

		// Help text
		container.addChild(new Text("", 0, 0));
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • esc back"), 1, 0));

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => { settingsList.handleInput?.(data); tui.requestRender(); },
		};
	});
}

/**
 * Format a source badge for display.
 */
function formatSourceBadge(source: FieldSource): string {
	switch (source) {
		case "default": return "(default)";
		case "project": return "(project)";
		case "user":    return "(user)";
	}
}

/** Represents a pending field change returned from the section TUI. */
interface PendingChange {
	fieldId: string;
	rawValue: string;
}

/**
 * Section settings loop — shows the section, handles writes, and
 * re-renders with fresh state after each successful write.
 */
async function showSectionSettingsLoop(
	ctx: ExtensionContext,
	section: SectionDef,
	configRoot: string,
	pointerConfigRoot?: string,
): Promise<void> {
	while (true) {
		const state = loadConfigState(configRoot, pointerConfigRoot);
		const result = await showSectionSettingsOnce(ctx, section, state.mergedConfig, state.prefs, state.rawProject, state.rawPrefs);

		if (result === null) return;  // User pressed Esc → back to sections

		// Process the pending change
		const field = section.fields.find((f) => f.configPath === result.fieldId);
		if (!field) continue;  // Safety: field not found

		const typedValue = coerceValueForWrite(field, result.rawValue);

		// Collect UI answers for the write-decision contract
		let destinationChoice: string | null = null;
		if (getDefaultWriteDestination(field) === null) {
			// L1+L2 fields: ask user where to save
			destinationChoice = await ctx.ui.select(
				"Save this change to:",
				[
					"User preferences (personal)",
					"Project config (shared)",
					"Cancel",
				],
			);
		}

		let projectConfirmed = true;
		// Only ask for confirmation if the resolved dest will be "project"
		const needsProjectConfirm =
			(field.layer === "L1") ||
			(field.layer === "L1+L2" && destinationChoice?.startsWith("Project"));
		if (needsProjectConfirm) {
			projectConfirmed = await ctx.ui.confirm(
				"Confirm project config change",
				"This writes to .pi/taskplane-config.json (shared project config). Continue?",
			);
		}

		const dest = resolveWriteAction(field, destinationChoice, projectConfirmed);
		if (dest === "skip") continue;

		// Perform the write
		try {
			if (dest === "project") {
				writeProjectConfigField(configRoot, field.configPath, typedValue, pointerConfigRoot);
			} else {
				// L2 write — use prefsKey
				if (field.prefsKey) {
					writeUserPreference(field.prefsKey, typedValue);
				}
			}
			ctx.ui.notify(
				`✅ ${field.label} updated.\n` +
				`ℹ Restart session to apply changes.`,
				"info",
			);
		} catch (err: any) {
			ctx.ui.notify(`❌ Failed to save: ${err.message}`, "error");
		}

		// Loop continues → re-show section with fresh state
	}
}

/**
 * Show the settings list for a section once.
 *
 * Returns a PendingChange when the user edits a field (toggle or input),
 * or null when the user presses Esc to go back.
 *
 * Design: the TUI exits after any change so the caller can handle
 * confirmation/destination choice with standard ctx.ui methods,
 * then re-renders with fresh state.
 */
async function showSectionSettingsOnce(
	ctx: ExtensionContext,
	section: SectionDef,
	mergedConfig: TaskplaneConfig,
	prefs: UserPreferences,
	rawProject: Record<string, any> | null,
	rawPrefs: Record<string, any> | null,
): Promise<PendingChange | null> {
	// Build SettingItem[] from section fields
	const settingsItems: SettingItem[] = section.fields.map((field) => {
		const displayValue = getFieldDisplayValue(field, mergedConfig, prefs);
		const source = detectFieldSource(field, rawProject, rawPrefs);
		const sourceBadge = formatSourceBadge(source);

		const item: SettingItem = {
			id: field.configPath,
			label: field.label,
			currentValue: `${displayValue}  ${sourceBadge}`,
			description: field.description,
		};

		// Toggle fields get values array for cycling
		if (field.control === "toggle" && field.values) {
			item.values = field.values.map((v) => `${v}  ${sourceBadge}`);
		}

		// Input fields get a submenu for inline editing
		if (field.control === "input") {
			item.submenu = (currentValue: string, submenuDone: (selectedValue?: string) => void) => {
				return createInputSubmenu(field, currentValue, submenuDone);
			};
		}

		return item;
	});

	// Find JSON-only fields for this section's config path (footer note)
	const jsonOnlyNote = getJsonOnlyFooterForSection(section, mergedConfig);

	return ctx.ui.custom<PendingChange | null>((tui, theme, _kb, done) => {
		const container = new Container();

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Title
		container.addChild(new Text(theme.fg("accent", theme.bold(section.name)), 1, 0));
		container.addChild(new Text("", 0, 0));

		const settingsList = new SettingsList(
			settingsItems,
			Math.min(settingsItems.length + 2, 20),
			getSettingsListTheme(),
			(id, newValue) => {
				// onChange: a toggle was cycled or an input was submitted
				// Exit TUI with the change so the caller can handle write-back
				done({ fieldId: id, rawValue: newValue });
			},
			() => done(null),  // onCancel → back to section selector
			{ enableSearch: settingsItems.length > 5 },
		);
		container.addChild(settingsList);

		// JSON-only footer note
		if (jsonOnlyNote) {
			container.addChild(new Text("", 0, 0));
			container.addChild(new Text(theme.fg("dim", jsonOnlyNote), 1, 0));
		}

		// Help text
		container.addChild(new Text("", 0, 0));
		container.addChild(new Text(
			theme.fg("dim", "↑↓ navigate • ←→/space cycle • enter edit • esc back"),
			1, 0,
		));

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => { settingsList.handleInput?.(data); tui.requestRender(); },
		};
	});
}


// ── Input Submenu ────────────────────────────────────────────────────

/**
 * Create a submenu component for inline text input editing.
 * Used by SettingsList's submenu pattern for input-type fields.
 */
function createInputSubmenu(
	field: FieldDef,
	currentValue: string,
	done: (selectedValue?: string) => void,
): any {
	// Strip source badge from current value for editing
	const cleanValue = currentValue.replace(/\s+\((?:default|project|user)\)$/, "");
	let inputBuffer = cleanValue === "(not set)" || cleanValue === "(inherit)" ? "" : cleanValue;
	let errorMsg = "";
	let cursorPos = inputBuffer.length;

	const component = {
		render(width: number): string[] {
			const lines: string[] = [];
			const prompt = `  Enter ${field.label}: `;
			const inputDisplay = inputBuffer + "█";  // Simple cursor
			lines.push(truncateLine(prompt + inputDisplay, width));

			if (field.optional) {
				lines.push(truncateLine("  (empty to unset)", width));
			}

			if (errorMsg) {
				lines.push(truncateLine(`  ❌ ${errorMsg}`, width));
			}

			lines.push(truncateLine("  enter confirm • esc cancel", width));
			return lines;
		},

		invalidate() {},

		handleInput(data: string): void {
			// Simple input handling — enter, escape, backspace, printable chars
			if (data === "\r" || data === "\n") {
				// Validate and confirm
				const result = validateFieldInput(field, inputBuffer);
				if (result.valid) {
					if (inputBuffer.trim() === "" && field.optional) {
						done("(not set)");
					} else {
						done(inputBuffer);
					}
				} else {
					errorMsg = result.error || "Invalid input";
				}
			} else if (data === "\x1b" || data === "\x1b\x1b") {
				// Escape — cancel
				done(undefined);
			} else if (data === "\x7f" || data === "\b") {
				// Backspace
				if (inputBuffer.length > 0) {
					inputBuffer = inputBuffer.slice(0, -1);
					errorMsg = "";
				}
			} else if (data.length === 1 && data.charCodeAt(0) >= 32) {
				// Printable character
				inputBuffer += data;
				errorMsg = "";
			}
		},
	};

	return component;
}

/** Simple line truncation for submenu rendering */
function truncateLine(text: string, width: number): string {
	if (text.length <= width) return text;
	return text.substring(0, width - 3) + "...";
}


// ── JSON-Only Footer ─────────────────────────────────────────────────

/**
 * Map from section name to the config subsection prefixes it covers.
 * Used to dynamically discover JSON-only sibling fields.
 */
const SECTION_CONFIG_PREFIXES: Record<string, string[]> = {
	"Orchestrator": ["orchestrator.orchestrator"],
	"Dependencies": ["orchestrator.dependencies"],
	"Assignment": ["orchestrator.assignment"],
	"Pre-Warm": ["orchestrator.preWarm"],
	"Merge": ["orchestrator.merge"],
	"Failure Policy": ["orchestrator.failure"],
	"Monitoring": ["orchestrator.monitoring"],
	"Worker": ["taskRunner.worker"],
	"Reviewer": ["taskRunner.reviewer"],
	"Context Limits": ["taskRunner.context"],
};

/**
 * Generate a footer note about JSON-only fields related to a section.
 *
 * Dynamically discovers uncovered fields under the same config subsection
 * prefix, so new fields added to the schema auto-appear in footers.
 */
function getJsonOnlyFooterForSection(section: SectionDef, config: TaskplaneConfig): string | null {
	const prefixes = SECTION_CONFIG_PREFIXES[section.name];
	if (!prefixes) return null;

	// Find all uncovered leaf fields under these prefixes
	const uncoveredFields: string[] = [];
	walkConfig(config, "", (path, _value) => {
		if (COVERED_PATHS.has(path)) return; // Already editable
		for (const prefix of prefixes) {
			if (path.startsWith(prefix + ".")) {
				// Extract the field name (last segment)
				const fieldName = path.split(".").pop() || path;
				uncoveredFields.push(fieldName);
			}
		}
	});

	if (uncoveredFields.length === 0) return null;
	return `+ ${uncoveredFields.join(", ")} (edit JSON directly)`;
}
