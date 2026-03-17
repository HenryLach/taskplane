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
 * Write-back is handled in Step 3 — this module focuses on display
 * and validation only. The onChange callback is the integration seam.
 *
 * @module settings/tui
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
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
 * Read the raw project config JSON as a plain object (no defaults merge).
 * Returns null if no JSON config exists. Does not throw on parse errors.
 */
function readRawProjectJson(configRoot: string): Record<string, any> | null {
	const jsonPath = join(configRoot, ".pi", PROJECT_CONFIG_FILENAME);
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
function readRawYamlConfigs(configRoot: string): Record<string, any> | null {
	const trPath = join(configRoot, ".pi", "task-runner.yaml");
	const orchPath = join(configRoot, ".pi", "task-orchestrator.yaml");
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
	// L2 check for dual-layer and L2-only fields
	if ((field.layer === "L1+L2" || field.layer === "L2") && field.prefsKey && rawPrefs) {
		const prefVal = rawPrefs[field.prefsKey];
		if (field.fieldType === "string") {
			// String rule: non-undefined AND non-empty → (user)
			if (prefVal !== undefined && prefVal !== "") return "user";
		} else if (field.fieldType === "enum") {
			// Enum rule: any defined value → (user)
			if (prefVal !== undefined) return "user";
		} else if (field.fieldType === "number") {
			// Number rule: any defined value → (user)
			if (prefVal !== undefined) return "user";
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
			if (!Number.isFinite(num) || num < 0) {
				return { valid: false, error: "Must be a positive number" };
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

interface AdvancedItem {
	label: string;
	value: string;
}

/**
 * Get display items for the Advanced (JSON Only) section.
 * Shows collection/Record/array fields that aren't editable in the TUI.
 */
function getAdvancedItems(config: TaskplaneConfig): AdvancedItem[] {
	const items: AdvancedItem[] = [];

	// Config version
	items.push({ label: "Config Version", value: String(config.configVersion) });

	// Project identity
	items.push({ label: "Project Name", value: config.taskRunner.project.name || "(empty)" });
	items.push({ label: "Project Description", value: config.taskRunner.project.description || "(empty)" });

	// Paths
	items.push({ label: "Tasks Path", value: config.taskRunner.paths.tasks });
	if (config.taskRunner.paths.architecture) {
		items.push({ label: "Architecture Path", value: config.taskRunner.paths.architecture });
	}

	// Collections — show counts
	const testing = config.taskRunner.testing.commands;
	items.push({ label: "Testing Commands", value: summarizeRecord(testing) });

	items.push({ label: "Standards Docs", value: summarizeArray(config.taskRunner.standards.docs) });
	items.push({ label: "Standards Rules", value: summarizeArray(config.taskRunner.standards.rules) });

	items.push({ label: "Standards Overrides", value: summarizeRecord(config.taskRunner.standardsOverrides) });
	items.push({ label: "Task Areas", value: summarizeRecord(config.taskRunner.taskAreas) });
	items.push({ label: "Reference Docs", value: summarizeRecord(config.taskRunner.referenceDocs) });
	items.push({ label: "Never Load", value: summarizeArray(config.taskRunner.neverLoad) });
	items.push({ label: "Self Doc Targets", value: summarizeRecord(config.taskRunner.selfDocTargets) });
	items.push({ label: "Protected Docs", value: summarizeArray(config.taskRunner.protectedDocs) });

	// Orchestrator collections
	items.push({ label: "Size Weights", value: summarizeRecord(config.orchestrator.assignment.sizeWeights) });
	items.push({ label: "Pre-Warm Commands", value: summarizeRecord(config.orchestrator.preWarm.commands) });
	items.push({ label: "Pre-Warm Always", value: summarizeArray(config.orchestrator.preWarm.always) });
	items.push({ label: "Merge Verify", value: summarizeArray(config.orchestrator.merge.verify) });

	return items;
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
 * @param configRoot - Resolved config root path (from execCtx.workspaceRoot)
 */
export async function openSettingsTui(
	ctx: ExtensionContext,
	configRoot: string,
): Promise<void> {
	// Load current config state
	const mergedConfig = loadProjectConfig(configRoot);
	const prefs = loadUserPreferences();
	const rawProject = readRawProjectJson(resolveConfigRoot(configRoot)) || readRawYamlConfigs(resolveConfigRoot(configRoot));
	const rawPrefs = readRawPreferences();

	await showSectionSelector(ctx, mergedConfig, prefs, rawProject, rawPrefs, configRoot);
}

/**
 * Show the top-level section selector.
 */
async function showSectionSelector(
	ctx: ExtensionContext,
	mergedConfig: TaskplaneConfig,
	prefs: UserPreferences,
	rawProject: Record<string, any> | null,
	rawPrefs: Record<string, any> | null,
	configRoot: string,
): Promise<void> {
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
		await showAdvancedSection(ctx, mergedConfig);
	} else {
		await showSectionSettings(ctx, section, mergedConfig, prefs, rawProject, rawPrefs, configRoot);
	}

	// After returning from a section, re-show the section selector
	// (loop until user presses Esc at the top level)
	await showSectionSelector(ctx, mergedConfig, prefs, rawProject, rawPrefs, configRoot);
}

/**
 * Show the Advanced (JSON Only) section — read-only display.
 */
async function showAdvancedSection(
	ctx: ExtensionContext,
	mergedConfig: TaskplaneConfig,
): Promise<void> {
	const advItems = getAdvancedItems(mergedConfig);

	const settingsItems: SettingItem[] = advItems.map((item, i) => ({
		id: `adv-${i}`,
		label: item.label,
		currentValue: item.value,
		description: "Edit in .pi/taskplane-config.json",
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

/**
 * Show the settings list for a specific section.
 */
async function showSectionSettings(
	ctx: ExtensionContext,
	section: SectionDef,
	mergedConfig: TaskplaneConfig,
	prefs: UserPreferences,
	rawProject: Record<string, any> | null,
	rawPrefs: Record<string, any> | null,
	_configRoot: string,
): Promise<void> {
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
			item.values = field.values.map((v) => {
				// Re-detect source when cycling: it will always be current layer.
				// For now, append the same source badge since toggle changes aren't persisted yet (Step 3).
				return `${v}  ${sourceBadge}`;
			});
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

	await ctx.ui.custom((tui, theme, _kb, done) => {
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
				// onChange: handle toggle changes
				// For now, just update the display. Write-back is Step 3.
				// Note: "Restart session to apply" — edits are display-only until Step 3.
				ctx.ui.notify(
					`⚙ Setting changed: ${id}\n` +
					`New value: ${newValue.replace(/\s+\(.*\)$/, "")}\n\n` +
					`ℹ Write-back not yet implemented. Changes take effect on next session.`,
					"info",
				);
			},
			() => done(undefined),  // onCancel → back to section selector
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
 * Generate a footer note about JSON-only fields related to a section.
 */
function getJsonOnlyFooterForSection(section: SectionDef, _config: TaskplaneConfig): string | null {
	// Map sections to their JSON-only siblings
	const sectionJsonOnly: Record<string, string[]> = {
		"Assignment": ["sizeWeights"],
		"Pre-Warm": ["commands", "always"],
		"Merge": ["verify"],
	};

	const jsonFields = sectionJsonOnly[section.name];
	if (!jsonFields || jsonFields.length === 0) return null;

	return `+ ${jsonFields.join(", ")} (edit JSON directly)`;
}
