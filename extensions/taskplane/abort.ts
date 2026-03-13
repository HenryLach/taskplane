/**
 * Abort logic (graceful and hard)
 * @module orch/abort
 */
import { writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, resolve } from "path";

import { execLog, tmuxHasSession, tmuxKillSession } from "./execution.ts";
import { deleteBatchState, parseOrchSessionNames, persistRuntimeState } from "./persistence.ts";
import type { AbortActionStep, AbortErrorCode, AbortLaneResult, AbortMode, AbortResult, AbortTargetSession, AllocatedLane, OrchBatchRuntimeState, PersistedBatchState } from "./types.ts";

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
	const targetNames = allSessionNames.filter(name => {
		const prefixWithDash = `${prefix}-`;
		if (!name.startsWith(prefixWithDash)) return false;
		const suffix = name.slice(prefixWithDash.length);
		return suffix.startsWith("lane-") || suffix.startsWith("merge-");
	});

	// Build lookup from persisted state task records
	const persistedLookup = new Map<string, { laneId: string; taskId: string; taskFolder: string }>();
	if (persistedState) {
		for (const task of persistedState.tasks) {
			if (task.sessionName) {
				persistedLookup.set(task.sessionName, {
					laneId: `lane-${task.laneNumber}`,
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
		runtimeLookup.set(lane.tmuxSessionName, {
			laneId: lane.laneId,
			taskId: currentTask?.taskId || null,
			worktreePath: lane.worktreePath,
			taskFolder: currentTask?.task.taskFolder || null,
		});
	}

	return targetNames.map(sessionName => {
		const runtime = runtimeLookup.get(sessionName);
		const persisted = persistedLookup.get(sessionName);

		const laneId = runtime?.laneId || persisted?.laneId || "unknown";
		const taskId = runtime?.taskId || persisted?.taskId || null;
		const worktreePath = runtime?.worktreePath || null;
		const taskFolder = runtime?.taskFolder || persisted?.taskFolder || null;

		// Resolve task folder path within the worktree
		let taskFolderInWorktree: string | null = null;
		if (taskFolder && worktreePath && repoRoot) {
			const repoRootNorm = resolve(repoRoot).replace(/\\/g, "/");
			const folderNorm = resolve(taskFolder).replace(/\\/g, "/");
			let relativePath: string;
			if (folderNorm.startsWith(repoRootNorm + "/")) {
				relativePath = folderNorm.slice(repoRootNorm.length + 1);
			} else {
				relativePath = taskFolder;
			}
			taskFolderInWorktree = join(worktreePath, relativePath);
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


// ── Abort Orchestration Functions ────────────────────────────────────

/**
 * Write wrap-up signal files to each lane's task folder.
 *
 * Writes both `.task-wrap-up` (primary) and `.wiggum-wrap-up` (legacy)
 * for backward compatibility. Continues on partial failure — aggregates
 * errors per lane.
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
			const legacyPath = join(target.taskFolderInWorktree, ".wiggum-wrap-up");

			// Ensure directory exists
			if (!existsSync(target.taskFolderInWorktree)) {
				results.push({ sessionName: target.sessionName, written: false, error: `Task folder does not exist: ${target.taskFolderInWorktree}` });
				continue;
			}

			writeFileSync(primaryPath, content, "utf-8");
			writeFileSync(legacyPath, content, "utf-8");
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
 * Wait for TMUX sessions to exit gracefully.
 *
 * Polls every `pollIntervalMs` until all sessions have exited or the
 * grace period expires.
 *
 * @param sessionNames     - Session names to monitor
 * @param gracePeriodMs    - Maximum time to wait
 * @param pollIntervalMs   - Polling interval
 * @returns Object with exited and remaining session names
 */
export async function waitForSessionExit(
	sessionNames: string[],
	gracePeriodMs: number,
	pollIntervalMs: number,
): Promise<{ exited: string[]; remaining: string[] }> {
	const deadline = Date.now() + gracePeriodMs;
	const exited: string[] = [];
	const remaining = new Set(sessionNames);

	while (Date.now() < deadline && remaining.size > 0) {
		for (const name of [...remaining]) {
			if (!tmuxHasSession(name)) {
				remaining.delete(name);
				exited.push(name);
			}
		}
		if (remaining.size === 0) break;
		await new Promise(r => setTimeout(r, pollIntervalMs));
	}

	return { exited, remaining: [...remaining] };
}

/**
 * Kill orchestrator TMUX sessions.
 *
 * Kills each session and its children (worker, reviewer).
 * Returns per-session kill results.
 *
 * @param sessionNames - Session names to kill
 * @returns Per-session kill results
 */
export function killOrchSessions(
	sessionNames: string[],
): Array<{ sessionName: string; killed: boolean; error: string | null }> {
	const results: Array<{ sessionName: string; killed: boolean; error: string | null }> = [];

	// Group into base sessions (lane/merge) and child sessions
	const baseSessionNames = sessionNames.filter(name =>
		!name.endsWith("-worker") && !name.endsWith("-reviewer"),
	);
	const childSessionNames = sessionNames.filter(name =>
		name.endsWith("-worker") || name.endsWith("-reviewer"),
	);

	// Kill explicitly-targeted child sessions first.
	for (const name of childSessionNames) {
		const killed = tmuxKillSession(name);
		results.push({
			sessionName: name,
			killed,
			error: killed ? null : `Session '${name}' still alive after kill attempt`,
		});
	}

	// Then kill base sessions (and defensively kill their children).
	for (const name of baseSessionNames) {
		// Best-effort child cleanup even if not explicitly targeted.
		tmuxKillSession(`${name}-worker`);
		tmuxKillSession(`${name}-reviewer`);

		const killed = tmuxKillSession(name);
		results.push({
			sessionName: name,
			killed,
			error: killed ? null : `Session '${name}' still alive after kill attempt`,
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
 * @param prefix         - TMUX session prefix (e.g., "orch")
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

	// Step 3: List all orch sessions
	let allSessionNames: string[];
	try {
		allSessionNames = parseOrchSessionNames(
			(() => {
				try {
					return execSync('tmux list-sessions -F "#{session_name}"', {
						encoding: "utf-8",
						timeout: 5000,
					});
				} catch {
					return "";
				}
			})(),
			prefix,
		);
	} catch (err) {
		errors.push({
			code: "ABORT_TMUX_LIST_FAILED",
			message: err instanceof Error ? err.message : String(err),
		});
		allSessionNames = [];
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
			const killResults = killOrchSessions(waitResult.remaining);
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
		const killResults = killOrchSessions(allTargetNames);
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

