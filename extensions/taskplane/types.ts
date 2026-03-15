/**
 * All types, interfaces, error classes, constants, and defaults
 * @module orch/types
 */
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────

/** Configuration from .pi/task-orchestrator.yaml */
export interface OrchestratorConfig {
	orchestrator: {
		max_lanes: number;
		worktree_location: "sibling" | "subdirectory";
		worktree_prefix: string;
		batch_id_format: "timestamp" | "sequential";
		spawn_mode: "tmux" | "subprocess";
		tmux_prefix: string;
	};
	dependencies: {
		source: "prompt" | "agent";
		cache: boolean;
	};
	assignment: {
		strategy: "affinity-first" | "round-robin" | "load-balanced";
		size_weights: Record<string, number>;
	};
	pre_warm: {
		auto_detect: boolean;
		commands: Record<string, string>;
		always: string[];
	};
	merge: {
		model: string;
		tools: string;
		verify: string[];
		order: "fewest-files-first" | "sequential";
	};
	failure: {
		on_task_failure: "skip-dependents" | "stop-wave" | "stop-all";
		on_merge_failure: "pause" | "abort";
		stall_timeout: number;
		max_worker_minutes: number;
		abort_grace_period: number;
	};
	monitoring: {
		poll_interval: number;
	};
}

/** A parsed task from PROMPT.md, enriched for orchestrator use */
export interface ParsedTask {
	taskId: string;
	taskName: string;
	reviewLevel: number;
	size: string;
	dependencies: string[];
	fileScope: string[];
	taskFolder: string;
	promptPath: string;
	areaName: string;
	status: "pending" | "complete";
	/** Repo ID declared in the PROMPT metadata (e.g., "api", "frontend"). Undefined if not declared. */
	promptRepoId?: string;
	/** Resolved repo ID after routing precedence (workspace mode only). Undefined in repo mode. */
	resolvedRepoId?: string;
}

/** A wave: a group of tasks whose dependencies are all satisfied */
export interface WaveAssignment {
	waveNumber: number;
	tasks: LaneAssignment[];
}

/** A task assigned to a specific lane within a wave */
export interface LaneAssignment {
	taskId: string;
	lane: number;
	task: ParsedTask;
}

/** Runtime state of the entire batch execution */
export interface BatchState {
	phase: "idle" | "planning" | "running" | "paused" | "merging" | "complete" | "error" | "aborted";
	batchId: string;
	waves: WaveAssignment[];
	currentWave: number;
	tasksTotal: number;
	tasksComplete: number;
	tasksFailed: number;
	laneCount: number;
	laneStatuses: Map<number, LaneStatus>;
	startTime: number;
	errors: string[];
}

/** Per-lane runtime status */
export interface LaneStatus {
	lane: number;
	taskId: string | null;
	status: "idle" | "running" | "complete" | "failed" | "stalled";
	stepProgress: string;
	iteration: number;
	elapsed: number;
	tmuxSession: string;
}

/** Task area definition from task-runner.yaml */
export interface TaskArea {
	path: string;
	prefix: string;
	context: string;
	/** Optional repo ID for routing tasks in this area (workspace mode only). */
	repoId?: string;
}

/** Subset of task-runner.yaml that the orchestrator needs */
export interface TaskRunnerConfig {
	task_areas: Record<string, TaskArea>;
	reference_docs: Record<string, string>;
}

/** Result of a preflight check */
export interface PreflightResult {
	passed: boolean;
	checks: PreflightCheck[];
}

/** Individual preflight check */
export interface PreflightCheck {
	name: string;
	status: "pass" | "fail" | "warn";
	message: string;
	hint?: string;
}


// ── Defaults ─────────────────────────────────────────────────────────

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
	orchestrator: {
		max_lanes: 3,
		worktree_location: "subdirectory",
		worktree_prefix: "taskplane-wt",
		batch_id_format: "timestamp",
		spawn_mode: "subprocess",
		tmux_prefix: "orch",
	},
	dependencies: {
		source: "prompt",
		cache: true,
	},
	assignment: {
		strategy: "affinity-first",
		size_weights: { S: 1, M: 2, L: 4 },
	},
	pre_warm: {
		auto_detect: false,
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
		on_task_failure: "skip-dependents",
		on_merge_failure: "pause",
		stall_timeout: 30,
		max_worker_minutes: 30,
		abort_grace_period: 60,
	},
	monitoring: {
		poll_interval: 5,
	},
};

export const DEFAULT_TASK_RUNNER_CONFIG: TaskRunnerConfig = {
	task_areas: {},
	reference_docs: {},
};


// ── Helpers ──────────────────────────────────────────────────────────

export function freshBatchState(): BatchState {
	return {
		phase: "idle",
		batchId: "",
		waves: [],
		currentWave: 0,
		tasksTotal: 0,
		tasksComplete: 0,
		tasksFailed: 0,
		laneCount: 0,
		laneStatuses: new Map(),
		startTime: 0,
		errors: [],
	};
}

// ── Worktree Types ───────────────────────────────────────────────────

/** Information about a created worktree. Returned by createWorktree(). */
export interface WorktreeInfo {
	/** Absolute filesystem path to the worktree directory */
	path: string;
	/** Branch name checked out in the worktree (e.g. task/lane-1-20260308T111750) */
	branch: string;
	/** Lane number (1-indexed) this worktree is assigned to */
	laneNumber: number;
}

/** Options for createWorktree() */
export interface CreateWorktreeOptions {
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Batch ID timestamp (e.g. "20260308T111750") */
	batchId: string;
	/** Branch to base the worktree on (e.g. "develop") */
	baseBranch: string;
	/** Worktree directory prefix (e.g. "taskplane-wt") */
	prefix: string;
	/** Full orchestrator config (optional; used for worktree_location) */
	config?: OrchestratorConfig;
}

/**
 * Stable error codes for worktree operations.
 *
 * - WORKTREE_PATH_IS_WORKTREE: path already registered as a git worktree
 * - WORKTREE_PATH_NOT_EMPTY: path exists and is a non-empty non-worktree dir
 * - WORKTREE_BRANCH_EXISTS: branch name already exists (checked out elsewhere)
 * - WORKTREE_INVALID_BASE: base branch does not exist
 * - WORKTREE_GIT_ERROR: unexpected git command failure
 * - WORKTREE_VERIFY_FAILED: post-creation/reset verification failed
 * - WORKTREE_REMOVE_FAILED: worktree removal failed (even after retries)
 * - WORKTREE_REMOVE_RETRY_EXHAUSTED: all retry attempts for worktree removal exhausted (Windows file locking)
 * - WORKTREE_BRANCH_DELETE_FAILED: branch deletion failed after successful worktree removal
 * - WORKTREE_NOT_FOUND: worktree path does not exist on disk
 * - WORKTREE_NOT_REGISTERED: path exists but is not a registered git worktree
 * - WORKTREE_DIRTY: worktree has uncommitted changes (cannot reset)
 * - WORKTREE_RESET_FAILED: git checkout -B reset command failed
 */
export type WorktreeErrorCode =
	| "WORKTREE_PATH_IS_WORKTREE"
	| "WORKTREE_PATH_NOT_EMPTY"
	| "WORKTREE_BRANCH_EXISTS"
	| "WORKTREE_INVALID_BASE"
	| "WORKTREE_GIT_ERROR"
	| "WORKTREE_VERIFY_FAILED"
	| "WORKTREE_REMOVE_FAILED"
	| "WORKTREE_REMOVE_RETRY_EXHAUSTED"
	| "WORKTREE_BRANCH_DELETE_FAILED"
	| "WORKTREE_NOT_FOUND"
	| "WORKTREE_NOT_REGISTERED"
	| "WORKTREE_DIRTY"
	| "WORKTREE_RESET_FAILED";

/** Typed error class for worktree operations with stable error codes. */
export class WorktreeError extends Error {
	code: WorktreeErrorCode;

	constructor(code: WorktreeErrorCode, message: string) {
		super(message);
		this.name = "WorktreeError";
		this.code = code;
	}
}

/**
 * Result of a removeWorktree() operation.
 *
 * Provides status flags so callers can branch on outcome without
 * catching errors for expected idempotent scenarios.
 */
export interface RemoveWorktreeResult {
	/** Whether the worktree directory was removed in this call */
	removed: boolean;
	/** Whether the worktree was already absent (idempotent no-op) */
	alreadyRemoved: boolean;
	/** Whether the lane branch was deleted (or was already absent) */
	branchDeleted: boolean;
	/** Whether the lane branch was preserved (unmerged commits detected) */
	branchPreserved: boolean;
	/** The saved branch name (if preserved) */
	savedBranch?: string;
	/** Number of unmerged commits (if preserved) */
	unmergedCount?: number;
}

// ── Bulk Operation Types ─────────────────────────────────────────────

/** Error from a single worktree within a bulk operation. */
export interface BulkWorktreeError {
	/** Lane number that failed */
	laneNumber: number;
	/** Error code from WorktreeError (if available) */
	code: WorktreeErrorCode | "UNKNOWN";
	/** Human-readable error message */
	message: string;
}

/**
 * Result of createLaneWorktrees() bulk creation.
 *
 * On success: `success=true`, `worktrees` contains all created WorktreeInfos.
 * On failure: `success=false`, `errors` lists per-lane failures,
 *   `rolledBack` indicates whether cleanup of partial state succeeded.
 */
export interface CreateLaneWorktreesResult {
	/** Whether all lane worktrees were created successfully */
	success: boolean;
	/** Created worktrees (sorted by laneNumber). Empty on failure if rolled back. */
	worktrees: WorktreeInfo[];
	/** Per-lane errors encountered during creation */
	errors: BulkWorktreeError[];
	/** Whether rollback of partially-created worktrees succeeded (only relevant on failure) */
	rolledBack: boolean;
	/** Errors encountered during rollback (if any) */
	rollbackErrors: BulkWorktreeError[];
}

/**
 * Per-worktree outcome within removeAllWorktrees().
 */
export interface RemoveWorktreeOutcome {
	/** The worktree that was targeted for removal */
	worktree: WorktreeInfo;
	/** The removal result (null if removal threw an error) */
	result: RemoveWorktreeResult | null;
	/** Error encountered during removal (null on success) */
	error: BulkWorktreeError | null;
}

/**
 * Result of removeAllWorktrees() bulk removal.
 *
 * Best-effort: continues on per-worktree errors (does not fail-fast).
 */
export interface RemoveAllWorktreesResult {
	/** Total worktrees found matching the prefix */
	totalAttempted: number;
	/** Successfully removed (or already removed) worktrees */
	removed: WorktreeInfo[];
	/** Worktrees that failed to remove */
	failed: RemoveWorktreeOutcome[];
	/** All per-worktree outcomes in order */
	outcomes: RemoveWorktreeOutcome[];
	/** Branches preserved (had unmerged commits) */
	preserved: Array<{ branch: string; savedBranch: string; laneNumber: number; unmergedCount?: number }>;
}

// ── Discovery Types ──────────────────────────────────────────────────

/** Structured error from the discovery phase with diagnostic context */
export interface DiscoveryError {
	code:
		| "PARSE_MISSING_ID"
		| "PARSE_MALFORMED"
		| "DUPLICATE_ID"
		| "UNKNOWN_ARG"
		| "SCAN_ERROR"
		| "DEP_UNRESOLVED"
		| "DEP_PENDING"
		| "DEP_AMBIGUOUS"
		| "DEP_SOURCE_FALLBACK"
		| "TASK_REPO_UNRESOLVED"
		| "TASK_REPO_UNKNOWN";
	message: string;
	taskPath?: string;
	taskId?: string;
}

/**
 * Discovery error codes that are fatal (block planning/execution).
 *
 * Used by formatDiscoveryResults, extension.ts, and engine.ts for
 * consistent fatal-error classification. Keep in sync with the
 * DiscoveryError.code union above.
 */
export const FATAL_DISCOVERY_CODES: ReadonlyArray<DiscoveryError["code"]> = [
	"DUPLICATE_ID",
	"DEP_UNRESOLVED",
	"DEP_PENDING",
	"DEP_AMBIGUOUS",
	"PARSE_MISSING_ID",
	"TASK_REPO_UNRESOLVED",
	"TASK_REPO_UNKNOWN",
] as const;

/** Result of the full discovery pipeline */
export interface DiscoveryResult {
	pending: Map<string, ParsedTask>;
	completed: Set<string>;
	errors: DiscoveryError[];
}


// ── Wave Computation Types ───────────────────────────────────────────

/** Dependency graph: adjacency list (task → tasks it depends on) */
export interface DependencyGraph {
	/** Map from task ID to list of task IDs it depends on (predecessors) */
	dependencies: Map<string, string[]>;
	/** Map from task ID to list of task IDs that depend on it (successors) */
	dependents: Map<string, string[]>;
	/** All task IDs in the graph (pending only, not completed) */
	nodes: Set<string>;
}

/** Result of graph validation */
export interface GraphValidationResult {
	valid: boolean;
	errors: DiscoveryError[];
}

/** Result of wave computation */
export interface WaveComputationResult {
	waves: WaveAssignment[];
	errors: DiscoveryError[];
}


// ── Lane Allocation (Phase 3) ────────────────────────────────────────

/**
 * Error codes specific to lane allocation.
 *
 * - ALLOC_INVALID_CONFIG: configuration validation failed
 * - ALLOC_EMPTY_WAVE: no tasks provided for allocation
 * - ALLOC_WORKTREE_FAILED: worktree creation failed (includes rollback info)
 * - ALLOC_TASK_NOT_FOUND: task ID from wave not found in pending map
 */
export type AllocationErrorCode =
	| "ALLOC_INVALID_CONFIG"
	| "ALLOC_EMPTY_WAVE"
	| "ALLOC_WORKTREE_FAILED"
	| "ALLOC_TASK_NOT_FOUND";

/** Typed error for lane allocation failures. */
export class AllocationError extends Error {
	code: AllocationErrorCode;
	details?: string;

	constructor(code: AllocationErrorCode, message: string, details?: string) {
		super(message);
		this.name = "AllocationError";
		this.code = code;
		this.details = details;
	}
}

/**
 * A task assigned within a lane, with its ordering position.
 *
 * Tasks within a lane execute sequentially in `order` (ascending).
 * The ordering is deterministic given the same input.
 */
export interface AllocatedTask {
	/** Task ID (e.g., "TO-014") */
	taskId: string;
	/** Execution order within the lane (0-indexed) */
	order: number;
	/** Full parsed task metadata */
	task: ParsedTask;
	/** Estimated duration in minutes */
	estimatedMinutes: number;
}

/**
 * A fully-allocated lane ready for execution.
 *
 * Contains everything Steps 2-3 need to spawn TMUX sessions,
 * monitor progress, and identify the lane. This is the contract
 * between Step 1 (allocation) and Step 2 (execution).
 */
export interface AllocatedLane {
	/** Lane number (1-indexed, deterministic) */
	laneNumber: number;
	/** Lane identifier for display and logging (e.g., "lane-1") */
	laneId: string;
	/** TMUX session naming seed (e.g., "orch-lane-1") — used by Step 2 */
	tmuxSessionName: string;
	/** Absolute path to the lane's worktree directory */
	worktreePath: string;
	/** Git branch name checked out in the worktree */
	branch: string;
	/** Tasks assigned to this lane, ordered for sequential execution */
	tasks: AllocatedTask[];
	/** Assignment strategy that was used (for diagnostics) */
	strategy: "affinity-first" | "round-robin" | "load-balanced";
	/** Total estimated load (sum of task weights) */
	estimatedLoad: number;
	/** Total estimated duration in minutes (sum of task durations) */
	estimatedMinutes: number;
}


// ── Execution Types & Contracts ──────────────────────────────────────

/**
 * Lifecycle status for a single task within lane execution.
 *
 * State machine:
 *   pending → running → succeeded
 *                     → failed
 *                     → stalled
 *   pending → skipped  (pause/abort before task starts, or prior task failed)
 */
export type LaneTaskStatus = "pending" | "running" | "succeeded" | "failed" | "stalled" | "skipped";

/**
 * Outcome of a single task execution within a lane.
 *
 * Produced by `executeLane()` for each task in the lane's task list.
 * Consumed by Step 3 (monitoring) and Step 4 (wave policy logic).
 */
export interface LaneTaskOutcome {
	/** Task identifier (e.g., "TO-014") */
	taskId: string;
	/** Final task status */
	status: LaneTaskStatus;
	/** When execution started (epoch ms), null if never started (skipped) */
	startTime: number | null;
	/** When execution ended (epoch ms), null if still pending */
	endTime: number | null;
	/** Human-readable reason for the outcome */
	exitReason: string;
	/** TMUX session name used for this task (e.g., "orch-lane-1") */
	sessionName: string;
	/** Whether .DONE file was found */
	doneFileFound: boolean;
}

/**
 * Overall result of executing all tasks in a lane.
 *
 * The lane runs tasks sequentially. If a task fails and the lane
 * has remaining tasks, those remaining tasks are marked as `skipped`.
 */
export interface LaneExecutionResult {
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Lane identifier for display (e.g., "lane-1") */
	laneId: string;
	/** Per-task outcomes in execution order */
	tasks: LaneTaskOutcome[];
	/** Aggregate lane status: succeeded if all tasks succeeded, failed if any failed */
	overallStatus: "succeeded" | "failed" | "partial";
	/** When lane execution started (epoch ms) */
	startTime: number;
	/** When lane execution ended (epoch ms) */
	endTime: number;
}

// ── Execution Constants ──────────────────────────────────────────────

/**
 * Grace period (ms) after TMUX session exits before declaring failure.
 * Allows time for .DONE file to be flushed to disk on slow filesystems.
 */
export const DONE_GRACE_MS = 5_000;

/**
 * Polling interval (ms) for checking session liveness and .DONE file.
 */
export const EXECUTION_POLL_INTERVAL_MS = 2_000;

/**
 * Maximum retries for TMUX session spawn failures.
 * Only transient failures (session name collision) are retried.
 */
export const SESSION_SPAWN_RETRY_MAX = 2;

// ── Execution Error Types ────────────────────────────────────────────

/**
 * Error codes for lane execution failures.
 *
 * - EXEC_SPAWN_FAILED: TMUX session could not be created after retries
 * - EXEC_TASK_FAILED: task completed without .DONE (non-zero exit)
 * - EXEC_TASK_STALLED: STATUS.md unchanged for stall_timeout (handled by Step 3)
 * - EXEC_TASK_STAGE_FAILED: git add failed for task files
 * - EXEC_TASK_COMMIT_FAILED: git commit failed for staged task files
 * - EXEC_TMUX_NOT_AVAILABLE: tmux binary not found
 * - EXEC_WORKTREE_MISSING: lane worktree path doesn't exist
 */
export type ExecutionErrorCode =
	| "EXEC_SPAWN_FAILED"
	| "EXEC_TASK_FAILED"
	| "EXEC_TASK_STALLED"
	| "EXEC_TASK_STAGE_FAILED"
	| "EXEC_TASK_COMMIT_FAILED"
	| "EXEC_TMUX_NOT_AVAILABLE"
	| "EXEC_WORKTREE_MISSING";

/** Typed error for lane execution failures. */
export class ExecutionError extends Error {
	code: ExecutionErrorCode;
	laneId?: string;
	taskId?: string;

	constructor(code: ExecutionErrorCode, message: string, laneId?: string, taskId?: string) {
		super(message);
		this.name = "ExecutionError";
		this.code = code;
		this.laneId = laneId;
		this.taskId = taskId;
	}
}


// ── Monitoring Types & Contracts ─────────────────────────────────────

/**
 * Snapshot of a single task's monitored state at a point in time.
 *
 * Produced by `resolveTaskMonitorState()` from combining:
 * - .DONE file presence
 * - TMUX session liveness
 * - STATUS.md parse results
 * - STATUS.md mtime for stall detection
 */
export interface TaskMonitorSnapshot {
	/** Task ID (e.g., "TO-014") */
	taskId: string;
	/** Resolved monitoring status */
	status: "pending" | "running" | "succeeded" | "failed" | "stalled" | "skipped" | "unknown";
	/** Current step name (e.g., "Implement Service Layer"), null if not parsed */
	currentStepName: string | null;
	/** Current step number, null if not parsed */
	currentStepNumber: number | null;
	/** Total steps in the task */
	totalSteps: number;
	/** Checked checkbox count across all steps */
	totalChecked: number;
	/** Total checkbox count across all steps */
	totalItems: number;
	/** Whether the TMUX session is alive */
	sessionAlive: boolean;
	/** Whether the .DONE file was found */
	doneFileFound: boolean;
	/** Stall reason (null if not stalled) */
	stallReason: string | null;
	/** Epoch ms of last known STATUS.md modification */
	lastHeartbeat: number | null;
	/** Epoch ms when this snapshot was taken */
	observedAt: number;
	/** Reason string if STATUS.md couldn't be read */
	parseError: string | null;
	/** Worker iteration number from STATUS.md */
	iteration: number;
	/** Review counter from STATUS.md */
	reviewCounter: number;
}

/**
 * Per-lane monitoring snapshot aggregating task-level snapshots.
 */
export interface LaneMonitorSnapshot {
	/** Lane identifier (e.g., "lane-1") */
	laneId: string;
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** TMUX session name (e.g., "orch-lane-1") */
	sessionName: string;
	/** Whether the TMUX session is alive right now */
	sessionAlive: boolean;
	/** Current task being executed (null if lane is idle/complete) */
	currentTaskId: string | null;
	/** Snapshot of the current task (null if no current task) */
	currentTaskSnapshot: TaskMonitorSnapshot | null;
	/** Task IDs that have completed (succeeded) */
	completedTasks: string[];
	/** Task IDs that failed or stalled */
	failedTasks: string[];
	/** Task IDs not yet started */
	remainingTasks: string[];
}

/**
 * Aggregate monitoring state across all lanes.
 *
 * This is the primary data contract consumed by:
 * - Step 4 (wave execution loop) for failure policy decisions
 * - Step 6 (dashboard widget) for rendering
 */
export interface MonitorState {
	/** Per-lane snapshots */
	lanes: LaneMonitorSnapshot[];
	/** Overall progress: tasks done / total */
	tasksDone: number;
	tasksFailed: number;
	tasksTotal: number;
	/** Current wave number */
	waveNumber: number;
	/** Number of poll cycles completed */
	pollCount: number;
	/** Epoch ms of last poll */
	lastPollTime: number;
	/** Whether all lanes have reached terminal state */
	allTerminal: boolean;
}

/**
 * Per-task mtime tracker for stall detection.
 *
 * Tracks when we first observed the task (for startup grace),
 * last known STATUS.md mtime, and stall timer state.
 */
export interface MtimeTracker {
	/** Task ID */
	taskId: string;
	/** Epoch ms when we first observed this task running */
	firstObservedAt: number;
	/** Whether we've successfully read STATUS.md at least once */
	statusFileSeenOnce: boolean;
	/** Last known STATUS.md mtime (epoch ms), null if never read */
	lastMtime: number | null;
	/** Epoch ms when the stall timer started (mtime stopped changing) */
	stallTimerStart: number | null;
}


// ── Wave Execution Types & Contracts ─────────────────────────────────

/**
 * Failure policy action matrix.
 *
 * Defines what happens to tasks in different states when a failure occurs,
 * depending on the configured failure policy.
 *
 * | Task State    | skip-dependents          | stop-wave              | stop-all                  |
 * |---------------|--------------------------|------------------------|---------------------------|
 * | In-flight     | Continue running         | Continue running       | Kill immediately          |
 * | Queued (lane) | Continue if not dependent| Skip remaining in lane | Skip remaining in lane    |
 * | Future waves  | Prune transitive deps    | Don't start next wave  | Don't start any more      |
 *
 * Ownership contract:
 * - executeLane() is source-of-truth for terminal task status
 * - monitorLanes() runs as sibling async loop, can kill stalled sessions
 * - executeWave() coordinates both and applies policy
 * - Monitor's stall-kill does NOT conflict with executeLane() because
 *   executeLane() polls tmux session status and will see the killed session
 */

/**
 * Result of executing a single wave.
 *
 * Consumed by:
 * - Step 5 (/orch command) for wave-to-wave progression decisions
 * - Step 6 (dashboard widget) for rendering wave summaries
 */
export interface WaveExecutionResult {
	/** Wave number (1-indexed) */
	waveIndex: number;
	/** Epoch ms when wave execution started */
	startedAt: number;
	/** Epoch ms when wave execution ended */
	endedAt: number;
	/** Per-lane execution results */
	laneResults: LaneExecutionResult[];
	/** Which failure policy was configured */
	policyApplied: "skip-dependents" | "stop-wave" | "stop-all";
	/** Whether the wave was stopped early due to policy */
	stoppedEarly: boolean;
	/** Task IDs that failed (including stalled) */
	failedTaskIds: string[];
	/** Task IDs that were skipped (due to pause, prior failure, or policy) */
	skippedTaskIds: string[];
	/** Task IDs that succeeded */
	succeededTaskIds: string[];
	/** Task IDs blocked for future waves (transitive dependents of failed tasks) */
	blockedTaskIds: string[];
	/** Number of lanes used */
	laneCount: number;
	/** Overall wave status */
	overallStatus: "succeeded" | "failed" | "partial" | "aborted";
	/** Final monitor state snapshot (null if monitoring wasn't started) */
	finalMonitorState: MonitorState | null;
	/** Allocated lanes used in this wave (preserved for merge and cleanup) */
	allocatedLanes: AllocatedLane[];
}


// ── Orchestrator Runtime State ───────────────────────────────────────

/**
 * Runtime phase of the orchestrator batch execution.
 *
 * State machine:
 *   idle → planning → executing → completed
 *                               → failed
 *                               → stopped (stop-wave/stop-all policy triggered)
 *                   → paused (via /orch-pause)
 *   Any active state → idle (via cleanup after completion/failure)
 */
export type OrchBatchPhase = "idle" | "planning" | "executing" | "merging" | "paused" | "stopped" | "completed" | "failed";

/**
 * Runtime state for a batch execution.
 *
 * This is the primary state object that:
 * - Tracks progress across waves for the /orch command
 * - Is consumed by Step 6 (dashboard widget) for rendering
 * - Tracks pauseSignal for /orch-pause
 * - Accumulates wave results for summary
 */
export interface OrchBatchRuntimeState {
	/** Current execution phase */
	phase: OrchBatchPhase;
	/** Unique batch identifier (timestamp format, e.g., "20260308T214300") */
	batchId: string;
	/** Branch that was active when /orch started — used as base for worktrees and merge target */
	baseBranch: string;
	/** Shared pause signal — set by /orch-pause, read by executeLane/executeWave */
	pauseSignal: { paused: boolean };
	/** All wave results in order (grows as waves complete) */
	waveResults: WaveExecutionResult[];
	/** Current wave index (0-based into waves array, -1 if not started) */
	currentWaveIndex: number;
	/** Total number of waves planned */
	totalWaves: number;
	/** Set of task IDs blocked for future waves (from skip-dependents policy) */
	blockedTaskIds: Set<string>;
	/** Epoch ms when batch started */
	startedAt: number;
	/** Epoch ms when batch ended (null if still running) */
	endedAt: number | null;
	/** Total tasks in batch */
	totalTasks: number;
	/** Tasks completed successfully */
	succeededTasks: number;
	/** Tasks that failed */
	failedTasks: number;
	/** Tasks skipped */
	skippedTasks: number;
	/** Tasks blocked (transitive dependents of failures) */
	blockedTasks: number;
	/** Error messages for display */
	errors: string[];
	/** Allocated lanes from current wave (for session registry) */
	currentLanes: AllocatedLane[];
	/** Dependency graph for the batch (for skip-dependents computation) */
	dependencyGraph: DependencyGraph | null;
	/** Accumulated merge results across all waves */
	mergeResults: MergeWaveResult[];
}

/**
 * Session registry entry for /orch-sessions command.
 */
export interface OrchestratorSessionEntry {
	/** TMUX session name (e.g., "orch-lane-1") */
	sessionName: string;
	/** Lane ID (e.g., "lane-1") */
	laneId: string;
	/** Task ID currently running (if tracked) */
	taskId: string | null;
	/** Session status */
	status: "alive" | "dead";
	/** Worktree path */
	worktreePath: string;
	/** Attach command for user */
	attachCmd: string;
}

/**
 * Session registry: maps session names to their metadata.
 */
export type OrchestratorSessionRegistry = Map<string, OrchestratorSessionEntry>;

// ── Batch ID Generation ──────────────────────────────────────────────

/**
 * Generate a batch ID from the current timestamp.
 * Format: "YYYYMMDDTHHMMSS" (e.g., "20260308T214300")
 */
export function generateBatchId(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Create a fresh batch runtime state.
 */
export function freshOrchBatchState(): OrchBatchRuntimeState {
	return {
		phase: "idle",
		batchId: "",
		baseBranch: "",
		pauseSignal: { paused: false },
		waveResults: [],
		currentWaveIndex: -1,
		totalWaves: 0,
		blockedTaskIds: new Set(),
		startedAt: 0,
		endedAt: null,
		totalTasks: 0,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		errors: [],
		currentLanes: [],
		dependencyGraph: null,
		mergeResults: [],
	};
}


// ── Merge Types ──────────────────────────────────────────────────────

/**
 * Valid merge result statuses.
 * Matches the contract in .pi/agents/task-merger.md.
 */
export type MergeResultStatus = "SUCCESS" | "CONFLICT_RESOLVED" | "CONFLICT_UNRESOLVED" | "BUILD_FAILURE";

/** All valid status strings for runtime validation. */
export const VALID_MERGE_STATUSES: ReadonlySet<string> = new Set([
	"SUCCESS",
	"CONFLICT_RESOLVED",
	"CONFLICT_UNRESOLVED",
	"BUILD_FAILURE",
]);

/** A single conflict entry in the merge result. */
export interface MergeConflict {
	file: string;
	type: string;
	resolved: boolean;
	resolution?: string;
}

/** Verification outcome in the merge result. */
export interface MergeVerification {
	ran: boolean;
	passed: boolean;
	output: string;
}

/**
 * Merge result JSON written by the merge agent.
 * Matches the schema in .pi/agents/task-merger.md § Result File Format.
 */
export interface MergeResult {
	status: MergeResultStatus;
	source_branch: string;
	target_branch: string;
	merge_commit: string;
	conflicts: MergeConflict[];
	verification: MergeVerification;
}

/** Per-lane merge outcome, enriched by the orchestrator. */
export interface MergeLaneResult {
	laneNumber: number;
	laneId: string;
	sourceBranch: string;
	targetBranch: string;
	result: MergeResult | null;
	error: string | null;
	durationMs: number;
}

/** Overall wave merge outcome. */
export interface MergeWaveResult {
	waveIndex: number;
	status: "succeeded" | "failed" | "partial";
	laneResults: MergeLaneResult[];
	failedLane: number | null;
	failureReason: string | null;
	totalDurationMs: number;
}

// ── Merge Error Types ────────────────────────────────────────────────

/**
 * Error codes for merge operations.
 *
 * - MERGE_SPAWN_FAILED: Could not create TMUX session for merge agent
 * - MERGE_TIMEOUT: Merge agent did not produce result within timeout
 * - MERGE_SESSION_DIED: TMUX session exited without writing result
 * - MERGE_RESULT_INVALID: Result file exists but contains invalid JSON
 * - MERGE_RESULT_MISSING_FIELDS: Result JSON missing required fields
 * - MERGE_UNKNOWN_STATUS: Result has an unrecognized status value
 * - MERGE_GIT_ERROR: Git command failure during merge setup
 */
export type MergeErrorCode =
	| "MERGE_SPAWN_FAILED"
	| "MERGE_TIMEOUT"
	| "MERGE_SESSION_DIED"
	| "MERGE_RESULT_INVALID"
	| "MERGE_RESULT_MISSING_FIELDS"
	| "MERGE_UNKNOWN_STATUS"
	| "MERGE_GIT_ERROR";

/** Typed error class for merge operations. */
export class MergeError extends Error {
	code: MergeErrorCode;

	constructor(code: MergeErrorCode, message: string) {
		super(message);
		this.name = "MergeError";
		this.code = code;
	}
}

// ── Merge Constants ──────────────────────────────────────────────────

/**
 * Default timeout for merge agent execution (ms).
 * Merge agents typically complete in 10-60 seconds. A 5-minute timeout
 * is generous and covers verification (go build) on large codebases.
 */
export const MERGE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Polling interval for merge result file (ms).
 * Merge agents are fast; poll aggressively.
 */
export const MERGE_POLL_INTERVAL_MS = 2_000;

/**
 * Grace period after TMUX session exits before declaring failure (ms).
 * Allows for slow disk flush of the result file.
 */
export const MERGE_RESULT_GRACE_MS = 3_000;

/**
 * Maximum retries for reading a partially-written result file.
 * If JSON parse fails, wait and retry in case the file is still being written.
 */
export const MERGE_RESULT_READ_RETRIES = 3;

/**
 * Delay between result file read retries (ms).
 */
export const MERGE_RESULT_READ_RETRY_DELAY_MS = 1_000;

/**
 * Maximum retries for TMUX session spawn during merge.
 */
export const MERGE_SPAWN_RETRY_MAX = 2;


// ── View-Model Types ─────────────────────────────────────────────────

/**
 * Summary counts for the orchestrator dashboard.
 * Pure data — no rendering logic.
 */
export interface OrchSummaryCounts {
	completed: number;
	running: number;
	queued: number;
	failed: number;
	blocked: number;
	stalled: number;
	total: number;
}

/**
 * Per-lane view data for dashboard rendering.
 * Derived from MonitorState LaneMonitorSnapshot + AllocatedLane metadata.
 */
export interface OrchLaneCardData {
	laneNumber: number;
	laneId: string;
	sessionName: string;
	sessionAlive: boolean;
	currentTaskId: string | null;
	currentStepName: string | null;
	totalChecked: number;
	totalItems: number;
	completedTasks: number;
	totalLaneTasks: number;
	status: "idle" | "running" | "succeeded" | "failed" | "stalled";
	stallReason: string | null;
}

/**
 * Dashboard view-model — maps runtime state to render-ready data.
 *
 * This is the single data contract between OrchBatchRuntimeState +
 * MonitorState and the widget rendering function.
 */
export interface OrchDashboardViewModel {
	phase: OrchBatchPhase;
	batchId: string;
	waveProgress: string; // e.g., "2/3"
	elapsed: string; // e.g., "2m 14s"
	summary: OrchSummaryCounts;
	laneCards: OrchLaneCardData[];
	attachHint: string; // e.g., "tmux attach -t orch-lane-1"
	errors: string[];
	failurePolicy: string | null; // e.g., "stop-wave" if stopped by policy
}


// ── State Persistence Types (TS-009) ─────────────────────────────────

/**
 * Current schema version for batch-state.json.
 * Increment when the persisted schema changes in incompatible ways.
 * loadBatchState() rejects files with a different schemaVersion.
 */
export const BATCH_STATE_SCHEMA_VERSION = 1;

/**
 * Canonical file path for persisted batch state.
 * Resolved relative to repository root: `.pi/batch-state.json`
 */
export const BATCH_STATE_FILENAME = "batch-state.json";

/**
 * Resolve the absolute path to the batch state file.
 * @param repoRoot - Absolute path to the repository root
 */
export function batchStatePath(repoRoot: string): string {
	return join(repoRoot, ".pi", BATCH_STATE_FILENAME);
}

/**
 * Error codes for state persistence operations.
 *
 * - STATE_FILE_IO_ERROR: Filesystem read/write/rename failure
 * - STATE_FILE_PARSE_ERROR: File exists but contains invalid JSON
 * - STATE_SCHEMA_INVALID: JSON is valid but fails schema validation
 *   (missing required fields, unknown enum values, version mismatch)
 */
export type StateFileErrorCode =
	| "STATE_FILE_IO_ERROR"
	| "STATE_FILE_PARSE_ERROR"
	| "STATE_SCHEMA_INVALID";

/** Typed error class for state file operations. */
export class StateFileError extends Error {
	code: StateFileErrorCode;

	constructor(code: StateFileErrorCode, message: string) {
		super(message);
		this.name = "StateFileError";
		this.code = code;
	}
}

/**
 * Persisted record of a single task's execution state.
 *
 * Contains everything `/orch-resume` needs to reconstruct
 * task progress without re-running discovery.
 */
export interface PersistedTaskRecord {
	/** Task identifier (e.g., "TO-014") */
	taskId: string;
	/** Lane number the task was assigned to (1-indexed) */
	laneNumber: number;
	/** TMUX session name used (e.g., "orch-lane-1") */
	sessionName: string;
	/** Current task status */
	status: LaneTaskStatus;
	/** Absolute path to the task's folder (contains PROMPT.md, STATUS.md) */
	taskFolder: string;
	/** Epoch ms when task started (null if never started) */
	startedAt: number | null;
	/** Epoch ms when task ended (null if still pending/running) */
	endedAt: number | null;
	/** Whether .DONE file was found for this task */
	doneFileFound: boolean;
	/** Human-readable exit reason (if completed/failed) */
	exitReason: string;
}

/**
 * Persisted record of a lane's configuration.
 *
 * Captures worktree/branch assignment so `/orch-resume` can
 * reconnect to existing worktrees without re-allocation.
 */
export interface PersistedLaneRecord {
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Lane identifier (e.g., "lane-1") */
	laneId: string;
	/** TMUX session name (e.g., "orch-lane-1") */
	tmuxSessionName: string;
	/** Absolute path to the lane's worktree directory */
	worktreePath: string;
	/** Git branch name checked out in the worktree */
	branch: string;
	/** Task IDs assigned to this lane in execution order */
	taskIds: string[];
}

/**
 * Persisted summary of a wave merge result.
 * Minimal subset of MergeWaveResult needed for resume decisions.
 */
export interface PersistedMergeResult {
	/** Wave index (0-based) */
	waveIndex: number;
	/** Merge status */
	status: "succeeded" | "failed" | "partial";
	/** Which lane failed (null if all succeeded) */
	failedLane: number | null;
	/** Failure reason (null if all succeeded) */
	failureReason: string | null;
}

/**
 * Persisted batch state written to `.pi/batch-state.json`.
 *
 * This is the serialization contract for batch state persistence.
 * It captures enough information for `/orch-resume` to reconstruct
 * the orchestrator state after a terminal disconnect.
 *
 * Design decisions:
 * - `schemaVersion` enables forward-compatible rejection of old formats
 * - Phase uses the same `OrchBatchPhase` literal union as runtime state
 * - Per-task records include folder paths and session names for resume
 * - Merge results are summarized (not full MergeWaveResult) for size
 * - `updatedAt` is monotonic (epoch ms) for staleness detection
 * - `lastError` captures most recent error without PII
 */
export interface PersistedBatchState {
	/** Schema version — must equal BATCH_STATE_SCHEMA_VERSION */
	schemaVersion: number;
	/** Current batch execution phase */
	phase: OrchBatchPhase;
	/** Unique batch identifier (timestamp format) */
	batchId: string;
	/** Branch that was active when /orch started — used as base for worktrees and merge target */
	baseBranch: string;
	/** Epoch ms when batch started */
	startedAt: number;
	/** Epoch ms when state was last written */
	updatedAt: number;
	/** Epoch ms when batch ended (null if still active) */
	endedAt: number | null;
	/** Current wave index (0-based, -1 if not started) */
	currentWaveIndex: number;
	/** Total number of waves in the plan */
	totalWaves: number;
	/** Wave plan: array of arrays of task IDs per wave */
	wavePlan: string[][];
	/** Per-lane configuration records */
	lanes: PersistedLaneRecord[];
	/** Per-task execution records (all tasks across all waves) */
	tasks: PersistedTaskRecord[];
	/** Merge results for completed waves */
	mergeResults: PersistedMergeResult[];
	/** Summary counters */
	totalTasks: number;
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	/** Task IDs blocked for future waves (from skip-dependents) */
	blockedTaskIds: string[];
	/** Most recent error (code + message, no PII) */
	lastError: { code: string; message: string } | null;
	/** Accumulated error messages */
	errors: string[];
}


// ── Resume (TS-009 Step 4) ───────────────────────────────────────────

/**
 * Error codes for /orch-resume command failures.
 *
 * - RESUME_NO_STATE: No batch-state.json found on disk
 * - RESUME_INVALID_STATE: State file exists but cannot be parsed/validated
 * - RESUME_SCHEMA_MISMATCH: State file has incompatible schema version
 * - RESUME_PHASE_NOT_RESUMABLE: Persisted phase does not allow resume
 * - RESUME_TMUX_UNAVAILABLE: TMUX is not available for session reconnection
 * - RESUME_EXECUTION_FAILED: Resume reconciliation succeeded but execution failed
 */
export type ResumeErrorCode =
	| "RESUME_NO_STATE"
	| "RESUME_INVALID_STATE"
	| "RESUME_SCHEMA_MISMATCH"
	| "RESUME_PHASE_NOT_RESUMABLE"
	| "RESUME_TMUX_UNAVAILABLE"
	| "RESUME_EXECUTION_FAILED";

/** Typed error class for resume failures with stable error codes. */
export class ResumeError extends Error {
	code: ResumeErrorCode;

	constructor(code: ResumeErrorCode, message: string) {
		super(message);
		this.name = "ResumeError";
		this.code = code;
	}
}

/**
 * Result of reconciling a single task's persisted state against live signals.
 *
 * Combines persisted status, tmux session liveness, and .DONE file presence
 * into a deterministic action for the resume engine.
 *
 * Reconciliation precedence (highest → lowest):
 * 1. .DONE file found → "mark-complete" (regardless of session state)
 * 2. Session alive + no .DONE → "reconnect" (task is still running)
 * 3. Persisted status is terminal (succeeded/failed/stalled/skipped) → "skip"
 * 4. Session dead + no .DONE + was running → "mark-failed"
 */
export interface ReconciledTaskState {
	/** Task identifier */
	taskId: string;
	/** Status from the persisted state file */
	persistedStatus: LaneTaskStatus;
	/** Reconciled live status after checking signals */
	liveStatus: LaneTaskStatus;
	/** Whether the TMUX session is alive right now */
	sessionAlive: boolean;
	/** Whether the .DONE file was found */
	doneFileFound: boolean;
	/** Whether the lane worktree still exists on disk */
	worktreeExists: boolean;
	/** Action the resume engine should take */
	action: "reconnect" | "mark-complete" | "mark-failed" | "re-execute" | "skip";
}

/**
 * Result of resume eligibility check.
 *
 * Determines whether a persisted batch state can be resumed based on its phase.
 */
export interface ResumeEligibility {
	/** Whether the batch can be resumed */
	eligible: boolean;
	/** Human-readable reason (for both eligible and ineligible) */
	reason: string;
	/** Persisted phase */
	phase: OrchBatchPhase;
	/** Batch ID */
	batchId: string;
}

/**
 * Resume point computed from reconciled task states.
 *
 * Tells the resume engine where to start in the wave plan.
 */
export interface ResumePoint {
	/** Wave index to resume from (0-based) */
	resumeWaveIndex: number;
	/** Task IDs confirmed completed (via .DONE or prior succeeded) */
	completedTaskIds: string[];
	/** Task IDs that still need execution */
	pendingTaskIds: string[];
	/** Task IDs confirmed failed (dead session, no .DONE) */
	failedTaskIds: string[];
	/** Task IDs with alive sessions that need reconnection */
	reconnectTaskIds: string[];
	/** Task IDs with dead sessions but existing worktrees that need re-execution */
	reExecuteTaskIds: string[];
}

// ── Abort (TS-009 Step 5) ────────────────────────────────────────────

/**
 * Abort mode: graceful (checkpoint + wait + force-kill) or hard (immediate kill).
 */
export type AbortMode = "graceful" | "hard";

/**
 * Error codes for abort operations.
 *
 * - ABORT_TMUX_LIST_FAILED: Could not list TMUX sessions
 * - ABORT_WRAPUP_WRITE_FAILED: Failed to write wrap-up signal file(s)
 * - ABORT_KILL_FAILED: Failed to kill one or more TMUX sessions
 * - ABORT_STATE_DELETE_FAILED: Failed to delete batch-state.json
 */
export type AbortErrorCode =
	| "ABORT_TMUX_LIST_FAILED"
	| "ABORT_WRAPUP_WRITE_FAILED"
	| "ABORT_KILL_FAILED"
	| "ABORT_STATE_DELETE_FAILED";

/**
 * Per-lane result from an abort operation.
 */
export interface AbortLaneResult {
	/** TMUX session name */
	sessionName: string;
	/** Lane ID (e.g., "lane-1") or "unknown" */
	laneId: string;
	/** Task ID if known */
	taskId: string | null;
	/** Task folder path in the worktree (for wrap-up file writing) */
	taskFolderInWorktree: string | null;
	/** Whether wrap-up files were written (graceful only) */
	wrapUpWritten: boolean;
	/** Wrap-up write error if any */
	wrapUpError: string | null;
	/** Whether the session was killed */
	sessionKilled: boolean;
	/** Whether the session exited gracefully (before force-kill) */
	exitedGracefully: boolean;
}

/**
 * Overall result from an abort operation.
 */
export interface AbortResult {
	/** Abort mode used */
	mode: AbortMode;
	/** Number of sessions found to abort */
	sessionsFound: number;
	/** Number of sessions actually killed (force-killed or graceful exit) */
	sessionsKilled: number;
	/** Number of sessions that exited gracefully (before timeout) */
	gracefulExits: number;
	/** Per-lane results */
	laneResults: AbortLaneResult[];
	/** Number of wrap-up write failures (graceful only) */
	wrapUpFailures: number;
	/** Whether batch state file was deleted */
	stateDeleted: boolean;
	/** Aggregated errors */
	errors: Array<{ code: AbortErrorCode; message: string }>;
	/** Duration of the abort operation in milliseconds */
	durationMs: number;
}

/**
 * Action step in an abort plan.
 */
export type AbortActionStep =
	| { type: "write-wrapup" }
	| { type: "poll-wait"; gracePeriodMs: number; pollIntervalMs: number }
	| { type: "kill-remaining" }
	| { type: "kill-all" };

/**
 * Target session with enrichment from persisted state.
 */
export interface AbortTargetSession {
	/** TMUX session name */
	sessionName: string;
	/** Lane ID from persisted state or "unknown" */
	laneId: string;
	/** Task ID from persisted state or null */
	taskId: string | null;
	/** Task folder path resolved in the worktree (for wrap-up files), or null */
	taskFolderInWorktree: string | null;
	/** Worktree path from persisted state or batch state */
	worktreePath: string | null;
}

// ── Size-to-Duration Mapping ─────────────────────────────────────────

/**
 * Default duration mapping (size → minutes).
 *
 * | Size | Weight | Duration |
 * |------|--------|----------|
 * | S    | 1      | 30 min   |
 * | M    | 2      | 60 min   |
 * | L    | 4      | 120 min  |
 */
export const SIZE_DURATION_MINUTES: Record<string, number> = {
	S: 30,
	M: 60,
	L: 120,
};
export const DURATION_BASE_MINUTES = 30;

/**
 * Get estimated duration in minutes for a task size.
 * Uses explicit mapping, falling back to weight × base.
 */
export function getTaskDurationMinutes(
	size: string,
	sizeWeights: Record<string, number>,
): number {
	if (SIZE_DURATION_MINUTES[size] !== undefined) {
		return SIZE_DURATION_MINUTES[size];
	}
	const weight = sizeWeights[size] || sizeWeights["M"] || 2;
	return weight * DURATION_BASE_MINUTES;
}


// ── Batch History ────────────────────────────────────────────────────

/** Token counts for a task, wave, or batch. */
export interface TokenCounts {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costUsd: number;
}

/** Per-task summary for history. */
export interface BatchTaskSummary {
	taskId: string;
	taskName: string;
	status: "succeeded" | "failed" | "skipped" | "blocked" | "stalled";
	wave: number;      // 1-based
	lane: number;      // 1-based
	durationMs: number;
	tokens: TokenCounts;
	exitReason: string | null;
}

/** Per-wave summary for history. */
export interface BatchWaveSummary {
	wave: number;      // 1-based
	tasks: string[];   // task IDs
	mergeStatus: "succeeded" | "failed" | "partial" | "skipped";
	durationMs: number;
	tokens: TokenCounts;
}

/** Complete batch history entry — written after Phase 3 cleanup. */
export interface BatchHistorySummary {
	batchId: string;
	status: "completed" | "partial" | "failed" | "aborted";
	startedAt: number;
	endedAt: number;
	durationMs: number;
	totalWaves: number;
	totalTasks: number;
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	tokens: TokenCounts;
	tasks: BatchTaskSummary[];
	waves: BatchWaveSummary[];
}

/** Max number of batch history entries to retain. */
export const BATCH_HISTORY_MAX_ENTRIES = 100;


// ── Workspace Mode Types ─────────────────────────────────────────────

/**
 * Workspace execution mode.
 *
 * Mode behavior contract:
 * - **"repo"** (default): No workspace config file present. The orchestrator
 *   treats `cwd` as both the workspace root and the single repo root.
 *   All existing monorepo behavior is preserved unchanged.
 * - **"workspace"**: A `.pi/taskplane-workspace.yaml` file is present and
 *   valid. The orchestrator runs from a non-git workspace root that
 *   coordinates multiple repos and a shared task root.
 *
 * Mode determination rules:
 * 1. No workspace config file → repo mode (non-fatal default, silent).
 * 2. Workspace config file present + invalid → fatal error with actionable
 *    `WorkspaceConfigError` (never silently falls back to repo mode).
 * 3. Workspace config file present + valid → workspace mode.
 */
export type WorkspaceMode = "repo" | "workspace";

/**
 * Configuration for a single repository within a workspace.
 *
 * Each repo is identified by a stable ID (e.g., "api", "frontend")
 * that is used for routing tasks to repos and for display purposes.
 */
export interface WorkspaceRepoConfig {
	/** Stable identifier for this repo (e.g., "api", "frontend") */
	id: string;
	/** Absolute filesystem path to the repo root (must be a git repo) */
	path: string;
	/** Optional default branch override (e.g., "develop", "main"). Falls back to repo HEAD. */
	defaultBranch?: string;
}

/**
 * Routing configuration for workspace mode.
 *
 * Controls where tasks are discovered and which repo receives
 * unqualified operations.
 */
export interface WorkspaceRoutingConfig {
	/**
	 * Absolute path to the shared tasks root directory.
	 * All task areas are resolved relative to this path.
	 * Must exist on disk.
	 */
	tasksRoot: string;
	/**
	 * Default repo ID for operations that don't specify a repo.
	 * Must reference a valid key in `WorkspaceConfig.repos`.
	 */
	defaultRepo: string;
}

/**
 * Top-level workspace configuration.
 *
 * Loaded from `.pi/taskplane-workspace.yaml` when present.
 * Immutable after initial validation — never mutated at runtime.
 */
export interface WorkspaceConfig {
	/** Active workspace mode */
	mode: WorkspaceMode;
	/** Map of repo ID → repo configuration. At least one repo required in workspace mode. */
	repos: Map<string, WorkspaceRepoConfig>;
	/** Routing configuration (tasks root, default repo) */
	routing: WorkspaceRoutingConfig;
	/** Absolute path to the workspace config file that was loaded */
	configPath: string;
}

/**
 * Canonical execution context for the orchestrator.
 *
 * This is the primary runtime context threaded through orchestrator
 * entry points. It replaces the previous pattern of passing raw `cwd`
 * as the sole repo root.
 *
 * In repo mode, `workspaceRoot` and `repoRoot` are the same directory.
 * In workspace mode, `workspaceRoot` is the non-git coordination root
 * and `repoRoot` is the default repo from the workspace config.
 *
 * Design rationale:
 * - Step 2 (wire orchestrator startup) will construct this from config
 *   loading results and thread it into `executeOrchBatch()` and friends.
 * - `repoRoot` is always a git repository, preserving the invariant
 *   that git operations (worktree, branch, merge) have a valid target.
 * - `workspaceConfig` is null in repo mode (no workspace file loaded).
 */
export interface ExecutionContext {
	/** Absolute path to the workspace root (cwd in repo mode, workspace dir in workspace mode) */
	workspaceRoot: string;
	/** Absolute path to the default/primary git repo root */
	repoRoot: string;
	/** Active workspace mode */
	mode: WorkspaceMode;
	/** Workspace configuration (null in repo mode) */
	workspaceConfig: WorkspaceConfig | null;
	/** Loaded task runner configuration */
	taskRunnerConfig: TaskRunnerConfig;
	/** Loaded orchestrator configuration */
	orchestratorConfig: OrchestratorConfig;
}


// ── Workspace Validation Error Types ─────────────────────────────────

/**
 * Error codes for workspace configuration validation failures.
 *
 * Each code maps to a deterministic validation rule from the workspace
 * config loading pipeline. Codes are stable and machine-branchable.
 *
 * - WORKSPACE_FILE_READ_ERROR: Config file exists but cannot be read (permissions, encoding)
 * - WORKSPACE_FILE_PARSE_ERROR: Config file contains invalid YAML
 * - WORKSPACE_MISSING_REPOS: No repos defined in workspace config (at least one required)
 * - WORKSPACE_REPO_PATH_MISSING: A repo entry has no `path` field
 * - WORKSPACE_REPO_PATH_NOT_FOUND: A repo's `path` does not exist on disk
 * - WORKSPACE_REPO_NOT_GIT: A repo's `path` exists but is not a git repository
 * - WORKSPACE_MISSING_TASKS_ROOT: `routing.tasks_root` is missing or empty
 * - WORKSPACE_TASKS_ROOT_NOT_FOUND: `routing.tasks_root` path does not exist on disk
 * - WORKSPACE_MISSING_DEFAULT_REPO: `routing.default_repo` is missing or empty
 * - WORKSPACE_DEFAULT_REPO_NOT_FOUND: `routing.default_repo` references a repo ID not in the repos map
 * - WORKSPACE_DUPLICATE_REPO_PATH: Two or more repos share the same filesystem path
 * - WORKSPACE_SCHEMA_INVALID: Config file has valid YAML but missing/invalid top-level structure
 */
export type WorkspaceConfigErrorCode =
	| "WORKSPACE_FILE_READ_ERROR"
	| "WORKSPACE_FILE_PARSE_ERROR"
	| "WORKSPACE_MISSING_REPOS"
	| "WORKSPACE_REPO_PATH_MISSING"
	| "WORKSPACE_REPO_PATH_NOT_FOUND"
	| "WORKSPACE_REPO_NOT_GIT"
	| "WORKSPACE_MISSING_TASKS_ROOT"
	| "WORKSPACE_TASKS_ROOT_NOT_FOUND"
	| "WORKSPACE_MISSING_DEFAULT_REPO"
	| "WORKSPACE_DEFAULT_REPO_NOT_FOUND"
	| "WORKSPACE_DUPLICATE_REPO_PATH"
	| "WORKSPACE_SCHEMA_INVALID";

/**
 * Typed error class for workspace configuration failures.
 *
 * Thrown during workspace config loading/validation when the config file
 * is present but invalid. Never thrown when no config file exists (that
 * case silently falls back to repo mode).
 *
 * Follows the established pattern of typed error classes in this module
 * (WorktreeError, ExecutionError, MergeError, StateFileError, ResumeError).
 */
export class WorkspaceConfigError extends Error {
	code: WorkspaceConfigErrorCode;
	/** Optional repo ID that triggered the error (for repo-specific validation failures) */
	repoId?: string;
	/** Optional filesystem path related to the error */
	relatedPath?: string;

	constructor(code: WorkspaceConfigErrorCode, message: string, repoId?: string, relatedPath?: string) {
		super(message);
		this.name = "WorkspaceConfigError";
		this.code = code;
		this.repoId = repoId;
		this.relatedPath = relatedPath;
	}
}


// ── Workspace Defaults ───────────────────────────────────────────────

/**
 * Canonical filename for workspace configuration.
 * Resolved relative to workspace root: `.pi/taskplane-workspace.yaml`
 */
export const WORKSPACE_CONFIG_FILENAME = "taskplane-workspace.yaml";

/**
 * Resolve the absolute path to the workspace config file.
 * @param workspaceRoot - Absolute path to the workspace root
 */
export function workspaceConfigPath(workspaceRoot: string): string {
	return join(workspaceRoot, ".pi", WORKSPACE_CONFIG_FILENAME);
}

/**
 * Create a default ExecutionContext for repo mode.
 *
 * Used when no workspace config file is present. The workspace root
 * and repo root are the same directory (cwd), preserving existing
 * monorepo behavior exactly.
 *
 * @param cwd - Current working directory (treated as both workspace and repo root)
 * @param taskRunnerConfig - Loaded task runner config (or defaults)
 * @param orchestratorConfig - Loaded orchestrator config (or defaults)
 */
export function createRepoModeContext(
	cwd: string,
	taskRunnerConfig: TaskRunnerConfig,
	orchestratorConfig: OrchestratorConfig,
): ExecutionContext {
	return {
		workspaceRoot: cwd,
		repoRoot: cwd,
		mode: "repo",
		workspaceConfig: null,
		taskRunnerConfig,
		orchestratorConfig,
	};
}

