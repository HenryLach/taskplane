/**
 * Unified config loader for taskplane-config.json with YAML fallback.
 *
 * Precedence matrix:
 *   1. `.pi/taskplane-config.json` exists and is valid → use it
 *   2. `.pi/taskplane-config.json` exists but malformed → throw with clear error
 *   3. `.pi/taskplane-config.json` exists but unsupported configVersion → throw
 *   4. JSON absent + one/both YAML files present → read YAML, map to unified shape
 *   5. None present → return cloned defaults
 *
 * Path resolution:
 *   Resolves config paths relative to `configRoot`. Callers should pass
 *   the project root (or TASKPLANE_WORKSPACE_ROOT fallback) as `configRoot`.
 *
 * All returned objects are deep-cloned from defaults — no cross-call mutation.
 *
 * @module config/loader
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parse as yamlParse } from "yaml";

import {
	CONFIG_VERSION,
	PROJECT_CONFIG_FILENAME,
	DEFAULT_PROJECT_CONFIG,
	DEFAULT_TASK_RUNNER_SECTION,
	DEFAULT_ORCHESTRATOR_SECTION,
} from "./config-schema.ts";
import type {
	TaskplaneConfig,
	TaskRunnerSection,
	OrchestratorSection,
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
 * Recursively convert all keys in an object from snake_case to camelCase.
 * Record-type sections (task_areas, reference_docs, etc.) have their
 * user-defined keys preserved — only structural keys are converted.
 */
function convertKeysToCamel(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (Array.isArray(obj)) return obj.map(convertKeysToCamel);
	if (typeof obj !== "object") return obj;

	const result: Record<string, any> = {};
	for (const [key, val] of Object.entries(obj)) {
		const camelKey = snakeToCamel(key);
		if (val !== null && typeof val === "object" && !Array.isArray(val)) {
			result[camelKey] = convertKeysToCamel(val);
		} else if (Array.isArray(val)) {
			result[camelKey] = val.map(convertKeysToCamel);
		} else {
			result[camelKey] = val;
		}
	}
	return result;
}


// ── JSON Loading ─────────────────────────────────────────────────────

/**
 * Attempt to load and validate `.pi/taskplane-config.json`.
 * Returns the parsed config or null if the file doesn't exist.
 * Throws ConfigLoadError for malformed JSON or unsupported versions.
 */
function loadJsonConfig(configRoot: string): TaskplaneConfig | null {
	const jsonPath = join(configRoot, ".pi", PROJECT_CONFIG_FILENAME);
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
 * Load task-runner settings from `.pi/task-runner.yaml`.
 * Maps snake_case YAML keys to the camelCase TaskRunnerSection shape.
 * Returns cloned defaults if the file doesn't exist or is malformed.
 */
function loadTaskRunnerYaml(configRoot: string): TaskRunnerSection {
	const yamlPath = join(configRoot, ".pi", "task-runner.yaml");
	if (!existsSync(yamlPath)) return deepClone(DEFAULT_TASK_RUNNER_SECTION);

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return deepClone(DEFAULT_TASK_RUNNER_SECTION);

		// Convert snake_case keys to camelCase
		const camel = convertKeysToCamel(loaded);

		// Deep merge with cloned defaults
		const section = deepClone(DEFAULT_TASK_RUNNER_SECTION);
		deepMerge(section, camel);

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
 * Load orchestrator settings from `.pi/task-orchestrator.yaml`.
 * Maps snake_case YAML keys to the camelCase OrchestratorSection shape.
 * Returns cloned defaults if the file doesn't exist or is malformed.
 */
function loadOrchestratorYaml(configRoot: string): OrchestratorSection {
	const yamlPath = join(configRoot, ".pi", "task-orchestrator.yaml");
	if (!existsSync(yamlPath)) return deepClone(DEFAULT_ORCHESTRATOR_SECTION);

	try {
		const raw = readFileSync(yamlPath, "utf-8");
		const loaded = yamlParse(raw) as any;
		if (!loaded || typeof loaded !== "object") return deepClone(DEFAULT_ORCHESTRATOR_SECTION);

		// Convert snake_case keys to camelCase
		const camel = convertKeysToCamel(loaded);

		// Deep merge with cloned defaults
		const section = deepClone(DEFAULT_ORCHESTRATOR_SECTION);
		deepMerge(section, camel);

		return section;
	} catch {
		return deepClone(DEFAULT_ORCHESTRATOR_SECTION);
	}
}


// ── Unified Loader ───────────────────────────────────────────────────

/**
 * Resolve the config root directory.
 *
 * In workspace mode, workers run in repo worktrees — not the workspace root.
 * TASKPLANE_WORKSPACE_ROOT tells us where config files actually live.
 * Falls back to `cwd` if the env var is not set or the path doesn't have `.pi/`.
 */
function resolveConfigRoot(cwd: string): string {
	// First try cwd
	if (existsSync(join(cwd, ".pi"))) return cwd;

	// Workspace mode fallback
	const wsRoot = process.env.TASKPLANE_WORKSPACE_ROOT;
	if (wsRoot && existsSync(join(wsRoot, ".pi"))) return wsRoot;

	// Fall back to cwd even without .pi/ — loaders will return defaults
	return cwd;
}

/**
 * Load the unified project configuration.
 *
 * Precedence:
 *   1. `.pi/taskplane-config.json` — JSON-first (new format)
 *   2. `.pi/task-runner.yaml` + `.pi/task-orchestrator.yaml` — YAML fallback
 *   3. Defaults — if no config files exist
 *
 * Path resolution honors TASKPLANE_WORKSPACE_ROOT for workspace mode.
 *
 * @param cwd - Current working directory (project root or worktree)
 * @returns Unified TaskplaneConfig — always a fresh deep-cloned object
 * @throws ConfigLoadError if JSON exists but is malformed or has unsupported version
 */
export function loadProjectConfig(cwd: string): TaskplaneConfig {
	const configRoot = resolveConfigRoot(cwd);

	// Try JSON first
	const jsonConfig = loadJsonConfig(configRoot);
	if (jsonConfig !== null) return jsonConfig;

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
 * Convert a camelCase key to snake_case.
 */
function camelToSnake(s: string): string {
	return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * Recursively convert all keys in an object from camelCase to snake_case.
 */
function convertKeysToSnake(obj: any): any {
	if (obj === null || obj === undefined) return obj;
	if (Array.isArray(obj)) return obj.map(convertKeysToSnake);
	if (typeof obj !== "object") return obj;

	const result: Record<string, any> = {};
	for (const [key, val] of Object.entries(obj)) {
		const snakeKey = camelToSnake(key);
		if (val !== null && typeof val === "object" && !Array.isArray(val)) {
			result[snakeKey] = convertKeysToSnake(val);
		} else if (Array.isArray(val)) {
			result[snakeKey] = val.map(convertKeysToSnake);
		} else {
			result[snakeKey] = val;
		}
	}
	return result;
}

/**
 * Adapter: produce the legacy `OrchestratorConfig` (snake_case) from unified config.
 *
 * This allows `buildExecutionContext()` and all orchestrator consumers to
 * continue using `OrchestratorConfig` without changes during the transition.
 */
export function toOrchestratorConfig(config: TaskplaneConfig): import("./types.ts").OrchestratorConfig {
	return convertKeysToSnake(config.orchestrator) as import("./types.ts").OrchestratorConfig;
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

	return {
		task_areas: taskAreas,
		reference_docs: { ...config.taskRunner.referenceDocs },
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
	};
}
