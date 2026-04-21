/**
 * Settings TUI — interactive configuration viewer and editor.
 *
 * Provides a `/taskplane-settings` command that renders a two-level navigation:
 *   1. Section selector (14 sections)
 *   2. Per-section SettingsList with field display, source badges,
 *      and inline editing for enum/boolean/string/number fields
 *
 * Source detection reads raw project config to determine whether each
 * field is explicitly overridden in project config (`(project)`) or
 * inherited from global baseline (`(global)`).
 *
 * Write-back defaults to global preferences for all editable fields.
 * "Save to project override" and "Remove project override" are
 * explicit actions in the destination picker.
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
	type GlobalPreferences,
} from "./config-schema.ts";
import {
	loadGlobalPreferences,
	loadProjectConfig,
	loadProjectOverrides,
	resolveConfigRoot,
	resolveGlobalPreferencesPath,
} from "./config-loader.ts";
import { loadPiSettingsPackages } from "./settings-loader.ts";


// ── Types ────────────────────────────────────────────────────────────

/** Source of a field's current value */
export type FieldSource = "project" | "global";

/** Layer assignment for a field */
export type FieldLayer = "L1" | "L2" | "L1+L2";

/** UI control type for a field */
export type FieldControl = "toggle" | "input" | "picker";

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
	/** For L1+L2 fields: the global preferences key */
	prefsKey?: keyof GlobalPreferences;
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
 * Canonical navigation map — 14 sections.
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
			{ configPath: "orchestrator.orchestrator.sessionPrefix", label: "Session Prefix", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "sessionPrefix", description: "Prefix for orchestrator session names" },
			{ configPath: "orchestrator.orchestrator.operatorId", label: "Operator ID", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "operatorId", description: "Operator identifier (empty = auto-detect)" },
			{ configPath: "orchestrator.orchestrator.integration", label: "Integration", control: "picker", layer: "L1", fieldType: "enum", values: ["manual", "supervised", "auto"], description: "How completed batches are integrated. manual = user runs /orch-integrate. supervised = supervisor proposes plan, asks confirmation. auto = supervisor executes without asking." },
		],
	},
	{
		name: "Agent: Supervisor",
		fields: [
			{ configPath: "orchestrator.supervisor.model", label: "Supervisor Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "supervisorModel", description: "Supervisor model (inherit = use session model)" },
			{ configPath: "orchestrator.supervisor.autonomy", label: "Autonomy Level", control: "picker", layer: "L1", fieldType: "enum", values: ["interactive", "supervised", "autonomous"], description: "Recovery action confirmation behavior" },
		],
	},
	{
		name: "Agent: Worker",
		fields: [
			{ configPath: "taskRunner.worker.model", label: "Worker Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "workerModel", description: "Worker model (inherit = use session model)" },
			{ configPath: "taskRunner.worker.tools", label: "Worker Tools", control: "input", layer: "L1", fieldType: "string", description: "Worker tool allowlist" },
			{ configPath: "taskRunner.worker.thinking", label: "Worker Thinking", control: "picker", layer: "L1", fieldType: "string", description: "Worker thinking mode" },
		],
	},
	{
		name: "Agent: Reviewer",
		fields: [
			{ configPath: "taskRunner.reviewer.model", label: "Reviewer Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "reviewerModel", description: "Reviewer model (inherit = use session model)" },
			{ configPath: "taskRunner.reviewer.tools", label: "Reviewer Tools", control: "input", layer: "L1", fieldType: "string", description: "Reviewer tool allowlist" },
			{ configPath: "taskRunner.reviewer.thinking", label: "Reviewer Thinking", control: "picker", layer: "L1", fieldType: "string", description: "Reviewer thinking mode" },
		],
	},
	{
		name: "Agent: Merge",
		fields: [
			{ configPath: "orchestrator.merge.model", label: "Merge Model", control: "input", layer: "L1+L2", fieldType: "string", prefsKey: "mergeModel", description: "Merge-agent model (inherit = use session model)" },
			{ configPath: "orchestrator.merge.tools", label: "Merge Tools", control: "input", layer: "L1", fieldType: "string", description: "Merge-agent tool allowlist" },
			{ configPath: "orchestrator.merge.thinking", label: "Merge Thinking", control: "picker", layer: "L1+L2", fieldType: "string", prefsKey: "mergeThinking", description: "Merge-agent thinking mode" },
			{ configPath: "orchestrator.merge.order", label: "Merge Order", control: "toggle", layer: "L1", fieldType: "enum", values: ["fewest-files-first", "sequential"], description: "Lane merge ordering policy" },
			{ configPath: "orchestrator.merge.timeoutMinutes", label: "Merge Timeout (minutes)", control: "input", layer: "L1", fieldType: "number", description: "Max time for merge agent to complete. Increase for large batches (default: 10)" },
		],
	},
	{
		name: "Agent Extensions",
		readOnly: true,  // Dynamically handled — no fixed fields
		fields: [],
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
		name: "Monitoring",
		fields: [
			{ configPath: "orchestrator.monitoring.pollInterval", label: "Poll Interval (sec)", control: "input", layer: "L1", fieldType: "number", description: "Poll interval for lane/task monitoring (seconds)" },
		],
	},
	{
		name: "Global Preferences",
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
 * Read the raw global preferences JSON.
 */
function readRawPreferences(): Record<string, any> | null {
	const prefsPath = resolveGlobalPreferencesPath();
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

function pruneEmptyObjects(node: unknown): boolean {
	if (!node || typeof node !== "object" || Array.isArray(node)) return false;
	const obj = node as Record<string, any>;
	for (const key of Object.keys(obj)) {
		const child = obj[key];
		if (child && typeof child === "object" && !Array.isArray(child)) {
			if (pruneEmptyObjects(child)) {
				delete obj[key];
			}
		}
	}
	return Object.keys(obj).length === 0;
}

function toGlobalPreferencePath(field: FieldDef): string {
	if (field.configPath.startsWith("preferences.")) {
		return field.configPath.slice("preferences.".length);
	}
	return field.configPath;
}

/**
 * Write a single project override field to `taskplane-config.json`.
 *
 * This performs sparse writes only: when no JSON file exists yet, a new
 * file is created with `{ configVersion }` plus the specific override path.
 * It does NOT bootstrap full config values from YAML/global/default layers.
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

	mkdirSync(dirname(jsonPath), { recursive: true });

	let configObj: Record<string, any>;
	if (existsSync(jsonPath)) {
		try {
			const raw = readFileSync(jsonPath, "utf-8");
			configObj = JSON.parse(raw);
		} catch (e: any) {
			throw new Error(
				`Cannot write settings: ${jsonPath} contains malformed JSON. ` +
				`Please fix or delete the file and try again. ` +
				`(Parse error: ${e.message ?? "unknown"})`,
			);
		}
	} else {
		const yamlSeed = loadProjectOverrides(resolvedRoot);
		configObj = {
			configVersion: CONFIG_VERSION,
			...JSON.parse(JSON.stringify(yamlSeed)),
		};
	}

	setNestedValue(configObj, configPath, value);
	pruneEmptyObjects(configObj);
	if (configObj.configVersion === undefined) {
		configObj.configVersion = CONFIG_VERSION;
	}

	const json = JSON.stringify(configObj, null, 2) + "\n";
	writeFileSync(tmpPath, json, "utf-8");
	try {
		renameSync(tmpPath, jsonPath);
	} catch {
		writeFileSync(jsonPath, json, "utf-8");
		try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* cleanup best-effort */ }
	}
}

/**
 * Write a global preference at a dot-path (e.g. `taskRunner.worker.model`).
 * Uses sparse JSON updates and prunes empty objects on delete.
 */
export function writeGlobalPreference(path: string, value: any): void {
	const prefsPath = resolveGlobalPreferencesPath();
	const tmpPath = prefsPath + ".tmp";

	const prefsDir = dirname(prefsPath);
	if (!existsSync(prefsDir)) {
		mkdirSync(prefsDir, { recursive: true });
	}

	let prefsObj: Record<string, any> = {};
	if (existsSync(prefsPath)) {
		try {
			const raw = readFileSync(prefsPath, "utf-8");
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				prefsObj = parsed;
			}
		} catch {
			prefsObj = {};
		}
	}

	setNestedValue(prefsObj, path, value);
	pruneEmptyObjects(prefsObj);

	const json = JSON.stringify(prefsObj, null, 2) + "\n";
	writeFileSync(tmpPath, json, "utf-8");
	try {
		renameSync(tmpPath, prefsPath);
	} catch {
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
	const cleaned = rawValue.replace(/\s+\((?:default|project|global)\)$/, "").trim();

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
 * Write destinations for settings edits.
 *
 * - `prefs`: write to global preferences (default)
 * - `project`: write a project-specific override
 * - `remove-project`: delete an existing project override (revert to global)
 */
export type WriteDestination = "project" | "prefs" | "remove-project";

export function getDefaultWriteDestination(_field: FieldDef): WriteDestination {
	return "prefs";
}

/**
 * Resolve the write action for a field change.
 */
export function resolveWriteAction(
	field: FieldDef,
	destinationChoice: string | null,
	projectConfirmed: boolean,
): WriteDestination | "skip" {
	const defaultDest = getDefaultWriteDestination(field);

	// L2-only fields have no project layer
	if (field.layer === "L2") return "prefs";

	if (!destinationChoice || destinationChoice === "Cancel") return "skip";
	if (destinationChoice.startsWith("Global") || destinationChoice.startsWith("User")) return "prefs";
	if (destinationChoice.startsWith("Remove project override")) return "remove-project";
	if (destinationChoice.startsWith("Project") && !projectConfirmed) return "skip";
	if (destinationChoice.startsWith("Project")) return "project";

	return defaultDest;
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
 * Source badge policy:
 * - `(project)` when the field is explicitly present in project config JSON/YAML
 * - `(global)` otherwise (global preferences baseline + schema defaults)
 */
export function detectFieldSource(
	field: FieldDef,
	rawProjectConfig: Record<string, any> | null,
	_rawPrefs: Record<string, any> | null,
): FieldSource {
	if (field.layer !== "L2" && rawProjectConfig) {
		const val = getNestedValue(rawProjectConfig, field.configPath);
		if (val !== undefined) return "project";
	}

	return "global";
}


// ── Value Formatting ─────────────────────────────────────────────────

/**
 * Get the display value for a field from the merged config.
 */
export function getFieldDisplayValue(
	field: FieldDef,
	mergedConfig: TaskplaneConfig,
	prefs: GlobalPreferences,
): string {
	// Special case: dashboardPort (L2-only, not in merged config)
	if (field.configPath === "preferences.dashboardPort") {
		const val = prefs.dashboardPort;
		return val !== undefined ? String(val) : "(not set)";
	}

	const val = getNestedValue(mergedConfig, field.configPath);

	// Optional fields may be undefined
	if (val === undefined) {
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
 * This is the main entry point called from the /taskplane-settings command handler.
 * Uses a two-level navigation:
 *   1. SelectList for section navigation
 *   2. SettingsList for per-section field display and editing
 *
 * @param ctx - Extension context for UI access
 * @param configRoot - Workspace/repo root (from execCtx.workspaceRoot)
 * @param pointerConfigRoot - Optional pointer-resolved config root (workspace mode)
 */
// ── Model Picker (Sage-style provider → model selection) ────────────

/**
 * Interactive two-level model picker: provider first, then model within provider.
 * Returns the selected model string (e.g., "anthropic/claude-sonnet-4-20250514")
 * or "" for inherit, or undefined if cancelled.
 *
 * Adapted from Sage's pickModel implementation.
 */
async function pickModel(ctx: ExtensionContext, currentModel: string): Promise<string | undefined> {
	const available = ctx.modelRegistry.getAvailable();
	if (available.length === 0) {
		ctx.ui.notify("No available models found in pi model registry", "warning");
		// Fall back to manual input
		const manual = await ctx.ui.input("Model (provider/model-id, or empty for inherit)", currentModel || "");
		if (manual === null || manual === undefined) return undefined;
		return manual;
	}

	const currentLower = (currentModel || "").trim().toLowerCase();
	const providers = [...new Set(available.map((m: any) => m.provider))].sort();

	while (true) {
		// Level 1: Provider selection (with "inherit" as first option)
		const providerOptions: string[] = [
			"inherit (use current session model)",
			...providers.map((p: string) => {
				const count = available.filter((m: any) => m.provider === p).length;
				return `${p} (${count} models)`;
			}),
		];

		const providerChoice = await selectScrollable(ctx, "Choose model provider", providerOptions);
		if (!providerChoice) return undefined;  // Cancelled

		if (providerChoice.startsWith("inherit")) {
			return "";  // Empty string = inherit
		}

		// Extract provider name (strip " (N models)" suffix)
		const provider = providerChoice.replace(/\s*\(\d+ models?\)$/, "");
		const providerModels = available
			.filter((m: any) => m.provider === provider)
			.sort((a: any, b: any) => {
				// Current model first, then alphabetical
				const aComposite = `${a.provider}/${a.id}`.toLowerCase();
				const bComposite = `${b.provider}/${b.id}`.toLowerCase();
				if (aComposite === currentLower) return -1;
				if (bComposite === currentLower) return 1;
				return a.id.localeCompare(b.id);
			});

		// Level 2: Model selection within provider
		const modelOptionMap = new Map<string, string>();
		const modelOptions = ["← Back to providers"];

		for (const model of providerModels) {
			const composite = `${model.provider}/${model.id}`;
			const isCurrent = composite.toLowerCase() === currentLower;
			const label = `${model.id}${isCurrent ? "  ✓ current" : ""}`;
			modelOptions.push(label);
			modelOptionMap.set(label, composite);
		}

		const modelChoice = await selectScrollable(ctx, `Choose model (${provider})`, modelOptions);
		if (!modelChoice) continue;  // Cancelled → back to providers
		if (modelChoice === "← Back to providers") continue;

		const resolved = modelOptionMap.get(modelChoice);
		if (resolved) return resolved;
	}
}

type ThinkingModeValue = "" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const THINKING_MODE_OPTIONS: Array<{ value: ThinkingModeValue; label: string }> = [
	{ value: "", label: "inherit (use session thinking)" },
	{ value: "off", label: "off" },
	{ value: "minimal", label: "minimal" },
	{ value: "low", label: "low" },
	{ value: "medium", label: "medium" },
	{ value: "high", label: "high" },
	{ value: "xhigh", label: "xhigh" },
];

function normalizeThinkingMode(value: unknown): ThinkingModeValue {
	const cleaned = String(value ?? "").trim().toLowerCase();
	if (!cleaned || cleaned === "inherit") return "";
	if (cleaned === "on") return "high";
	if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(cleaned)) {
		return cleaned as ThinkingModeValue;
	}
	return "";
}

async function pickThinkingMode(
	ctx: ExtensionContext,
	currentThinking: string,
): Promise<ThinkingModeValue | undefined> {
	const current = normalizeThinkingMode(currentThinking);
	const resolvedCurrent: ThinkingModeValue = current || "high";
	const optionToValue = new Map<string, ThinkingModeValue>();
	const optionLabels: string[] = [];

	for (const option of THINKING_MODE_OPTIONS) {
		const label = `${option.label}${option.value === resolvedCurrent ? "  ✓ current" : ""}`;
		optionLabels.push(label);
		optionToValue.set(label, option.value);
	}

	const selected = await selectScrollable(ctx, "Choose thinking mode", optionLabels, 8);
	if (!selected) return undefined;
	return optionToValue.get(selected);
}

const MODEL_THINKING_PATH_MAP: Record<string, { thinkingPath: string; label: string }> = {
	"taskRunner.worker.model": { thinkingPath: "taskRunner.worker.thinking", label: "Worker" },
	"taskRunner.reviewer.model": { thinkingPath: "taskRunner.reviewer.thinking", label: "Reviewer" },
	"orchestrator.merge.model": { thinkingPath: "orchestrator.merge.thinking", label: "Merge" },
};

const THINKING_MODEL_PATH_MAP: Record<string, { modelPath: string; label: string }> = {
	"taskRunner.worker.thinking": { modelPath: "taskRunner.worker.model", label: "Worker" },
	"taskRunner.reviewer.thinking": { modelPath: "taskRunner.reviewer.model", label: "Reviewer" },
	"orchestrator.merge.thinking": { modelPath: "orchestrator.merge.model", label: "Merge" },
};

function resolveModelRecord(ctx: ExtensionContext, modelRef: string): any | undefined {
	const trimmed = modelRef.trim();
	if (!trimmed) return undefined;

	const available = ctx.modelRegistry.getAvailable();
	const lower = trimmed.toLowerCase();
	const slashIdx = trimmed.indexOf("/");

	if (slashIdx > 0) {
		const provider = trimmed.slice(0, slashIdx).toLowerCase();
		const id = trimmed.slice(slashIdx + 1).toLowerCase();
		return available.find((m: any) =>
			String(m?.provider ?? "").toLowerCase() === provider
			&& String(m?.id ?? "").toLowerCase() === id,
		);
	}

	return available.find((m: any) =>
		String(m?.id ?? "").toLowerCase() === lower
		|| `${String(m?.provider ?? "").toLowerCase()}/${String(m?.id ?? "").toLowerCase()}` === lower,
	);
}

export function modelSupportsThinking(model: any): boolean {
	if (!model || typeof model !== "object") return false;

	const boolFlags = [
		"supportsThinking",
		"thinking",
		"supportsReasoning",
		"supportsReasoningEffort",
		"supportsReasoningTokens",
		"reasoning",
	];
	const capabilityKeys = [
		"reasoningEffort",
		"reasoningTokens",
		"thinkingModes",
		"thinkingMode",
		"reasoning_effort",
		"reasoning_tokens",
	];

	const candidateObjects = [
		model,
		model.capabilities,
		model.features,
		model.metadata,
	].filter((entry) => entry && typeof entry === "object");

	for (const candidate of candidateObjects) {
		for (const key of boolFlags) {
			if (typeof candidate[key] === "boolean" && candidate[key]) return true;
			if (typeof candidate[key] === "string") {
				const normalized = candidate[key].trim().toLowerCase();
				if (["yes", "true", "on", "supported"].includes(normalized)) return true;
			}
		}
		for (const key of capabilityKeys) {
			if (candidate[key] !== undefined && candidate[key] !== null) return true;
		}
	}

	return false;
}

export function buildThinkingSuggestionForModelChange(
	ctx: ExtensionContext,
	field: FieldDef,
	previousModelValue: string,
	nextModelValue: string,
	mergedConfig: TaskplaneConfig,
): string | null {
	const mapping = MODEL_THINKING_PATH_MAP[field.configPath];
	if (!mapping) return null;

	const previousNormalized = previousModelValue.trim().toLowerCase();
	const nextNormalized = nextModelValue.trim().toLowerCase();
	if (!nextNormalized || previousNormalized === nextNormalized) return null;

	const modelRecord = resolveModelRecord(ctx, nextModelValue);
	if (!modelRecord || !modelSupportsThinking(modelRecord)) return null;

	const currentThinking = normalizeThinkingMode(getNestedValue(mergedConfig, mapping.thinkingPath));
	if (currentThinking === "high") return null;

	return `${mapping.label} model supports thinking. Consider setting ${mapping.label} Thinking to \"high\".`;
}

export function buildThinkingUnsupportedNoteForThinkingField(
	ctx: ExtensionContext,
	field: FieldDef,
	mergedConfig: TaskplaneConfig,
): string | null {
	const mapping = THINKING_MODEL_PATH_MAP[field.configPath];
	if (!mapping) return null;

	const modelRef = String(getNestedValue(mergedConfig, mapping.modelPath) ?? "").trim();
	if (!modelRef) return null;

	const modelRecord = resolveModelRecord(ctx, modelRef);
	if (!modelRecord || modelSupportsThinking(modelRecord)) return null;

	return `${mapping.label} model does not advertise thinking support. You can still set thinking; unsupported models ignore it at runtime.`;
}

/**
 * Scrollable select list for model/provider picking.
 * Uses pi's TUI custom widget API.
 */
async function selectScrollable(
	ctx: ExtensionContext,
	title: string,
	options: string[],
	maxVisible = 12,
): Promise<string | undefined> {
	if (options.length === 0) return undefined;

	const items: SelectItem[] = options.map((option, index) => ({
		value: String(index),
		label: option,
	}));

	const selectedValue = await ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", title), 1, 0));
		container.addChild(new Text("", 0, 0));

		const selectList = new SelectList(items, Math.max(3, Math.min(maxVisible, items.length)), {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		});

		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(undefined);
		container.addChild(selectList);

		container.addChild(new Text("", 0, 0));
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • type to filter • enter select • esc back"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});

	if (selectedValue === undefined) return undefined;
	const selectedIndex = Number(selectedValue);
	if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) return undefined;
	return options[selectedIndex];
}

export async function openSettingsTui(
	ctx: ExtensionContext,
	configRoot: string,
	pointerConfigRoot?: string,
	onConfigChanged?: () => void,
): Promise<void> {
	// Load current config state — refreshed each time we return to the top level
	await showSectionSelectorLoop(ctx, configRoot, pointerConfigRoot, onConfigChanged);
}

/**
 * Reload all config state from disk. Called after write-back to
 * refresh the TUI display.
 */
function loadConfigState(configRoot: string, pointerConfigRoot?: string): {
	mergedConfig: TaskplaneConfig;
	prefs: GlobalPreferences;
	rawProject: Record<string, any> | null;
	rawPrefs: Record<string, any> | null;
} {
	const resolvedRoot = resolveConfigRoot(configRoot, pointerConfigRoot);
	return {
		mergedConfig: loadProjectConfig(configRoot, pointerConfigRoot),
		prefs: loadGlobalPreferences(),
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
	onConfigChanged?: () => void,
): Promise<void> {
	while (true) {
		const state = loadConfigState(configRoot, pointerConfigRoot);

		const sectionItems: SelectItem[] = SECTIONS.map((section, i) => ({
			value: String(i),
			label: section.name,
			description: section.name === "Agent Extensions"
				? "Toggle extensions per agent type"
				: section.readOnly
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

		if (section.name === "Agent Extensions") {
			await showExtensionsSection(ctx, configRoot, pointerConfigRoot, onConfigChanged);
		} else if (section.readOnly) {
			await showAdvancedSection(ctx, state.mergedConfig);
		} else {
			await showSectionSettingsLoop(ctx, section, configRoot, pointerConfigRoot, onConfigChanged);
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
 * TP-180: Agent Extensions section — toggle extensions per agent type.
 *
 * Discovers all installed Pi extension packages from project + global settings,
 * shows per-agent-type toggles (Worker, Reviewer, Merger), and saves
 * exclusion changes to project taskplane-config.json.
 */
async function showExtensionsSection(
	ctx: ExtensionContext,
	configRoot: string,
	pointerConfigRoot?: string,
	onConfigChanged?: () => void,
): Promise<void> {
	while (true) {
		const resolvedRoot = resolveConfigRoot(configRoot, pointerConfigRoot);
		const mergedConfig = loadProjectConfig(configRoot, pointerConfigRoot);

		// Discover installed packages (excluding taskplane itself)
		// Use configRoot (project/state root) for consistency with runtime forwarding,
		// not resolvedRoot (pointer-resolved config path).
		const packages = loadPiSettingsPackages(configRoot);

		if (packages.length === 0) {
			await ctx.ui.custom((_tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Agent Extensions")), 1, 0));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Text(theme.fg("dim", "No third-party extensions found."), 1, 0));
				container.addChild(new Text(theme.fg("dim", "Install extensions via pi settings to see them here."), 1, 0));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Text(theme.fg("dim", "esc back"), 1, 0));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				return {
					render: (w: number) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => { if (data === "\x1b" || data === "\x1b\x1b") done(undefined); },
				};
			});
			return;
		}

		// Read current exclusion lists
		const workerExclude = new Set(mergedConfig.taskRunner.worker.excludeExtensions ?? []);
		const reviewerExclude = new Set(mergedConfig.taskRunner.reviewer.excludeExtensions ?? []);
		const mergeExclude = new Set(mergedConfig.orchestrator.merge.excludeExtensions ?? []);

		const agentTypes = [
			{ name: "Worker", exclude: workerExclude, configPath: "taskRunner.worker.excludeExtensions" },
			{ name: "Reviewer", exclude: reviewerExclude, configPath: "taskRunner.reviewer.excludeExtensions" },
			{ name: "Merger", exclude: mergeExclude, configPath: "orchestrator.merge.excludeExtensions" },
		];

		// Build toggle items: one per package per agent type
		const settingsItems: SettingItem[] = [];
		for (const pkg of packages) {
			for (const agentType of agentTypes) {
				const isExcluded = agentType.exclude.has(pkg);
				const enabled = !isExcluded;
				settingsItems.push({
					id: `${agentType.configPath}::${pkg}`,
					label: `${pkg}`,
					currentValue: enabled ? "✅ enabled" : "❌ disabled",
					description: agentType.name,
					values: [enabled ? "❌ disabled" : "✅ enabled"],
				});
			}
		}

		const result = await ctx.ui.custom<{ id: string; value: string } | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Agent Extensions")), 1, 0));
			container.addChild(new Text(theme.fg("dim", "Toggle extensions on/off per agent type"), 1, 0));
			container.addChild(new Text("", 0, 0));

			const settingsList = new SettingsList(
				settingsItems,
				Math.min(settingsItems.length + 2, 20),
				getSettingsListTheme(),
				(id, newValue) => done({ id, value: newValue }),
				() => done(null),
			);
			container.addChild(settingsList);

			container.addChild(new Text("", 0, 0));
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • space toggle • esc back"), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => { settingsList.handleInput?.(data); tui.requestRender(); },
			};
		});

		if (!result) return; // User pressed Esc

		// Parse the toggle result
		const [configPath, pkg] = result.id.split("::", 2);
		if (!configPath || !pkg) continue;

		const enabling = result.value.includes("enabled");

		// Read current exclusion array from merged effective config (handles YAML+JSON)
		const freshConfig = loadProjectConfig(configRoot, pointerConfigRoot);
		const currentExcludeList: string[] = (getNestedValue(freshConfig, configPath) as string[] | undefined) ?? [];

		let newExcludeList: string[];
		if (enabling) {
			// Remove from exclusions → enable
			newExcludeList = currentExcludeList.filter((e: string) => e !== pkg);
		} else {
			// Add to exclusions → disable
			newExcludeList = currentExcludeList.includes(pkg)
				? currentExcludeList
				: [...currentExcludeList, pkg];
		}

		try {
			writeProjectConfigField(configRoot, configPath, newExcludeList, pointerConfigRoot);
			if (onConfigChanged) {
				try { onConfigChanged(); } catch { /* non-fatal */ }
			}
			ctx.ui.notify(
				`${enabling ? "✅ Enabled" : "❌ Disabled"} ${pkg} for ${configPath.includes("worker") ? "Worker" : configPath.includes("reviewer") ? "Reviewer" : "Merger"}`,
				"info",
			);
		} catch (err: any) {
			ctx.ui.notify(`❌ Failed to save: ${err.message}`, "error");
		}

		// Loop continues → re-render with fresh state
	}
}

/**
 * Format a source badge for display.
 */
function formatSourceBadge(source: FieldSource): string {
	switch (source) {
		case "project": return "(project)";
		case "global":  return "(global)";
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
	onConfigChanged?: () => void,
): Promise<void> {
	while (true) {
		const state = loadConfigState(configRoot, pointerConfigRoot);
		const result = await showSectionSettingsOnce(ctx, section, state.mergedConfig, state.prefs, state.rawProject, state.rawPrefs);

		if (result === null) return;  // User pressed Esc → back to sections

		// Process the pending change
		const field = section.fields.find((f) => f.configPath === result.fieldId);
		if (!field) continue;  // Safety: field not found

		let previousModelValue = "";

		// Input/picker fields: the submenu returned a sentinel — open the editor picker.
		if (result.rawValue === "__EDIT_REQUESTED__" && (field.control === "input" || field.control === "picker")) {
			const state = loadConfigState(configRoot, pointerConfigRoot);
			const currentDisplay = getFieldDisplayValue(field, state.mergedConfig, state.prefs);
			const currentClean = String(currentDisplay).replace(/\s+\((?:default|project|global)\)$/, "");
			const normalizedCurrent = currentClean === "(inherit)" ? "" : currentClean;

			// Model fields: use interactive provider → model picker instead of free-text
			if (field.configPath.endsWith(".model")) {
				previousModelValue = normalizedCurrent;
				const selected = await pickModel(ctx, normalizedCurrent);
				if (selected === undefined) continue;  // Cancelled
				result.rawValue = selected;
			} else if (field.control === "picker" && field.configPath.endsWith(".thinking")) {
				const note = buildThinkingUnsupportedNoteForThinkingField(ctx, field, state.mergedConfig);
				if (note) ctx.ui.notify(note, "info");
				const selected = await pickThinkingMode(ctx, normalizedCurrent);
				if (selected === undefined) continue;  // Cancelled
				result.rawValue = selected;
			} else if (field.control === "picker" && field.values && field.values.length > 0) {
				// Enum picker: show scrollable list of allowed values
				const options = field.values.map((v) =>
					`${v}${v === normalizedCurrent ? "  ✓ current" : ""}`
				);
				const selected = await selectScrollable(ctx, field.label, options);
				if (!selected) continue;  // Cancelled
				result.rawValue = selected.replace(/\s+✓ current$/, "");
			} else {
				const placeholder = currentClean === "(not set)" || currentClean === "(inherit)" ? "" : currentClean;

				const newValue = await ctx.ui.input(
					`${field.label}${field.description ? ` — ${field.description}` : ""}`,
					placeholder,
				);

				if (newValue === null || newValue === undefined) continue;  // Cancelled

				// Validate
				const validation = validateFieldInput(field, newValue);
				if (!validation.valid) {
					ctx.ui.notify(`❌ Invalid value: ${validation.error}`, "error");
					continue;
				}

				result.rawValue = newValue;
			}
		}

		const typedValue = coerceValueForWrite(field, result.rawValue);
		const hasProjectOverride =
			field.layer !== "L2" &&
			!!state.rawProject &&
			getNestedValue(state.rawProject, field.configPath) !== undefined;

		// Collect UI answers for the write-decision contract
		let destinationChoice: string | null = null;
		if (field.layer !== "L2") {
			const options = [
				"Global preferences (default)",
				"Project override (this project only)",
				...(hasProjectOverride ? ["Remove project override (revert to global)"] : []),
				"Cancel",
			];
			destinationChoice = await ctx.ui.select("Save this change to:", options);
		}

		let projectConfirmed = true;
		if (destinationChoice?.startsWith("Project override")) {
			projectConfirmed = await ctx.ui.confirm(
				"Confirm project override",
				"This writes to .pi/taskplane-config.json as a project override. Continue?",
			);
		}

		const dest = resolveWriteAction(field, destinationChoice, projectConfirmed);
		if (dest === "skip") continue;

		// Perform the write
		try {
			if (dest === "project") {
				writeProjectConfigField(configRoot, field.configPath, typedValue, pointerConfigRoot);
			} else if (dest === "remove-project") {
				writeProjectConfigField(configRoot, field.configPath, undefined, pointerConfigRoot);
			} else {
				writeGlobalPreference(toGlobalPreferencePath(field), typedValue);
			}
			// Notify caller to reload in-memory config from disk
			if (onConfigChanged) {
				try { onConfigChanged(); } catch { /* non-fatal */ }
			}

			ctx.ui.notify(
				`✅ ${field.label} updated.`,
				"info",
			);

			const refreshedState = loadConfigState(configRoot, pointerConfigRoot);
			const suggestion = buildThinkingSuggestionForModelChange(
				ctx,
				field,
				previousModelValue,
				String(result.rawValue ?? ""),
				refreshedState.mergedConfig,
			);
			if (suggestion) {
				ctx.ui.notify(`💡 ${suggestion}`, "info");
			}
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
	prefs: GlobalPreferences,
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

		// Toggle fields: use cycling for 2 values (boolean-like), submenu for 3+
		if (field.control === "toggle" && field.values) {
			if (field.values.length <= 2) {
				item.values = field.values.map((v) => `${v}  ${sourceBadge}`);
			} else {
				// 3+ values: use a submenu so the user can pick any option,
				// not just cycle to the next one and immediately commit.
				item.submenu = (_currentValue: string, done: (selected?: string) => void) => {
					const selectItems: SelectItem[] = field.values!.map((v) => ({
						value: `${v}  ${sourceBadge}`,
						label: v,
					}));
					// Return SelectList directly — Container doesn't forward
					// handleInput to children, which would freeze the TUI.
					const list = new SelectList(
						selectItems,
						Math.min(selectItems.length + 1, 10),
						{
							selectedPrefix: (t: string) => `\x1b[36m${t}\x1b[0m`,
							selectedText: (t: string) => `\x1b[36m${t}\x1b[0m`,
							description: (t: string) => `\x1b[2m${t}\x1b[0m`,
							scrollInfo: (t: string) => `\x1b[2m${t}\x1b[0m`,
							noMatch: (t: string) => `\x1b[33m${t}\x1b[0m`,
						},
					);
					const currentIdx = field.values!.indexOf(displayValue);
					if (currentIdx >= 0) list.setSelectedIndex(currentIdx);
					list.onSelect = (selected) => done(selected.value);
					list.onCancel = () => done();
					return list;
				};
			}
		}

		// Input fields: use a single-value cycling pattern instead of a submenu.
		// The inline submenu approach freezes on Windows/tmux (issue #57).
		// We set a single sentinel value so pressing Enter/Space triggers onChange,
		// which exits the TUI. The caller then uses ctx.ui.input() for actual editing.
		if (field.control === "input" || field.control === "picker") {
			item.values = [`__EDIT_REQUESTED__`];
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
	const cleanValue = currentValue.replace(/\s+\((?:default|project|global)\)$/, "");
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
	"Agent: Supervisor": ["orchestrator.supervisor"],
	"Agent: Worker": ["taskRunner.worker"],
	"Agent: Reviewer": ["taskRunner.reviewer"],
	"Agent: Merge": ["orchestrator.merge"],
	"Context Limits": ["taskRunner.context"],
	"Failure Policy": ["orchestrator.failure"],
	"Dependencies": ["orchestrator.dependencies"],
	"Assignment": ["orchestrator.assignment"],
	"Pre-Warm": ["orchestrator.preWarm"],
	"Monitoring": ["orchestrator.monitoring"],
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
