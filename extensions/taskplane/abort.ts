/**
 * Abort logic (graceful and hard)
 * @module orch/abort
 */
import { writeFileSync, existsSync } from "fs";
import { join } from "path";

import { execLog, killV2LaneAgents, resolveCanonicalTaskPaths } from "./execution.ts";
import { killMergeAgentV2, killAllMergeAgentsV2 } from "./merge.ts";
import { deleteBatchState, persistRuntimeState } from "./persistence.ts";
import type { AbortActionStep, AbortErrorCode, AbortLaneResult, AbortMode, AbortResult, AbortTargetSession, AllocatedLane, OrchBatchRuntimeState, PersistedBatchState, PersistedLaneRecord } from "./types.ts";

// ── Abort Pure Functions ─────────────────────────────────────────────

/**
 * Select and enrich target sessions for abort.
 *
 * Filters sessions to only `orch-lane-*` and `orch-merge-*` patterns,
 * then enriches with task folder and worktree info from persisted or
 * runtime state.
 *
 * Pure function: no side effects.
 *
 * @param allSessionNames  - All TMUX session names matching the prefix
 * @param persistedState   - Loaded persisted state (null if unavailable)
 * @param runtimeLanes     - Current in-memory lanes (from orchBatchState)
 * @param repoRoot         - Repository root path for task folder resolution
 * @returns Filtered and enriched target sessions
 */
export function selectAbortTargetSessions(
	allSessionNames: string[],
	persistedState: PersistedBatchState | null,
	runtimeLanes: AllocatedLane[],
	repoRoot: string,
	prefix: string = "orch",
): AbortTargetSession[] {
	// Filter to only lane and merge sessions for the exact orchestrator prefix.
	// Handles both repo-mode (`<prefix>-lane-<N>`) and workspace-mode
	// (`<prefix>-<repoId>-lane-<N>`) session name formats.
	const targetNames = allSessionNames.filter(name => {
		const prefixWithDash = `${prefix}-`;
		if (!name.startsWith(prefixWithDash)) return false;
		const suffix = name.slice(prefixWithDash.length);
		// Repo mode: suffix starts with "lane-" or "merge-"
		if (suffix.startsWith("lane-") || suffix.startsWith("merge-")) return true;
		// Workspace mode: suffix is "<repoId>-lane-<N>" — contains "-lane-"
		// Match any suffix that contains "-lane-" or "-merge-" followed by a number
		if (/\-lane-\d/.test(suffix) || /\-merge-\d/.test(suffix)) return true;
		return false;
	});

	// Build lookup from persisted lane records for workspace-aware laneId resolution.
	// Keyed by lane session ID for direct session-to-lane mapping.
	const persistedLaneLookup = new Map<string, PersistedLaneRecord>();
	if (persistedState?.lanes) {
		for (const lane of persistedState.lanes) {
			persistedLaneLookup.set(lane.laneSessionId, lane);
		}
	}

	// Build lookup from persisted state task records
	const persistedLookup = new Map<string, { laneId: string; taskId: string; taskFolder: string }>();
	if (persistedState) {
		for (const task of persistedState.tasks) {
			if (task.sessionName) {
				// Source laneId from persisted lane records (workspace-aware)
				// rather than reconstructing as `lane-${laneNumber}` which
				// drops the repo dimension in workspace mode.
				const laneRecord = persistedLaneLookup.get(task.sessionName);
				const laneId = laneRecord?.laneId ?? `lane-${task.laneNumber}`;
				persistedLookup.set(task.sessionName, {
					laneId,
					taskId: task.taskId,
					taskFolder: task.taskFolder,
				});
			}
		}
	}

	// Build lookup from runtime lanes
	const runtimeLookup = new Map<string, { laneId: string; taskId: string | null; worktreePath: string; taskFolder: string | null }>();
	for (const lane of runtimeLanes) {
		const currentTask = lane.tasks.length > 0 ? lane.tasks[0] : null;
		runtimeLookup.set(lane.laneSessionId, {
			laneId: lane.laneId,
			taskId: currentTask?.taskId || null,
			worktreePath: lane.worktreePath,
			// TP-169: Guard against null task stubs from reconstructAllocatedLanes
			taskFolder: currentTask?.task?.taskFolder || null,
		});
	}

	return targetNames.map(sessionName => {
		const runtime = runtimeLookup.get(sessionName);
		const persisted = persistedLookup.get(sessionName);

		const laneId = runtime?.laneId || persisted?.laneId || "unknown";
		const taskId = runtime?.taskId || persisted?.taskId || null;
		const worktreePath = runtime?.worktreePath || null;
		const taskFolder = runtime?.taskFolder || persisted?.taskFolder || null;

		// Resolve task folder path using the canonical resolver.
		// For repo-contained tasks: translates to worktree-relative path.
		// For external tasks: uses the absolute canonical path directly.
		let taskFolderInWorktree: string | null = null;
		if (taskFolder && worktreePath && repoRoot) {
			const resolved = resolveCanonicalTaskPaths(taskFolder, worktreePath, repoRoot);
			taskFolderInWorktree = resolved.taskFolderResolved;
		}

		return {
			sessionName,
			laneId,
			taskId,
			taskFolderInWorktree,
			worktreePath,
		};
	});
}

/**
 * Plan the ordered list of abort actions based on mode.
 *
 * Pure function: no side effects.
 *
 * @param mode             - Abort mode (graceful or hard)
 * @param gracePeriodMs    - Grace period in ms (graceful only, default 60000)
 * @param pollIntervalMs   - Poll interval in ms (graceful only, default 2000)
 * @returns Ordered list of abort action steps
 */
export function planAbortActions(
	mode: AbortMode,
	gracePeriodMs: number = 60_000,
	pollIntervalMs: number = 2_000,
): AbortActionStep[] {
	if (mode === "hard") {
		return [{ type: "kill-all" }];
	}
	return [
		{ type: "write-wrapup" },
		{ type: "poll-wait", gracePeriodMs, pollIntervalMs },
		{ type: "kill-remaining" },
	];
}

/**
 * Discover abort target session names from Runtime V2 state sources.
 *
 * Sources (deduped):
 * - in-memory runtime lanes (`batchState.currentLanes`)
 * - persisted lane records (`persistedState.lanes`)
 * - persisted task records (`persistedState.tasks[].sessionName`)
 */
export function discoverAbortSessionNames(
	prefix: string,
	persistedState: PersistedBatchState | null,
	runtimeLanes: AllocatedLane[],
): string[] {
	const names = new Set<string>();
	const prefixWithDash = `${prefix}-`;
	const add = (name: string | null | undefined) => {
		if (!name) return;
		const trimmed = name.trim();
		if (!trimmed || !trimmed.startsWith(prefixWithDash)) return;
		names.add(trimmed);
	};

	for (const lane of runtimeLanes) {
		add(lane.laneSessionId);
	}

	if (persistedState?.lanes) {
		for (const lane of persistedState.lanes) {
			add(lane.laneSessionId);
		}
	}

	if (persistedState?.tasks) {
		for (const task of persistedState.tasks) {
			add(task.sessionName);
		}
	}

	return [...names];
}


// ── Abort Orchestration Functions ────────────────────────────────────

/**
 * Write wrap-up signal files to each lane's task folder.
 *
 * Writes `.task-wrap-up` signal file to each lane's task folder.
 * Continues on partial failure — aggregates errors per lane.
 *
 * @param targets   - Target sessions with resolved task folders
 * @returns Updated target results with wrapUpWritten/wrapUpError
 */
export function writeWrapUpFiles(
	targets: AbortTargetSession[],
): Array<{ sessionName: string; written: boolean; error: string | null }> {
	const timestamp = new Date().toISOString();
	const content = `Abort requested at ${timestamp}`;
	const results: Array<{ sessionName: string; written: boolean; error: string | null }> = [];

	for (const target of targets) {
		if (!target.taskFolderInWorktree) {
			// Skip child sessions (workers, reviewers) — only main lane sessions have task folders
			// Also skip merge sessions (no task folder)
			if (target.sessionName.endsWith("-worker") || target.sessionName.endsWith("-reviewer") || target.sessionName.includes("merge")) {
				results.push({ sessionName: target.sessionName, written: false, error: null });
			} else {
				results.push({ sessionName: target.sessionName, written: false, error: "No task folder resolved" });
			}
			continue;
		}

		try {
			const primaryPath = join(target.taskFolderInWorktree, ".task-wrap-up");

			// Ensure directory exists
			if (!existsSync(target.taskFolderInWorktree)) {
				results.push({ sessionName: target.sessionName, written: false, error: `Task folder does not exist: ${target.taskFolderInWorktree}` });
				continue;
			}

			writeFileSync(primaryPath, content, "utf-8");
			results.push({ sessionName: target.sessionName, written: true, error: null });
		} catch (err) {
			results.push({
				sessionName: target.sessionName,
				written: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return results;
}

/**
 * Wait for graceful shutdown window to elapse.
 *
 * Runtime V2 no longer relies on TMUX session liveness as an abort signal.
 * We keep this grace window so workers can observe `.task-wrap-up` and exit
 * naturally before forced cleanup.
 *
 * @param sessionNames     - Session names being tracked for abort
 * @param gracePeriodMs    - Maximum time to wait
 * @param pollIntervalMs   - Polling cadence for the grace wait loop
 * @returns Object with exited and remaining session names
 */
export async function waitForSessionExit(
	sessionNames: string[],
	gracePeriodMs: number,
	pollIntervalMs: number,
): Promise<{ exited: string[]; remaining: string[] }> {
	if (sessionNames.length === 0 || gracePeriodMs <= 0) {
		return { exited: [], remaining: [...sessionNames] };
	}

	const deadline = Date.now() + gracePeriodMs;
	while (Date.now() < deadline) {
		const sleepMs = Math.max(1, Math.min(pollIntervalMs, deadline - Date.now()));
		await new Promise(r => setTimeout(r, sleepMs));
	}

	return { exited: [], remaining: [...sessionNames] };
}

/**
 * Kill orchestrator Runtime V2 agents.
 *
 * Kills lane worker/reviewer agents and merge agents by process handle.
 * Session names are normalized to base lane/merge IDs so child suffixes do
 * not trigger duplicate cleanup attempts.
 *
 * @param sessionNames - Session names to kill
 * @returns Per-session kill results
 */
export function killOrchSessions(
	sessionNames: string[],
	options?: { stateRoot?: string; batchId?: string },
): Array<{ sessionName: string; killed: boolean; error: string | null }> {
	const results: Array<{ sessionName: string; killed: boolean; error: string | null }> = [];
	const killedBaseSessions = new Set<string>();

	for (const name of sessionNames) {
		const baseSessionName = name.replace(/-(worker|reviewer)$/, "");
		if (!killedBaseSessions.has(baseSessionName)) {
			killV2LaneAgents(baseSessionName, {
				stateRoot: options?.stateRoot,
				batchId: options?.batchId,
				logContext: "abort",
			});
			killMergeAgentV2(baseSessionName);
			killedBaseSessions.add(baseSessionName);
		}

		results.push({
			sessionName: name,
			killed: true,
			error: null,
		});
	}

	return results;
}

/**
 * Execute a full abort operation.
 *
 * Phase/state transition ordering:
 * 1. Set phase to "stopped"
 * 2. Persist runtime state (so state file reflects stopped phase)
 * 3. Select target sessions
 * 4. Execute mode-specific flow (graceful or hard)
 * 5. Delete batch state file
 * 6. Return AbortResult
 *
 * Non-goal: does NOT delete worktrees/branches (preserved for inspection).
 *
 * @param mode           - Abort mode (graceful or hard)
 * @param prefix         - orchestrator session prefix (e.g., "orch")
 * @param repoRoot       - Repository root path
 * @param batchState     - Current batch runtime state (mutated: phase set to stopped)
 * @param persistedState - Loaded persisted state (for session enrichment)
 * @param gracePeriodMs  - Grace period for graceful abort (default 60000)
 * @param pollIntervalMs - Poll interval for graceful abort (default 2000)
 * @returns AbortResult with per-lane details
 */
export async function executeAbort(
	mode: AbortMode,
	prefix: string,
	repoRoot: string,
	batchState: OrchBatchRuntimeState,
	persistedState: PersistedBatchState | null,
	gracePeriodMs: number = 60_000,
	pollIntervalMs: number = 2_000,
): Promise<AbortResult> {
	const startTime = Date.now();
	const errors: Array<{ code: AbortErrorCode; message: string }> = [];

	// Step 1: Set phase to stopped
	batchState.phase = "stopped";
	batchState.endedAt = Date.now();

	// Step 2: Persist state (best-effort — abort must continue even if persist fails)
	try {
		persistRuntimeState(
			`abort-${mode}`,
			batchState,
			[], // wavePlan not needed for abort persistence
			batchState.currentLanes,
			[], // taskOutcomes not needed
			null, // discovery not needed
			repoRoot,
		);
	} catch (err) {
		execLog("abort", batchState.batchId, `Failed to persist state during abort: ${err instanceof Error ? err.message : String(err)}`);
	}

	// TP-108: Kill all V2 merge agents (process-owned, not TMUX)
	// This catches V2 merge agents that have no TMUX session.
	const v2MergeKilled = killAllMergeAgentsV2();
	if (v2MergeKilled > 0) {
		execLog("abort", batchState.batchId, `killed ${v2MergeKilled} V2 merge agent(s)`);
	}

	// Step 3: Discover target sessions from Runtime V2 state sources.
	const allSessionNames = discoverAbortSessionNames(prefix, persistedState, batchState.currentLanes);
	if (allSessionNames.length === 0) {
		execLog("abort", batchState.batchId, `No abort targets discovered for prefix "${prefix}" from runtime/persisted state.`);
	}

	// Step 4: Select and enrich target sessions
	const targets = selectAbortTargetSessions(
		allSessionNames,
		persistedState,
		batchState.currentLanes,
		repoRoot,
		prefix,
	);

	const laneResults: AbortLaneResult[] = [];
	let gracefulExits = 0;
	let wrapUpFailures = 0;

	if (mode === "graceful") {
		// Step 5a: Write wrap-up files
		const wrapUpResults = writeWrapUpFiles(targets);
		for (const wr of wrapUpResults) {
			if (wr.error) wrapUpFailures++;
		}
		if (wrapUpFailures > 0) {
			errors.push({
				code: "ABORT_WRAPUP_WRITE_FAILED",
				message: `Failed to write wrap-up files for ${wrapUpFailures} session(s)`,
			});
		}

		// Step 5b: Wait for sessions to exit
		const allTargetNames = targets.map(t => t.sessionName);
		const waitResult = await waitForSessionExit(allTargetNames, gracePeriodMs, pollIntervalMs);
		gracefulExits = waitResult.exited.length;

		// Step 5c: Force-kill remaining sessions
		const killResultBySession = new Map<string, { killed: boolean; error: string | null }>();
		if (waitResult.remaining.length > 0) {
			const killResults = killOrchSessions(waitResult.remaining, {
				stateRoot: repoRoot,
				batchId: batchState.batchId,
			});
			for (const kr of killResults) {
				killResultBySession.set(kr.sessionName, { killed: kr.killed, error: kr.error });
			}
			const killFailures = killResults.filter(kr => !kr.killed);
			if (killFailures.length > 0) {
				errors.push({
					code: "ABORT_KILL_FAILED",
					message: `Failed to kill ${killFailures.length} session(s)`,
				});
			}
		}

		// Build lane results
		const exitedSet = new Set(waitResult.exited);
		for (const target of targets) {
			const wrapUp = wrapUpResults.find(wr => wr.sessionName === target.sessionName);
			const wasGraceful = exitedSet.has(target.sessionName);
			const killResult = killResultBySession.get(target.sessionName);
			const sessionKilled = wasGraceful || killResult?.killed === true;
			laneResults.push({
				sessionName: target.sessionName,
				laneId: target.laneId,
				taskId: target.taskId,
				taskFolderInWorktree: target.taskFolderInWorktree,
				wrapUpWritten: wrapUp?.written || false,
				wrapUpError: wrapUp?.error || null,
				sessionKilled,
				exitedGracefully: wasGraceful,
			});
		}
	} else {
		// Hard mode: kill all immediately
		const allTargetNames = targets.map(t => t.sessionName);
		const killResults = killOrchSessions(allTargetNames, {
			stateRoot: repoRoot,
			batchId: batchState.batchId,
		});
		const killResultBySession = new Map<string, { killed: boolean; error: string | null }>();
		for (const kr of killResults) {
			killResultBySession.set(kr.sessionName, { killed: kr.killed, error: kr.error });
		}
		const killFailures = killResults.filter(kr => !kr.killed);
		if (killFailures.length > 0) {
			errors.push({
				code: "ABORT_KILL_FAILED",
				message: `Failed to kill ${killFailures.length} session(s)`,
			});
		}

		for (const target of targets) {
			const killResult = killResultBySession.get(target.sessionName);
			laneResults.push({
				sessionName: target.sessionName,
				laneId: target.laneId,
				taskId: target.taskId,
				taskFolderInWorktree: target.taskFolderInWorktree,
				wrapUpWritten: false,
				wrapUpError: null,
				sessionKilled: killResult?.killed === true,
				exitedGracefully: false,
			});
		}
	}

	// Step 6: Delete batch state file
	let stateDeleted = false;
	try {
		deleteBatchState(repoRoot);
		stateDeleted = true;
	} catch (err) {
		errors.push({
			code: "ABORT_STATE_DELETE_FAILED",
			message: err instanceof Error ? err.message : String(err),
		});
	}

	return {
		mode,
		sessionsFound: targets.length,
		sessionsKilled: laneResults.filter(lr => lr.sessionKilled).length,
		gracefulExits,
		laneResults,
		wrapUpFailures,
		stateDeleted,
		errors,
		durationMs: Date.now() - startTime,
	};
}

