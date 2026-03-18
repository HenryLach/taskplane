/**
 * Unified project configuration schema for taskplane-config.json
 *
 * Merges all settings from task-runner.yaml and task-orchestrator.yaml
 * into a single JSON-first configuration file with clear sections.
 *
 * Key naming policy:
 * - JSON uses camelCase (e.g., `maxLanes`, `workerContextWindow`)
 * - YAML fallback loader maps snake_case keys to camelCase equivalents
 * - The runtime config object always uses the interfaces defined here
 *
 * Section map (old YAML → new JSON):
 *   task-runner.yaml:
 *     project          → taskRunner.project
 *     paths            → taskRunner.paths
 *     testing          → taskRunner.testing
 *     standards        → taskRunner.standards
 *     standards_overrides → taskRunner.standardsOverrides
 *     worker           → taskRunner.worker
 *     reviewer         → taskRunner.reviewer
 *     context          → taskRunner.context
 *     task_areas       → taskRunner.taskAreas
 *     reference_docs   → taskRunner.referenceDocs
 *     never_load       → taskRunner.neverLoad
 *     self_doc_targets → taskRunner.selfDocTargets
 *     protected_docs   → taskRunner.protectedDocs
 *
 *   task-orchestrator.yaml:
 *     orchestrator     → orchestrator.orchestrator
 *     dependencies     → orchestrator.dependencies
 *     assignment       → orchestrator.assignment
 *     pre_warm         → orchestrator.preWarm
 *     merge            → orchestrator.merge
 *     failure          → orchestrator.failure
 *     monitoring       → orchestrator.monitoring
 *
 * @module config/schema
 */

// ── Config Version ───────────────────────────────────────────────────

/**
 * Current config schema version.
 *
 * Semantics:
 * - Required field in taskplane-config.json (must be present and valid)
 * - Initial version: 1
 * - Loader behavior for unknown future versions: reject with a clear
 *   error message telling the user to upgrade Taskplane
 * - YAML fallback files have no version field; the loader treats them
 *   as implicitly version 1
 */
export const CONFIG_VERSION = 1;

// ── Canonical Config Path ────────────────────────────────────────────

/**
 * Canonical filename for the unified JSON config.
 * Resolved relative to project root: `.pi/taskplane-config.json`
 */
export const PROJECT_CONFIG_FILENAME = "taskplane-config.json";


// ── Task Runner Section Interfaces ───────────────────────────────────

/** Project metadata */
export interface ProjectMetadataConfig {
	/** Project display name used in prompts/status UI context */
	name: string;
	/** Short project description for agent context */
	description: string;
}

/** Path metadata for the project */
export interface PathsConfig {
	/** Logical tasks root path metadata */
	tasks: string;
	/** Path to architecture document used in context references */
	architecture?: string;
}

/** Verification commands available to agents/reviewers */
export interface TestingConfig {
	/** Named commands (e.g., { test: "npm test", build: "npm run build" }) */
	commands: Record<string, string>;
}

/** Coding standards for agent context */
export interface StandardsConfig {
	/** Docs to treat as coding/review standards references */
	docs: string[];
	/** Plain-language rules injected into agent context */
	rules: string[];
}

/** Per-area standards override */
export interface StandardsOverride {
	/** Override docs for this area */
	docs?: string[];
	/** Override rules for this area */
	rules?: string[];
}

/** Worker agent configuration */
export interface WorkerConfig {
	/** Worker model. Empty string = inherit from active pi session model */
	model: string;
	/** Tool allowlist passed to worker agent invocations */
	tools: string;
	/** Thinking mode setting passed to worker agent */
	thinking: string;
	/** Optional spawn mode override for task-runner */
	spawnMode?: "subprocess" | "tmux";
}

/** Reviewer agent configuration */
export interface ReviewerConfig {
	/** Reviewer model (empty = inherit session model) */
	model: string;
	/** Tool allowlist for reviewer agent */
	tools: string;
	/** Thinking mode for reviewer */
	thinking: string;
}

/** Context/resource limits for task execution */
export interface ContextConfig {
	/** Context window size used for worker context pressure tracking */
	workerContextWindow: number;
	/** Warn threshold for context utilization (percent) */
	warnPercent: number;
	/** Hard-stop threshold for context utilization (percent) */
	killPercent: number;
	/** Max worker iterations per step before failure */
	maxWorkerIterations: number;
	/** Max revise loops per review stage */
	maxReviewCycles: number;
	/** Max no-progress iterations before marking failure */
	noProgressLimit: number;
	/** Optional per-worker wall-clock cap (minutes, used in tmux/orchestrated flows) */
	maxWorkerMinutes?: number;
}

/** Task area definition */
export interface TaskAreaConfig {
	/** Directory containing task folders */
	path: string;
	/** Task ID prefix convention for that area */
	prefix: string;
	/** Area context file path (CONTEXT.md) */
	context: string;
	/** Optional repo ID for routing tasks in this area (workspace mode only) */
	repoId?: string;
}

/** Self-documentation target definition */
export interface SelfDocTarget {
	/** File path where agents should log discoveries */
	[key: string]: string;
}


// ── Task Runner Combined Section ─────────────────────────────────────

/**
 * All task-runner settings, previously from `.pi/task-runner.yaml`.
 *
 * Contains sections consumed by both the task-runner extension directly
 * and by broader ecosystem tooling (skills, workflows, orchestrator).
 */
export interface TaskRunnerSection {
	/** Project metadata */
	project: ProjectMetadataConfig;
	/** Path metadata */
	paths: PathsConfig;
	/** Verification commands */
	testing: TestingConfig;
	/** Coding standards */
	standards: StandardsConfig;
	/** Per-area standards overrides, keyed by area name */
	standardsOverrides: Record<string, StandardsOverride>;
	/** Worker agent configuration */
	worker: WorkerConfig;
	/** Reviewer agent configuration */
	reviewer: ReviewerConfig;
	/** Context/resource limits */
	context: ContextConfig;
	/** Task area definitions, keyed by area name */
	taskAreas: Record<string, TaskAreaConfig>;
	/** Named reference docs catalog */
	referenceDocs: Record<string, string>;
	/** Files/docs that should not be loaded into task execution context */
	neverLoad: string[];
	/** Target anchors where agents should log discoveries */
	selfDocTargets: Record<string, string>;
	/** Paths requiring explicit user approval before modification */
	protectedDocs: string[];
}


// ── Orchestrator Section Interfaces ──────────────────────────────────

/** Core orchestrator settings */
export interface OrchestratorCoreConfig {
	/** Maximum parallel execution lanes/worktrees */
	maxLanes: number;
	/** Where lane worktree directories are created */
	worktreeLocation: "sibling" | "subdirectory";
	/** Prefix used for worktree directory names and lane branch naming */
	worktreePrefix: string;
	/** Batch ID format used in logs/branch naming */
	batchIdFormat: "timestamp" | "sequential";
	/** How lane sessions are spawned */
	spawnMode: "tmux" | "subprocess";
	/** Prefix for orchestrator tmux sessions (tmux mode) */
	tmuxPrefix: string;
	/** Operator identifier. Auto-detected from OS username if empty */
	operatorId: string;
}

/** Dependency resolution settings */
export interface DependenciesConfig {
	/** Dependency extraction source */
	source: "prompt" | "agent";
	/** Cache dependency analysis results between runs */
	cache: boolean;
}

/** Lane assignment settings */
export interface AssignmentConfig {
	/** Lane assignment strategy */
	strategy: "affinity-first" | "round-robin" | "load-balanced";
	/** Relative weights used by size-aware assignment logic */
	sizeWeights: Record<string, number>;
}

/** Pre-warm settings */
export interface PreWarmConfig {
	/** Enable automatic pre-warm command detection */
	autoDetect: boolean;
	/** Named pre-warm commands */
	commands: Record<string, string>;
	/** Commands always run before wave execution */
	always: string[];
}

/** Merge settings */
export interface MergeConfig {
	/** Merge-agent model (empty = inherit active session model) */
	model: string;
	/** Merge-agent tool allowlist */
	tools: string;
	/** Verification commands run after merge operations */
	verify: string[];
	/** Lane merge ordering policy */
	order: "fewest-files-first" | "sequential";
	/** Merge-agent timeout in minutes */
	timeoutMinutes?: number;
}

/** Failure policy settings */
export interface FailureConfig {
	/** Batch behavior when a task fails */
	onTaskFailure: "skip-dependents" | "stop-wave" | "stop-all";
	/** Behavior when a merge step fails */
	onMergeFailure: "pause" | "abort";
	/** Stall detection threshold (minutes) */
	stallTimeout: number;
	/** Max worker runtime budget per task in orchestrated mode (minutes) */
	maxWorkerMinutes: number;
	/** Graceful abort wait time (seconds) before forced termination */
	abortGracePeriod: number;
}

/** Monitoring settings */
export interface MonitoringConfig {
	/** Poll interval (seconds) for lane/task monitoring loop */
	pollInterval: number;
}


// ── Orchestrator Combined Section ────────────────────────────────────

/**
 * All orchestrator settings, previously from `.pi/task-orchestrator.yaml`.
 */
export interface OrchestratorSection {
	/** Core orchestrator settings */
	orchestrator: OrchestratorCoreConfig;
	/** Dependency resolution */
	dependencies: DependenciesConfig;
	/** Lane assignment */
	assignment: AssignmentConfig;
	/** Pre-warm */
	preWarm: PreWarmConfig;
	/** Merge */
	merge: MergeConfig;
	/** Failure policy */
	failure: FailureConfig;
	/** Monitoring */
	monitoring: MonitoringConfig;
}


// ── Unified Config ───────────────────────────────────────────────────

/**
 * Unified project configuration — the single source of truth.
 *
 * This is the runtime config object produced by `loadProjectConfig()`.
 * It merges all settings from both YAML files (or the single JSON file)
 * into one typed structure.
 *
 * File: `.pi/taskplane-config.json`
 *
 * Example JSON structure:
 * ```json
 * {
 *   "configVersion": 1,
 *   "taskRunner": { ... },
 *   "orchestrator": { ... }
 * }
 * ```
 */
export interface TaskplaneConfig {
	/** Schema version — must equal CONFIG_VERSION */
	configVersion: number;
	/** Task runner settings */
	taskRunner: TaskRunnerSection;
	/** Orchestrator settings */
	orchestrator: OrchestratorSection;
}


// ── User Preferences (Layer 2) ───────────────────────────────────────

/**
 * User preferences — personal settings stored per-user.
 *
 * File: `~/.pi/agent/taskplane/preferences.json`
 * (or `$PI_CODING_AGENT_DIR/taskplane/preferences.json` if set)
 *
 * These are "Layer 2" fields — they override project config (Layer 1)
 * for user-scoped settings only. The merge is allowlist-based: only
 * the fields defined here can be overridden by user preferences.
 * Unknown keys in the preferences file are silently ignored.
 *
 * Preferences JSON uses camelCase keys matching the runtime config shape.
 *
 * Layer 2 allowlist — preference field → config path:
 *
 * | Preference field   | Config path                          | Type    |
 * |--------------------|--------------------------------------|---------|
 * | operatorId         | orchestrator.orchestrator.operatorId | string  |
 * | tmuxPrefix         | orchestrator.orchestrator.tmuxPrefix | string  |
 * | spawnMode          | orchestrator.orchestrator.spawnMode  | string  |
 * | workerModel        | taskRunner.worker.model              | string  |
 * | reviewerModel      | taskRunner.reviewer.model            | string  |
 * | mergeModel         | orchestrator.merge.model             | string  |
 * | dashboardPort      | (preferences-only; not yet in schema)| number  |
 */
export interface UserPreferences {
	/** Operator identifier (overrides orchestrator.orchestrator.operatorId) */
	operatorId?: string;
	/** TMUX session prefix (overrides orchestrator.orchestrator.tmuxPrefix) */
	tmuxPrefix?: string;
	/** Spawn mode override (overrides orchestrator.orchestrator.spawnMode) */
	spawnMode?: "tmux" | "subprocess";
	/** Worker model override (overrides taskRunner.worker.model) */
	workerModel?: string;
	/** Reviewer model override (overrides taskRunner.reviewer.model) */
	reviewerModel?: string;
	/** Merge model override (overrides orchestrator.merge.model) */
	mergeModel?: string;
	/** Dashboard port (preferences-only; not yet wired into config schema) */
	dashboardPort?: number;
}

/** Default (empty) user preferences — all fields undefined means "no override". */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {};

/**
 * Canonical filename for user preferences.
 * Resolved relative to agent directory: `<agentDir>/taskplane/preferences.json`
 */
export const USER_PREFERENCES_FILENAME = "preferences.json";

/**
 * Subdirectory under the agent dir for taskplane preferences.
 */
export const USER_PREFERENCES_SUBDIR = "taskplane";


// ── Defaults ─────────────────────────────────────────────────────────

/** Default task runner section values */
export const DEFAULT_TASK_RUNNER_SECTION: TaskRunnerSection = {
	project: { name: "Project", description: "" },
	paths: { tasks: "docs/task-management" },
	testing: { commands: {} },
	standards: { docs: [], rules: [] },
	standardsOverrides: {},
	worker: { model: "", tools: "read,write,edit,bash,grep,find,ls", thinking: "off" },
	reviewer: { model: "openai/gpt-5.3-codex", tools: "read,bash,grep,find,ls", thinking: "on" },
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
};

/** Default orchestrator section values */
export const DEFAULT_ORCHESTRATOR_SECTION: OrchestratorSection = {
	orchestrator: {
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
		timeoutMinutes: 10,
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
};

/** Default unified config */
export const DEFAULT_PROJECT_CONFIG: TaskplaneConfig = {
	configVersion: CONFIG_VERSION,
	taskRunner: DEFAULT_TASK_RUNNER_SECTION,
	orchestrator: DEFAULT_ORCHESTRATOR_SECTION,
};
