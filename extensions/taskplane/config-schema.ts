/**
 * Unified JSON config schema for taskplane-config.json
 *
 * This schema merges both `.pi/task-runner.yaml` and `.pi/task-orchestrator.yaml`
 * into a single `taskplane-config.json` file with clear sections.
 *
 * Key naming: JSON uses camelCase. YAML fallback maps snake_case keys to camelCase.
 *
 * Section mapping (YAML → JSON):
 *   task-runner.yaml sections → taskplaneConfig.*:
 *     project           → project
 *     paths             → paths
 *     testing           → testing
 *     standards         → standards
 *     standards_overrides → standardsOverrides
 *     worker            → worker
 *     reviewer          → reviewer
 *     context           → context
 *     task_areas        → taskAreas
 *     reference_docs    → referenceDocs
 *     never_load        → neverLoad
 *     self_doc_targets  → selfDocTargets
 *     protected_docs    → protectedDocs
 *
 *   task-orchestrator.yaml sections → taskplaneConfig.orchestrator.*:
 *     orchestrator      → orchestrator.general
 *     dependencies      → orchestrator.dependencies
 *     assignment        → orchestrator.assignment
 *     pre_warm          → orchestrator.preWarm
 *     merge             → orchestrator.merge
 *     failure           → orchestrator.failure
 *     monitoring        → orchestrator.monitoring
 *
 * @module config-schema
 */

// ── Config Version ───────────────────────────────────────────────────

/**
 * Current config schema version.
 *
 * Semantics:
 * - Required field in taskplane-config.json
 * - Initial version: 1
 * - Loader rejects unknown future versions (> CONFIG_SCHEMA_VERSION)
 *   with an actionable error message suggesting a Taskplane upgrade.
 * - Backward-compatible additions (new optional fields) do NOT bump version.
 * - Breaking changes (removed/renamed fields, semantic changes) bump version.
 */
export const CONFIG_SCHEMA_VERSION = 1;

// ── Task Runner Sections ─────────────────────────────────────────────

/** Project metadata. */
export interface ProjectConfig {
	name: string;
	description: string;
}

/** Path metadata for the project. */
export interface PathsConfig {
	tasks: string;
	architecture?: string;
}

/** Named verification commands. */
export interface TestingConfig {
	commands: Record<string, string>;
}

/** Coding/review standards references. */
export interface StandardsConfig {
	docs: string[];
	rules: string[];
}

/** Per-area standards overrides keyed by area name. */
export type StandardsOverridesConfig = Record<string, {
	docs?: string[];
	rules?: string[];
}>;

/** Worker agent configuration. */
export interface WorkerConfig {
	model: string;
	tools: string;
	thinking: string;
	spawnMode?: "subprocess" | "tmux";
}

/** Reviewer agent configuration. */
export interface ReviewerConfig {
	model: string;
	tools: string;
	thinking: string;
}

/** Context window and iteration limits. */
export interface ContextConfig {
	workerContextWindow: number;
	warnPercent: number;
	killPercent: number;
	maxWorkerIterations: number;
	maxReviewCycles: number;
	noProgressLimit: number;
	maxWorkerMinutes?: number;
}

/** Task area definition. */
export interface TaskAreaConfig {
	path: string;
	prefix: string;
	context: string;
	repoId?: string;
}

// ── Orchestrator Sections ────────────────────────────────────────────

/** General orchestrator settings (maps from orchestrator.* YAML section). */
export interface OrchestratorGeneralConfig {
	maxLanes: number;
	worktreeLocation: "sibling" | "subdirectory";
	worktreePrefix: string;
	batchIdFormat: "timestamp" | "sequential";
	spawnMode: "tmux" | "subprocess";
	tmuxPrefix: string;
	operatorId: string;
}

/** Dependency extraction settings. */
export interface OrchestratorDependenciesConfig {
	source: "prompt" | "agent";
	cache: boolean;
}

/** Lane assignment settings. */
export interface OrchestratorAssignmentConfig {
	strategy: "affinity-first" | "round-robin" | "load-balanced";
	sizeWeights: Record<string, number>;
}

/** Pre-warm command settings. */
export interface OrchestratorPreWarmConfig {
	autoDetect: boolean;
	commands: Record<string, string>;
	always: string[];
}

/** Merge agent settings. */
export interface OrchestratorMergeConfig {
	model: string;
	tools: string;
	verify: string[];
	order: "fewest-files-first" | "sequential";
}

/** Failure policy settings. */
export interface OrchestratorFailureConfig {
	onTaskFailure: "skip-dependents" | "stop-wave" | "stop-all";
	onMergeFailure: "pause" | "abort";
	stallTimeout: number;
	maxWorkerMinutes: number;
	abortGracePeriod: number;
}

/** Monitoring settings. */
export interface OrchestratorMonitoringConfig {
	pollInterval: number;
}

/** All orchestrator settings grouped under one namespace. */
export interface OrchestratorSectionConfig {
	general: OrchestratorGeneralConfig;
	dependencies: OrchestratorDependenciesConfig;
	assignment: OrchestratorAssignmentConfig;
	preWarm: OrchestratorPreWarmConfig;
	merge: OrchestratorMergeConfig;
	failure: OrchestratorFailureConfig;
	monitoring: OrchestratorMonitoringConfig;
}

// ── Unified Config ───────────────────────────────────────────────────

/**
 * Unified Taskplane project configuration.
 *
 * This is the canonical TypeScript interface for `taskplane-config.json`.
 * It merges all settings from both `task-runner.yaml` (13 sections) and
 * `task-orchestrator.yaml` (7 sections) into a single typed object.
 *
 * The loader produces this shape regardless of whether the source is
 * JSON or YAML fallback.
 */
export interface TaskplaneConfig {
	/** Schema version — must equal CONFIG_SCHEMA_VERSION (currently 1). */
	configVersion: number;

	// ── Task Runner Sections ──
	project: ProjectConfig;
	paths: PathsConfig;
	testing: TestingConfig;
	standards: StandardsConfig;
	standardsOverrides: StandardsOverridesConfig;
	worker: WorkerConfig;
	reviewer: ReviewerConfig;
	context: ContextConfig;
	taskAreas: Record<string, TaskAreaConfig>;
	referenceDocs: Record<string, string>;
	neverLoad: string[];
	selfDocTargets: Record<string, string>;
	protectedDocs: string[];

	// ── Orchestrator Sections ──
	orchestrator: OrchestratorSectionConfig;
}

// ── Defaults ─────────────────────────────────────────────────────────

/**
 * Centralized defaults for the unified config.
 *
 * Single source of truth — both JSON loader and YAML fallback use these
 * defaults when fields are missing. This replaces the separate defaults
 * in types.ts (DEFAULT_ORCHESTRATOR_CONFIG, DEFAULT_TASK_RUNNER_CONFIG)
 * and task-runner.ts (DEFAULT_CONFIG) for the unified loader path.
 */
export const DEFAULT_TASKPLANE_CONFIG: TaskplaneConfig = {
	configVersion: CONFIG_SCHEMA_VERSION,

	// ── Task Runner Defaults ──
	project: { name: "Project", description: "" },
	paths: { tasks: "tasks" },
	testing: { commands: {} },
	standards: { docs: [], rules: [] },
	standardsOverrides: {},
	worker: { model: "", tools: "read,write,edit,bash,grep,find,ls", thinking: "off" },
	reviewer: { model: "", tools: "read,bash,grep,find,ls", thinking: "on" },
	context: {
		workerContextWindow: 200000,
		warnPercent: 70,
		killPercent: 85,
		maxWorkerIterations: 20,
		maxReviewCycles: 2,
		noProgressLimit: 3,
	},
	taskAreas: {},
	referenceDocs: {},
	neverLoad: [],
	selfDocTargets: {},
	protectedDocs: [],

	// ── Orchestrator Defaults ──
	orchestrator: {
		general: {
			maxLanes: 3,
			worktreeLocation: "subdirectory",
			worktreePrefix: "taskplane-wt",
			batchIdFormat: "timestamp",
			spawnMode: "subprocess",
			tmuxPrefix: "orch",
			operatorId: "",
		},
		dependencies: {
			source: "prompt",
			cache: true,
		},
		assignment: {
			strategy: "affinity-first",
			sizeWeights: { S: 1, M: 2, L: 4 },
		},
		preWarm: {
			autoDetect: false,
			commands: {},
			always: [],
		},
		merge: {
			model: "",
			tools: "read,write,edit,bash,grep,find,ls",
			verify: [],
			order: "fewest-files-first",
		},
		failure: {
			onTaskFailure: "skip-dependents",
			onMergeFailure: "pause",
			stallTimeout: 30,
			maxWorkerMinutes: 30,
			abortGracePeriod: 60,
		},
		monitoring: {
			pollInterval: 5,
		},
	},
};
