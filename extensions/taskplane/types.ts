/**
 * All types, interfaces, error classes, constants, and defaults
 * @module orch/types
 */
import { join } from "path";
import type { ExitClassification, TaskExitDiagnostic } from "./diagnostics.js";

// ── Types ────────────────────────────────────────────────────────────

/** Configuration from .pi/task-orchestrator.yaml */
export interface OrchestratorConfig {
	orchestrator: {
		max_lanes: number;
		worktree_location: "sibling" | "subdirectory";
		worktree_prefix: string;
		batch_id_format: "timestamp" | "sequential";
		spawn_mode: "subprocess";
		sessionPrefix: string;
		/** Optional operator identifier. Auto-detected from OS username if empty. */
		operator_id: string;
		/** How completed batches are integrated. manual = user runs /orch-integrate. supervised = supervisor proposes plan, asks confirmation. auto = supervisor executes without asking. */
		integration: "manual" | "supervised" | "auto";
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
		/** Merge-agent thinking mode (empty = inherit session thinking) */
		thinking: string;
		verify: string[];
		order: "fewest-files-first" | "sequential";
		/** Merge agent timeout in minutes. Default: 10. Increase for large batches. */
		timeout_minutes: number;
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
	/** Verification baseline fingerprinting settings (TP-032). */
	verification: {
		enabled: boolean;
		mode: "strict" | "permissive";
		flaky_reruns: number;
	};
}

/** Stable segment identifier: `<taskId>::<repoId>` */
export type SegmentId = `${string}::${string}`;

/** How an intra-task segment edge was produced (for observability/debugging). */
export type SegmentEdgeProvenance = "explicit" | "inferred";

/** Repo-scoped edge parsed from optional `## Segment DAG` prompt metadata. */
export interface PromptSegmentDagEdge {
	fromRepoId: string;
	toRepoId: string;
}

/** Optional explicit segment metadata parsed from PROMPT.md. */
export interface PromptSegmentDagMetadata {
	/** Repo IDs participating in this task's segment graph, first-seen order. */
	repoIds: string[];
	/** Directed repo-level edges, sorted by `fromRepoId` then `toRepoId`. */
	edges: PromptSegmentDagEdge[];
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
	/** Optional explicit segment DAG metadata from `## Segment DAG`. */
	explicitSegmentDag?: PromptSegmentDagMetadata;
	/**
	 * Repo ID that owns task packet files (v4, TP-081).
	 * Populated by execution engine in workspace mode. Undefined in repo mode.
	 */
	packetRepoId?: string;
	/**
	 * Absolute path to task folder in the packet repo worktree (v4, TP-081).
	 * Populated by execution engine. Undefined if not yet resolved.
	 */
	packetTaskPath?: string;
	/**
	 * Segment IDs for this task (v4, TP-081).
	 * Populated from TaskSegmentPlan during execution.
	 */
	segmentIds?: string[];
	/**
	 * Currently active segment ID (v4, TP-081).
	 * Null when no segment is active.
	 */
	activeSegmentId?: string | null;
}

/** Build a stable segment ID from task + repo identity (`<taskId>::<repoId>`). */
export function buildSegmentId(taskId: string, repoId: string): SegmentId {
	return `${taskId}::${repoId}` as SegmentId;
}

/** One repo-scoped segment node for a task. */
export interface TaskSegmentNode {
	segmentId: SegmentId;
	taskId: string;
	repoId: string;
	/**
	 * Deterministic segment order within a task (0-indexed).
	 * Stable tie-break: repoId lexical order.
	 */
	order: number;
}

/** Directed edge between two segment nodes in the same task. */
export interface TaskSegmentEdge {
	fromSegmentId: SegmentId;
	toSegmentId: SegmentId;
	provenance: SegmentEdgeProvenance;
	/** Optional explanation of why this edge exists (debug/telemetry aid). */
	reason?: string;
}

/**
 * Deterministic segment plan for one task.
 *
 * Ordering contract:
 * - `segments`: sorted by `order`, then `repoId`
 * - `edges`: sorted by `fromSegmentId`, then `toSegmentId`
 */
export interface TaskSegmentPlan {
	taskId: string;
	segments: TaskSegmentNode[];
	edges: TaskSegmentEdge[];
	/**
	 * explicit-dag: parsed from prompt metadata
	 * inferred-sequential: deterministic fallback inference
	 * repo-singleton: repo mode fallback (`resolvedRepoId ?? "default"`)
	 */
	mode: "explicit-dag" | "inferred-sequential" | "repo-singleton";
}

/**
 * TaskId-keyed segment plans.
 * Iteration order must be deterministic: sort task IDs lexicographically.
 */
export type TaskSegmentPlanMap = Map<string, TaskSegmentPlan>;

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
	/** Repo ID this task targets (workspace mode only). Undefined in repo mode. */
	repoId?: string;
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
	/** Named testing/verification commands (e.g., { test: "node --test tests/*.test.ts" }). Used for baseline fingerprinting (TP-032). */
	testing_commands?: Record<string, string>;
	/**
	 * Model fallback behavior when a configured model becomes unavailable mid-batch.
	 * - `"inherit"` (default): Retry without explicit model (session model fallback).
	 * - `"fail"`: No model substitution — normal failure path.
	 * @since TP-055
	 */
	model_fallback?: "inherit" | "fail";
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
		sessionPrefix: "orch",
		operator_id: "",
		integration: "manual",
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
		thinking: "off",
		verify: [],
		order: "fewest-files-first",
		timeout_minutes: 90,
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
	verification: {
		enabled: false,
		mode: "permissive",
		flaky_reruns: 1,
	},
};

export const DEFAULT_TASK_RUNNER_CONFIG: TaskRunnerConfig = {
	task_areas: {},
	reference_docs: {},
	model_fallback: "inherit",
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
	/** Operator identifier (sanitized, e.g., "henrylach") */
	opId: string;
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
		| "TASK_REPO_UNKNOWN"
		| "TASK_ROUTING_STRICT"
		| "SEGMENT_DAG_INVALID"
		| "SEGMENT_REPO_UNKNOWN";
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
	"TASK_ROUTING_STRICT",
	"SEGMENT_DAG_INVALID",
	"SEGMENT_REPO_UNKNOWN",
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
	/** Optional task→segment planning map (TP-080, additive contract). */
	segmentPlans?: TaskSegmentPlanMap;
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
 * Contains everything Steps 2-3 need to run lane sessions,
 * monitor progress, and identify the lane. This is the contract
 * between Step 1 (allocation) and Step 2 (execution).
 */
export interface AllocatedLane {
	/** Lane number (1-indexed, deterministic, globally unique across repos) */
	laneNumber: number;
	/** Lane identifier for display and logging (e.g., "lane-1") */
	laneId: string;
	/** Lane session identifier (e.g., "orch-lane-1") — used by Step 2 */
	laneSessionId: string;
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
	/** Repo ID this lane targets (workspace mode only). Undefined in repo mode. */
	repoId?: string;
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
 * Embedded telemetry attached to a lane task outcome.
 *
 * Populated by Runtime V2 lane-runner at emission time so downstream
 * consumers (batch history, diagnostics) can read authoritative usage
 * without reconstructing task↔lane joins from snapshot keys.
 */
export interface LaneTaskOutcomeTelemetry {
	/** Total input tokens for this task outcome. */
	inputTokens: number;
	/** Total output tokens for this task outcome. */
	outputTokens: number;
	/** Total cache-read tokens for this task outcome. */
	cacheReadTokens: number;
	/** Total cache-write tokens for this task outcome. */
	cacheWriteTokens: number;
	/** Cumulative cost in USD for this task outcome. */
	costUsd: number;
	/** Number of tool calls made while producing this outcome. */
	toolCalls: number;
	/** End-to-end duration in milliseconds for this outcome. */
	durationMs: number;
}

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
	/** Segment identifier for segment-aware execution (null for whole-task units). */
	segmentId?: string | null;
	/** When execution started (epoch ms), null if never started (skipped) */
	startTime: number | null;
	/** When execution ended (epoch ms), null if still pending */
	endTime: number | null;
	/** Human-readable reason for the outcome */
	exitReason: string;
	/** Lane session name used for this task (e.g., "orch-lane-1") */
	sessionName: string;
	/** Whether .DONE file was found */
	doneFileFound: boolean;
	/**
	 * Lane number that produced this task outcome (1-indexed).
	 *
	 * Optional for backward compatibility with pre-TP-116 persisted state.
	 */
	laneNumber?: number;
	/**
	 * Embedded task-level telemetry (authoritative for Runtime V2).
	 *
	 * Optional for backward compatibility and non-agent outcomes
	 * (for example skipped tasks).
	 */
	telemetry?: LaneTaskOutcomeTelemetry;
	/**
	 * Number of commits preserved as partial progress for a failed task.
	 * 0 when no partial progress was saved (succeeded tasks, no commits, etc.).
	 * Optional for backward compatibility — defaults to 0 when absent.
	 */
	partialProgressCommits?: number;
	/**
	 * Saved branch name holding partial progress for a failed task.
	 * Undefined when no partial progress was saved.
	 * Optional for backward compatibility.
	 */
	partialProgressBranch?: string;
	/**
	 * Structured exit diagnostic for this task (v3, TP-030).
	 *
	 * Canonical structured exit data — preferred over the legacy `exitReason`
	 * string when present. Produced by `classifyExit()` after session ends,
	 * then enriched with progress/context metadata.
	 *
	 * Optional: absent for tasks that haven't exited yet, and for
	 * backward compatibility with pre-v3 code paths.
	 * Consumers should check `exitDiagnostic` first, falling back to
	 * `exitReason` for display.
	 */
	exitDiagnostic?: TaskExitDiagnostic;
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
 * Grace period (ms) after a lane session exits before declaring failure.
 * Allows time for .DONE file to be flushed to disk on slow filesystems.
 */
export const DONE_GRACE_MS = 5_000;

/**
 * Polling interval (ms) for checking session liveness and .DONE file.
 */
export const EXECUTION_POLL_INTERVAL_MS = 2_000;

/**
 * Maximum retries for legacy lane-session spawn failures.
 * Only transient failures (session name collision) are retried.
 */
export const SESSION_SPAWN_RETRY_MAX = 2;

// ── Execution Error Types ────────────────────────────────────────────

/**
 * Error codes for lane execution failures.
 *
 * - EXEC_SPAWN_FAILED: Lane session could not be created after retries
 * - EXEC_TASK_FAILED: task completed without .DONE (non-zero exit)
 * - EXEC_TASK_STALLED: STATUS.md unchanged for stall_timeout (handled by Step 3)
 * - EXEC_TASK_STAGE_FAILED: git add failed for task files
 * - EXEC_TASK_COMMIT_FAILED: git commit failed for staged task files
 * - EXEC_TMUX_NOT_AVAILABLE: Legacy `tmux` binary not found (compat path)
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
 * - Lane-session liveness
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
	/** Whether the lane session is alive */
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
	/** Lane session name (e.g., "orch-lane-1") */
	sessionName: string;
	/** Whether the lane session is alive right now */
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
 *   executeLane() polls session liveness and will see the killed session
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
	/**
	 * Structured allocation error when lane provisioning failed.
	 * Null when allocation succeeded or wave failed for other reasons.
	 * Used by Tier 0 to detect stale worktree failures and retry.
	 * @since TP-039
	 */
	allocationError?: {
		code: AllocationErrorCode;
		message: string;
		details?: string;
	} | null;
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
export type OrchBatchPhase = "idle" | "launching" | "planning" | "executing" | "merging" | "paused" | "stopped" | "completed" | "failed";

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
	/** Orchestrator-managed branch name (e.g., 'orch/henry-20260318T140000'). Empty = legacy mode (merge into baseBranch directly). */
	orchBranch: string;
	/** Workspace execution mode (v2). Defaults to "repo" for backward compatibility. */
	mode: WorkspaceMode;
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
	/**
	 * v3 resilience state carried forward across resume cycles.
	 * Populated from persisted state on resume; defaults used for new batches.
	 */
	resilience?: ResilienceState;
	/**
	 * v3 diagnostics state carried forward across resume cycles.
	 * Populated from persisted state on resume; defaults used for new batches.
	 */
	diagnostics?: BatchDiagnostics;
	/**
	 * v4 segment records carried forward across resume cycles (TP-081).
	 * Populated from persisted state on resume; empty for new batches
	 * and repo-mode batches.
	 */
	segments?: PersistedSegmentRecord[];
	/**
	 * Unknown top-level fields from loaded persisted state.
	 * Carried forward so they survive serialization roundtrips.
	 */
	_extraFields?: Record<string, unknown>;
}

/**
 * Session registry entry for /orch-sessions command.
 */
export interface OrchestratorSessionEntry {
	/** Lane session name (e.g., "orch-lane-1") */
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
		orchBranch: "",
		mode: "repo",
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

/**
 * Orchestrator-side verification baseline comparison result for a single lane.
 * Populated when verification baseline fingerprinting is enabled (testing.commands configured).
 */
export interface VerificationBaselineResult {
	/** Whether baseline comparison was performed */
	performed: boolean;
	/** Number of new failures (not in baseline) */
	newFailureCount: number;
	/** Number of pre-existing failures (also in baseline) */
	preExistingCount: number;
	/** Number of failures that disappeared (fixed by the merge) */
	fixedCount: number;
	/** Classification: "pass" (no new failures), "verification_new_failure", "flaky_suspected" */
	classification: "pass" | "verification_new_failure" | "flaky_suspected";
	/** Human-readable summary of new failures (truncated) */
	newFailureSummary: string;
	/** Whether a flaky re-run was performed */
	flakyRerunPerformed: boolean;
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
	/** Repo ID this lane targeted (workspace mode only). Undefined in repo mode. */
	repoId?: string;
	/**
	 * Orchestrator-side verification baseline result (TP-032).
	 * Populated when baseline fingerprinting is enabled and a successful merge occurred.
	 * Undefined when fingerprinting is not enabled or merge failed before verification.
	 */
	verificationBaseline?: VerificationBaselineResult;
}

/** Overall wave merge outcome. */
export interface MergeWaveResult {
	waveIndex: number;
	status: "succeeded" | "failed" | "partial";
	laneResults: MergeLaneResult[];
	failedLane: number | null;
	failureReason: string | null;
	totalDurationMs: number;
	/** Per-repo merge outcomes (populated in workspace mode; empty in repo mode). */
	repoResults?: RepoMergeOutcome[];
	/**
	 * TP-033: True when a verification rollback failed and safe-stop was triggered.
	 * Engine MUST force `paused` phase regardless of `on_merge_failure` config,
	 * and preserve all merge worktrees/branches for manual recovery.
	 */
	rollbackFailed?: boolean;
	/**
	 * TP-033: Transaction records for each lane merge attempt in this wave.
	 * Populated when transactional envelope is active.
	 */
	transactionRecords?: TransactionRecord[];
	/**
	 * TP-033 R004-2: Errors encountered while persisting transaction records.
	 * When non-empty, recovery commands in transaction records may reference
	 * files that don't exist on disk. Operator should check `.pi/verification/`
	 * manually.
	 */
	persistenceErrors?: string[];
}

/** Per-repo merge outcome within a wave merge. */
export interface RepoMergeOutcome {
	/** Repo ID (undefined in repo mode default group). */
	repoId: string | undefined;
	/** Merge status for this repo. */
	status: "succeeded" | "failed" | "partial";
	/** Lane results belonging to this repo. */
	laneResults: MergeLaneResult[];
	/** Failed lane number within this repo (null if all succeeded). */
	failedLane: number | null;
	/** Failure reason within this repo (null if all succeeded). */
	failureReason: string | null;
}

// ── Merge Transaction Types (TP-033) ─────────────────────────────────

/**
 * Status of a transactional merge attempt for a single lane.
 *
 * - `committed`: Merge succeeded, verification passed, refs advanced.
 * - `rolled_back`: Verification failed, merge commit rolled back to baseHEAD.
 * - `rollback_failed`: Rollback attempted but failed — safe-stop triggered.
 * - `merge_failed`: Merge itself failed (conflict, crash, etc.) before verification.
 *
 * @since TP-033
 */
export type TransactionStatus = "committed" | "rolled_back" | "rollback_failed" | "merge_failed";

/**
 * Transactional record for a single lane merge attempt.
 *
 * Persisted as JSON at:
 * `.pi/verification/{opId}/txn-b{batchId}-repo-{repoId}-wave-{n}-lane-{k}.json`
 *
 * Captures the complete ref state before and after merge, rollback outcome,
 * and recovery commands for safe-stop scenarios.
 *
 * @since TP-033
 */
export interface TransactionRecord {
	/** Operator ID for this batch run */
	opId: string;
	/** Batch identifier */
	batchId: string;
	/** Wave index (0-based) */
	waveIndex: number;
	/** Lane number within the wave */
	laneNumber: number;
	/** Repo ID (undefined/null in repo mode, string in workspace mode) */
	repoId: string | null;
	/** HEAD of temp branch before this lane's merge commit (rollback target) */
	baseHEAD: string;
	/** HEAD of the lane's source branch (commit being merged in) */
	laneHEAD: string;
	/** HEAD of temp branch after merge commit (null if merge failed before commit) */
	mergedHEAD: string | null;
	/** Transaction outcome */
	status: TransactionStatus;
	/** Whether a rollback was attempted */
	rollbackAttempted: boolean;
	/** Rollback outcome detail (null if rollback not attempted) */
	rollbackResult: string | null;
	/** Recovery commands emitted on rollback failure (empty array otherwise) */
	recoveryCommands: string[];
	/** ISO timestamp when transaction started */
	startedAt: string;
	/** ISO timestamp when transaction completed */
	completedAt: string;
}

// ── Merge Error Types ────────────────────────────────────────────────

/**
 * Error codes for merge operations.
 *
 * - MERGE_SPAWN_FAILED: Could not create merge-agent session
 * - MERGE_TIMEOUT: Merge agent did not produce result within timeout
 * - MERGE_SESSION_DIED: Merge-agent session exited without writing result
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
/** Default merge agent timeout. Use config.merge.timeout_minutes to override. */
export const MERGE_TIMEOUT_MS = 90 * 60 * 1000;

/**
 * Polling interval for merge result file (ms).
 * Merge agents are fast; poll aggressively.
 */
export const MERGE_POLL_INTERVAL_MS = 2_000;

/**
 * Grace period after a merge-agent session exits before declaring failure (ms).
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
 * Maximum retries for merge-agent session spawn.
 */
export const MERGE_SPAWN_RETRY_MAX = 2;

/**
 * Maximum retries for merge agent timeout (TP-038).
 *
 * When a merge agent times out, the orchestrator retries with 2× the
 * previous timeout. This allows recovery from transient slowness without
 * operator intervention.
 *
 * Retry 0: original timeout (e.g., 10 min)
 * Retry 1: 2× original (e.g., 20 min)
 * Retry 2: 4× original (e.g., 40 min)
 */
export const MERGE_TIMEOUT_MAX_RETRIES = 2;

// ── Merge Health Monitoring Constants (TP-056) ───────────────────────

/**
 * Polling interval for merge health monitor (ms).
 * Independent of the merge result poll — runs on its own cadence.
 * @since TP-056
 */
export const MERGE_HEALTH_POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Threshold (ms) after which a merge session with no new output
 * is classified as "possibly stalled" and a warning event is emitted.
 * @since TP-056
 */
export const MERGE_HEALTH_WARNING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Threshold (ms) after which a merge session with no new output
 * is classified as "stuck" and a stuck event is emitted.
 * @since TP-056
 */
export const MERGE_HEALTH_STUCK_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Number of lines to capture from recent merge output snapshots
 * for activity detection via snapshot comparison.
 * @since TP-056
 */
export const MERGE_HEALTH_CAPTURE_LINES = 10;

// ── Persistent Reviewer Constants (TP-057) ───────────────────────────

/**
 * Polling interval (ms) for the `wait_for_review` tool to check for signal files.
 * Reviews take minutes; 3s latency is invisible to the user.
 * @since TP-057
 */
export const REVIEWER_POLL_INTERVAL_MS = 3_000;

/**
 * Maximum time (ms) for the `wait_for_review` tool to wait for a review signal.
 * 30 minutes — generous for long-running code reviews.
 * @since TP-057
 */
export const REVIEWER_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Grace period (ms) after writing shutdown signal before killing the reviewer session.
 * Allows the reviewer to exit cleanly after receiving the shutdown signal.
 * @since TP-057
 */
export const REVIEWER_SHUTDOWN_GRACE_MS = 10_000;

/**
 * Signal file prefix for review requests. Full name: `.review-signal-{NNN}`
 * @since TP-057
 */
export const REVIEWER_SIGNAL_PREFIX = ".review-signal-";

/**
 * Shutdown signal filename written to .reviews/ when the task is complete.
 * @since TP-057
 */
export const REVIEWER_SHUTDOWN_SIGNAL = ".review-shutdown";

// ── Merge Health Event Types (TP-056) ────────────────────────────────

/**
 * Health classification for a merge session.
 *
 * - `healthy`:  Session alive, output changing
 * - `warning`:  Session alive, no new output for MERGE_HEALTH_WARNING_THRESHOLD_MS
 * - `dead`:     Session gone, no result file
 * - `stuck`:    Session alive, no new output for MERGE_HEALTH_STUCK_THRESHOLD_MS
 *
 * @since TP-056
 */
export type MergeHealthStatus = "healthy" | "warning" | "dead" | "stuck";

/**
 * Engine event types for merge health monitoring.
 *
 * These extend the EngineEventType union and are emitted to the
 * unified events.jsonl for supervisor consumption.
 *
 * @since TP-056
 */
export type MergeHealthEventType =
	| "merge_health_warning"
	| "merge_health_dead"
	| "merge_health_stuck";

/**
 * Snapshot of a merge session's pane output at a point in time.
 * Used for activity detection by comparing successive snapshots.
 *
 * @since TP-056
 */
export interface MergeSessionSnapshot {
	/** Captured pane content (last N lines) */
	content: string;
	/** Epoch ms when the snapshot was taken */
	capturedAt: number;
}

/**
 * Per-session health tracking state.
 *
 * @since TP-056
 */
export interface MergeSessionHealthState {
	/** Merge session name */
	sessionName: string;
	/** Lane number this session belongs to */
	laneNumber: number;
	/** Last captured pane snapshot */
	lastSnapshot: MergeSessionSnapshot | null;
	/** Epoch ms when the last output change was detected */
	lastActivityAt: number;
	/** Current health classification */
	status: MergeHealthStatus;
	/** Whether a warning event has been emitted (prevent duplicates) */
	warningEmitted: boolean;
	/** Whether a stuck event has been emitted (prevent duplicates) */
	stuckEmitted: boolean;
	/** Whether a dead event has been emitted (prevent duplicates) */
	deadEmitted: boolean;
}


// ── Merge Retry Policy Matrix (TP-033 Step 2) ───────────────────────

/**
 * Merge-related failure classifications for the retry policy matrix.
 *
 * These are the merge-phase failure classes from the resilience roadmap §4c.
 * Task-execution classes (api_error, context_overflow, etc.) are out of scope
 * for TP-033 and handled separately in Phase 1/3.
 *
 * @since TP-033
 */
export type MergeFailureClassification =
	| "verification_new_failure"
	| "merge_conflict_unresolved"
	| "cleanup_post_merge_failed"
	| "git_worktree_dirty"
	| "git_lock_file";

/**
 * Retry policy for a single merge failure classification.
 *
 * Defines whether a failure class is retriable, the maximum retry attempts,
 * cooldown between retries (in milliseconds), and what happens on exhaustion.
 *
 * @since TP-033
 */
export interface MergeRetryPolicy {
	/** Whether this failure class can be retried automatically */
	retriable: boolean;
	/** Maximum number of retry attempts (0 for non-retriable) */
	maxAttempts: number;
	/** Cooldown delay between retries in milliseconds (0 for immediate) */
	cooldownMs: number;
	/** Action when retries are exhausted or class is non-retriable */
	exhaustionAction: "pause" | "pause_wave_gate" | "pause_escalation";
}

/**
 * Centralized retry policy matrix for merge-related failure classes.
 *
 * This is the **single source of truth** for retry behavior. Both engine.ts
 * and resume.ts consume this table through `computeMergeRetryDecision()` to
 * guarantee parity.
 *
 * Values from resilience roadmap §4c:
 *
 * | Classification              | Retry? | Max | Cooldown | Exhaustion          |
 * |-----------------------------|--------|-----|----------|---------------------|
 * | verification_new_failure    | ✅     | 1   | 0ms      | pause + diagnostic  |
 * | merge_conflict_unresolved   | ❌     | 0   | —        | pause + escalation  |
 * | cleanup_post_merge_failed   | ✅     | 1   | 2000ms   | pause (wave gate)   |
 * | git_worktree_dirty          | ✅     | 1   | 2000ms   | pause               |
 * | git_lock_file               | ✅     | 2   | 3000ms   | pause               |
 *
 * @since TP-033
 */
export const MERGE_RETRY_POLICY_MATRIX: Readonly<Record<MergeFailureClassification, MergeRetryPolicy>> = {
	verification_new_failure: {
		retriable: true,
		maxAttempts: 1,
		cooldownMs: 0,
		exhaustionAction: "pause",
	},
	merge_conflict_unresolved: {
		retriable: false,
		maxAttempts: 0,
		cooldownMs: 0,
		exhaustionAction: "pause_escalation",
	},
	cleanup_post_merge_failed: {
		retriable: true,
		maxAttempts: 1,
		cooldownMs: 2_000,
		exhaustionAction: "pause_wave_gate",
	},
	git_worktree_dirty: {
		retriable: true,
		maxAttempts: 1,
		cooldownMs: 2_000,
		exhaustionAction: "pause",
	},
	git_lock_file: {
		retriable: true,
		maxAttempts: 2,
		cooldownMs: 3_000,
		exhaustionAction: "pause",
	},
};

/**
 * All merge failure classifications as a readonly array, for iteration/validation.
 * @since TP-033
 */
export const MERGE_FAILURE_CLASSIFICATIONS: readonly MergeFailureClassification[] = [
	"verification_new_failure",
	"merge_conflict_unresolved",
	"cleanup_post_merge_failed",
	"git_worktree_dirty",
	"git_lock_file",
] as const;


// ── Tier 0 Watchdog Recovery Types (TP-039) ──────────────────────────

/**
 * Tier 0 recovery pattern identifiers.
 *
 * Each pattern corresponds to a failure class that the engine can
 * handle automatically without supervisor intervention.
 *
 * @since TP-039
 */
export type Tier0RecoveryPattern =
	| "worker_crash"
	| "stale_worktree"
	| "cleanup_gate"
	| "model_fallback";

/**
 * Exit classifications that are eligible for automatic Tier 0 retry.
 *
 * These are transient failures where re-running the task has a reasonable
 * chance of success. Classifications NOT in this set (e.g., user_killed,
 * stall_timeout, context_overflow) indicate persistent problems that
 * won't be fixed by retrying.
 *
 * @since TP-039
 */
export const TIER0_RETRYABLE_CLASSIFICATIONS: ReadonlySet<string> = new Set([
	"api_error",
	"model_access_error",
	"process_crash",
	"session_vanished",
]);

/**
 * Retry budget for Tier 0 recovery patterns.
 *
 * Defines max retries, cooldown between attempts, and backoff
 * multiplier for each pattern. Values from spec §5.3.
 *
 * @since TP-039
 */
export interface Tier0RetryBudget {
	/** Maximum number of retry attempts */
	maxRetries: number;
	/** Cooldown delay between retries in milliseconds */
	cooldownMs: number;
	/** Multiplier applied to cooldown on each subsequent retry */
	backoffMultiplier: number;
}

/**
 * Centralized retry budgets for Tier 0 recovery patterns.
 *
 * These are the defaults from spec §5.3. They are NOT configurable
 * via user config in Tier 0 — the supervisor (Tier 1) can override
 * them in future iterations.
 *
 * @since TP-039
 */
export const TIER0_RETRY_BUDGETS: Readonly<Record<Tier0RecoveryPattern, Tier0RetryBudget>> = {
	worker_crash: {
		maxRetries: 1,
		cooldownMs: 5_000,
		backoffMultiplier: 1.0,
	},
	stale_worktree: {
		maxRetries: 1,
		cooldownMs: 2_000,
		backoffMultiplier: 1.0,
	},
	cleanup_gate: {
		maxRetries: 1,
		cooldownMs: 2_000,
		backoffMultiplier: 1.0,
	},
	model_fallback: {
		maxRetries: 1,
		cooldownMs: 3_000,
		backoffMultiplier: 1.0,
	},
};

/**
 * All Tier 0 escalation-eligible pattern identifiers.
 *
 * Extends `Tier0RecoveryPattern` with `merge_timeout` so that
 * `EscalationContext` can describe escalations from every exhaustion
 * path, including the merge retry loop (which uses its own retry
 * matrix but still triggers Tier 0 escalation on exhaustion).
 *
 * @since TP-039
 */
export type Tier0EscalationPattern = Tier0RecoveryPattern | "merge_timeout";
// Note: model_fallback is already included via Tier0RecoveryPattern

/**
 * Context payload emitted when Tier 0 retries are exhausted and the
 * engine must escalate to the supervisor (future TP-041).
 *
 * This is the structured data that a Tier 1 supervisor agent uses to
 * decide what to do next.  In Tier 0, escalation simply falls through
 * to the existing pause behaviour.
 *
 * @since TP-039
 */
export interface EscalationContext {
	/** Which recovery pattern was attempted */
	pattern: Tier0EscalationPattern;
	/** Number of retry attempts that were made (1-based) */
	attempts: number;
	/** Maximum attempts that were allowed */
	maxAttempts: number;
	/** Human-readable last error / failure reason */
	lastError: string;
	/** Task IDs affected by this failure */
	affectedTasks: string[];
	/** Suggested remediation for an operator or supervisor */
	suggestion: string;
}

/**
 * Scope key prefix for Tier 0 (non-merge) retry counters.
 *
 * Format: `t0:{pattern}:{taskId}:w{waveIndex}`
 * This namespace prevents collisions with merge retry scope keys
 * (which use `{taskId}:w{waveIndex}:l{laneNumber}`).
 *
 * @since TP-039
 */
export function tier0ScopeKey(pattern: Tier0RecoveryPattern, taskId: string, waveIndex: number): string {
	return `t0:${pattern}:${taskId}:w${waveIndex}`;
}

/**
 * Wave-level scope key for Tier 0 patterns that operate at wave granularity
 * (stale_worktree, cleanup_gate).
 *
 * Format: `t0:{pattern}:w{waveIndex}`
 *
 * @since TP-039
 */
export function tier0WaveScopeKey(pattern: Tier0RecoveryPattern, waveIndex: number): string {
	return `t0:${pattern}:w${waveIndex}`;
}

// ── Engine Event Types (TP-040) ──────────────────────────────────────

/**
 * Engine lifecycle event types emitted during batch execution.
 *
 * These events are the primary coordination mechanism between the
 * non-blocking engine and external consumers (supervisor agent,
 * dashboard, command handlers).
 *
 * Event semantics (from spec §7.3):
 * - `wave_start`      — Wave execution begins
 * - `task_complete`    — Task .DONE detected (succeeded)
 * - `task_failed`      — Task failed or stalled
 * - `merge_start`      — Wave merge begins
 * - `merge_success`    — Merge and verification pass
 * - `merge_failed`     — Merge or verification fails
 * - `batch_complete`   — All waves done (terminal)
 * - `batch_paused`     — Batch paused (failure or manual)
 *
 * Tier 0 recovery events (`tier0_recovery_attempt`, `tier0_recovery_success`,
 * `tier0_recovery_exhausted`, `tier0_escalation`) continue to use the
 * existing `Tier0EventType` from persistence.ts and share the same JSONL
 * file. Engine events extend the same stream with lifecycle context.
 *
 * @since TP-040
 */
export type EngineEventType =
	| "wave_start"
	| "task_complete"
	| "task_failed"
	| "merge_start"
	| "merge_success"
	| "merge_failed"
	| "merge_health_warning"
	| "merge_health_dead"
	| "merge_health_stuck"
	| "batch_complete"
	| "batch_paused";

/**
 * Structured engine event written to `.pi/supervisor/events.jsonl`.
 *
 * Shares the same JSONL file as Tier 0 events, with a consistent
 * base payload (`timestamp`, `batchId`, `waveIndex`) for uniform
 * consumption by the supervisor agent.
 *
 * Design: follows reviewer suggestion (R001) to use a shared base
 * payload and extend the existing event-writing infrastructure rather
 * than introducing a parallel writer.
 *
 * @since TP-040
 */
export interface EngineEvent {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Engine event type */
	type: EngineEventType;
	/** Batch identifier */
	batchId: string;
	/** Wave index (0-based, -1 if not wave-scoped) */
	waveIndex: number;
	/** Current batch phase at event emission time */
	phase: OrchBatchPhase;

	// ── Event-specific fields (all optional) ─────────────────────

	/** Task IDs in the wave (for wave_start) */
	taskIds?: string[];
	/** Number of lanes used (for wave_start, merge_start) */
	laneCount?: number;
	/** Task ID (for task_complete, task_failed) */
	taskId?: string;
	/** Task execution duration in milliseconds (for task_complete, task_failed) */
	durationMs?: number;
	/** Task outcome summary (for task_complete) */
	outcome?: string;
	/** Failure reason (for task_failed, merge_failed, batch_paused) */
	reason?: string;
	/** Whether partial progress was preserved (for task_failed) */
	partialProgress?: boolean;
	/** Lane number (for merge_failed) */
	laneNumber?: number;
	/** Merge error details (for merge_failed) */
	error?: string;
	/** Number of merge test verifications (for merge_success) */
	testCount?: number;
	/** Wave count for total waves (for merge_success) */
	totalWaves?: number;

	// ── Batch summary fields (for batch_complete, batch_paused) ──

	/** Total succeeded tasks (for batch_complete) */
	succeededTasks?: number;
	/** Total failed tasks (for batch_complete, batch_paused) */
	failedTasks?: number;
	/** Total skipped tasks (for batch_complete) */
	skippedTasks?: number;
	/** Total blocked tasks (for batch_complete) */
	blockedTasks?: number;
	/** Batch duration in milliseconds (for batch_complete) */
	batchDurationMs?: number;

	// ── Merge health monitoring fields (TP-056) ──────────────────

	/** Merge session name (for merge_health_* events) */
	sessionName?: string;
	/** Merge health status classification (for merge_health_* events) */
	healthStatus?: MergeHealthStatus;
	/** Minutes since last activity (for merge_health_warning, merge_health_stuck) */
	stalledMinutes?: number;
}

/**
 * Callback type for engine event consumers.
 *
 * The command handler (extension.ts) subscribes to this to receive
 * real-time engine state transitions. In the non-blocking architecture
 * (Step 2), this is the primary way the caller observes engine progress
 * instead of awaiting the return value.
 *
 * The callback is invoked synchronously in the engine's event loop.
 * Consumers MUST NOT perform blocking I/O in the callback.
 *
 * @since TP-040
 */
export type EngineEventCallback = (event: EngineEvent) => void;


// ── Supervisor Alert Types (TP-076) ──────────────────────────────────

/**
 * Alert category for supervisor notifications.
 *
 * Matches the alert categories in the autonomous supervisor spec:
 * - `task-failure`:   A task failed after deterministic recovery was exhausted
 * - `merge-failure`:  Wave merge failed and batch paused
 * - `batch-complete`: Batch finished (all waves done)
 * - `agent-message`:  Runtime mailbox reply/escalation from a running agent
 *
 * Note: `stall` detection is deferred to a future phase (requires
 * last-activity tracking not yet built).
 *
 * @since TP-076
 */
export type SupervisorAlertCategory = "task-failure" | "merge-failure" | "batch-complete" | "agent-message";

/**
 * Structured context payload for supervisor alerts.
 *
 * All fields are IPC-serializable (no functions, no circular refs, no Maps/Sets).
 * Each alert category populates the relevant subset of optional fields.
 *
 * @since TP-076
 */
export interface SupervisorSegmentFrontierSnapshot {
	/** Parent task identifier */
	taskId: string;
	/** Total number of ordered segments for the task */
	totalSegments: number;
	/** Number of segments that reached a terminal status */
	terminalSegments: number;
	/** Active (or most recently active) segment ID */
	activeSegmentId: string | null;
	/** Segment-level execution snapshot in deterministic order */
	segments: Array<{
		segmentId: string;
		repoId: string;
		status: PersistedSegmentStatus;
		dependsOnSegmentIds: string[];
	}>;
}

export interface SupervisorAlertContext {
	/** Task ID (for task-failure alerts) */
	taskId?: string;
	/** Segment ID (for segment-aware task-failure alerts) */
	segmentId?: string;
	/** Repo ID associated with the failure (task segment or merge target) */
	repoId?: string;
	/** Lane ID, e.g., "lane-1" (for task-failure alerts) */
	laneId?: string;
	/** Lane number (for task-failure and merge-failure alerts) */
	laneNumber?: number;
	/** Wave index, 0-based (for merge-failure and batch-complete alerts) */
	waveIndex?: number;
	/** Exit reason string (for task-failure alerts) */
	exitReason?: string;
	/** Segment frontier snapshot for task-failure diagnosis */
	segmentFrontier?: SupervisorSegmentFrontierSnapshot;
	/** Agent ID (for agent-message alerts) */
	agentId?: string;
	/** Mailbox message ID (for agent-message alerts) */
	messageId?: string;
	/** Whether partial progress was preserved (for task-failure alerts) */
	partialProgress?: boolean;
	/** Batch progress summary */
	batchProgress?: {
		succeededTasks: number;
		failedTasks: number;
		skippedTasks: number;
		blockedTasks: number;
		totalTasks: number;
		currentWave: number;
		totalWaves: number;
	};
	/** Merge failure reason (for merge-failure alerts) */
	mergeError?: string;
	/** Batch duration in milliseconds (for batch-complete alerts) */
	batchDurationMs?: number;
}

/**
 * Structured supervisor alert message.
 *
 * Emitted by the engine (child process) via IPC when the supervisor
 * needs to be notified of an event requiring attention or acknowledgement.
 *
 * Design:
 * - All fields are plain JSON-serializable values (IPC-safe).
 * - `category` determines the alert type and which `context` fields are populated.
 * - `summary` is a pre-formatted, human-readable string suitable for direct
 *   display to the supervisor LLM as a conversation message.
 * - `context` provides structured data for programmatic consumption.
 *
 * @since TP-076
 */
export interface SupervisorAlert {
	/** Alert category — determines handling behavior */
	category: SupervisorAlertCategory;
	/** Human-readable summary suitable for display as a chat message */
	summary: string;
	/** Structured context data (all fields IPC-serializable) */
	context: SupervisorAlertContext;
}

/**
 * Callback type for supervisor alert emission.
 *
 * The engine (child process) calls this when it needs to alert the
 * supervisor about a significant event. The main thread handler
 * converts the alert into a `sendUserMessage` call to wake the
 * supervisor LLM.
 *
 * @since TP-076
 */
export type SupervisorAlertCallback = (alert: SupervisorAlert) => void;

/**
 * Build a batch progress snapshot from runtime state.
 *
 * Pure function — extracts the current progress counters from
 * OrchBatchRuntimeState into the IPC-serializable format used
 * by SupervisorAlertContext.batchProgress.
 *
 * @since TP-076
 */
export function buildBatchProgressSnapshot(
	batchState: OrchBatchRuntimeState,
): NonNullable<SupervisorAlertContext["batchProgress"]> {
	return {
		succeededTasks: batchState.succeededTasks,
		failedTasks: batchState.failedTasks,
		skippedTasks: batchState.skippedTasks,
		blockedTasks: batchState.blockedTasks,
		totalTasks: batchState.totalTasks,
		currentWave: batchState.currentWaveIndex + 1, // 1-based for display
		totalWaves: batchState.totalWaves,
	};
}

function repoIdFromSegmentId(segmentId: string): string {
	const idx = segmentId.indexOf("::");
	if (idx <= 0 || idx >= segmentId.length - 2) return "unknown";
	return segmentId.slice(idx + 2);
}

/**
 * Build a task-level segment frontier snapshot for supervisor failure alerts.
 *
 * Returns `undefined` when the task has no segment metadata.
 */
export function buildSupervisorSegmentFrontierSnapshot(
	taskId: string,
	segmentIds: string[] | undefined,
	activeSegmentId: string | null | undefined,
	persistedSegments: PersistedSegmentRecord[] | undefined,
	preferredSegmentId?: string | null,
): SupervisorSegmentFrontierSnapshot | undefined {
	const orderedSegmentIds = Array.isArray(segmentIds)
		? segmentIds.filter((segmentId): segmentId is string => typeof segmentId === "string" && segmentId.trim().length > 0)
		: [];
	if (orderedSegmentIds.length === 0) return undefined;

	const bySegmentId = new Map<string, PersistedSegmentRecord>();
	for (const segment of persistedSegments ?? []) {
		if (segment && segment.taskId === taskId) {
			bySegmentId.set(segment.segmentId, segment);
		}
	}

	const resolvedActiveSegmentId = (activeSegmentId && orderedSegmentIds.includes(activeSegmentId))
		? activeSegmentId
		: (preferredSegmentId && orderedSegmentIds.includes(preferredSegmentId)
			? preferredSegmentId
			: null);

	const segments = orderedSegmentIds.map((segmentId) => {
		const persisted = bySegmentId.get(segmentId);
		const status: PersistedSegmentStatus = persisted?.status
			?? (resolvedActiveSegmentId === segmentId ? "running" : "pending");
		return {
			segmentId,
			repoId: persisted?.repoId ?? repoIdFromSegmentId(segmentId),
			status,
			dependsOnSegmentIds: persisted?.dependsOnSegmentIds ?? [],
		};
	});

	const terminalSegments = segments.filter((segment) =>
		segment.status === "succeeded"
		|| segment.status === "failed"
		|| segment.status === "stalled"
		|| segment.status === "skipped",
	).length;

	return {
		taskId,
		totalSegments: segments.length,
		terminalSegments,
		activeSegmentId: resolvedActiveSegmentId,
		segments,
	};
}

/**
 * Build the base fields for an engine event.
 *
 * Ensures consistent field population across all emit sites.
 * Analogous to `buildTier0EventBase()` for Tier 0 events.
 *
 * @since TP-040
 */
export function buildEngineEventBase(
	type: EngineEventType,
	batchId: string,
	waveIndex: number,
	phase: OrchBatchPhase,
): Pick<EngineEvent, "timestamp" | "type" | "batchId" | "waveIndex" | "phase"> {
	return {
		timestamp: new Date().toISOString(),
		type,
		batchId,
		waveIndex,
		phase,
	};
}


/**
 * Decision output from the merge retry policy evaluator.
 *
 * Pure data structure — callers use this to decide whether to retry,
 * wait, or escalate to paused.
 *
 * @since TP-033
 */
export interface MergeRetryDecision {
	/** Whether the merge should be retried */
	shouldRetry: boolean;
	/** Cooldown to wait before retry (0 if no retry or immediate) */
	cooldownMs: number;
	/** Human-readable reason for the decision */
	reason: string;
	/** Current retry count for this scope (after increment if retrying) */
	currentAttempt: number;
	/** Maximum attempts allowed for this classification */
	maxAttempts: number;
	/** Classification that was evaluated */
	classification: MergeFailureClassification;
	/** Exhaustion action if not retrying */
	exhaustionAction: MergeRetryPolicy["exhaustionAction"];
}

/**
 * Outcome of the merge retry loop.
 *
 * Returned by `applyMergeRetryLoop()` to tell the caller what happened
 * during the retry cycle so it can take the appropriate action (continue,
 * break, force-pause, etc.).
 *
 * @since TP-033 R006
 */
export type MergeRetryLoopOutcome =
	| {
		/** Retry succeeded — caller should continue normal post-merge flow */
		kind: "retry_succeeded";
		mergeResult: MergeWaveResult;
		/** Classification of the failure that was retried */
		classification: MergeFailureClassification | null;
		/** Scope key used for retry counter tracking */
		scopeKey: string;
		/** Last retry decision (carries attempt/maxAttempts for event emission) */
		lastDecision: MergeRetryDecision;
	}
	| {
		/** Safe-stop triggered during retry — caller should break the wave loop */
		kind: "safe_stop";
		mergeResult: MergeWaveResult;
		/** Classification of the failure that was retried */
		classification: MergeFailureClassification | null;
		/** Scope key used for retry counter tracking */
		scopeKey: string;
		/** Last retry decision (carries attempt/maxAttempts for event emission) */
		lastDecision: MergeRetryDecision;
		errorMessage: string;
		notifyMessage: string;
	}
	| {
		/**
		 * Retry exhausted or failure is non-retriable — caller should
		 * force `paused` regardless of on_merge_failure config.
		 */
		kind: "exhausted";
		mergeResult: MergeWaveResult;
		classification: MergeFailureClassification | null;
		scopeKey: string;
		lastDecision: MergeRetryDecision;
		errorMessage: string;
		notifyMessage: string;
	}
	| {
		/** No retry attempted (unclassifiable or non-retriable with 0 attempts).
		 *  Caller should fall through to standard on_merge_failure policy. */
		kind: "no_retry";
		mergeResult: MergeWaveResult;
		classification: MergeFailureClassification | null;
		scopeKey: string;
	};

/**
 * Callbacks provided to `applyMergeRetryLoop()` for side effects
 * that differ between engine.ts and resume.ts.
 *
 * @since TP-033 R006
 */
export interface MergeRetryCallbacks {
	/** Re-invoke mergeWaveByRepo and return the new result */
	performMerge: () => MergeWaveResult | Promise<MergeWaveResult>;
	/** Persist batch state with a trigger label */
	persist: (trigger: string) => void;
	/** Log a message */
	log: (message: string, details?: Record<string, unknown>) => void;
	/** Emit a notification */
	notify: (message: string, level: "info" | "warning" | "error") => void;
	/** Update the merge result in tracking arrays */
	updateMergeResult: (result: MergeWaveResult) => void;
	/** Sleep for cooldown (allows test injection) */
	sleep: (ms: number) => void | Promise<void>;
	/**
	 * Optional callback fired when a retry attempt is about to be executed.
	 * Provides the retry decision with classification, attempt count, and cooldown
	 * so callers can emit structured Tier 0 events at the right time.
	 * @since TP-039 R004
	 */
	onRetryAttempt?: (decision: MergeRetryDecision) => void;
}

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
	orchBranch: string; // e.g., "orch/henry-20260318T140000" — merge target branch
	waveProgress: string; // e.g., "2/3"
	elapsed: string; // e.g., "2m 14s"
	summary: OrchSummaryCounts;
	laneCards: OrchLaneCardData[];
	attachHint: string; // e.g., "Attach via the current runtime session tool"
	errors: string[];
	failurePolicy: string | null; // e.g., "stop-wave" if stopped by policy
}


// ── State Persistence Types (TS-009) ─────────────────────────────────

// ── v3 Resilience & Diagnostics Sections (TP-030) ────────────────────

/**
 * Record of a single automated repair action taken by the orchestrator.
 *
 * Repair actions are deterministic strategies applied when known failure
 * classes are detected (e.g., stale worktree cleanup, lock file removal).
 * Each entry is immutable once written — history is append-only.
 *
 * @since v3 (TP-030)
 */
export interface PersistedRepairRecord {
	/** Unique repair ID (e.g., "r-20260319-001") */
	id: string;
	/** Strategy name that was applied (e.g., "stale-worktree-cleanup", "lock-file-removal") */
	strategy: string;
	/** Outcome of the repair */
	status: "succeeded" | "failed" | "skipped";
	/** Repo ID targeted by the repair (undefined in repo mode) */
	repoId?: string;
	/** Epoch ms when the repair started */
	startedAt: number;
	/** Epoch ms when the repair ended */
	endedAt: number;
}

/**
 * Resilience state section for batch-state.json.
 *
 * Tracks retry/repair metadata so the orchestrator can make informed
 * decisions about retries, force-resume, and failure escalation.
 *
 * All fields are required in a canonical v3 state. Migration from v1/v2
 * fills conservative defaults (no retries, no repairs, no forced resume).
 *
 * @since v3 (TP-030)
 */
export interface ResilienceState {
	/** Whether the last resume was a --force resume */
	resumeForced: boolean;
	/**
	 * Retry counts keyed by scope string.
	 * Scope format: `{taskId}:w{waveIndex}:l{laneNumber}` (e.g., "TP-001:w0:l1").
	 * Value is the number of retries attempted for that scope.
	 */
	retryCountByScope: Record<string, number>;
	/**
	 * Exit classification of the most recent failure (null if no failures).
	 * Uses the same `ExitClassification` union from diagnostics.ts.
	 */
	lastFailureClass: ExitClassification | null;
	/** Chronological history of automated repair actions. Append-only. */
	repairHistory: PersistedRepairRecord[];
}

/**
 * Persisted summary of a single task's exit diagnostic.
 *
 * This is a compact representation stored in `diagnostics.taskExits`.
 * For the full diagnostic (tokens, progress, etc.), see the
 * `exitDiagnostic` field on `PersistedTaskRecord`.
 *
 * Uses `ExitClassification` from diagnostics.ts as the canonical
 * classification type — no duplication.
 *
 * @since v3 (TP-030)
 */
export interface PersistedTaskExitSummary {
	/** Deterministic exit classification */
	classification: ExitClassification;
	/** Estimated cost in USD for this task's execution */
	cost: number;
	/** Wall-clock duration of the task in seconds */
	durationSec: number;
	/** Number of retry attempts (0 if never retried) */
	retries?: number;
}

/**
 * Batch-level diagnostics section for batch-state.json.
 *
 * Aggregates per-task exit summaries and batch-wide cost for
 * dashboard display and post-mortem analysis.
 *
 * All fields are required in a canonical v3 state. Migration from v1/v2
 * fills conservative defaults (empty taskExits, zero batchCost).
 *
 * @since v3 (TP-030)
 */
export interface BatchDiagnostics {
	/**
	 * Per-task exit summaries keyed by task ID.
	 * Populated as tasks complete during execution.
	 */
	taskExits: Record<string, PersistedTaskExitSummary>;
	/** Accumulated batch cost in USD across all tasks */
	batchCost: number;
}

/**
 * Create a default ResilienceState with conservative initial values.
 * Used when migrating v1/v2 states to v3, and for new batch creation.
 */
export function defaultResilienceState(): ResilienceState {
	return {
		resumeForced: false,
		retryCountByScope: {},
		lastFailureClass: null,
		repairHistory: [],
	};
}

/**
 * Create a default BatchDiagnostics with empty/zero initial values.
 * Used when migrating v1/v2 states to v3, and for new batch creation.
 */
export function defaultBatchDiagnostics(): BatchDiagnostics {
	return {
		taskExits: {},
		batchCost: 0,
	};
}

// ── Schema Version & Constants ───────────────────────────────────────

/**
 * Current schema version for batch-state.json.
 * Increment when the persisted schema changes in incompatible ways.
 *
 * Version history:
 *   v1 — Original schema (TS-009). No repo-aware fields on task records.
 *         Lane records had optional `repoId` but it was not validated.
 *   v2 — Repo-aware records (TP-006). Adds `repoId` and `resolvedRepoId`
 *         to task records. Formalizes `repoId` on lane records. Adds
 *         `mode` field to top-level state.
 *   v3 — Resilience & diagnostics (TP-030). Adds optional `resilience`
 *         section (retry counters, force-resume, failure classification,
 *         repair history) and optional `diagnostics` section (per-task
 *         exit summaries, batch cost). Task records gain optional
 *         `exitDiagnostic` alongside legacy `exitReason`.
 *         Both new sections are optional for v1/v2 migration paths.
 *   v4 — Segment execution (TP-081). Adds optional `segments` array
 *         for persisting per-segment runtime state. Task records gain
 *         optional `packetRepoId`, `packetTaskPath`, `segmentIds`, and
 *         `activeSegmentId` fields. All v4-specific fields are optional
 *         for backward compatibility with v1/v2/v3 migration paths.
 *         When migrating from v3, `segments` defaults to `[]` and
 *         task-level segment fields default to `undefined`.
 *
 * Compatibility policy:
 *   - loadBatchState() accepts v1, v2, v3, and v4 files. v1→v2→v3→v4
 *     auto-upconverted in memory (chained).
 *     The on-disk file is NOT rewritten during load.
 *   - saveBatchState() always writes v4.
 *   - Schema versions > 4 are rejected with STATE_SCHEMA_INVALID.
 */
export const BATCH_STATE_SCHEMA_VERSION = 4;

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
 *
 * Repo-aware fields (v2):
 *   `repoId` and `resolvedRepoId` capture task-to-repo attribution
 *   so resume can reconstruct repo routing without re-running discovery.
 *
 *   Mode semantics:
 *   - **repo mode**: Both fields are `undefined`. Tasks implicitly target
 *     the single repository (cwd). No repo routing needed.
 *   - **workspace mode**: `repoId` is the repo ID declared in PROMPT.md
 *     (may be `undefined` if the task didn't declare one). `resolvedRepoId`
 *     is the final repo ID after applying the routing precedence chain
 *     (prompt → area → workspace default). Always a non-empty string in
 *     workspace mode for tasks that passed routing validation.
 *
 *   Source of truth:
 *   - For allocated tasks: derived from `ParsedTask.promptRepoId` and
 *     `ParsedTask.resolvedRepoId` via `serializeBatchState()`.
 *   - For unallocated/pending tasks: derived from the same ParsedTask
 *     fields via discovery enrichment in `persistRuntimeState()`.
 */
export interface PersistedTaskRecord {
	/** Task identifier (e.g., "TO-014") */
	taskId: string;
	/** Lane number the task was assigned to (1-indexed) */
	laneNumber: number;
	/** Lane session name used (e.g., "orch-lane-1") */
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
	/**
	 * Repo ID declared in the task's PROMPT.md metadata (v2).
	 * Undefined in repo mode or if the task didn't declare a repo.
	 */
	repoId?: string;
	/**
	 * Resolved repo ID after applying routing precedence (v2).
	 * Undefined in repo mode. In workspace mode, this is the final
	 * repo target after prompt → area → workspace-default fallback.
	 */
	resolvedRepoId?: string;
	/**
	 * Number of commits preserved as partial progress for a failed task (TP-028).
	 * Undefined when no partial progress was saved (succeeded tasks, no commits, etc.).
	 * Optional for backward compatibility with pre-TP-028 state files.
	 */
	partialProgressCommits?: number;
	/**
	 * Saved branch name holding partial progress for a failed task (TP-028).
	 * Undefined when no partial progress was saved.
	 * Optional for backward compatibility with pre-TP-028 state files.
	 */
	partialProgressBranch?: string;
	/**
	 * Structured exit diagnostic for this task (v3, TP-030).
	 *
	 * Canonical structured exit data — preferred over the legacy `exitReason`
	 * string when present. Contains deterministic classification, cost, timing,
	 * and progress metadata.
	 *
	 * Optional for backward compatibility with v1/v2 state files and tasks
	 * that haven't exited yet. Consumers should check `exitDiagnostic` first,
	 * falling back to `exitReason` for display.
	 */
	exitDiagnostic?: TaskExitDiagnostic;
	/**
	 * Repo ID that owns task packet files (PROMPT.md/STATUS.md/.DONE) (v4, TP-081).
	 *
	 * In workspace mode, this is the `taskPacketRepo` from routing config.
	 * Undefined in repo mode or for pre-v4 state files.
	 */
	packetRepoId?: string;
	/**
	 * Absolute path to the task folder in the packet repo worktree (v4, TP-081).
	 *
	 * Used by resume to locate packet files without re-running discovery.
	 * Undefined in repo mode or for pre-v4 state files.
	 */
	packetTaskPath?: string;
	/**
	 * Segment IDs belonging to this task (v4, TP-081).
	 *
	 * Array of segment ID strings (`<taskId>::<repoId>`).
	 * Empty array for repo-mode tasks or single-repo tasks.
	 * Undefined for pre-v4 state files.
	 */
	segmentIds?: string[];
	/**
	 * Currently executing segment ID (v4, TP-081).
	 *
	 * Null when no segment is active (all completed or not started).
	 * Undefined for pre-v4 state files.
	 */
	activeSegmentId?: string | null;
}

// ── Segment-Level Persisted State (v4, TP-081) ──────────────────────

/**
 * Segment execution status within a batch.
 *
 * State machine mirrors `LaneTaskStatus` but applies at segment granularity:
 *   pending → running → succeeded
 *                     → failed
 *                     → stalled
 *   pending → skipped  (prior segment failed, or task skipped)
 *
 * @since v4 (TP-081)
 */
export type PersistedSegmentStatus = "pending" | "running" | "succeeded" | "failed" | "stalled" | "skipped";

/**
 * Persisted record of a single segment's execution state.
 *
 * A segment is a repo-scoped execution unit within a task. Each task
 * may have one or more segments (one per repo the task touches).
 *
 * Contains everything `/orch-resume` needs to reconstruct segment-level
 * progress without re-running discovery.
 *
 * @since v4 (TP-081)
 */
export interface PersistedSegmentRecord {
	/** Stable segment identifier (`<taskId>::<repoId>`, e.g., "TP-002::api") */
	segmentId: string;
	/** Parent task identifier */
	taskId: string;
	/** Repo ID this segment targets */
	repoId: string;
	/** Segment execution status */
	status: PersistedSegmentStatus;
	/** Lane ID the segment executed on (e.g., "lane-1"), empty if not yet assigned */
	laneId: string;
	/** Lane session name used for this segment */
	sessionName: string;
	/** Absolute path to the worktree used for this segment */
	worktreePath: string;
	/** Git branch name checked out for this segment */
	branch: string;
	/** Epoch ms when segment execution started (null if not yet started) */
	startedAt: number | null;
	/** Epoch ms when segment execution ended (null if still pending/running) */
	endedAt: number | null;
	/** Number of retry attempts for this segment */
	retries: number;
	/**
	 * Segment IDs this segment depends on (intra-task DAG edges).
	 * Empty array for the first segment in a task or for tasks with no intra-task deps.
	 */
	dependsOnSegmentIds: string[];
	/**
	 * Structured exit diagnostic for this segment.
	 * Optional: absent for segments that haven't exited yet.
	 * Uses the same `TaskExitDiagnostic` shape from diagnostics.ts.
	 */
	exitDiagnostic?: TaskExitDiagnostic;
	/** Human-readable exit reason (legacy compat, same as task-level) */
	exitReason: string;
}

/**
 * Persisted record of a lane's configuration.
 *
 * Captures worktree/branch assignment so `/orch-resume` can
 * reconnect to existing worktrees without re-allocation.
 *
 * Repo-aware contract (v2):
 *   `repoId` captures which repository this lane targets.
 *
 *   Mode semantics:
 *   - **repo mode**: `repoId` is `undefined`. The lane's worktree is
 *     created from the single repository (cwd). All lanes share the
 *     same repo implicitly.
 *   - **workspace mode**: `repoId` is a non-empty string matching a
 *     key in `WorkspaceConfig.repos`. All tasks assigned to this lane
 *     target the same repo. Lane allocation guarantees repo affinity
 *     (no lane mixes tasks from different repos).
 *
 *   Source of truth: derived from `AllocatedLane.repoId` during
 *   serialization in `serializeBatchState()`.
 */
export interface PersistedLaneRecord {
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Lane identifier (e.g., "lane-1") */
	laneId: string;
	/** Lane session identifier (e.g., "orch-lane-1") */
	laneSessionId: string;
	/** Absolute path to the lane's worktree directory */
	worktreePath: string;
	/** Git branch name checked out in the worktree */
	branch: string;
	/** Task IDs assigned to this lane in execution order */
	taskIds: string[];
	/**
	 * Repo ID this lane targets (v2).
	 * Undefined in repo mode. Non-empty string in workspace mode,
	 * matching a key in `WorkspaceConfig.repos`.
	 */
	repoId?: string;
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
	/**
	 * Per-repo merge outcomes (v2, TP-009).
	 * Populated in workspace mode when MergeWaveResult.repoResults is available.
	 * Undefined/absent in repo mode or for older state files. Dashboard treats
	 * absence as single-repo merge.
	 */
	repoResults?: PersistedRepoMergeOutcome[];
}

/**
 * Persisted per-repo merge outcome within a wave merge.
 * Serializable subset of RepoMergeOutcome — excludes full MergeLaneResult
 * objects (which contain detailed merge agent result JSON) to keep state file compact.
 */
export interface PersistedRepoMergeOutcome {
	/** Repo ID. Undefined for the default group in repo mode. */
	repoId: string | undefined;
	/** Merge status for this repo. */
	status: "succeeded" | "failed" | "partial";
	/** Lane numbers involved in this repo's merge. */
	laneNumbers: number[];
	/** Failed lane number within this repo (null if all succeeded). */
	failedLane: number | null;
	/** Failure reason within this repo (null if all succeeded). */
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
 *
 * v2 additions (TP-006):
 * - `mode` field captures workspace vs repo mode at batch start
 * - Task records include `repoId` and `resolvedRepoId` for repo attribution
 * - Lane records formalize `repoId` contract per mode
 * - v1 files are auto-upconverted: `mode` defaults to "repo", task/lane
 *   `repoId` fields default to `undefined` (omitted from JSON)
 *
 * v3 additions (TP-030):
 * - `resilience` section (required): retry counters, force-resume intent,
 *   failure classification, and repair history for automated recovery.
 * - `diagnostics` section (required): per-task exit summaries and batch cost.
 * - Task records gain optional `exitDiagnostic` (canonical structured exit
 *   data alongside legacy `exitReason` string).
 * - Both sections are required in v3. Migration from v1/v2 fills
 *   conservative defaults (see `defaultResilienceState()` / `defaultBatchDiagnostics()`).
 *
 * v4 additions (TP-081):
 * - `segments` array (required): per-segment execution records for multi-repo
 *   task execution. Empty array in repo mode or for pre-v4 migration.
 * - Task records gain optional `packetRepoId`, `packetTaskPath`, `segmentIds`,
 *   and `activeSegmentId` for segment-level tracking.
 * - Migration from v3 fills `segments` as `[]` and leaves task-level segment
 *   fields as `undefined`.
 */
export interface PersistedBatchState {
	/** Schema version — must equal BATCH_STATE_SCHEMA_VERSION (currently 4) */
	schemaVersion: number;
	/** Current batch execution phase */
	phase: OrchBatchPhase;
	/** Unique batch identifier (timestamp format) */
	batchId: string;
	/** Branch that was active when /orch started — used as base for worktrees and merge target */
	baseBranch: string;
	/** Orchestrator-managed branch name (e.g., 'orch/henry-20260318T140000'). Empty = legacy mode (merge into baseBranch directly). */
	orchBranch: string;
	/**
	 * Workspace execution mode at batch start (v2).
	 * - "repo": Single-repo mode (default, backward-compatible).
	 * - "workspace": Multi-repo workspace mode.
	 * Defaults to "repo" when loading v1 state files.
	 */
	mode: WorkspaceMode;
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
	/**
	 * Resilience state for retry/recovery tracking (v3, TP-030).
	 * Required in v3+. Migration from v1/v2 fills conservative defaults.
	 */
	resilience: ResilienceState;
	/**
	 * Batch-level diagnostics for cost tracking and exit summaries (v3, TP-030).
	 * Required in v3+. Migration from v1/v2 fills conservative defaults.
	 */
	diagnostics: BatchDiagnostics;
	/**
	 * Per-segment execution records for multi-repo task execution (v4, TP-081).
	 *
	 * Each entry represents one repo-scoped segment of a task. In repo mode
	 * or for single-repo tasks, this array is empty (segment tracking is
	 * implicit via task records).
	 *
	 * Required in v4. Migration from v1/v2/v3 fills empty array.
	 */
	segments: PersistedSegmentRecord[];
	/**
	 * Unknown top-level fields captured during deserialization.
	 * Preserved on roundtrip to avoid data loss from future schema extensions
	 * or external tools writing additional fields.
	 * Not serialized directly — merged back by `serializeBatchState()`.
	 */
	_extraFields?: Record<string, unknown>;
}


// ── Resume (TS-009 Step 4) ───────────────────────────────────────────

/**
 * Error codes for /orch-resume command failures.
 *
 * - RESUME_NO_STATE: No batch-state.json found on disk
 * - RESUME_INVALID_STATE: State file exists but cannot be parsed/validated
 * - RESUME_SCHEMA_MISMATCH: State file has incompatible schema version
 * - RESUME_PHASE_NOT_RESUMABLE: Persisted phase does not allow resume
 * - RESUME_TMUX_UNAVAILABLE: Legacy session backend is unavailable for reconnection
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
 * Combines persisted status, lane-session liveness, and .DONE file presence
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
	/** Whether the lane session is alive right now */
	sessionAlive: boolean;
	/** Whether the .DONE file was found */
	doneFileFound: boolean;
	/** Whether the lane worktree still exists on disk */
	worktreeExists: boolean;
	/** Action the resume engine should take */
	action: "reconnect" | "mark-complete" | "mark-failed" | "re-execute" | "skip" | "pending";
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
	/**
	 * Wave indexes (0-based) where all tasks are terminal but the merge
	 * is missing or failed. These waves should be retried for merge only
	 * (no task re-execution). Empty when all completed waves have
	 * successful merges. (TP-037, Bug #102)
	 */
	mergeRetryWaveIndexes: number[];
}

// ── Abort (TS-009 Step 5) ────────────────────────────────────────────

/**
 * Abort mode: graceful (checkpoint + wait + force-kill) or hard (immediate kill).
 */
export type AbortMode = "graceful" | "hard";

/**
 * Error codes for abort operations.
 *
 * - ABORT_TMUX_LIST_FAILED: Could not list legacy session records
 * - ABORT_WRAPUP_WRITE_FAILED: Failed to write wrap-up signal file(s)
 * - ABORT_KILL_FAILED: Failed to kill one or more lane sessions
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
	/** Lane session name */
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
	/** Lane session name */
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
 * 1. Workspace config file present + invalid → fatal error with actionable
 *    `WorkspaceConfigError` (never silently falls back to repo mode).
 * 2. Workspace config file present + valid → workspace mode.
 * 3. No workspace config + cwd is a git repo → repo mode.
 * 4. No workspace config + cwd is not a git repo → `WORKSPACE_SETUP_REQUIRED`.
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
	/**
	 * Repo ID that owns task packet files (PROMPT.md/STATUS.md/.DONE/.reviews).
	 *
	 * Required at runtime. Legacy workspace YAML without this field is
	 * compatibility-mapped to `defaultRepo` during load with a warning.
	 *
	 * Invariant: `tasksRoot` must resolve inside `repos[taskPacketRepo].path`.
	 */
	taskPacketRepo: string;
	/**
	 * When true, every task MUST declare an explicit execution target
	 * (via `## Execution Target` section or inline `**Repo:**` in PROMPT.md).
	 * Area-level and workspace-default fallbacks are still used for
	 * validation (unknown-repo checks) but NOT for automatic resolution.
	 *
	 * This prevents accidental misrouting in large multi-team workspaces
	 * where task authors must be intentional about which repo a task targets.
	 *
	 * Default: false (permissive — existing precedence chain applies).
	 * Only meaningful in workspace mode.
	 */
	strict?: boolean;
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
	/**
	 * Resolved pointer for config/agent paths (null in repo mode).
	 *
	 * When present, `pointer.configRoot` and `pointer.agentRoot` point to
	 * the config repo's config directory. State/sidecar paths are NOT
	 * affected — they always live at `<workspaceRoot>/.pi/`.
	 */
	pointer: PointerResolution | null;
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
 * - WORKSPACE_TASK_PACKET_REPO_NOT_FOUND: `routing.task_packet_repo` references a repo ID not in the repos map
 * - WORKSPACE_TASKS_ROOT_OUTSIDE_PACKET_REPO: `routing.tasks_root` resolves outside `repos[routing.task_packet_repo].path`
 * - WORKSPACE_TASK_AREA_OUTSIDE_TASKS_ROOT: A configured task-area path resolves outside `routing.tasks_root`
 * - WORKSPACE_SETUP_REQUIRED: No workspace config and cwd is not a git repository
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
	| "WORKSPACE_TASK_PACKET_REPO_NOT_FOUND"
	| "WORKSPACE_TASKS_ROOT_OUTSIDE_PACKET_REPO"
	| "WORKSPACE_TASK_AREA_OUTSIDE_TASKS_ROOT"
	| "WORKSPACE_SETUP_REQUIRED"
	| "WORKSPACE_DUPLICATE_REPO_PATH"
	| "WORKSPACE_SCHEMA_INVALID";/**
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


// ── Pointer Resolution Types ─────────────────────────────────────────

/**
 * Canonical filename for the workspace pointer file.
 * Located at `<workspace-root>/.pi/taskplane-pointer.json`.
 *
 * Created by `taskplane init` in workspace mode. Points to the config
 * repo and config path within it. Not committed to git — each user
 * creates it during onboarding.
 */
export const POINTER_FILENAME = "taskplane-pointer.json";

/**
 * Resolve the absolute path to the pointer file.
 * @param workspaceRoot - Absolute path to the workspace root
 */
export function pointerFilePath(workspaceRoot: string): string {
	return join(workspaceRoot, ".pi", POINTER_FILENAME);
}

/**
 * Result of resolving the workspace pointer file.
 *
 * This is the primary contract for downstream consumers (task-runner,
 * orchestrator, merge agent, dashboard). All pointer failures are
 * non-fatal: when the pointer cannot be resolved, `used` is false and
 * `configRoot`/`agentRoot` fall back to workspace-root paths.
 *
 * State/sidecar paths are NOT affected by the pointer — they always
 * live at `<workspace-root>/.pi/` regardless of pointer resolution.
 *
 * In repo mode, `resolvePointer()` returns null (pointer is ignored
 * entirely, even if a file happens to exist).
 */
export interface PointerResolution {
	/**
	 * Whether the pointer was successfully resolved.
	 * - true: pointer file was found, parsed, and config_repo resolved
	 *   to a known repo in WorkspaceConfig.repos.
	 * - false: pointer was missing, malformed, or referenced an unknown
	 *   repo. Fallback paths are used instead.
	 */
	used: boolean;

	/**
	 * Resolved config root directory.
	 * - When used=true: `<config-repo-path>/<config_path>/`
	 * - When used=false: `<workspace-root>/.pi/` (existing fallback)
	 */
	configRoot: string;

	/**
	 * Resolved agent overrides directory.
	 * - When used=true: `<config-repo-path>/<config_path>/agents/`
	 * - When used=false: `<workspace-root>/.pi/agents/` (existing fallback)
	 */
	agentRoot: string;

	/**
	 * Warning message when pointer resolution fell back.
	 * - undefined when used=true (no warning)
	 * - Human-readable reason string when used=false
	 */
	warning?: string;
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
		pointer: null,
	};
}


// ── Agent Mailbox Types (TP-089) ─────────────────────────────────────

/**
 * Mailbox directory name under .pi/.
 * @since TP-089
 */
export const MAILBOX_DIR_NAME = "mailbox";

/**
 * Maximum content size in UTF-8 bytes.
 * Steering messages should be concise directives; larger context should be
 * written to a separate file and referenced by path.
 * @since TP-089
 */
export const MAILBOX_MAX_CONTENT_BYTES = 4096;

/**
 * Message types for the agent mailbox system.
 *
 * | Type       | Direction           | Purpose                                    |
 * |------------|---------------------|--------------------------------------------|
 * | `steer`    | supervisor → agent  | Course correction. Agent must follow.       |
 * | `query`    | supervisor → agent  | Request for status/info. Agent replies.     |
 * | `abort`    | supervisor → agent  | Graceful stop. Agent wraps up and exits.    |
 * | `info`     | supervisor → agent  | FYI context. No action required.            |
 * | `reply`    | agent → supervisor  | Response to query or steer acknowledgment.  |
 * | `escalate` | agent → supervisor  | Agent-initiated: blocked or needs guidance. |
 *
 * @since TP-089
 */
export type MailboxMessageType = "steer" | "query" | "abort" | "info" | "reply" | "escalate";

/**
 * Set of valid mailbox message types for runtime validation.
 * @since TP-089
 */
export const MAILBOX_MESSAGE_TYPES: ReadonlySet<string> = new Set<MailboxMessageType>([
	"steer", "query", "abort", "info", "reply", "escalate",
]);

/**
 * Message format for the file-based agent mailbox.
 *
 * Messages are written as JSON files in batch-scoped, session-scoped
 * directories. The rpc-wrapper checks the inbox on every `message_end`
 * event and injects pending messages into the agent's LLM context via
 * pi's `steer` RPC command.
 *
 * @see docs/specifications/taskplane/agent-mailbox-steering.md
 * @since TP-089
 */
export interface MailboxMessage {
	/** Unique message ID: `{timestamp}-{5char-hex-nonce}` */
	id: string;
	/** Batch ID — must match current batch for validation */
	batchId: string;
	/** Sender identifier: `"supervisor"` or session name */
	from: string;
	/** Target session name or `"_broadcast"` */
	to: string;
	/** Epoch milliseconds (Date.now()) */
	timestamp: number;
	/** Message type */
	type: MailboxMessageType;
	/** Message body (max 4KB UTF-8 bytes) */
	content: string;
	/** Whether the sender expects a reply (default: false) */
	expectsReply?: boolean;
	/** Reference to a previous message ID for threading (default: null) */
	replyTo?: string | null;
}

/**
 * Input options for writeMailboxMessage.
 *
 * The caller provides these fields; the utility generates `id`, `batchId`,
 * `to`, and `timestamp` from its own arguments.
 *
 * @since TP-089
 */
export interface WriteMailboxMessageOpts {
	/** Sender identifier: `"supervisor"` or session name */
	from: string;
	/** Message type */
	type: MailboxMessageType;
	/** Message body (max 4KB UTF-8 bytes) */
	content: string;
	/** Whether the sender expects a reply (default: false) */
	expectsReply?: boolean;
	/** Reference to a previous message ID for threading (default: null) */
	replyTo?: string | null;
}

// ── Runtime V2 Contracts (TP-102) ────────────────────────────────────
//
// These types define the foundational contracts for backend-neutral Runtime V2
// architecture. They are additive — existing runtime paths continue to work
// while Runtime V2 is incrementally adopted.
//
// Design principles:
//   1. Agent identity is a stable runtime ID, not a legacy session name.
//   2. Packet-path authority is explicit, never inferred from cwd.
//   3. Process ownership uses a registry, not terminal session discovery.
//   4. Normalized events flow directly from child to parent.
//
// See: docs/specifications/framework/taskplane-runtime-v2/
// ─────────────────────────────────────────────────────────────────────

/**
 * Canonical agent roles in the Runtime V2 process model.
 *
 * Every spawned agent process has exactly one role. The role determines
 * the process's responsibilities, tools, and lifecycle semantics.
 *
 * @since TP-102
 */
export type RuntimeAgentRole = "worker" | "reviewer" | "merger" | "lane-runner";

/**
 * Agent lifecycle states in the process registry.
 *
 * State machine:
 *   spawning → running → wrapping_up → exited
 *                      → crashed
 *                      → timed_out
 *                      → killed
 *
 * @since TP-102
 */
export type RuntimeAgentStatus =
	| "spawning"
	| "running"
	| "wrapping_up"
	| "exited"
	| "crashed"
	| "timed_out"
	| "killed";

/** Set of terminal agent statuses (process is no longer alive). @since TP-102 */
export const TERMINAL_AGENT_STATUSES: ReadonlySet<RuntimeAgentStatus> = new Set([
	"exited", "crashed", "timed_out", "killed",
]);

/**
 * Stable agent identity for Runtime V2.
 *
 * This replaces legacy session names as the canonical identifier for a
 * spawned agent process. The string format is deliberately compatible
 * with existing naming conventions (e.g., "orch-henrylach-lane-1-worker")
 * to minimize churn in supervisor tools, dashboard, and mailbox addressing.
 *
 * The key semantic change: this is a **runtime process ID**, not a terminal
 * session label. Code must not assume terminal-session probes apply to RuntimeAgentId.
 *
 * @since TP-102
 */
export type RuntimeAgentId = string;

/**
 * Explicit packet-path authority for a task execution.
 *
 * In workspace mode, the packet home (where PROMPT.md / STATUS.md / .DONE
 * live) may differ from the execution cwd (the active segment repo worktree).
 * Runtime V2 requires these paths to be resolved explicitly and passed
 * through the execution chain — never inferred from cwd.
 *
 * In repo mode (single repo), all paths point into the same filesystem tree.
 * The contract is the same; the values just happen to be co-located.
 *
 * @since TP-102
 */
export interface PacketPaths {
	/** Absolute path to the task's PROMPT.md */
	promptPath: string;
	/** Absolute path to the task's STATUS.md */
	statusPath: string;
	/** Absolute path to the task's .DONE marker */
	donePath: string;
	/** Absolute path to the task's .reviews/ directory */
	reviewsDir: string;
	/** Absolute path to the task folder containing packet files */
	taskFolder: string;
}

/**
 * Resolve a PacketPaths object from a task folder path.
 *
 * This is a pure helper — it does not check whether the files exist.
 * Consumers should use this to build authoritative paths from an
 * already-resolved task folder location.
 *
 * @param taskFolder - Absolute path to the task folder
 * @returns Complete PacketPaths with all derived paths
 *
 * @since TP-102
 */
export function resolvePacketPaths(taskFolder: string): PacketPaths {
	return {
		promptPath: `${taskFolder}/PROMPT.md`,
		statusPath: `${taskFolder}/STATUS.md`,
		donePath: `${taskFolder}/.DONE`,
		reviewsDir: `${taskFolder}/.reviews`,
		taskFolder,
	};
}

/**
 * A single execution unit in Runtime V2.
 *
 * Represents one unit of work to be executed in one lane: either a whole
 * task (repo mode / single-segment workspace mode) or one segment of a
 * multi-repo task.
 *
 * This is the contract between the engine (which decides what to run) and
 * the lane-runner (which runs it). It carries everything the lane-runner
 * needs without requiring it to re-derive paths from cwd or session state.
 *
 * @since TP-102
 */
export interface ExecutionUnit {
	/** Unique identifier: taskId for whole-task units, `taskId::repoId` for segments */
	id: string;
	/** Parent task identifier */
	taskId: string;
	/** Segment identifier (null for whole-task execution) */
	segmentId: string | null;
	/** Repo ID where execution happens (cwd of the worker) */
	executionRepoId: string;
	/** Repo ID that owns the packet files (may differ in workspace mode) */
	packetHomeRepoId: string;
	/** Absolute path to the execution worktree */
	worktreePath: string;
	/** Authoritative packet file paths */
	packet: PacketPaths;
	/** Full parsed task metadata */
	task: ParsedTask;
}

/**
 * Per-agent process manifest for the runtime registry.
 *
 * Written by the agent's parent process (lane-runner or engine) before
 * the agent is considered visible. Updated on status transitions and
 * cleaned up on batch completion.
 *
 * Replaces legacy session discovery as the source of truth for agent
 * liveness, identity, and attribution.
 *
 * File location: `.pi/runtime/{batchId}/agents/{agentId}/manifest.json`
 *
 * @since TP-102
 */
export interface RuntimeAgentManifest {
	/** Batch this agent belongs to */
	batchId: string;
	/** Stable agent identity (e.g., "orch-henrylach-lane-1-worker") */
	agentId: RuntimeAgentId;
	/** Agent role */
	role: RuntimeAgentRole;
	/** Lane number (null for merge agents) */
	laneNumber: number | null;
	/** Current task ID being executed (null before first assignment) */
	taskId: string | null;
	/** Repo ID the agent is operating in */
	repoId: string;
	/** OS process ID of the agent host process */
	pid: number;
	/** OS process ID of the parent (lane-runner or engine) */
	parentPid: number;
	/** Epoch ms when the agent was spawned */
	startedAt: number;
	/** Current lifecycle status */
	status: RuntimeAgentStatus;
	/** Absolute path to the agent's working directory */
	cwd: string;
	/** Authoritative packet paths (null for merge agents or pre-assignment) */
	packet: PacketPaths | null;
}

/**
 * Batch-level runtime registry snapshot.
 *
 * Contains all active and recently-exited agents for one batch.
 * The authoritative source of truth for which agents exist, replacing
 * legacy session discovery.
 *
 * File location: `.pi/runtime/{batchId}/registry.json`
 *
 * @since TP-102
 */
export interface RuntimeRegistry {
	/** Batch ID this registry belongs to */
	batchId: string;
	/** Epoch ms when the registry was last updated */
	updatedAt: number;
	/** All known agents (keyed by agentId for fast lookup in JSON form) */
	agents: Record<RuntimeAgentId, RuntimeAgentManifest>;
}

/**
 * Lane execution snapshot emitted by the lane-runner.
 *
 * Replaces the current `lane-state-*.json` sidecar with a first-class
 * contract. Written by the lane-runner directly (not by tailing sidecar
 * files from a sibling process).
 *
 * File location: `.pi/runtime/{batchId}/lanes/lane-{N}.json`
 *
 * @since TP-102
 */
export interface RuntimeLaneSnapshot {
	/** Batch this lane belongs to */
	batchId: string;
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Lane identifier (e.g., "lane-1") */
	laneId: string;
	/** Repo ID this lane targets */
	repoId: string;
	/** Current task ID being executed */
	taskId: string | null;
	/** Current segment ID (null for whole-task execution) */
	segmentId: string | null;
	/** Lane execution status */
	status: "idle" | "running" | "complete" | "failed";
	/** Worker agent snapshot (null when no worker is active) */
	worker: RuntimeAgentTelemetrySnapshot | null;
	/** Reviewer agent snapshot (null when no reviewer is active) */
	reviewer: RuntimeAgentTelemetrySnapshot | null;
	/** Task progress derived from STATUS.md */
	progress: RuntimeTaskProgress | null;
	/** Epoch ms when this snapshot was last updated */
	updatedAt: number;
}

/**
 * Telemetry snapshot for a single agent within a lane.
 *
 * @since TP-102
 */
export interface RuntimeAgentTelemetrySnapshot {
	/** Agent ID */
	agentId: RuntimeAgentId;
	/** Agent lifecycle status */
	status: RuntimeAgentStatus;
	/** Elapsed time in milliseconds */
	elapsedMs: number;
	/** Number of tool calls made */
	toolCalls: number;
	/** Context window utilization percentage (0-100) */
	contextPct: number;
	/** Cumulative cost in USD */
	costUsd: number;
	/** Last tool call description */
	lastTool: string;
	/** Input tokens consumed */
	inputTokens: number;
	/** Output tokens generated */
	outputTokens: number;
	/** Cache read tokens */
	cacheReadTokens: number;
	/** Cache write tokens */
	cacheWriteTokens: number;
}

/**
 * Task progress derived from STATUS.md parsing.
 *
 * @since TP-102
 */
export interface RuntimeTaskProgress {
	/** Human-readable current step label */
	currentStep: string;
	/** Number of checked checkboxes across all steps */
	checked: number;
	/** Total number of checkboxes across all steps */
	total: number;
	/** Current worker iteration number */
	iteration: number;
	/** Number of reviews performed */
	reviews: number;
}

/**
 * Normalized event emitted by an agent host.
 *
 * The canonical telemetry/conversation event shape for Runtime V2.
 * Agent hosts write these to per-agent event logs and stream them
 * to their parent process via IPC.
 *
 * File location: `.pi/runtime/{batchId}/agents/{agentId}/events.jsonl`
 *
 * @since TP-102
 */
export interface RuntimeAgentEvent {
	/** Batch ID */
	batchId: string;
	/** Agent that produced this event */
	agentId: RuntimeAgentId;
	/** Agent role */
	role: RuntimeAgentRole;
	/** Lane number (null for merge agents) */
	laneNumber: number | null;
	/** Task ID being executed when the event was produced */
	taskId: string | null;
	/** Repo ID */
	repoId: string;
	/** Epoch ms timestamp */
	ts: number;
	/** Event type */
	type: RuntimeAgentEventType;
	/** Event-specific payload */
	payload: Record<string, unknown>;
}

/**
 * Normalized event types for the Runtime V2 agent event stream.
 *
 * @since TP-102
 */
export type RuntimeAgentEventType =
	// Lifecycle
	| "agent_started"
	| "agent_exited"
	| "agent_killed"
	| "agent_crashed"
	| "agent_timeout"
	// Conversation
	| "prompt_sent"
	| "assistant_message"
	| "tool_call"
	| "tool_result"
	// Telemetry
	| "usage_delta"
	| "context_usage"
	| "retry_started"
	| "retry_finished"
	| "compaction_started"
	| "compaction_finished"
	// Steering
	| "message_delivered"
	| "reply_sent"
	| "escalation_sent"
	// Review / bridge
	| "review_requested"
	| "review_completed"
	| "review_failed";

// ── Runtime V2 Path Helpers (TP-102) ─────────────────────────────────

/**
 * Resolve the root directory for Runtime V2 artifacts for a given batch.
 *
 * @param stateRoot - Root directory containing .pi/ (workspace root or repo root)
 * @param batchId - Batch identifier
 * @returns Absolute path: `{stateRoot}/.pi/runtime/{batchId}/`
 *
 * @since TP-102
 */
export function runtimeRoot(stateRoot: string, batchId: string): string {
	return `${stateRoot}/.pi/runtime/${batchId}`;
}

/**
 * Resolve the path for a specific agent's runtime directory.
 *
 * @param stateRoot - Root directory containing .pi/
 * @param batchId - Batch identifier
 * @param agentId - Runtime agent identifier
 * @returns Absolute path: `{stateRoot}/.pi/runtime/{batchId}/agents/{agentId}/`
 *
 * @since TP-102
 */
export function runtimeAgentDir(stateRoot: string, batchId: string, agentId: RuntimeAgentId): string {
	return `${stateRoot}/.pi/runtime/${batchId}/agents/${agentId}`;
}

/**
 * Resolve the path for a specific agent's manifest file.
 *
 * @since TP-102
 */
export function runtimeManifestPath(stateRoot: string, batchId: string, agentId: RuntimeAgentId): string {
	return `${runtimeAgentDir(stateRoot, batchId, agentId)}/manifest.json`;
}

/**
 * Resolve the path for a specific agent's event log.
 *
 * @since TP-102
 */
export function runtimeAgentEventsPath(stateRoot: string, batchId: string, agentId: RuntimeAgentId): string {
	return `${runtimeAgentDir(stateRoot, batchId, agentId)}/events.jsonl`;
}

/**
 * Resolve the path for a lane snapshot file.
 *
 * @since TP-102
 */
export function runtimeLaneSnapshotPath(stateRoot: string, batchId: string, laneNumber: number): string {
	return `${stateRoot}/.pi/runtime/${batchId}/lanes/lane-${laneNumber}.json`;
}

/**
 * Resolve the path for the batch runtime registry.
 *
 * @since TP-102
 */
export function runtimeRegistryPath(stateRoot: string, batchId: string): string {
	return `${stateRoot}/.pi/runtime/${batchId}/registry.json`;
}

/**
 * Build a canonical RuntimeAgentId from components.
 *
 * Produces IDs compatible with the existing naming convention
 * (e.g., "orch-henrylach-lane-1-worker") while semantically
 * decoupling them from legacy session names.
 *
 * @param prefix - Operator/batch prefix (e.g., "orch-henrylach")
 * @param laneNumber - Lane number (null for merge agents)
 * @param role - Agent role
 * @param mergeIndex - Merge wave index (only for merge agents)
 * @returns Canonical agent ID string
 *
 * @since TP-102
 */
export function buildRuntimeAgentId(
	prefix: string,
	laneNumber: number | null,
	role: RuntimeAgentRole,
	mergeIndex?: number,
): RuntimeAgentId {
	if (role === "merger" && mergeIndex != null) {
		return `${prefix}-merge-${mergeIndex}`;
	}
	if (role === "lane-runner" && laneNumber != null) {
		return `${prefix}-lane-${laneNumber}`;
	}
	if (laneNumber != null) {
		return `${prefix}-lane-${laneNumber}-${role}`;
	}
	return `${prefix}-${role}`;
}

/**
 * Validate that a RuntimeAgentManifest has required fields and sane values.
 *
 * Returns an array of validation error strings (empty = valid).
 *
 * @since TP-102
 */
export function validateAgentManifest(manifest: unknown): string[] {
	const errors: string[] = [];
	if (!manifest || typeof manifest !== "object") {
		return ["manifest must be a non-null object"];
	}
	const m = manifest as Record<string, unknown>;

	if (typeof m.batchId !== "string" || !m.batchId) errors.push("batchId must be a non-empty string");
	if (typeof m.agentId !== "string" || !m.agentId) errors.push("agentId must be a non-empty string");
	if (typeof m.role !== "string") errors.push("role must be a string");
	else {
		const validRoles: ReadonlySet<string> = new Set(["worker", "reviewer", "merger", "lane-runner"]);
		if (!validRoles.has(m.role as string)) errors.push(`role must be one of: ${[...validRoles].join(", ")}`);
	}
	if (typeof m.pid !== "number" || !Number.isFinite(m.pid) || m.pid <= 0) errors.push("pid must be a positive finite number");
	if (typeof m.parentPid !== "number" || !Number.isFinite(m.parentPid) || m.parentPid <= 0) errors.push("parentPid must be a positive finite number");
	if (typeof m.startedAt !== "number" || !Number.isFinite(m.startedAt)) errors.push("startedAt must be a finite number");
	if (typeof m.status !== "string") errors.push("status must be a string");
	else {
		const validStatuses: ReadonlySet<string> = new Set(["spawning", "running", "wrapping_up", "exited", "crashed", "timed_out", "killed"]);
		if (!validStatuses.has(m.status as string)) errors.push(`status must be one of: ${[...validStatuses].join(", ")}`);
	}
	if (typeof m.cwd !== "string" || !m.cwd) errors.push("cwd must be a non-empty string");
	if (typeof m.repoId !== "string") errors.push("repoId must be a string");

	return errors;
}

/**
 * Validate that a PacketPaths object has all required fields.
 *
 * Returns an array of validation error strings (empty = valid).
 *
 * @since TP-102
 */
export function validatePacketPaths(packet: unknown): string[] {
	const errors: string[] = [];
	if (!packet || typeof packet !== "object") {
		return ["packet must be a non-null object"];
	}
	const p = packet as Record<string, unknown>;

	for (const field of ["promptPath", "statusPath", "donePath", "reviewsDir", "taskFolder"] as const) {
		if (typeof p[field] !== "string" || !(p[field] as string)) {
			errors.push(`${field} must be a non-empty string`);
		}
	}

	return errors;
}

