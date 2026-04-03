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
	/** Optional spawn mode override for task-runner (Runtime V2 subprocess-only). */
	spawnMode?: "subprocess";
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
	/** Context window size used for worker context pressure tracking.
	 *  Set to 0 (default) for auto-detection from the pi model registry.
	 *  When 0, the task-runner resolves at runtime: ctx.model.contextWindow → 200K fallback. */
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
	/** Optional per-worker wall-clock cap (minutes, used in orchestrated flows) */
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

/**
 * Severity threshold for quality gate pass decisions.
 *
 * - `no_critical`: PASS if no critical findings (important/suggestion allowed)
 * - `no_important`: PASS if no critical and fewer than 3 important findings
 * - `all_clear`: PASS only if zero findings of any severity
 */
export type PassThreshold = "no_critical" | "no_important" | "all_clear";

/**
 * Model fallback behavior when a configured agent model becomes unavailable mid-batch.
 *
 * - `"inherit"`: Fall back to the session model and retry (default). The task is
 *   retried without an explicit --model flag, so pi uses whatever model the
 *   session is configured with.
 * - `"fail"`: Fail immediately — the normal failure/retry path handles the error
 *   without any model substitution.
 *
 * @since TP-055
 */
export type ModelFallbackMode = "inherit" | "fail";

/** Quality gate configuration — opt-in post-completion review */
export interface QualityGateConfig {
	/** Enable quality gate review before .DONE creation (default: false) */
	enabled: boolean;
	/** Model used for quality gate review agent (empty = inherit session model) */
	reviewModel: string;
	/** Max total review cycles before marking task failed (default: 2) */
	maxReviewCycles: number;
	/** Max fix agent cycles per quality gate run (default: 1) */
	maxFixCycles: number;
	/** Severity threshold for PASS decision (default: "no_critical") */
	passThreshold: PassThreshold;
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
	/** Quality gate configuration — opt-in post-completion review */
	qualityGate: QualityGateConfig;
	/**
	 * Model fallback behavior when a configured model becomes unavailable mid-batch.
	 *
	 * - `"inherit"` (default): Retry the task without an explicit model flag,
	 *   falling back to the session model.
	 * - `"fail"`: Fail immediately without model substitution.
	 *
	 * @since TP-055
	 */
	modelFallback: ModelFallbackMode;
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
	/** How lane sessions are spawned (Runtime V2 subprocess-only). */
	spawnMode: "subprocess";
	/** Prefix for orchestrator session naming */
	sessionPrefix: string;
	/** Operator identifier. Auto-detected from OS username if empty */
	operatorId: string;
	/** How completed batches are integrated. manual = user runs /orch-integrate. supervised = supervisor proposes plan, asks confirmation. auto = supervisor executes without asking. */
	integration: "manual" | "supervised" | "auto";
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

/**
 * Verification baseline fingerprinting settings.
 *
 * Controls orchestrator-side baseline capture and post-merge comparison.
 * When enabled, test commands from `taskRunner.testing.commands` are run
 * before and after each lane merge to detect genuinely new failures.
 *
 * This is separate from `merge.verify` (agent-side verification) which
 * handles revert-on-failure logic within the merge agent.
 */
export interface VerificationConfig {
	/**
	 * Enable verification baseline fingerprinting.
	 *
	 * When false (default), no baseline capture or comparison is performed,
	 * regardless of whether `taskRunner.testing.commands` are configured.
	 *
	 * When true, requires `taskRunner.testing.commands` to have at least
	 * one command configured. If enabled but no commands are configured:
	 * - strict mode: treats as baseline-unavailable (triggers merge failure)
	 * - permissive mode: logs a warning and continues without verification
	 */
	enabled: boolean;
	/**
	 * Verification mode controlling behavior when baseline is unavailable.
	 *
	 * - "strict": Baseline capture failure or missing commands triggers a
	 *   merge failure. The `failure.onMergeFailure` policy then determines
	 *   whether the batch pauses or aborts.
	 * - "permissive": Baseline capture failure or missing commands logs a
	 *   warning and continues without orchestrator-side verification.
	 *   Merge-agent verification (`merge.verify`) still applies independently.
	 *
	 * Default: "permissive"
	 */
	mode: "strict" | "permissive";
	/**
	 * Number of flaky re-runs when new failures are detected.
	 *
	 * When new failures are found after a lane merge, only the commands that
	 * produced failures are re-run this many times. If failures disappear on
	 * any re-run, the lane is classified as "flaky_suspected" (warning only).
	 *
	 * Set to 0 to disable flaky re-runs (any new failure immediately blocks).
	 * Default: 1
	 */
	flakyReruns: number;
}


// ── Orchestrator Combined Section ────────────────────────────────────

/**
 * All orchestrator settings, previously from `.pi/task-orchestrator.yaml`.
 */
/** Supervisor agent settings (TP-041). */
export interface SupervisorSectionConfig {
	/** Supervisor model (empty = inherit active session model) */
	model: string;
	/** Autonomy level for recovery actions */
	autonomy: "interactive" | "supervised" | "autonomous";
}

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
	/** Verification baseline fingerprinting (TP-032) */
	verification: VerificationConfig;
	/** Supervisor agent (TP-041) */
	supervisor: SupervisorSectionConfig;
}


// ── Workspace Section Interfaces ─────────────────────────────────────

/** Workspace repo definition (JSON config shape). */
export interface WorkspaceRepoSectionConfig {
	/** Repo root path (relative to workspace root or absolute). */
	path: string;
	/** Optional default branch override. */
	defaultBranch?: string;
}

/** Workspace routing definition (JSON config shape). */
export interface WorkspaceRoutingSectionConfig {
	/** Shared task packet root directory. */
	tasksRoot: string;
	/** Default repo for unqualified operations. */
	defaultRepo: string;
	/** Packet-home repo owning PROMPT/STATUS/.DONE. */
	taskPacketRepo: string;
	/** Strict repo routing mode. */
	strict?: boolean;
}

/** Optional workspace section in taskplane-config.json. */
export interface WorkspaceSectionConfig {
	/** Repo map keyed by repo ID. */
	repos: Record<string, WorkspaceRepoSectionConfig>;
	/** Routing contract for workspace mode. */
	routing: WorkspaceRoutingSectionConfig;
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
	/** Optional workspace config (JSON-first; legacy YAML fallback supported). */
	workspace?: WorkspaceSectionConfig;
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
 * | sessionPrefix      | orchestrator.orchestrator.sessionPrefix | string  |
 * | spawnMode          | orchestrator.orchestrator.spawnMode  | string  |
 * | workerModel        | taskRunner.worker.model              | string  |
 * | reviewerModel      | taskRunner.reviewer.model            | string  |
 * | mergeModel         | orchestrator.merge.model             | string  |
 * | supervisorModel    | orchestrator.supervisor.model        | string  |
 * | dashboardPort      | (preferences-only; not yet in schema)| number  |
 */
export interface UserPreferences {
	/** Operator identifier (overrides orchestrator.orchestrator.operatorId) */
	operatorId?: string;
	/** Orchestrator session prefix (overrides orchestrator.orchestrator.sessionPrefix) */
	sessionPrefix?: string;
	/** Spawn mode override (overrides orchestrator.orchestrator.spawnMode). */
	spawnMode?: "subprocess";
	/** Worker model override (overrides taskRunner.worker.model) */
	workerModel?: string;
	/** Reviewer model override (overrides taskRunner.reviewer.model) */
	reviewerModel?: string;
	/** Merge model override (overrides orchestrator.merge.model) */
	mergeModel?: string;
	/** Supervisor model override (overrides orchestrator.supervisor.model) (TP-041) */
	supervisorModel?: string;
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
		workerContextWindow: 0,
		warnPercent: 85,
		killPercent: 95,
		maxWorkerIterations: 20,
		maxReviewCycles: 2,
		noProgressLimit: 3,
	},
	taskAreas: {},
	referenceDocs: {},
	neverLoad: [],
	selfDocTargets: {},
	protectedDocs: [],
	qualityGate: {
		enabled: false,
		reviewModel: "",
		maxReviewCycles: 2,
		maxFixCycles: 1,
		passThreshold: "no_critical",
	},
	modelFallback: "inherit",
};

/** Default orchestrator section values */
export const DEFAULT_ORCHESTRATOR_SECTION: OrchestratorSection = {
	orchestrator: {
		maxLanes: 3,
		worktreeLocation: "subdirectory",
		worktreePrefix: "taskplane-wt",
		batchIdFormat: "timestamp",
		spawnMode: "subprocess",
		sessionPrefix: "orch",
		operatorId: "",
		integration: "manual",
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
		timeoutMinutes: 90,
	},
	failure: {
		onTaskFailure: "skip-dependents",
		onMergeFailure: "pause",
		stallTimeout: 30,
		maxWorkerMinutes: 120,
		abortGracePeriod: 60,
	},
	monitoring: {
		pollInterval: 5,
	},
	verification: {
		enabled: false,
		mode: "permissive",
		flakyReruns: 1,
	},
	supervisor: {
		model: "",
		autonomy: "supervised",
	},
};

/** Default unified config */
export const DEFAULT_PROJECT_CONFIG: TaskplaneConfig = {
	configVersion: CONFIG_VERSION,
	taskRunner: DEFAULT_TASK_RUNNER_SECTION,
	orchestrator: DEFAULT_ORCHESTRATOR_SECTION,
};
