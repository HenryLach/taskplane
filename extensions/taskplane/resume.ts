/**
 * Resume logic for paused/interrupted batches
 * @module orch/resume
 */
import { existsSync } from "fs";
import { join } from "path";

import { runDiscovery } from "./discovery.ts";
import { executeOrchBatch } from "./engine.ts";
import { computeTransitiveDependents, execLog, executeWave, pollUntilTaskComplete, spawnLaneSession, tmuxHasSession } from "./execution.ts";
import type { MonitorUpdateCallback } from "./execution.ts";
import { runGit } from "./git.ts";
import { mergeWaveByRepo } from "./merge.ts";
import { computeMergeFailurePolicy, formatRepoMergeSummary, ORCH_MESSAGES } from "./messages.ts";
import { resolveOperatorId } from "./naming.ts";
import { deleteBatchState, hasTaskDoneMarker, loadBatchState, persistRuntimeState, seedPendingOutcomesForAllocatedLanes, syncTaskOutcomesFromMonitor, upsertTaskOutcome } from "./persistence.ts";
import { StateFileError } from "./types.ts";
import type { AllocatedLane, AllocatedTask, LaneExecutionResult, LaneTaskOutcome, LaneTaskStatus, MergeWaveResult, OrchBatchPhase, OrchBatchRuntimeState, OrchestratorConfig, ParsedTask, PersistedBatchState, PersistedLaneRecord, ReconciledTaskState, ResumeEligibility, ResumePoint, TaskRunnerConfig, WaveExecutionResult, WorkspaceConfig } from "./types.ts";
import { buildDependencyGraph, resolveRepoRoot } from "./waves.ts";
import { deleteBranchBestEffort, forceCleanupWorktree, listWorktrees, removeAllWorktrees, removeWorktree, safeResetWorktree } from "./worktree.ts";

// ── Resume Repo Helpers ──────────────────────────────────────────────

/**
 * Collect unique repo roots from persisted lane records.
 *
 * In repo mode (no repoId on lanes), returns `[defaultRepoRoot]`.
 * In workspace mode, returns one entry per unique repoId, resolved
 * via `resolveRepoRoot()`. Includes the default root as a fallback
 * for lanes with no repoId.
 *
 * Used by inter-wave worktree reset and terminal cleanup to operate
 * on worktrees across all repos in the batch.
 *
 * @param persistedState   - Loaded batch state with lane records
 * @param defaultRepoRoot  - Default/main repo root (cwd)
 * @param workspaceConfig  - Workspace configuration (null in repo mode)
 * @returns Array of unique absolute repo root paths
 */
export function collectRepoRoots(
	persistedState: PersistedBatchState,
	defaultRepoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): string[] {
	const roots = new Set<string>();

	for (const lane of persistedState.lanes) {
		const root = resolveRepoRoot(lane.repoId, defaultRepoRoot, workspaceConfig);
		roots.add(root);
	}

	// Always include the default repo root (covers repo mode and any
	// lanes without repoId)
	roots.add(defaultRepoRoot);

	return [...roots];
}

/**
 * Reconstruct AllocatedLane[] from persisted lane records.
 *
 * Used during resume to preserve lane metadata (worktreePath, branch, repoId)
 * across persistence checkpoints. Without this, the first resume checkpoint
 * would serialize empty lanes, losing all lane context.
 *
 * When `persistedTasks` is provided, repo attribution fields (repoId,
 * resolvedRepoId, taskFolder) are carried forward onto the reconstructed
 * ParsedTask stubs. This ensures `serializeBatchState()` can emit repo
 * fields for tasks not in `discovery.pending` (e.g., completed/failed tasks
 * that have been archived).
 *
 * @param persistedLanes - Persisted lane records
 * @param persistedTasks - Optional persisted task records for repo field carry-forward
 * @returns Reconstructed AllocatedLane array with repo attribution preserved
 */
export function reconstructAllocatedLanes(
	persistedLanes: PersistedLaneRecord[],
	persistedTasks?: PersistedBatchState["tasks"],
): AllocatedLane[] {
	// Build task lookup for repo field carry-forward
	const taskLookup = new Map<string, PersistedBatchState["tasks"][0]>();
	if (persistedTasks) {
		for (const t of persistedTasks) {
			taskLookup.set(t.taskId, t);
		}
	}

	return persistedLanes.map((lr) => ({
		laneNumber: lr.laneNumber,
		laneId: lr.laneId,
		tmuxSessionName: lr.tmuxSessionName,
		worktreePath: lr.worktreePath,
		branch: lr.branch,
		tasks: lr.taskIds.map((taskId) => {
			const persistedTask = taskLookup.get(taskId);
			// Build a minimal ParsedTask stub that carries repo attribution
			// from the persisted record. This ensures serializeBatchState()
			// can emit repoId/resolvedRepoId for tasks not in discovery.
			const taskStub: Partial<ParsedTask> = {};
			if (persistedTask?.repoId !== undefined) {
				taskStub.promptRepoId = persistedTask.repoId;
			}
			if (persistedTask?.resolvedRepoId !== undefined) {
				taskStub.resolvedRepoId = persistedTask.resolvedRepoId;
			}
			if (persistedTask?.taskFolder) {
				taskStub.taskFolder = persistedTask.taskFolder;
			}
			return {
				taskId,
				order: 0,
				task: (Object.keys(taskStub).length > 0 ? taskStub : null) as unknown as ParsedTask,
				estimatedMinutes: 0,
			};
		}),
		strategy: "round-robin" as const,
		estimatedLoad: 0,
		estimatedMinutes: 0,
		...(lr.repoId !== undefined ? { repoId: lr.repoId } : {}),
	}));
}

/**
 * Collect unique repo roots from a combination of sources.
 *
 * Unlike `collectRepoRoots()` which only reads from persistedState.lanes,
 * this variant merges repo roots from multiple lane sources. This is
 * important during resumed execution where new waves may allocate lanes
 * in repos not present in the original persisted state.
 *
 * @param laneSources   - Array of lane arrays to collect repo roots from
 * @param defaultRepoRoot - Default/main repo root (cwd)
 * @param workspaceConfig - Workspace configuration (null in repo mode)
 * @returns Array of unique absolute repo root paths
 */
export function collectAllRepoRoots(
	laneSources: Array<{ repoId?: string }[]>,
	defaultRepoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): string[] {
	const roots = new Set<string>();

	for (const lanes of laneSources) {
		for (const lane of lanes) {
			const root = resolveRepoRoot(lane.repoId, defaultRepoRoot, workspaceConfig);
			roots.add(root);
		}
	}

	// Always include the default repo root (covers repo mode and any
	// lanes without repoId)
	roots.add(defaultRepoRoot);

	return [...roots];
}

// ── Resume Pure Functions ────────────────────────────────────────────

/**
 * Check whether a persisted batch state is eligible for resume.
 *
 * Resume eligibility matrix:
 * | Phase     | Eligible? | Reason                                    |
 * |-----------|-----------|-------------------------------------------|
 * | paused    | ✅        | Batch was paused (user/merge-failure)      |
 * | executing | ✅        | Batch was executing when orchestrator died |
 * | merging   | ✅        | Batch was merging when orchestrator died   |
 * | stopped   | ❌        | Batch was stopped by policy                |
 * | failed    | ❌        | Batch has terminal failure                 |
 * | completed | ❌        | Batch already completed                   |
 * | idle      | ❌        | Batch never started execution              |
 * | planning  | ❌        | Batch was still planning                   |
 *
 * Pure function — no process or filesystem access.
 */
export function checkResumeEligibility(state: PersistedBatchState): ResumeEligibility {
	const { phase, batchId } = state;

	switch (phase) {
		case "paused":
			return {
				eligible: true,
				reason: `Batch ${batchId} is paused and can be resumed.`,
				phase,
				batchId,
			};

		case "executing":
			return {
				eligible: true,
				reason: `Batch ${batchId} was executing when the orchestrator disconnected. Can be resumed.`,
				phase,
				batchId,
			};

		case "merging":
			return {
				eligible: true,
				reason: `Batch ${batchId} was merging when the orchestrator disconnected. Can be resumed.`,
				phase,
				batchId,
			};

		case "stopped":
			return {
				eligible: false,
				reason: `Batch ${batchId} was stopped by failure policy. Use /orch-abort to clean up, then start a new batch.`,
				phase,
				batchId,
			};

		case "failed":
			return {
				eligible: false,
				reason: `Batch ${batchId} has a terminal failure. Use /orch-abort to clean up, then start a new batch.`,
				phase,
				batchId,
			};

		case "completed":
			return {
				eligible: false,
				reason: `Batch ${batchId} already completed. Delete the state file or start a new batch.`,
				phase,
				batchId,
			};

		case "idle":
			return {
				eligible: false,
				reason: `Batch ${batchId} never started execution. Start a new batch with /orch.`,
				phase,
				batchId,
			};

		case "planning":
			return {
				eligible: false,
				reason: `Batch ${batchId} was still in planning phase. Start a new batch with /orch.`,
				phase,
				batchId,
			};

		default:
			return {
				eligible: false,
				reason: `Batch ${batchId} has unknown phase "${phase}". Delete the state file and start a new batch.`,
				phase,
				batchId,
			};
	}
}

/**
 * Reconcile persisted task states against live signals.
 *
 * For each task in the persisted state, determines the correct action
 * based on the current state of TMUX sessions and .DONE files.
 *
 * Precedence rules (applied per-task):
 * 1. .DONE file found → "mark-complete" (even if session is alive — task is done)
 * 2. Session alive + no .DONE → "reconnect" (task is still running)
 * 3. Persisted status is terminal (succeeded/failed/stalled/skipped) → "skip"
 *    (already resolved in the original run, no action needed)
 * 4. Session dead + no .DONE + was pending/running → "mark-failed"
 *    (task was interrupted and did not complete)
 *
 * Pure function — no process or filesystem access.
 *
 * @param persistedState  - Loaded and validated batch state
 * @param aliveSessions   - Set of TMUX session names currently alive
 * @param doneTaskIds     - Set of task IDs whose .DONE files exist
 * @returns Array of reconciled task states in persisted order
 */
export function reconcileTaskStates(
	persistedState: PersistedBatchState,
	aliveSessions: ReadonlySet<string>,
	doneTaskIds: ReadonlySet<string>,
	existingWorktrees: ReadonlySet<string> = new Set(),
): ReconciledTaskState[] {
	return persistedState.tasks.map((task) => {
		const sessionAlive = aliveSessions.has(task.sessionName);
		const doneFileFound = doneTaskIds.has(task.taskId);
		const worktreeExists = existingWorktrees.has(task.taskId);

		// Precedence 1: .DONE file found → task completed
		if (doneFileFound) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "succeeded" as LaneTaskStatus,
				sessionAlive,
				doneFileFound: true,
				worktreeExists,
				action: "mark-complete" as const,
			};
		}

		// Precedence 2: Session alive → reconnect
		if (sessionAlive) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "running" as LaneTaskStatus,
				sessionAlive: true,
				doneFileFound: false,
				worktreeExists,
				action: "reconnect" as const,
			};
		}

		// Precedence 3: Already terminal in persisted state → skip
		const terminalStatuses: LaneTaskStatus[] = ["succeeded", "failed", "stalled", "skipped"];
		if (terminalStatuses.includes(task.status)) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: task.status,
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists,
				action: "skip" as const,
			};
		}

		// Precedence 4: Session dead + no .DONE + worktree exists → re-execute
		if (worktreeExists) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "pending" as LaneTaskStatus,
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists: true,
				action: "re-execute" as const,
			};
		}

		// Precedence 5: Never-started task (pending + no session assigned) → remain pending
		// These are future-wave tasks that were never allocated to a lane.
		// They should be re-queued for execution, not failed.
		if (task.status === "pending" && !task.sessionName) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "pending" as LaneTaskStatus,
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists: false,
				action: "pending" as const,
			};
		}

		// Precedence 6: Dead session + not terminal + no .DONE + no worktree → failed
		// (Task was allocated and started but crashed without completing)
		return {
			taskId: task.taskId,
			persistedStatus: task.status,
			liveStatus: "failed" as LaneTaskStatus,
			sessionAlive: false,
			doneFileFound: false,
			worktreeExists: false,
			action: "mark-failed" as const,
		};
	});
}

/**
 * Compute the resume point from reconciled task states and wave plan.
 *
 * Determines which wave to resume from by finding the first wave that
 * has any incomplete tasks. Skips fully completed waves.
 *
 * Pure function — no process or filesystem access.
 *
 * @param persistedState    - Loaded and validated batch state
 * @param reconciledTasks   - Reconciled task states
 * @returns Resume point with wave index and categorized task IDs
 */
export function computeResumePoint(
	persistedState: PersistedBatchState,
	reconciledTasks: ReconciledTaskState[],
): ResumePoint {
	// Build lookup: taskId → reconciled state
	const reconciledMap = new Map<string, ReconciledTaskState>();
	for (const task of reconciledTasks) {
		reconciledMap.set(task.taskId, task);
	}

	// Categorize tasks
	const completedTaskIds: string[] = [];
	const pendingTaskIds: string[] = [];
	const failedTaskIds: string[] = [];
	const reconnectTaskIds: string[] = [];
	const reExecuteTaskIds: string[] = [];

	for (const task of reconciledTasks) {
		switch (task.action) {
			case "mark-complete":
				completedTaskIds.push(task.taskId);
				break;
			case "skip":
				if (task.liveStatus === "succeeded" || task.persistedStatus === "succeeded") {
					completedTaskIds.push(task.taskId);
				} else if (task.liveStatus === "failed" || task.liveStatus === "stalled" || task.persistedStatus === "failed" || task.persistedStatus === "stalled") {
					failedTaskIds.push(task.taskId);
				}
				// persistedStatus === "skipped" → terminal but neither completed nor failed.
				// Not re-queued. Counted separately via batchState.skippedTasks (carried from persisted state).
				break;
			case "reconnect":
				reconnectTaskIds.push(task.taskId);
				break;
			case "re-execute":
				reExecuteTaskIds.push(task.taskId);
				break;
			case "mark-failed":
				failedTaskIds.push(task.taskId);
				break;
			case "pending":
				// Never-started tasks remain pending for execution — not failed.
				// These are future-wave tasks that were never allocated to a lane.
				pendingTaskIds.push(task.taskId);
				break;
		}
	}

	// Find resume wave: first wave with any non-completed tasks
	let resumeWaveIndex = persistedState.wavePlan.length; // default: past end = all done

	for (let i = 0; i < persistedState.wavePlan.length; i++) {
		const waveTasks = persistedState.wavePlan[i];
		const allDone = waveTasks.every((taskId) => {
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) return false;
			// A task is "done" for wave-skip purposes if it's terminal:
			// mark-complete, mark-failed, or skip with any terminal status
			// (succeeded, failed, stalled, skipped)
			if (reconciled.action === "mark-complete" || reconciled.action === "mark-failed") {
				return true;
			}
			if (reconciled.action === "skip") {
				const s = reconciled.liveStatus ?? reconciled.persistedStatus;
				return s === "succeeded" || s === "failed" || s === "stalled" || s === "skipped";
			}
			return false;
		});

		if (!allDone) {
			resumeWaveIndex = i;
			break;
		}
	}

	// Determine pending tasks: tasks in resume wave and later that need execution
	const actualPendingTaskIds: string[] = [];
	for (let i = resumeWaveIndex; i < persistedState.wavePlan.length; i++) {
		for (const taskId of persistedState.wavePlan[i]) {
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) {
				actualPendingTaskIds.push(taskId); // Unknown task — treat as pending
				continue;
			}
			if (reconciled.action === "reconnect") {
				// Tasks with alive sessions need reconnection and remain pending.
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "re-execute") {
				// Tasks with existing worktrees need re-execution and remain pending.
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "skip" && reconciled.persistedStatus === "pending") {
				// Skipped tasks that were pending need execution
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "pending") {
				// Never-started tasks from future waves need execution
				actualPendingTaskIds.push(taskId);
			}
		}
	}

	return {
		resumeWaveIndex,
		completedTaskIds,
		pendingTaskIds: actualPendingTaskIds,
		failedTaskIds,
		reconnectTaskIds,
		reExecuteTaskIds,
	};
}


export async function resumeOrchBatch(
	orchConfig: OrchestratorConfig,
	runnerConfig: TaskRunnerConfig,
	cwd: string,
	batchState: OrchBatchRuntimeState,
	onNotify: (message: string, level: "info" | "warning" | "error") => void,
	onMonitorUpdate?: MonitorUpdateCallback,
	workspaceConfig?: WorkspaceConfig | null,
	workspaceRoot?: string,
	agentRoot?: string,
): Promise<void> {
	const repoRoot = cwd;
	// State files (.pi/batch-state.json, lane-state, etc.) belong in the workspace root,
	// which is where .pi/ config lives. In repo mode, stateRoot === repoRoot.
	const stateRoot = workspaceRoot ?? cwd;
	const prefix = orchConfig.orchestrator.tmux_prefix;

	// ── 1. Load persisted state ──────────────────────────────────
	let persistedState: PersistedBatchState | null;
	try {
		persistedState = loadBatchState(stateRoot);
	} catch (err: unknown) {
		if (err instanceof StateFileError) {
			onNotify(
				`❌ Cannot resume: ${err.message}`,
				"error",
			);
			return;
		}
		throw err;
	}

	if (!persistedState) {
		onNotify(
			ORCH_MESSAGES.resumeNoState(),
			"error",
		);
		return;
	}

	// ── 2. Check eligibility ─────────────────────────────────────
	const eligibility = checkResumeEligibility(persistedState);
	if (!eligibility.eligible) {
		onNotify(
			ORCH_MESSAGES.resumePhaseNotResumable(persistedState.batchId, persistedState.phase, eligibility.reason),
			"error",
		);
		return;
	}

	onNotify(
		ORCH_MESSAGES.resumeStarting(persistedState.batchId, persistedState.phase),
		"info",
	);

	// ── 3. Discover live signals ─────────────────────────────────
	// Check TMUX sessions
	const aliveSessions = new Set<string>();
	for (const task of persistedState.tasks) {
		if (task.sessionName && tmuxHasSession(task.sessionName)) {
			aliveSessions.add(task.sessionName);
		}
	}

	// Check .DONE files
	const doneTaskIds = new Set<string>();
	for (const task of persistedState.tasks) {
		if (task.taskFolder && hasTaskDoneMarker(task.taskFolder)) {
			doneTaskIds.add(task.taskId);
		}
	}

	// ── 3b. Detect existing worktrees ────────────────────────────
	const existingWorktreeTaskIds = new Set<string>();
	for (const task of persistedState.tasks) {
		const laneRecord = persistedState.lanes.find(l => l.taskIds.includes(task.taskId));
		if (laneRecord && laneRecord.worktreePath && existsSync(laneRecord.worktreePath)) {
			existingWorktreeTaskIds.add(task.taskId);
		}
	}

	// ── 4. Reconcile task states ─────────────────────────────────
	const reconciledTasks = reconcileTaskStates(persistedState, aliveSessions, doneTaskIds, existingWorktreeTaskIds);

	// ── 5. Compute resume point ──────────────────────────────────
	const resumePoint = computeResumePoint(persistedState, reconciledTasks);
	const completedTaskSet = new Set(resumePoint.completedTaskIds);
	const failedTaskSet = new Set(resumePoint.failedTaskIds);
	const reconnectTaskSet = new Set(resumePoint.reconnectTaskIds);
	const reExecuteTaskSet = new Set(resumePoint.reExecuteTaskIds);

	onNotify(
		ORCH_MESSAGES.resumeReconciled(
			persistedState.batchId,
			resumePoint.completedTaskIds.length,
			resumePoint.pendingTaskIds.length,
			resumePoint.failedTaskIds.length,
			resumePoint.reconnectTaskIds.length,
			resumePoint.reExecuteTaskIds.length,
		),
		"info",
	);

	if (resumePoint.reconnectTaskIds.length > 0) {
		onNotify(
			ORCH_MESSAGES.resumeReconnecting(resumePoint.reconnectTaskIds.length),
			"info",
		);
	}

	if (resumePoint.resumeWaveIndex > 0) {
		onNotify(
			ORCH_MESSAGES.resumeSkippedWaves(resumePoint.resumeWaveIndex),
			"info",
		);
	}

	// ── 6. Reconstruct runtime state ─────────────────────────────
	batchState.phase = "executing";
	batchState.batchId = persistedState.batchId;
	batchState.baseBranch = persistedState.baseBranch || "";
	batchState.mode = persistedState.mode;
	batchState.startedAt = persistedState.startedAt;
	batchState.pauseSignal = { paused: false };
	batchState.totalWaves = persistedState.totalWaves;
	batchState.totalTasks = persistedState.totalTasks;
	batchState.succeededTasks = resumePoint.completedTaskIds.length;
	batchState.failedTasks = resumePoint.failedTaskIds.length;
	batchState.skippedTasks = persistedState.skippedTasks;
	batchState.blockedTasks = persistedState.blockedTasks;
	batchState.blockedTaskIds = new Set(persistedState.blockedTaskIds);
	// Track persisted blocked IDs separately to avoid double-counting in wave loop.
	// Engine.ts counts blocked tasks per-wave when a wave is entered. If the prior
	// run paused before reaching a wave, tasks blocked for that wave are in
	// `blockedTaskIds` but NOT yet counted in `blockedTasks`. On resume, the
	// per-wave counting loop excludes `persistedBlockedTaskIds`, so those tasks
	// would never be counted. Fix: count persisted blocked tasks in future waves
	// (waves >= resumeWaveIndex) that were not yet counted.
	const persistedBlockedTaskIds = new Set(persistedState.blockedTaskIds);

	// Count persisted-blocked tasks in unvisited waves (wave >= resumeWaveIndex).
	// These were added to blockedTaskIds in the prior run but their wave was never
	// entered, so they were never counted in blockedTasks.
	if (persistedBlockedTaskIds.size > 0) {
		let uncountedBlocked = 0;
		for (let wi = resumePoint.resumeWaveIndex; wi < persistedState.wavePlan.length; wi++) {
			for (const taskId of persistedState.wavePlan[wi]) {
				if (persistedBlockedTaskIds.has(taskId)) {
					uncountedBlocked++;
				}
			}
		}
		if (uncountedBlocked > 0) {
			batchState.blockedTasks += uncountedBlocked;
			execLog("resume", persistedState.batchId, `blocked counter fix: ${uncountedBlocked} persisted-blocked task(s) in unvisited waves added to blockedTasks`);
		}
	}

	batchState.errors = [...persistedState.errors];
	batchState.endedAt = null;
	batchState.currentWaveIndex = resumePoint.resumeWaveIndex;
	batchState.waveResults = [];

	// ── 7. Re-run discovery for ParsedTask metadata ──────────────
	// We need fresh ParsedTask data (taskFolder, promptPath) for execution.
	// Use "all" to discover all areas.
	const discovery = runDiscovery("all", runnerConfig.task_areas, cwd, {
		refreshDependencies: false,
		dependencySource: orchConfig.dependencies.source,
		useDependencyCache: orchConfig.dependencies.cache,
		workspaceConfig: workspaceConfig ?? null,
	});

	// Build dependency graph for skip-dependents policy
	const depGraph = buildDependencyGraph(discovery.pending, discovery.completed);
	batchState.dependencyGraph = depGraph;

	// ── 8. Handle alive sessions (reconnect) ─────────────────────
	// For tasks with alive sessions, we need to wait for them to complete.
	// We poll each alive session's .DONE file.
	const reconnectTasks = reconciledTasks.filter(t => t.action === "reconnect");
	const reconnectFinalStatus = new Map<string, LaneTaskStatus>();

	if (reconnectTasks.length > 0) {
		// Wait for reconnected tasks to complete (poll .DONE files)
		for (const task of reconnectTasks) {
			const parsedTask = discovery.pending.get(task.taskId);
			if (!parsedTask) continue;

			// Find the lane info from persisted state
			const laneRecord = persistedState.lanes.find(
				l => l.taskIds.includes(task.taskId),
			);
			if (!laneRecord) continue;

			// Build a minimal AllocatedLane for polling
			const allocatedTask: AllocatedTask = {
				taskId: task.taskId,
				order: 0,
				task: parsedTask,
				estimatedMinutes: 0,
			};
			const lane: AllocatedLane = {
				laneNumber: laneRecord.laneNumber,
				laneId: laneRecord.laneId,
				tmuxSessionName: laneRecord.tmuxSessionName,
				worktreePath: laneRecord.worktreePath,
				branch: laneRecord.branch,
				tasks: [allocatedTask],
				strategy: "round-robin",
				estimatedLoad: 0,
				estimatedMinutes: 0,
				...(laneRecord.repoId !== undefined ? { repoId: laneRecord.repoId } : {}),
			};

			// Resolve per-lane repo root for workspace mode (v1/repo mode: falls back to repoRoot)
			const laneRepoRoot = resolveRepoRoot(laneRecord.repoId, repoRoot, workspaceConfig);

			execLog("resume", task.taskId, "reconnecting to alive session", {
				session: laneRecord.tmuxSessionName,
				repoId: laneRecord.repoId ?? "(default)",
			});

			// Poll until task completes
			try {
				const pollResult = await pollUntilTaskComplete(
					lane,
					allocatedTask,
					orchConfig,
					laneRepoRoot,
					batchState.pauseSignal,
				);

				if (pollResult.status === "succeeded") {
					reconnectFinalStatus.set(task.taskId, "succeeded");
					completedTaskSet.add(task.taskId);
					failedTaskSet.delete(task.taskId);
					reconnectTaskSet.delete(task.taskId);
					batchState.succeededTasks++;
					execLog("resume", task.taskId, "reconnected task succeeded");
				} else {
					reconnectFinalStatus.set(task.taskId, "failed");
					failedTaskSet.add(task.taskId);
					completedTaskSet.delete(task.taskId);
					reconnectTaskSet.delete(task.taskId);
					batchState.failedTasks++;
					execLog("resume", task.taskId, `reconnected task ${pollResult.status}: ${pollResult.exitReason}`);
				}
			} catch (err: unknown) {
				reconnectFinalStatus.set(task.taskId, "failed");
				failedTaskSet.add(task.taskId);
				completedTaskSet.delete(task.taskId);
				reconnectTaskSet.delete(task.taskId);
				batchState.failedTasks++;
				const msg = err instanceof Error ? err.message : String(err);
				execLog("resume", task.taskId, `reconnection error: ${msg}`);
			}
		}
	}

	// ── 8b. Handle re-execute tasks (dead session + existing worktree) ──
	const reExecuteTasks = reconciledTasks.filter(t => t.action === "re-execute");
	const reExecuteFinalStatus = new Map<string, LaneTaskStatus>();
	const reExecAllocatedLanes: AllocatedLane[] = [];

	if (reExecuteTasks.length > 0) {
		onNotify(
			`🔄 Re-executing ${reExecuteTasks.length} interrupted task(s) in existing worktrees...`,
			"info",
		);

		for (const task of reExecuteTasks) {
			const parsedTask = discovery.pending.get(task.taskId);
			if (!parsedTask) continue;

			const laneRecord = persistedState.lanes.find(
				l => l.taskIds.includes(task.taskId),
			);
			if (!laneRecord) continue;

			const allocatedTask: AllocatedTask = {
				taskId: task.taskId,
				order: 0,
				task: parsedTask,
				estimatedMinutes: 0,
			};
			const lane: AllocatedLane = {
				laneNumber: laneRecord.laneNumber,
				laneId: laneRecord.laneId,
				tmuxSessionName: laneRecord.tmuxSessionName,
				worktreePath: laneRecord.worktreePath,
				branch: laneRecord.branch,
				tasks: [allocatedTask],
				strategy: "round-robin",
				estimatedLoad: 0,
				estimatedMinutes: 0,
				...(laneRecord.repoId !== undefined ? { repoId: laneRecord.repoId } : {}),
			};

			// Resolve per-lane repo root for workspace mode (v1/repo mode: falls back to repoRoot)
			const reExecRepoRoot = resolveRepoRoot(laneRecord.repoId, repoRoot, workspaceConfig);

			execLog("resume", task.taskId, "re-executing interrupted task in existing worktree", {
				session: laneRecord.tmuxSessionName,
				worktree: laneRecord.worktreePath,
				repoId: laneRecord.repoId ?? "(default)",
			});

			try {
				spawnLaneSession(lane, allocatedTask, orchConfig, reExecRepoRoot);
				const pollResult = await pollUntilTaskComplete(
					lane,
					allocatedTask,
					orchConfig,
					reExecRepoRoot,
					batchState.pauseSignal,
				);

				if (pollResult.status === "succeeded") {
					reExecuteFinalStatus.set(task.taskId, "succeeded");
					completedTaskSet.add(task.taskId);
					failedTaskSet.delete(task.taskId);
					reExecuteTaskSet.delete(task.taskId);
					batchState.succeededTasks++;
					reExecAllocatedLanes.push(lane);
					execLog("resume", task.taskId, "re-executed task succeeded");
				} else {
					reExecuteFinalStatus.set(task.taskId, "failed");
					failedTaskSet.add(task.taskId);
					completedTaskSet.delete(task.taskId);
					reExecuteTaskSet.delete(task.taskId);
					batchState.failedTasks++;
					execLog("resume", task.taskId, `re-executed task ${pollResult.status}: ${pollResult.exitReason}`);
				}
			} catch (err: unknown) {
				reExecuteFinalStatus.set(task.taskId, "failed");
				failedTaskSet.add(task.taskId);
				completedTaskSet.delete(task.taskId);
				reExecuteTaskSet.delete(task.taskId);
				batchState.failedTasks++;
				const msg = err instanceof Error ? err.message : String(err);
				execLog("resume", task.taskId, `re-execution error: ${msg}`);
			}
		}
	}

	// ── 8c. Merge re-executed lane branches before cleanup ───────
	// Re-executed tasks completed outside the normal wave loop, so their
	// branches would not be merged by step 10. Merge them now.
	if (reExecAllocatedLanes.length > 0) {
		const succeededReExecTaskIds = [...reExecuteFinalStatus.entries()]
			.filter(([_, status]) => status === "succeeded")
			.map(([taskId]) => taskId);

		if (succeededReExecTaskIds.length > 0) {
			onNotify(
				`🔀 Merging ${reExecAllocatedLanes.length} re-executed lane branch(es)...`,
				"info",
			);

			// Build synthetic WaveExecutionResult for mergeWaveByRepo()
			const syntheticLaneResults: LaneExecutionResult[] = reExecAllocatedLanes.map(lane => ({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				tasks: lane.tasks.map(t => ({
					taskId: t.taskId,
					status: "succeeded" as LaneTaskStatus,
					startTime: Date.now(),
					endTime: Date.now(),
					exitReason: "Re-executed task completed successfully",
					sessionName: lane.tmuxSessionName,
					doneFileFound: true,
				})),
				overallStatus: "succeeded" as const,
				startTime: Date.now(),
				endTime: Date.now(),
			}));

			// Use waveIndex -1 as a sentinel for "pre-wave-loop re-exec merge".
			// mergeWaveByRepo expects 1-indexed waveIndex; persistence normalizes
			// to 0-based via `mr.waveIndex - 1`. By passing -1 here:
			//   - mergeWaveByRepo logs it as "W-1" (harmless)
			//   - persistence normalizes to `Math.max(0, -1 - 1)` = 0 (valid)
			//   - semantically distinguishes re-exec merges from wave 1 merges
			const RE_EXEC_WAVE_INDEX = -1;

			const syntheticWaveResult: WaveExecutionResult = {
				waveIndex: RE_EXEC_WAVE_INDEX,
				startedAt: Date.now(),
				endedAt: Date.now(),
				laneResults: syntheticLaneResults,
				policyApplied: orchConfig.failure.on_task_failure,
				stoppedEarly: false,
				failedTaskIds: [],
				skippedTaskIds: [],
				succeededTaskIds: succeededReExecTaskIds,
				blockedTaskIds: [],
				laneCount: reExecAllocatedLanes.length,
				overallStatus: "succeeded",
				finalMonitorState: null,
				allocatedLanes: reExecAllocatedLanes,
			};

			const reExecMergeResult = mergeWaveByRepo(
				reExecAllocatedLanes,
				syntheticWaveResult,
				RE_EXEC_WAVE_INDEX,
				orchConfig,
				repoRoot,
				batchState.batchId,
				batchState.baseBranch,
				workspaceConfig,
				stateRoot,
				agentRoot,
			);

			if (reExecMergeResult.status === "succeeded") {
				onNotify(
					`✅ Re-executed branch merge complete: ${reExecMergeResult.laneResults.length} lane(s) merged`,
					"info",
				);

				// Clean up merged branches (resolve per-lane repo root for workspace mode)
				for (const lr of reExecMergeResult.laneResults) {
					if (lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED") {
						const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
						deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
					}
				}
			} else {
				onNotify(
					`⚠️ Re-executed branch merge ${reExecMergeResult.status}: ${reExecMergeResult.failureReason || "unknown"}`,
					"warning",
				);
			}

			batchState.mergeResults.push(reExecMergeResult);
		}
	}

	// ── 9. Persist state after reconciliation ────────────────────
	// Track state for persistence
	const wavePlan = persistedState.wavePlan;
	const allTaskOutcomes: LaneTaskOutcome[] = [];

	// Initialize latestAllocatedLanes from persisted lane records so that
	// early persistence calls (before the first resumed wave) retain lane
	// records with repo attribution (laneNumber, laneId, branch, repoId).
	// Without this, the `resume-reconciliation` checkpoint would serialize
	// empty lanes[], losing all lane context until a new wave allocates.
	let latestAllocatedLanes: AllocatedLane[] = reconstructAllocatedLanes(persistedState.lanes, persistedState.tasks);

	// Track all repo roots encountered during execution (persisted + newly allocated).
	// Used by inter-wave reset and terminal cleanup to cover repos introduced
	// after resume starts (not present in persisted lanes).
	// Initialized from collectRepoRoots() helper for parity with other callers.
	const encounteredRepoRoots = new Set(
		collectRepoRoots(persistedState, repoRoot, workspaceConfig),
	);

	// Build outcomes from reconciled tasks
	for (const task of reconciledTasks) {
		const persistedTask = persistedState.tasks.find(t => t.taskId === task.taskId);
		const reconnectStatus = reconnectFinalStatus.get(task.taskId);
		const reExecuteStatus = reExecuteFinalStatus.get(task.taskId);
		const status = task.action === "reconnect"
			? (reconnectStatus || "running")
			: task.action === "re-execute"
			? (reExecuteStatus || "pending")
			: task.liveStatus;
		const isTerminal = status === "succeeded" || status === "failed" || status === "stalled" || status === "skipped";
		allTaskOutcomes.push({
			taskId: task.taskId,
			status,
			startTime: persistedTask?.startedAt ?? null,
			endTime: isTerminal ? Date.now() : null,
			exitReason: task.action === "mark-complete" ? ".DONE file found on resume"
				: task.action === "mark-failed" ? "Session dead, no .DONE file, no worktree on resume"
				: task.action === "reconnect"
					? (status === "succeeded" ? "Reconnected task completed" : status === "failed" ? "Reconnected task failed" : "Reconnected to alive session")
				: task.action === "re-execute"
					? (status === "succeeded" ? "Re-executed task completed" : status === "failed" ? "Re-executed task failed" : "Re-executing in existing worktree")
				: persistedTask?.exitReason ?? "",
			sessionName: persistedTask?.sessionName ?? "",
			doneFileFound: status === "succeeded" ? true : task.doneFileFound,
		});
	}

	// ── 9b. Seed blocked dependents from reconciled failures ─────
	// Under skip-dependents policy, failures discovered during reconciliation
	// (mark-failed) or resolved during reconnect/re-execute must propagate
	// to their transitive dependents BEFORE the wave loop begins.
	if (orchConfig.failure.on_task_failure === "skip-dependents" && failedTaskSet.size > 0) {
		const reconciledBlocked = computeTransitiveDependents(failedTaskSet, depGraph);
		for (const taskId of reconciledBlocked) {
			batchState.blockedTaskIds.add(taskId);
		}
		if (reconciledBlocked.size > 0) {
			execLog("resume", batchState.batchId, `skip-dependents: ${reconciledBlocked.size} task(s) blocked from reconciled failures`, {
				blocked: [...reconciledBlocked].sort().join(","),
				sources: [...failedTaskSet].sort().join(","),
			});
		}
	}

	persistRuntimeState("resume-reconciliation", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery ?? null, stateRoot);

	// ── 10. Continue wave execution ──────────────────────────────
	// We need to execute remaining waves starting from resumeWaveIndex.
	// For waves where some tasks are already done, we filter them out.

	let preserveWorktreesForResume = false;

	for (let waveIdx = resumePoint.resumeWaveIndex; waveIdx < persistedState.wavePlan.length; waveIdx++) {
		// Check pause signal
		if (batchState.pauseSignal.paused) {
			batchState.phase = "paused";
			persistRuntimeState("pause-before-wave", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
			onNotify(`⏸️  Batch paused before wave ${waveIdx + 1}.`, "warning");
			break;
		}

		batchState.currentWaveIndex = waveIdx;
		persistRuntimeState("wave-index-change", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);

		// Get wave tasks, filtering out completed/failed/blocked ones.
		let waveTasks = persistedState.wavePlan[waveIdx].filter(
			taskId => !completedTaskSet.has(taskId) &&
				!failedTaskSet.has(taskId) &&
				!batchState.blockedTaskIds.has(taskId),
		);

		// Also filter tasks where discovery doesn't have them as pending
		waveTasks = waveTasks.filter(taskId => discovery.pending.has(taskId));

		// Count only newly blocked tasks (not already persisted) to avoid double-counting.
		// persistedState.blockedTaskIds were already counted in persistedState.blockedTasks
		// which initialized batchState.blockedTasks.
		const blockedInWave = persistedState.wavePlan[waveIdx].filter(
			taskId => batchState.blockedTaskIds.has(taskId) &&
				!persistedBlockedTaskIds.has(taskId),
		);
		if (blockedInWave.length > 0) {
			batchState.blockedTasks += blockedInWave.length;
		}

		if (waveTasks.length === 0) {
			execLog("resume", batchState.batchId, `wave ${waveIdx + 1}: no tasks to execute (all completed/blocked)`);
			continue;
		}

		onNotify(
			ORCH_MESSAGES.orchWaveStart(waveIdx + 1, persistedState.wavePlan.length, waveTasks.length, Math.min(waveTasks.length, orchConfig.orchestrator.max_lanes)),
			"info",
		);

		const handleResumeMonitorUpdate: MonitorUpdateCallback = (monitorState) => {
			const changed = syncTaskOutcomesFromMonitor(monitorState, allTaskOutcomes);
			if (changed) {
				persistRuntimeState("task-transition", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
			}
			onMonitorUpdate?.(monitorState);
		};

		// Execute the wave
		const waveResult = await executeWave(
			waveTasks,
			waveIdx + 1,
			discovery.pending,
			orchConfig,
			repoRoot,
			batchState.batchId,
			batchState.pauseSignal,
			depGraph,
			batchState.baseBranch,
			handleResumeMonitorUpdate,
			(lanes) => {
				latestAllocatedLanes = lanes;
				batchState.currentLanes = lanes;
				// Track repos from newly allocated lanes for cleanup coverage
				for (const lane of lanes) {
					encounteredRepoRoots.add(resolveRepoRoot(lane.repoId, repoRoot, workspaceConfig));
				}
				if (seedPendingOutcomesForAllocatedLanes(lanes, allTaskOutcomes)) {
					persistRuntimeState("wave-lanes-allocated", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
				}
			},
			workspaceConfig,
		);

		batchState.waveResults.push(waveResult);
		batchState.currentLanes = [];

		// Accumulate task outcomes
		latestAllocatedLanes = waveResult.allocatedLanes;
		for (const lr of waveResult.laneResults) {
			for (const taskOutcome of lr.tasks) {
				upsertTaskOutcome(allTaskOutcomes, taskOutcome);
			}
		}

		// Accumulate results
		batchState.succeededTasks += waveResult.succeededTaskIds.length;
		batchState.failedTasks += waveResult.failedTaskIds.length;
		batchState.skippedTasks += waveResult.skippedTaskIds.length;

		for (const taskId of waveResult.succeededTaskIds) {
			completedTaskSet.add(taskId);
			failedTaskSet.delete(taskId);
			reconnectTaskSet.delete(taskId);
		}
		for (const taskId of waveResult.failedTaskIds) {
			failedTaskSet.add(taskId);
			completedTaskSet.delete(taskId);
			reconnectTaskSet.delete(taskId);
		}

		for (const blocked of waveResult.blockedTaskIds) {
			batchState.blockedTaskIds.add(blocked);
		}

		persistRuntimeState("wave-execution-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);

		const elapsedSec = Math.round((waveResult.endedAt - waveResult.startedAt) / 1000);
		onNotify(
			ORCH_MESSAGES.orchWaveComplete(
				waveIdx + 1,
				waveResult.succeededTaskIds.length,
				waveResult.failedTaskIds.length,
				waveResult.skippedTaskIds.length,
				elapsedSec,
			),
			waveResult.failedTaskIds.length > 0 ? "warning" : "info",
		);

		// Check failure policy
		if (waveResult.stoppedEarly) {
			if (waveResult.policyApplied === "stop-all") {
				batchState.phase = "stopped";
				persistRuntimeState("stop-all", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-all"), "error");
				break;
			}
			if (waveResult.policyApplied === "stop-wave") {
				batchState.phase = "stopped";
				persistRuntimeState("stop-wave", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-wave"), "error");
				break;
			}
		}

		// Merge handling (same as executeOrchBatch)
		let mergeResult: MergeWaveResult | null = null;

		const laneOutcomeByNumber = new Map<number, LaneExecutionResult>();
		for (const lr of waveResult.laneResults) {
			laneOutcomeByNumber.set(lr.laneNumber, lr);
		}
		const mixedOutcomeLanes = waveResult.laneResults.filter(lr => {
			const hasSucceeded = lr.tasks.some(t => t.status === "succeeded");
			const hasHardFailure = lr.tasks.some(
				t => t.status === "failed" || t.status === "stalled",
			);
			return hasSucceeded && hasHardFailure;
		});

		if (waveResult.succeededTaskIds.length > 0) {
			const mergeableLaneCount = waveResult.allocatedLanes.filter(lane => {
				const outcome = laneOutcomeByNumber.get(lane.laneNumber);
				if (!outcome) return false;
				const hasSucceeded = outcome.tasks.some(t => t.status === "succeeded");
				const hasHardFailure = outcome.tasks.some(
					t => t.status === "failed" || t.status === "stalled",
				);
				return hasSucceeded && !hasHardFailure;
			}).length;

			if (mergeableLaneCount > 0) {
				batchState.phase = "merging";
				persistRuntimeState("merge-start", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
				onNotify(ORCH_MESSAGES.orchMergeStart(waveIdx + 1, mergeableLaneCount), "info");

				mergeResult = mergeWaveByRepo(
					waveResult.allocatedLanes,
					waveResult,
					waveIdx + 1,
					orchConfig,
					repoRoot,
					batchState.batchId,
					batchState.baseBranch,
					workspaceConfig,
					stateRoot,
					agentRoot,
				);
				batchState.mergeResults.push(mergeResult);

				// Emit per-lane merge notifications
				for (const lr of mergeResult.laneResults) {
					const durationSec = Math.round(lr.durationMs / 1000);
					if (lr.result?.status === "SUCCESS") {
						onNotify(ORCH_MESSAGES.orchMergeLaneSuccess(lr.laneNumber, lr.result.merge_commit, durationSec), "info");
					} else if (lr.result?.status === "CONFLICT_RESOLVED") {
						onNotify(ORCH_MESSAGES.orchMergeLaneConflictResolved(lr.laneNumber, lr.result.conflicts.length, durationSec), "info");
					} else if (lr.result?.status === "CONFLICT_UNRESOLVED" || lr.result?.status === "BUILD_FAILURE") {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.error || lr.result.status), "error");
					} else if (lr.error) {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.error), "error");
					}
				}

				if (mixedOutcomeLanes.length > 0) {
					const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
					const failureReason =
						`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
						`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`;
					mergeResult = { ...mergeResult, status: "partial", failedLane: mixedOutcomeLanes[0].laneNumber, failureReason };
				}

				const mergedCount = mergeResult.laneResults.filter(
					r => r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED",
				).length;
				const mergeTotalSec = Math.round(mergeResult.totalDurationMs / 1000);

				if (mergeResult.status === "succeeded") {
					onNotify(ORCH_MESSAGES.orchMergeComplete(waveIdx + 1, mergedCount, mergeTotalSec), "info");
				} else {
					onNotify(
						ORCH_MESSAGES.orchMergeFailed(waveIdx + 1, mergeResult.failedLane ?? 0, mergeResult.failureReason || "unknown"),
						"error",
					);

					// Emit repo-divergence summary when partial is caused by cross-repo outcome differences
					if (mergeResult.status === "partial") {
						const repoSummary = formatRepoMergeSummary(mergeResult);
						if (repoSummary) {
							onNotify(repoSummary, "warning");
						}
					}
				}

				batchState.phase = "executing";
				persistRuntimeState("merge-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
			} else if (mixedOutcomeLanes.length > 0) {
				const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
				mergeResult = {
					waveIndex: waveIdx + 1,
					status: "partial",
					laneResults: [],
					failedLane: mixedOutcomeLanes[0].laneNumber,
					failureReason:
						`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
						`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`,
					totalDurationMs: 0,
				};
				onNotify(
					ORCH_MESSAGES.orchMergeFailed(waveIdx + 1, mergeResult.failedLane, mergeResult.failureReason || "unknown"),
					"error",
				);
			} else {
				onNotify(ORCH_MESSAGES.orchMergeSkipped(waveIdx + 1), "info");
			}
		} else {
			onNotify(ORCH_MESSAGES.orchMergeSkipped(waveIdx + 1), "info");
		}

		// Handle merge failure — shared helper guarantees parity with engine.ts (TP-005 Step 2)
		if (mergeResult && (mergeResult.status === "failed" || mergeResult.status === "partial")) {
			const policyResult = computeMergeFailurePolicy(mergeResult, waveIdx, orchConfig);

			execLog("batch", batchState.batchId, `merge failure — applying ${policyResult.policy} policy`, policyResult.logDetails);

			batchState.phase = policyResult.targetPhase;
			batchState.errors.push(policyResult.errorMessage);
			persistRuntimeState(policyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);
			onNotify(policyResult.notifyMessage, policyResult.notifyLevel);
			preserveWorktreesForResume = true;
			break;
		}

		// Post-merge: reset worktrees for next wave
		if (mergeResult && mergeResult.status === "succeeded") {
			for (const lr of mergeResult.laneResults) {
				if (lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED") {
					const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
					const ancestorCheck = runGit(["merge-base", "--is-ancestor", lr.sourceBranch, lr.targetBranch], laneRepoRoot);
					if (ancestorCheck.ok) {
						deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
					}
				}
			}
		}

		if (waveIdx < persistedState.wavePlan.length - 1 && !batchState.pauseSignal.paused) {
			const wtPrefix = orchConfig.orchestrator.worktree_prefix;
			const resetOpId = resolveOperatorId(orchConfig);

			// Use encounteredRepoRoots which includes both persisted lanes
			// AND newly allocated lanes from resumed waves, ensuring repos
			// introduced after resume starts are covered.
			for (const perRepoRoot of encounteredRepoRoots) {
				const existingWorktrees = listWorktrees(wtPrefix, perRepoRoot, resetOpId);
				if (existingWorktrees.length > 0) {
					const targetBranch = batchState.baseBranch;
					for (const wt of existingWorktrees) {
						const resetResult = safeResetWorktree(wt, targetBranch, perRepoRoot);
						if (!resetResult.success) {
							try {
								removeWorktree(wt, perRepoRoot);
							} catch {
								forceCleanupWorktree(wt, perRepoRoot, batchState.batchId);
							}
						}
					}
				}
			}
		}
	}

	// ── 11. Cleanup and terminal state ───────────────────────────
	if (!preserveWorktreesForResume) {
		const wtPrefix = orchConfig.orchestrator.worktree_prefix;
		const cleanupOpId = resolveOperatorId(orchConfig);
		const targetBranch = batchState.baseBranch;

		// Use encounteredRepoRoots which includes both persisted lanes
		// AND newly allocated lanes from resumed waves, ensuring repos
		// introduced after resume starts are cleaned up.
		for (const perRepoRoot of encounteredRepoRoots) {
			removeAllWorktrees(wtPrefix, perRepoRoot, cleanupOpId, targetBranch);
		}
	}

	batchState.endedAt = Date.now();
	const totalElapsedSec = Math.round((batchState.endedAt - batchState.startedAt) / 1000);

	if ((batchState.phase as OrchBatchPhase) === "executing" || (batchState.phase as OrchBatchPhase) === "merging") {
		if (batchState.failedTasks > 0) {
			batchState.phase = "failed";
		} else {
			batchState.phase = "completed";
		}
	}

	persistRuntimeState("batch-terminal", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discovery, stateRoot);

	if (batchState.phase === "paused" || batchState.phase === "stopped") {
		execLog("resume", batchState.batchId, "resumed batch ended in non-terminal state", { phase: batchState.phase });
	} else {
		onNotify(
			ORCH_MESSAGES.resumeComplete(
				batchState.batchId,
				batchState.succeededTasks,
				batchState.failedTasks,
				batchState.skippedTasks,
				batchState.blockedTasks,
				totalElapsedSec,
			),
			batchState.failedTasks > 0 ? "warning" : "info",
		);

		if (batchState.phase === "completed") {
			try {
				deleteBatchState(stateRoot);
				execLog("state", batchState.batchId, "state file deleted on clean resume completion");
			} catch {
				// Best-effort
			}
		}
	}
}

