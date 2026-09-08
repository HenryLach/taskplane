/**
 * Resume logic for paused/interrupted batches
 * @module orch/resume
 */
import { existsSync, renameSync } from "fs";
import { join } from "path";

import { assembleDiagnosticInput, emitDiagnosticReports } from "./diagnostic-reports.ts";
import { runDiscovery } from "./discovery.ts";
import {
	executeOrchBatch,
	resolveDisplayWaveNumber,
	buildSpawnFailureAlertExtras,
} from "./engine.ts";
import {
	advanceActiveSegment,
	applyReExecutionOutcomeToSegments,
	taskSegmentsAllSucceeded,
} from "./segment-recovery.ts";
import {
	buildReviewerEnv,
	buildWorkerEnv,
	buildWorkerExcludeEnv,
	batchTaskScope,
	computeTransitiveDependents,
	execLog,
	executeLaneV2,
	executeWave,
	resolveCanonicalTaskPaths,
} from "./execution.ts";
import type { MonitorUpdateCallback, RuntimeBackend } from "./execution.ts";
import { selectRuntimeBackend } from "./engine.ts";
import { readRegistrySnapshot, isTerminalStatus, isProcessAlive } from "./process-registry.ts";

/**
 * TP-112: Terminate any alive V2 agents for a lane before re-execution.
 * Per Runtime V2 spec §7.3: detect + terminate + rehydrate.
 * Prevents duplicate concurrent agents for the same lane/task on resume.
 */
/** #631: how long to wait for SIGTERM, then SIGKILL, before declaring termination unconfirmed. */
const TERMINATE_GRACE_MS = 5_000;
const TERMINATE_KILL_MS = 3_000;
const TERMINATE_POLL_MS = 200;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function waitForExit(pids: number[], timeoutMs: number): Promise<number[]> {
	const deadline = Date.now() + timeoutMs;
	let survivors = pids.filter((pid) => isProcessAlive(pid));
	while (survivors.length > 0 && Date.now() < deadline) {
		await sleep(TERMINATE_POLL_MS);
		survivors = survivors.filter((pid) => isProcessAlive(pid));
	}
	return survivors;
}

/**
 * Terminate the lane's still-alive V2 agents (worker/reviewer) before this
 * resume re-executes the lane in the SAME worktree.
 *
 * #631: termination is VERIFIED, not fire-and-forget. SIGTERM → bounded wait →
 * SIGKILL → bounded wait. If any agent is still alive after that, THROW: a
 * signal-resistant or permission-protected worker would otherwise keep writing
 * the worktree alongside its replacement. The callers' existing catch blocks
 * mark the task failed with this reason instead of re-executing.
 */
async function terminateAliveV2Agents(
	stateRoot: string,
	batchId: string,
	sessionName: string,
): Promise<void> {
	const registry = readRegistrySnapshot(stateRoot, batchId);
	if (!registry) return;
	const targets: Array<{ key: string; pid: number }> = [];
	for (const suffix of ["-worker", "-reviewer", ""]) {
		const key = `${sessionName}${suffix}`;
		const manifest = registry.agents[key];
		if (manifest && !isTerminalStatus(manifest.status) && isProcessAlive(manifest.pid)) {
			targets.push({ key, pid: manifest.pid });
		}
	}
	if (targets.length === 0) return;

	for (const t of targets) {
		try {
			process.kill(t.pid, "SIGTERM");
			execLog("resume", t.key, `SIGTERM sent to alive V2 agent (PID ${t.pid}) before re-execute`);
		} catch {
			/* already dead or not signalable — verified below */
		}
	}
	let survivors = await waitForExit(
		targets.map((t) => t.pid),
		TERMINATE_GRACE_MS,
	);
	if (survivors.length > 0) {
		for (const pid of survivors) {
			try {
				process.kill(pid, "SIGKILL");
				execLog(
					"resume",
					sessionName,
					`SIGKILL sent to V2 agent PID ${pid} (did not exit within ${TERMINATE_GRACE_MS}ms)`,
				);
			} catch {
				/* verified below */
			}
		}
		survivors = await waitForExit(survivors, TERMINATE_KILL_MS);
	}
	if (survivors.length > 0) {
		const list = targets
			.filter((t) => survivors.includes(t.pid))
			.map((t) => `${t.key} (PID ${t.pid})`)
			.join(", ");
		throw new Error(
			`cannot confirm termination of ${list} after SIGTERM+SIGKILL — refusing to re-execute the lane alongside a live agent (#631). ` +
				`Terminate the process manually and resume again.`,
		);
	}
	execLog(
		"resume",
		sessionName,
		`verified termination of ${targets.length} V2 agent(s) before re-execute`,
		{
			pids: targets.map((t) => t.pid).join(","),
		},
	);
}
import { getCurrentBranch, runGit, describeOrchBranchStateAcrossRepos } from "./git.ts";
import { authorizeCompletion } from "./completion-authority.ts";
import { mergeWaveByRepo } from "./merge.ts";
import {
	applyMergeRetryLoop,
	computeCleanupGatePolicy,
	computeMergeFailurePolicy,
	extractFailedRepoId,
	formatRepoMergeSummary,
	ORCH_MESSAGES,
} from "./messages.ts";
import type { CleanupGateRepoFailure } from "./messages.ts";
import { resolveOperatorId } from "./naming.ts";
import {
	applyPartialProgressToOutcomes,
	deleteBatchState,
	hasTaskDoneMarker,
	loadBatchState,
	persistRuntimeState,
	persistRuntimeStateStrict,
	reconstructBatchStateFromRuntime,
	saveBatchState,
	seedPendingOutcomesForAllocatedLanes,
	syncTaskOutcomesFromMonitor,
	upsertTaskOutcome,
} from "./persistence.ts";
import {
	createHoldRecord,
	createHoldStore,
	HOLD_TIMEOUT_MINUTES_DEFAULT,
	type HoldRecord,
	isHoldUnresolved,
	selectUnrecordedEscalations,
	taskCompletionBlocked,
} from "./hold-state.ts";
import { readOutboxStrict } from "./mailbox.ts";
import {
	buildBatchProgressSnapshot,
	buildSupervisorSegmentFrontierSnapshot,
	defaultResilienceState,
	ResumeError,
	StateFileError,
} from "./types.ts";
import type {
	AllocatedLane,
	AllocatedTask,
	LaneExecutionResult,
	LaneTaskOutcome,
	LaneTaskStatus,
	MailboxMessage,
	MergeWaveResult,
	OrchBatchPhase,
	OrchBatchRuntimeState,
	OrchestratorConfig,
	ParsedTask,
	PersistedBatchState,
	PersistedLaneRecord,
	PersistedSegmentRecord,
	ReconciledTaskState,
	ResumeEligibility,
	ResumePoint,
	TaskRunnerConfig,
	WaveExecutionResult,
	WorkspaceConfig,
} from "./types.ts";
import { buildDependencyGraph, resolveBaseBranch, resolveRepoRoot } from "./waves.ts";
import {
	deleteBranchBestEffort,
	forceCleanupWorktree,
	listWorktrees,
	preserveFailedLaneProgress,
	removeAllWorktrees,
	removeWorktree,
	safeResetWorktree,
	sleepSync,
} from "./worktree.ts";

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
/**
 * Catch-up merge eligibility (resume step 8d), pure: which persisted lanes hold
 * succeeded-but-unmerged work? A lane qualifies when ALL its tasks are
 * `succeeded`, none were re-executed in this resume pass, and the (LAST) wave
 * of every task has no `succeeded` merge record. Branch existence is checked by
 * the caller (needs git).
 */
export function selectCatchUpLanes(
	persistedState: Pick<PersistedBatchState, "lanes" | "tasks" | "mergeResults">,
	wavePlan: string[][],
	reExecutedTaskIds: ReadonlySet<string>,
): PersistedBatchState["lanes"] {
	// LATEST merge status per wave (the same rule computeResumePoint uses) — an
	// older succeeded record must not mask a later failure (success → failure
	// while a third task was still pending left succeeded work permanently
	// unmerged).
	const waveMerged = (w: number) =>
		getMergeStatusForWave(persistedState.mergeResults ?? [], w) === "succeeded";
	const waveOfTask = new Map<string, number>();
	wavePlan.forEach((wave, i) => {
		for (const id of wave) waveOfTask.set(id, i);
	});
	const succeededById = new Map(
		persistedState.tasks.map((t) => [t.taskId, t.status === "succeeded"]),
	);
	return persistedState.lanes.filter((laneRecord) => {
		if (laneRecord.taskIds.length === 0) return false;
		if (!laneRecord.taskIds.every((id) => succeededById.get(id))) return false;
		if (laneRecord.taskIds.some((id) => reExecutedTaskIds.has(id))) return false;
		const waves = laneRecord.taskIds.map((id) => waveOfTask.get(id));
		if (waves.some((w) => w === undefined || waveMerged(w))) return false;
		return true;
	});
}

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
 * Resolve a repoId from a resolved repo root path.
 *
 * In workspace mode, workspace config maps repoId → path. This performs
 * the reverse lookup: given a resolved absolute path, find the repoId.
 * Returns `undefined` if no workspace config or no matching repo is found
 * (which is correct for repo mode or the primary/default repo).
 *
 * Used during cleanup to call `resolveBaseBranch()` per-repo with the
 * correct repoId, ensuring unmerged-branch protection checks against
 * the right target branch in workspace mode.
 *
 * @param repoRoot        - Resolved absolute path of the repo
 * @param workspaceConfig - Workspace configuration (null in repo mode)
 * @returns The repoId or undefined if not found / not in workspace mode
 */
export function resolveRepoIdFromRoot(
	repoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): string | undefined {
	if (!workspaceConfig) return undefined;

	for (const [repoId, repoConfig] of workspaceConfig.repos) {
		if (repoConfig.path === repoRoot) {
			return repoId;
		}
	}

	return undefined;
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
		laneSessionId: lr.laneSessionId,
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
			// TP-169: Always set taskFolder on stub, even if empty string.
			// Previously, the falsy check `if (persistedTask?.taskFolder)` skipped
			// empty-string values, leaving taskFolder as `undefined` on the stub.
			// This caused crashes in buildExecutionUnit and merge code when
			// accessing `task.task.taskFolder` on dynamically-expanded segments
			// whose persisted records had taskFolder="" (the default from
			// serializeBatchState before enrichment).
			taskStub.taskFolder = persistedTask?.taskFolder ?? "";
			if ((persistedTask as any)?.packetRepoId !== undefined) {
				(taskStub as any).packetRepoId = (persistedTask as any).packetRepoId;
			}
			if ((persistedTask as any)?.packetTaskPath !== undefined) {
				(taskStub as any).packetTaskPath = (persistedTask as any).packetTaskPath;
			}
			if ((persistedTask as any)?.segmentIds !== undefined) {
				(taskStub as any).segmentIds = (persistedTask as any).segmentIds;
			}
			if ((persistedTask as any)?.activeSegmentId !== undefined) {
				(taskStub as any).activeSegmentId = (persistedTask as any).activeSegmentId;
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
 * Determine whether a multi-segment task's persisted segment frontier is
 * complete — i.e., every segment for the task reached a terminal-success
 * status ("succeeded" or "skipped").
 *
 * Returns:
 *  - `true` when the task has segments AND all of them are terminal-success.
 *  - `true` when the task has no segments recorded (single-segment / legacy
 *    tasks — the guard does not apply and `.DONE` is authoritative).
 *  - `false` when at least one segment is pending/running/failed/stalled.
 *
 * Used by `collectDoneTaskIdsForResume` (TP-196 / #462) to refuse a stale or
 * premature `.DONE` from suppressing re-execution of remaining segments.
 */
function isSegmentFrontierCompleteForResume(
	persistedState: PersistedBatchState,
	taskId: string,
): boolean {
	const segments = (persistedState.segments ?? []).filter((s) => s.taskId === taskId);
	if (segments.length === 0) return true; // No segments recorded — guard does not apply.
	return segments.every((s) => s.status === "succeeded" || s.status === "skipped");
}

/**
 * Collect task IDs with authoritative .DONE markers.
 *
 * Segment frontier state does not suppress .DONE authority for tasks WITHOUT
 * persisted segment records (single-segment / legacy). For tasks WITH segment
 * records (multi-segment), TP-196 / #462 adds a resume guard: when `.DONE`
 * exists but the segment frontier is incomplete (at least one segment is not
 * yet succeeded/skipped), we DO NOT add the taskId to the done set — the
 * task will be re-reconciled instead of silently marked complete. A WARN is
 * logged so operators can spot the inconsistency. The on-disk `.DONE` marker
 * is left alone; the engine will re-establish authoritative state.
 */
export function collectDoneTaskIdsForResume(
	persistedState: PersistedBatchState,
	repoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): Set<string> {
	const doneTaskIds = new Set<string>();
	for (const task of persistedState.tasks) {
		let markerFound = false;
		let markerLocation: string | null = null;
		// Reviews dir + worktree for the completion-authority check below. Resolved
		// the same way as `donePath` (primary task folder, else worktree-resolved).
		let reviewsDir: string | null = null;
		let worktreePathForTask: string | null = null;
		const laneRec = persistedState.lanes.find((l) => l.taskIds.includes(task.taskId));
		worktreePathForTask = laneRec?.worktreePath ?? null;
		if (task.taskFolder && hasTaskDoneMarker(task.taskFolder)) {
			markerFound = true;
			markerLocation = task.taskFolder;
			reviewsDir = join(task.taskFolder, ".reviews");
		}
		if (!markerFound) {
			if (laneRec?.worktreePath && task.taskFolder) {
				const resolved = resolveCanonicalTaskPaths(
					task.taskFolder,
					laneRec.worktreePath,
					repoRoot,
					!!workspaceConfig,
				);
				if (existsSync(resolved.donePath)) {
					markerFound = true;
					markerLocation = resolved.donePath;
					reviewsDir = join(resolved.taskFolderResolved, ".reviews");
				}
			}
		}
		if (!markerFound) continue;

		// TP-196 / #462: Resume guard — refuse `.DONE` authority for multi-segment
		// tasks with an incomplete segment frontier.
		if (!isSegmentFrontierCompleteForResume(persistedState, task.taskId)) {
			console.warn(
				`[resume] WARN: .DONE present for task ${task.taskId} at ${markerLocation} but segment frontier is incomplete — not marking complete (#462 guard). Task will re-reconcile.`,
			);
			continue;
		}

		// TP-199 (#627 Stage 2b): the `.DONE` acceptance flows through the SAME
		// `authorizeCompletion` predicate the live finalize gate uses, so a
		// worker-written `.DONE` over a blocking review gate (latest REVISE/RETHINK)
		// or a linked APPROVE with a missing/invalid/stale ratification is refused
		// on resume exactly as it would be live. Holds are also folded in
		// (`persistedState.holds`); `taskCompletionBlocked` and
		// `quarantineUnauthorizedDoneMarkers` already handle them, but the shared
		// predicate keeps the acceptance decision in one place. The frontier is
		// complete at this point, so this is the final unit (`isFinalSegment: true`).
		// Segment identity mirrors the live finalize run: the final segment's id
		// (so a segment-scoped ratification still validates), or null for
		// single-segment/legacy tasks. `workingTreeDrift` is intentionally omitted —
		// resume has no live worktree drift to bind against (defaults to clean).
		if (reviewsDir) {
			const taskSegments = (persistedState.segments ?? []).filter(
				(s) => s.taskId === task.taskId,
			);
			const finalSegment =
				taskSegments.length > 0 ? taskSegments[taskSegments.length - 1] : null;
			const segmentId = finalSegment?.segmentId ?? null;
			const worktreePath = finalSegment?.worktreePath ?? worktreePathForTask;
			const headRevision =
				worktreePath && existsSync(worktreePath)
					? (() => {
							const r = runGit(["rev-parse", "--verify", "HEAD^{commit}"], worktreePath);
							return r.ok ? r.stdout.trim() : null;
						})()
					: null;
			const isAncestor =
				worktreePath && existsSync(worktreePath)
					? (a: string, b: string) =>
							runGit(["merge-base", "--is-ancestor", a, b], worktreePath).ok
					: () => false;
			const decision = authorizeCompletion({
				holds: persistedState.holds ?? [],
				taskId: task.taskId,
				segmentId,
				reviewsDir,
				headRevision,
				isAncestor,
				isFinalSegment: true,
			});
			if (decision.allowed === false) {
				const blockers = decision.blockers
					.map((b) => `${b.kind}:${b.ref} (${b.reason})`)
					.join("; ");
				console.warn(
					`[resume] WARN: .DONE present for task ${task.taskId} at ${markerLocation} but refused by completion authority: ${blockers} — not marking complete. Task will re-reconcile.`,
				);
				continue;
			}
		}

		doneTaskIds.add(task.taskId);
	}
	return doneTaskIds;
}

/**
 * Check whether a persisted batch state is eligible for resume.
 *
 * Resume eligibility matrix:
 * | Phase     | Normal    | --force   | Reason                                    |
 * |-----------|-----------|-----------|-------------------------------------------|
 * | paused    | ✅        | ✅        | Batch was paused (user/merge-failure)      |
 * | executing | ✅        | ✅        | Batch was executing when orchestrator died |
 * | merging   | ✅        | ✅        | Batch was merging when orchestrator died   |
 * | stopped   | ❌        | ✅        | Batch was stopped by policy                |
 * | failed    | ❌        | ✅        | Batch has terminal failure                 |
 * | completed | ❌        | ❌        | Batch already completed                   |
 * | idle      | ❌        | ❌        | Batch never started execution              |
 * | planning  | ❌        | ❌        | Batch was still planning                   |
 *
 * Pure function — no process or filesystem access.
 *
 * @param state - Persisted batch state to check
 * @param force - When true, `stopped` and `failed` phases become eligible
 */
export function checkResumeEligibility(
	state: PersistedBatchState,
	force: boolean = false,
): ResumeEligibility {
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
			if (force) {
				return {
					eligible: true,
					reason: `Batch ${batchId} was stopped by failure policy. Force-resuming (--force).`,
					phase,
					batchId,
				};
			}
			return {
				eligible: false,
				reason: `Batch ${batchId} was stopped by failure policy. Use --force to resume, or /orch-abort to clean up.`,
				phase,
				batchId,
			};

		case "failed":
			if (force) {
				return {
					eligible: true,
					reason: `Batch ${batchId} has a terminal failure. Force-resuming (--force).`,
					phase,
					batchId,
				};
			}
			return {
				eligible: false,
				reason: `Batch ${batchId} has a terminal failure. Use --force to resume, or /orch-abort to clean up.`,
				phase,
				batchId,
			};

		case "completed":
			return {
				eligible: false,
				reason: `Batch ${batchId} already completed. ${force ? "--force cannot resume a completed batch. " : ""}Delete the state file or start a new batch.`,
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

		case "launching":
			return {
				eligible: false,
				reason: `Batch ${batchId} is currently launching. Wait for it to start or use /orch-abort.`,
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

interface SegmentFrontierResumeTaskState {
	taskId: string;
	completedSegmentIds: string[];
	inFlightSegmentIds: string[];
	pendingSegmentIds: string[];
	failedSegmentIds: string[];
	nextSegmentId: string | null;
	allSucceeded: boolean;
	dependencyBySegmentId: Map<string, string[]>;
}

function classifySegmentStatus(
	status: PersistedSegmentRecord["status"] | undefined,
): "completed" | "failed" | "in-flight" | "pending" {
	if (status === "succeeded" || status === "skipped") return "completed";
	if (status === "failed" || status === "stalled") return "failed";
	if (status === "running") return "in-flight";
	return "pending";
}

/**
 * Reconstruct per-task segment frontier from persisted segment records.
 *
 * Mutates persisted task records in-place to reflect the segment frontier:
 * - sets `activeSegmentId` to running or next pending segment
 * - normalizes task `status` to pending/running/terminal based on segments
 */
export function reconstructSegmentFrontier(
	persistedState: PersistedBatchState,
): Map<string, SegmentFrontierResumeTaskState> {
	const byTask = new Map<string, SegmentFrontierResumeTaskState>();
	const segmentRecordById = new Map<string, PersistedSegmentRecord>();
	for (const segment of persistedState.segments ?? []) {
		segmentRecordById.set(segment.segmentId, segment);
	}

	for (const task of persistedState.tasks) {
		const segmentIds = task.segmentIds ?? [];
		if (segmentIds.length === 0) continue;

		const dependencyBySegmentId = new Map<string, string[]>();
		const completedSegmentIds: string[] = [];
		const inFlightSegmentIds: string[] = [];
		const pendingSegmentIds: string[] = [];
		const failedSegmentIds: string[] = [];
		let hasConcreteSegmentRecord = false;

		for (let idx = 0; idx < segmentIds.length; idx++) {
			const segmentId = segmentIds[idx];
			const record = segmentRecordById.get(segmentId);
			if (record) hasConcreteSegmentRecord = true;
			const recordDeps = record?.dependsOnSegmentIds ?? [];
			const fallbackDeps = idx > 0 ? [segmentIds[idx - 1]] : [];
			const deps = (recordDeps.length > 0 ? recordDeps : fallbackDeps).filter((dep) =>
				segmentIds.includes(dep),
			);
			dependencyBySegmentId.set(
				segmentId,
				[...new Set(deps)].sort((a, b) => a.localeCompare(b)),
			);

			switch (classifySegmentStatus(record?.status)) {
				case "completed":
					completedSegmentIds.push(segmentId);
					break;
				case "in-flight":
					inFlightSegmentIds.push(segmentId);
					break;
				case "failed":
					failedSegmentIds.push(segmentId);
					break;
				default:
					pendingSegmentIds.push(segmentId);
					break;
			}
		}

		const completedSet = new Set(completedSegmentIds);
		const readyPending = pendingSegmentIds.filter((segmentId) => {
			const deps = dependencyBySegmentId.get(segmentId) ?? [];
			return deps.every((dep) => completedSet.has(dep));
		});

		const nextSegmentId = inFlightSegmentIds[0] ?? readyPending[0] ?? pendingSegmentIds[0] ?? null;
		const allSucceeded = segmentIds.every((segmentId) => {
			const status = segmentRecordById.get(segmentId)?.status;
			return status === "succeeded";
		});

		if (hasConcreteSegmentRecord) {
			if (failedSegmentIds.length > 0) {
				task.status = task.status === "skipped" ? "skipped" : "failed";
				task.activeSegmentId = null;
			} else if (inFlightSegmentIds.length > 0) {
				task.status = "running";
				task.activeSegmentId = inFlightSegmentIds[0];
			} else if (pendingSegmentIds.length > 0) {
				task.status = "pending";
				task.activeSegmentId = nextSegmentId;
			} else if (allSucceeded) {
				task.status = "succeeded";
				task.activeSegmentId = null;
			} else {
				task.status = task.status === "skipped" ? "skipped" : "failed";
				task.activeSegmentId = null;
			}
		}

		byTask.set(task.taskId, {
			taskId: task.taskId,
			completedSegmentIds,
			inFlightSegmentIds,
			pendingSegmentIds,
			failedSegmentIds,
			nextSegmentId,
			allSucceeded,
			dependencyBySegmentId,
		});
	}

	return byTask;
}

/**
 * Reconcile persisted task states against live signals.
 *
 * For each task in the persisted state, determines the correct action
 * based on the current state of lane-session liveness and .DONE files.
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
 * @param aliveSessions   - Set of lane session names currently alive
 * @param doneTaskIds     - Set of task IDs whose .DONE files exist
 * @returns Array of reconciled task states in persisted order
 */
/**
 * #627 (Sage review, blocker 6): attribute unrecorded escalations to units
 * from DURABLE evidence and open hold records for them.
 *
 * - Stamped scope (`msg.scope`) → that task/segment, provided the task exists.
 * - Unscoped (pre-#627) → only if the lane's persisted `taskIds` (durable
 *   assignment history) holds exactly one task; otherwise the replay is
 *   AMBIGUOUS and the caller must refuse rather than guess.
 *
 * Pure apart from the injected outbox reader; mutates `persistedState.holds`.
 */
export function replayUnrecordedEscalations(
	persistedState: PersistedBatchState,
	readOutboxFor: (workerAgentId: string) => MailboxMessage[],
	opts: { holdTimeoutMinutes?: number; now?: number } = {},
): { ok: true; opened: HoldRecord[] } | { ok: false; error: string } {
	const holds = (persistedState.holds ??= []);
	const opened: HoldRecord[] = [];
	const taskIds = new Set(persistedState.tasks.map((t) => t.taskId));
	for (const lane of persistedState.lanes) {
		const workerAgentId = `${lane.laneSessionId}-worker`;
		let outbox: MailboxMessage[];
		try {
			outbox = readOutboxFor(workerAgentId);
		} catch (err) {
			return {
				ok: false,
				error: `hold authority cannot be verified: outbox of ${workerAgentId} is unreadable (${err instanceof Error ? err.message : String(err)})`,
			};
		}
		for (const msg of selectUnrecordedEscalations(outbox, holds)) {
			let taskId: string;
			let segmentId: string | null;
			if (msg.scope) {
				if (!taskIds.has(msg.scope.taskId)) {
					return {
						ok: false,
						error: `hold authority cannot be recovered: escalation ${msg.id} in ${workerAgentId}'s outbox names unknown task ${msg.scope.taskId}`,
					};
				}
				taskId = msg.scope.taskId;
				segmentId = msg.scope.segmentId ?? null;
			} else if (lane.taskIds.length === 1) {
				taskId = lane.taskIds[0];
				segmentId = persistedState.tasks.find((t) => t.taskId === taskId)?.activeSegmentId ?? null;
			} else {
				return {
					ok: false,
					error:
						`hold authority cannot be recovered: unscoped escalation ${msg.id} in ${workerAgentId}'s outbox (lane ${lane.laneNumber} ran ${lane.taskIds.join(", ") || "no tasks"}) — ` +
						`it cannot be attributed to a task. Inspect the message, then either record a ruling for it out of band or move it out of the outbox.`,
				};
			}
			const record = createHoldRecord({
				escalation: msg,
				batchId: persistedState.batchId,
				taskId,
				segmentId,
				executionId: "replayed-on-resume",
				agentId: workerAgentId,
				laneNumber: lane.laneNumber,
				holdTimeoutMinutes: opts.holdTimeoutMinutes ?? HOLD_TIMEOUT_MINUTES_DEFAULT,
				now: opts.now,
			});
			holds.push(record);
			opened.push(record);
		}
	}
	return { ok: true, opened };
}

/**
 * #627 (Sage review, blocker 5): a hold on a specific segment pins that segment
 * as the task's active segment (unless the segment already succeeded), and
 * marks the task `held`, so the execution unit built for re-execution is the
 * held segment — not the whole task or a heuristically chosen sibling.
 */
/**
 * #627: rename `.DONE` markers of hold-bound tasks to `.DONE.unauthorized-<ts>`
 * at the canonical task folder AND the lane-worktree-resolved path — the two
 * locations resume's discovery / .DONE collection consult. Returns the paths
 * moved. A rename failure is logged by the caller via the returned list being
 * short; the marker is then still refused by reconciliation (hold-first).
 */
export function quarantineUnauthorizedDoneMarkers(
	persistedState: PersistedBatchState,
	repoRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): string[] {
	const moved: string[] = [];
	const bound = new Set((persistedState.holds ?? []).filter(isHoldUnresolved).map((h) => h.taskId));
	if (bound.size === 0) return moved;
	for (const task of persistedState.tasks) {
		if (!bound.has(task.taskId) || !task.taskFolder) continue;
		const candidates = new Set<string>([join(task.taskFolder, ".DONE")]);
		const laneRec = persistedState.lanes.find((l) => l.taskIds.includes(task.taskId));
		if (laneRec?.worktreePath) {
			try {
				candidates.add(
					resolveCanonicalTaskPaths(task.taskFolder, laneRec.worktreePath, repoRoot, !!workspaceConfig)
						.donePath,
				);
			} catch {
				/* unresolvable path — canonical candidate still covered */
			}
		}
		for (const donePath of candidates) {
			if (!existsSync(donePath)) continue;
			const target = `${donePath}.unauthorized-${Date.now()}`;
			try {
				renameSync(donePath, target);
				moved.push(target);
			} catch {
				/* leave it; reconciliation is hold-first and will not accept it */
			}
		}
	}
	return moved;
}

export function pinHeldSegments(persistedState: PersistedBatchState): string[] {
	const pinned: string[] = [];
	for (const hold of persistedState.holds ?? []) {
		if (!isHoldUnresolved(hold)) continue;
		const task = persistedState.tasks.find((t) => t.taskId === hold.taskId);
		if (!task) continue;
		if (hold.segmentId) {
			const seg = persistedState.segments.find((s) => s.segmentId === hold.segmentId);
			if (seg && seg.status === "succeeded") continue;
			if (task.activeSegmentId !== hold.segmentId) {
				task.activeSegmentId = hold.segmentId;
				pinned.push(`${task.taskId}→${hold.segmentId}`);
			}
			if (seg && seg.status !== "held" && seg.status !== "running") seg.status = "held";
		}
		if (task.status !== "held") task.status = "held";
	}
	return pinned;
}

export function reconcileTaskStates(
	persistedState: PersistedBatchState,
	aliveSessions: ReadonlySet<string>,
	doneTaskIds: ReadonlySet<string>,
	existingWorktrees: ReadonlySet<string> = new Set(),
	/**
	 * #627: tasks with an unresolved hold (from the durable hold table, or an
	 * escalation still sitting unrecorded in a worker outbox). Evaluated BEFORE
	 * `.DONE`: a held task is never marked complete on resume — it is re-executed
	 * so the lane-runner enters (or records) the hold, spawning nothing until a
	 * ruling arrives.
	 */
	holdBlockedTaskIds: ReadonlySet<string> = new Set(),
): ReconciledTaskState[] {
	return persistedState.tasks.map((task) => {
		const sessionAlive = aliveSessions.has(task.sessionName);
		const doneFileFound = doneTaskIds.has(task.taskId);
		const worktreeExists = existingWorktrees.has(task.taskId);

		// Precedence 0 (#627): hold-blocked → held (re-execute into the hold loop)
		if (holdBlockedTaskIds.has(task.taskId)) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "held" as LaneTaskStatus,
				sessionAlive,
				doneFileFound,
				worktreeExists,
				action: worktreeExists ? ("re-execute" as const) : ("pending" as const),
			};
		}

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

		// Precedence 5: Pending task that was never started → remain pending
		// Matches two cases:
		//   (a) No session assigned at all (future-wave task never allocated)
		//   (b) Session assigned from a prior failed resume, but session is dead
		//       and worktree doesn't exist — task was allocated but never actually
		//       started (TP-037 bug #102b fix)
		// In both cases the task should be re-queued for execution, not failed.
		if (task.status === "pending" && (!task.sessionName || (!sessionAlive && !worktreeExists))) {
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
 * Get the latest merge status for a specific wave index (0-based).
 *
 * Persisted merge results may contain multiple entries for the same wave
 * (e.g., re-exec sentinel merges clamped to wave 0, or retry attempts).
 * This helper returns the latest entry's status for the given wave,
 * preferring the last entry in array order (which is the most recent).
 *
 * @param mergeResults - Persisted merge results array
 * @param waveIndex    - 0-based wave index to look up
 * @returns The merge status ("succeeded" | "failed" | "partial") or null if no entry exists
 */
export function getMergeStatusForWave(
	mergeResults: ReadonlyArray<{ waveIndex: number; status: "succeeded" | "failed" | "partial" }>,
	waveIndex: number,
): "succeeded" | "failed" | "partial" | null {
	// Walk in reverse to find the latest entry for this wave
	for (let i = mergeResults.length - 1; i >= 0; i--) {
		if (mergeResults[i].waveIndex === waveIndex) {
			return mergeResults[i].status;
		}
	}
	return null;
}

/**
 * Expand persisted wave plan with continuation rounds required by segment counts.
 *
 * Groups missing rounds by the original last-occurrence wave so resumed execution
 * preserves multi-task round concurrency semantics (`[A,B]`, then `[A]`, etc.).
 */
export function buildResumeRuntimeWavePlan(persistedState: PersistedBatchState): string[][] {
	const baseWavePlan = persistedState.wavePlan.map((wave) => [...wave]);
	const runtimeWavePlan = [...baseWavePlan];
	const segmentCountByTaskId = new Map<string, number>();
	for (const task of persistedState.tasks) {
		if (Array.isArray(task.segmentIds) && task.segmentIds.length > 0) {
			segmentCountByTaskId.set(task.taskId, task.segmentIds.length);
		}
	}

	const scheduledCountByTaskId = new Map<string, number>();
	const lastWaveIndexByTaskId = new Map<string, number>();
	for (let waveIdx = 0; waveIdx < baseWavePlan.length; waveIdx++) {
		for (const taskId of baseWavePlan[waveIdx]) {
			scheduledCountByTaskId.set(taskId, (scheduledCountByTaskId.get(taskId) ?? 0) + 1);
			lastWaveIndexByTaskId.set(taskId, waveIdx);
		}
	}

	const missingByLastWaveIndex = new Map<number, Map<string, number>>();
	for (const [taskId, segmentCount] of segmentCountByTaskId.entries()) {
		const scheduledCount = scheduledCountByTaskId.get(taskId) ?? 0;
		if (segmentCount <= scheduledCount) continue;
		const lastWaveIndex = lastWaveIndexByTaskId.get(taskId) ?? -1;
		if (!missingByLastWaveIndex.has(lastWaveIndex)) {
			missingByLastWaveIndex.set(lastWaveIndex, new Map<string, number>());
		}
		missingByLastWaveIndex.get(lastWaveIndex)!.set(taskId, segmentCount - scheduledCount);
	}

	let offset = 0;
	for (let baseWaveIdx = 0; baseWaveIdx < baseWavePlan.length; baseWaveIdx++) {
		const missingForWave = missingByLastWaveIndex.get(baseWaveIdx);
		if (!missingForWave || missingForWave.size === 0) continue;
		const rounds: string[][] = [];
		const remaining = new Map(missingForWave);
		while ([...remaining.values()].some((count) => count > 0)) {
			const roundTaskIds = [...remaining.entries()]
				.filter(([, count]) => count > 0)
				.map(([taskId]) => taskId)
				.sort((a, b) => a.localeCompare(b));
			if (roundTaskIds.length === 0) break;
			rounds.push(roundTaskIds);
			for (const taskId of roundTaskIds) {
				remaining.set(taskId, (remaining.get(taskId) ?? 0) - 1);
			}
		}
		if (rounds.length > 0) {
			runtimeWavePlan.splice(baseWaveIdx + 1 + offset, 0, ...rounds);
			offset += rounds.length;
		}
	}

	const dangling = missingByLastWaveIndex.get(-1);
	if (dangling && dangling.size > 0) {
		const remaining = new Map(dangling);
		while ([...remaining.values()].some((count) => count > 0)) {
			const roundTaskIds = [...remaining.entries()]
				.filter(([, count]) => count > 0)
				.map(([taskId]) => taskId)
				.sort((a, b) => a.localeCompare(b));
			if (roundTaskIds.length === 0) break;
			runtimeWavePlan.push(roundTaskIds);
			for (const taskId of roundTaskIds) {
				remaining.set(taskId, (remaining.get(taskId) ?? 0) - 1);
			}
		}
	}

	return runtimeWavePlan;
}

/**
 * Compute the resume point from reconciled task states and wave plan.
 *
 * Determines which wave to resume from by finding the first wave that
 * has any incomplete tasks. Skips fully completed waves only when
 * their merge also succeeded.
 *
 * TP-037 (Bug #102): A wave where all tasks are terminal but the merge
 * is missing or failed is NOT skipped — it is flagged for merge retry
 * via `mergeRetryWaveIndexes`. The `resumeWaveIndex` is set to the
 * earliest such wave so the resume loop can process it.
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
	wavePlan: string[][] = persistedState.wavePlan,
): ResumePoint {
	// Build lookup: taskId → reconciled state
	const reconciledMap = new Map<string, ReconciledTaskState>();
	for (const task of reconciledTasks) {
		reconciledMap.set(task.taskId, task);
	}

	const segmentStatusBySegmentId = new Map<string, PersistedSegmentRecord["status"]>();
	for (const segment of persistedState.segments ?? []) {
		segmentStatusBySegmentId.set(segment.segmentId, segment.status);
	}
	const persistedTasks = Array.isArray((persistedState as { tasks?: unknown }).tasks)
		? persistedState.tasks
		: [];
	const segmentIdsByTaskId = new Map<string, string[]>();
	for (const task of persistedTasks) {
		if (task.segmentIds && task.segmentIds.length > 0) {
			segmentIdsByTaskId.set(task.taskId, task.segmentIds);
		}
	}
	const waveSegmentIdByTaskOccurrence = new Map<string, string>();
	const occurrenceByTaskId = new Map<string, number>();
	for (let waveIdx = 0; waveIdx < wavePlan.length; waveIdx++) {
		for (const taskId of wavePlan[waveIdx]) {
			const segmentIds = segmentIdsByTaskId.get(taskId);
			if (!segmentIds || segmentIds.length === 0) continue;
			const occurrence = occurrenceByTaskId.get(taskId) ?? 0;
			if (occurrence < segmentIds.length) {
				waveSegmentIdByTaskOccurrence.set(`${waveIdx}:${taskId}`, segmentIds[occurrence]);
			}
			occurrenceByTaskId.set(taskId, occurrence + 1);
		}
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
				} else if (
					task.liveStatus === "failed" ||
					task.liveStatus === "stalled" ||
					task.persistedStatus === "failed" ||
					task.persistedStatus === "stalled"
				) {
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

	// Find resume wave: first wave with any non-completed tasks OR missing/failed merge.
	// TP-037 (Bug #102): A wave where all tasks are terminal but the merge
	// hasn't succeeded is flagged for merge retry, not skipped.
	let resumeWaveIndex = wavePlan.length; // default: past end = all done
	const mergeRetryWaveIndexes: number[] = [];

	for (let i = 0; i < wavePlan.length; i++) {
		const waveTasks = wavePlan[i];
		const allDone = waveTasks.every((taskId) => {
			const waveSegmentId = waveSegmentIdByTaskOccurrence.get(`${i}:${taskId}`);
			if (waveSegmentId && segmentStatusBySegmentId.has(waveSegmentId)) {
				const segmentStatus = segmentStatusBySegmentId.get(waveSegmentId)!;
				return (
					segmentStatus === "succeeded" ||
					segmentStatus === "failed" ||
					segmentStatus === "stalled" ||
					segmentStatus === "skipped"
				);
			}
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
			// Only set resumeWaveIndex if not already set by a merge retry
			// (merge retry at an earlier wave takes precedence)
			if (resumeWaveIndex === wavePlan.length) {
				resumeWaveIndex = i;
			}
			break;
		}

		// TP-037 (Bug #102): All tasks are terminal — but did the merge succeed?
		// Only check merge status if the wave had any succeeded tasks (waves with
		// only failures/skips don't produce merges and can be safely skipped).
		const hasSucceededTasks = waveTasks.some((taskId) => {
			const waveSegmentId = waveSegmentIdByTaskOccurrence.get(`${i}:${taskId}`);
			if (waveSegmentId && segmentStatusBySegmentId.has(waveSegmentId)) {
				return segmentStatusBySegmentId.get(waveSegmentId) === "succeeded";
			}
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) return false;
			if (reconciled.action === "mark-complete") return true;
			if (
				reconciled.action === "skip" &&
				(reconciled.liveStatus === "succeeded" || reconciled.persistedStatus === "succeeded")
			)
				return true;
			return false;
		});

		if (hasSucceededTasks && persistedState.mergeResults) {
			const mergeStatus = getMergeStatusForWave(persistedState.mergeResults, i);
			if (mergeStatus !== "succeeded") {
				// Merge missing or failed — flag for retry, don't skip past this wave
				mergeRetryWaveIndexes.push(i);
				if (resumeWaveIndex === wavePlan.length) {
					// This is the first wave needing attention — set resume point here
					resumeWaveIndex = i;
				}
			}
		}
	}

	// Determine pending tasks: tasks in resume wave and later that need execution
	const actualPendingTaskIds: string[] = [];
	for (let i = resumeWaveIndex; i < wavePlan.length; i++) {
		for (const taskId of wavePlan[i]) {
			const waveSegmentId = waveSegmentIdByTaskOccurrence.get(`${i}:${taskId}`);
			if (waveSegmentId && segmentStatusBySegmentId.has(waveSegmentId)) {
				const segmentStatus = segmentStatusBySegmentId.get(waveSegmentId)!;
				if (segmentStatus === "running" || segmentStatus === "pending") {
					actualPendingTaskIds.push(taskId);
				}
				continue;
			}

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
		mergeRetryWaveIndexes,
	};
}

// ── Pre-Resume Diagnostics ───────────────────────────────────────────

/**
 * Result of a single diagnostic check.
 */
export interface DiagnosticCheckResult {
	/** Short label for the check */
	check: string;
	/** Whether the check passed */
	passed: boolean;
	/** Human-readable detail (reason for failure or confirmation) */
	detail: string;
}

/**
 * Aggregate result of pre-resume diagnostics.
 */
export interface PreResumeDiagnosticsResult {
	/** Whether all checks passed and resume can proceed */
	passed: boolean;
	/** Individual check results */
	checks: DiagnosticCheckResult[];
	/** Summary message for operator display */
	summary: string;
}

/**
 * Run pre-resume diagnostics before allowing a force-resume.
 *
 * Checks performed (per repo in workspace mode):
 * 1. **State coherence:** batch-state.json exists and is loadable
 * 2. **Branch consistency:** orch branch exists in each repo
 * 3. **Worktree health:** persisted lane worktrees are accessible or cleanly absent
 *
 * Pure-ish function — reads filesystem/git state but does not mutate anything.
 *
 * @param persistedState   - Loaded batch state
 * @param repoRoot         - Default repo root (cwd)
 * @param stateRoot        - Root for state files (.pi/)
 * @param workspaceConfig  - Workspace configuration (null in repo mode)
 * @returns Diagnostics result with pass/fail and per-check details
 */
export function runPreResumeDiagnostics(
	persistedState: PersistedBatchState,
	repoRoot: string,
	stateRoot: string,
	workspaceConfig?: WorkspaceConfig | null,
): PreResumeDiagnosticsResult {
	const checks: DiagnosticCheckResult[] = [];

	// 1. State coherence — verify batch-state.json is well-formed
	// (Already loaded by caller, so if we get here the state is valid.)
	checks.push({
		check: "state-coherence",
		passed: true,
		detail: `Batch state loaded successfully (batchId: ${persistedState.batchId}, phase: ${persistedState.phase})`,
	});

	// 2. Branch consistency — verify orch branch exists in each repo
	const repoRoots = collectRepoRoots(persistedState, repoRoot, workspaceConfig);
	for (const root of repoRoots) {
		const repoId = resolveRepoIdFromRoot(root, workspaceConfig);
		const label = repoId ? `repo:${repoId}` : "default-repo";

		if (persistedState.orchBranch) {
			const branchCheck = runGit(
				["rev-parse", "--verify", `refs/heads/${persistedState.orchBranch}`],
				root,
			);
			if (branchCheck.ok) {
				checks.push({
					check: `branch-consistency:${label}`,
					passed: true,
					detail: `Orch branch "${persistedState.orchBranch}" exists in ${label}`,
				});
			} else {
				checks.push({
					check: `branch-consistency:${label}`,
					passed: false,
					detail:
						`Orch branch "${persistedState.orchBranch}" not found in ${label}. ` +
						`The branch may have been deleted or the repo is in an inconsistent state.`,
				});
			}
		}
	}

	// 3. Worktree health — check each persisted lane worktree
	for (const lane of persistedState.lanes) {
		if (!lane.worktreePath) continue;

		const wtExists = existsSync(lane.worktreePath);
		if (wtExists) {
			// Verify it's a valid git worktree (has .git file/directory)
			const gitMarker = join(lane.worktreePath, ".git");
			const isValidWt = existsSync(gitMarker);
			checks.push({
				check: `worktree-health:lane-${lane.laneNumber}`,
				passed: isValidWt,
				detail: isValidWt
					? `Lane ${lane.laneNumber} worktree exists and has valid .git marker`
					: `Lane ${lane.laneNumber} worktree exists at ${lane.worktreePath} but lacks .git marker (corrupted)`,
			});
		} else {
			// Absent worktree is OK — resume will re-create or skip
			checks.push({
				check: `worktree-health:lane-${lane.laneNumber}`,
				passed: true,
				detail: `Lane ${lane.laneNumber} worktree absent (will be re-created on resume)`,
			});
		}
	}

	const failed = checks.filter((c) => !c.passed);
	const passed = failed.length === 0;

	const summary = passed
		? `✅ Pre-resume diagnostics passed (${checks.length} checks)`
		: `❌ Pre-resume diagnostics failed (${failed.length}/${checks.length} checks failed):\n` +
			failed.map((c) => `   • ${c.check}: ${c.detail}`).join("\n");

	return { passed, checks, summary };
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
	force: boolean = false,
	onSupervisorAlert?: import("./types.ts").SupervisorAlertCallback | null,
	supervisorAutonomy: "interactive" | "supervised" | "autonomous" = "autonomous",
	/**
	 * TP-187 (#538): Optional callback fired when a lane reaches a terminal
	 * state during a resumed batch. Threaded through to executeWave so the
	 * supervisor process keeps suppressing zombie alerts after resume too.
	 */
	onLaneTerminated?: import("./types.ts").LaneTerminatedCallback | null,
	/**
	 * TP-187 (#538): Optional callback fired when a lane is freshly
	 * (re-)allocated during resume. The supervisor uses it to lift any
	 * carried-over zombie-alert suppression.
	 */
	onLaneRespawned?: ((laneNumber: number, agentId: string, batchId: string) => void) | null,
): Promise<void> {
	const repoRoot = cwd;
	// State files (.pi/batch-state.json, lane-state, etc.) belong in the workspace root,
	// which is where .pi/ config lives. In repo mode, stateRoot === repoRoot.
	const stateRoot = workspaceRoot ?? cwd;

	// ── TP-076: Supervisor alert emission helper ─────────────────
	const emitAlert = (alert: import("./types.ts").SupervisorAlert): void => {
		if (onSupervisorAlert) {
			try {
				onSupervisorAlert(alert);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				execLog("resume", "unknown", `supervisor alert callback failed: ${msg}`, {
					alertCategory: alert.category,
				});
			}
		}
	};

	// ── 1. Load persisted state ──────────────────────────────────
	let persistedState: PersistedBatchState | null;
	try {
		persistedState = loadBatchState(stateRoot);
	} catch (err: unknown) {
		if (err instanceof StateFileError) {
			onNotify(`❌ Cannot resume: ${err.message}`, "error");
			// ── TP-040 R006: Reset phase on pre-execution early return ──
			// The caller may have set batchState.phase = "launching" before
			// calling this function. Since we're returning without starting
			// any work, reset to "idle" so the batch isn't stuck.
			batchState.phase = "idle";
			return;
		}
		throw err;
	}

	if (!persistedState) {
		if (!force) {
			onNotify(ORCH_MESSAGES.resumeNoState(), "error");
			// TP-040 R006: Reset phase on pre-execution early return
			batchState.phase = "idle";
			return;
		}
		// TP-187 (#539): On force-resume, attempt deterministic reconstruction
		// from .pi/runtime/<batchId>/ runtime artifacts (typically left intact
		// by `orch_abort()` even though `.pi/batch-state.json` is deleted).
		const reconstruction = reconstructBatchStateFromRuntime(stateRoot);
		if (!reconstruction.ok) {
			onNotify(ORCH_MESSAGES.resumeNoStateAfterAbort(reconstruction.error, null), "error");
			// TP-040 R006: Reset phase on pre-execution early return
			batchState.phase = "idle";
			return;
		}
		// #631: the parent gated engine ownership for a SPECIFIC batch. If the
		// deterministic reconstruction picked a different one, refuse BEFORE any
		// write — persisting reconstructed state for an ungated batch is itself an
		// unauthorized recovery mutation.
		if (batchState.batchId && reconstruction.batchId !== batchState.batchId) {
			const msg =
				`resume target mismatch: this engine was authorized for batch ${batchState.batchId} but reconstruction ` +
				`selected ${reconstruction.batchId}. Refusing without writing (ownership of ${reconstruction.batchId} was never verified).`;
			execLog("resume", batchState.batchId, msg);
			onNotify(`❌ ${msg}`, "error");
			batchState.phase = "failed";
			batchState.endedAt = Date.now();
			batchState.errors.push(msg);
			return;
		}

		// Successful reconstruction: persist so the rest of resumeOrchBatch
		// proceeds with a normal on-disk batch-state.json picture.
		onNotify(
			ORCH_MESSAGES.resumeReconstructed(reconstruction.batchId, reconstruction.selectionNote),
			"warning",
		);
		try {
			saveBatchState(JSON.stringify(reconstruction.state, null, 2), stateRoot);
		} catch (err) {
			onNotify(
				ORCH_MESSAGES.resumeNoStateAfterAbort(
					`reconstructed state could not be persisted: ${err instanceof Error ? err.message : String(err)}`,
					reconstruction.batchId,
				),
				"error",
			);
			// TP-040 R006: Reset phase on pre-execution early return
			batchState.phase = "idle";
			return;
		}
		persistedState = reconstruction.state;
	}

	// ── 2. Check eligibility ─────────────────────────────────────
	// #631: the parent gated engine ownership against a specific target and
	// published this engine's identity for it. Never resume a DIFFERENT batch
	// than the one authorized (e.g. reconstruction selecting another runtime
	// dir) — that batch's engine was never checked.
	if (batchState.batchId && persistedState.batchId !== batchState.batchId) {
		const msg =
			`resume target mismatch: this engine was authorized for batch ${batchState.batchId} but the ` +
			`persisted/reconstructed state is ${persistedState.batchId}. Refusing (ownership of ${persistedState.batchId} was never verified).`;
		execLog("resume", batchState.batchId, msg);
		onNotify(`❌ ${msg}`, "error");
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push(msg);
		return;
	}

	const eligibility = checkResumeEligibility(persistedState, force);
	if (!eligibility.eligible) {
		onNotify(
			ORCH_MESSAGES.resumePhaseNotResumable(
				persistedState.batchId,
				persistedState.phase,
				eligibility.reason,
			),
			"error",
		);
		// TP-040 R006: Reset phase on pre-execution early return
		batchState.phase = "idle";
		return;
	}

	// ── 2b. Force-resume: pre-resume diagnostics & state mutation ──
	const isForceResume =
		force && (persistedState.phase === "stopped" || persistedState.phase === "failed");
	if (isForceResume) {
		onNotify(
			ORCH_MESSAGES.forceResumeStarting(persistedState.batchId, persistedState.phase),
			"warning",
		);

		// Run pre-resume diagnostics before allowing force-resume
		const diagnostics = runPreResumeDiagnostics(persistedState, repoRoot, stateRoot, workspaceConfig);
		onNotify(diagnostics.summary, diagnostics.passed ? "info" : "error");

		if (!diagnostics.passed) {
			onNotify(ORCH_MESSAGES.forceResumeDiagnosticsFailed(persistedState.batchId), "error");
			// TP-040 R006: Reset phase on pre-execution early return
			batchState.phase = "idle";
			return;
		}

		// Record force intent in resilience state
		persistedState.resilience.resumeForced = true;

		// Reset phase to paused so normal resume flow can proceed
		execLog(
			"resume",
			persistedState.batchId,
			`force-resume: phase ${persistedState.phase} → paused`,
			{
				diagnosticChecks: diagnostics.checks.length,
				diagnosticsPassed: diagnostics.passed,
			},
		);
		persistedState.phase = "paused";
	}

	onNotify(ORCH_MESSAGES.resumeStarting(persistedState.batchId, persistedState.phase), "info");

	// ── 2c. #627: validated mailbox replay → strict hold persistence ──────
	// An escalation still sitting in a worker outbox with no hold record (crash
	// between the outbox write and the strict persist) is attributed HERE —
	// never guessed by a lane later — and persisted before frontier repair and
	// reconciliation. Ambiguous legacy (unscoped) messages refuse the resume.
	{
		const replay = replayUnrecordedEscalations(persistedState, (agentId) =>
			readOutboxStrict(stateRoot, persistedState.batchId, agentId),
		);
		if (replay.ok === false) {
			throw new ResumeError("RESUME_INVALID_STATE", replay.error);
		}
		if (replay.opened.length > 0) {
			execLog(
				"resume",
				persistedState.batchId,
				`hold-first: replayed ${replay.opened.length} unrecorded escalation(s) into the hold table: ${replay.opened.map((h) => `${h.escalationId}→${h.taskId}${h.segmentId ? `::${h.segmentId}` : ""}`).join(", ")}`,
			);
			// Strict: a hold that exists only in memory is a released hold.
			saveBatchState(JSON.stringify(persistedState, null, 2), stateRoot);
		}
	}

	// ── 2c'. #627: a worker-written .DONE under a hold is a claim, not authority.
	// Quarantine it at every location discovery / .DONE collection consult, so
	// the task stays pending in discovery and is re-executed into the hold loop
	// (Sage review round 2, blocker B).
	for (const q of quarantineUnauthorizedDoneMarkers(persistedState, repoRoot, workspaceConfig)) {
		execLog("resume", persistedState.batchId, `hold-first: quarantined unauthorized .DONE ${q}`);
	}

	const segmentFrontierByTask = reconstructSegmentFrontier(persistedState);
	// ── 2d. #627: hold-aware frontier repair ─────────────────────────────
	// A hold on a specific segment pins that segment as the task's active one
	// (unless it already succeeded) so re-execution runs the HELD segment, not
	// whatever the failed/pending heuristics chose.
	pinHeldSegments(persistedState);
	if (segmentFrontierByTask.size > 0) {
		let completedSegments = 0;
		let inFlightSegments = 0;
		let pendingSegments = 0;
		for (const frontier of segmentFrontierByTask.values()) {
			completedSegments += frontier.completedSegmentIds.length;
			inFlightSegments += frontier.inFlightSegmentIds.length;
			pendingSegments += frontier.pendingSegmentIds.length;
		}
		execLog("resume", persistedState.batchId, `segment frontier reconstructed`, {
			tasks: segmentFrontierByTask.size,
			completedSegments,
			inFlightSegments,
			pendingSegments,
		});
	}

	const runtimeWavePlan = buildResumeRuntimeWavePlan(persistedState);
	// TP-108/112: Runtime V2 backend selection for resumed batches.
	// MUST be computed before any backend-aware branch (section 3+).
	const resumeBackend: RuntimeBackend = selectRuntimeBackend(
		"all",
		runtimeWavePlan,
		workspaceConfig,
	).backend;
	execLog("resume", batchState.batchId, `runtime backend for resumed execution: ${resumeBackend}`);

	// ── 3. Discover live signals ─────────────────────────────────
	// TP-112/119: Runtime V2 session liveness check only.
	// Alive sessions are discovered from the process registry.
	const aliveSessions = new Set<string>();
	const registry = readRegistrySnapshot(stateRoot, persistedState.batchId);
	if (registry) {
		for (const manifest of Object.values(registry.agents)) {
			if (!isTerminalStatus(manifest.status) && isProcessAlive(manifest.pid)) {
				aliveSessions.add(manifest.agentId);
				// Also add lane session name (without role suffix) so reconciliation
				// matches persisted task.sessionName.
				// e.g., "orch-op-lane-1-worker" -> also add "orch-op-lane-1"
				const laneSession = manifest.agentId.replace(/-(worker|reviewer)$/, "");
				if (laneSession !== manifest.agentId) aliveSessions.add(laneSession);
			}
		}
	}

	// Check .DONE files — check both original path and worktree-relative path.
	// TP-109: In workspace mode or V2 execution, .DONE is written in the worktree
	// at the resolved packet path, not the original discovery path. Resume must
	// check both locations for authoritative completion detection.
	const doneTaskIds = collectDoneTaskIdsForResume(persistedState, repoRoot, workspaceConfig);

	// ── 3b. Detect existing worktrees ────────────────────────────
	const existingWorktreeTaskIds = new Set<string>();
	for (const task of persistedState.tasks) {
		const laneRecord = persistedState.lanes.find((l) => l.taskIds.includes(task.taskId));
		if (laneRecord && laneRecord.worktreePath && existsSync(laneRecord.worktreePath)) {
			existingWorktreeTaskIds.add(task.taskId);
		}
	}

	// ── 3c. #627: hold-first — which tasks are bound by an unresolved hold? ──
	// The durable hold table is the only source here: unrecorded escalations
	// were already replayed into it (validated attribution + strict persist)
	// BEFORE frontier reconstruction, see step 2c above.
	const holdBlockedTaskIds = new Set<string>();
	for (const task of persistedState.tasks) {
		if (taskCompletionBlocked(persistedState.holds ?? [], task.taskId)) {
			holdBlockedTaskIds.add(task.taskId);
		}
	}
	if (holdBlockedTaskIds.size > 0) {
		execLog(
			"resume",
			persistedState.batchId,
			`hold-first: ${[...holdBlockedTaskIds].join(", ")} bound by unresolved holds — re-executed into the hold loop (no spawn until a ruling)`,
		);
	}

	// ── 4. Reconcile task states ─────────────────────────────────
	const reconciledTasks = reconcileTaskStates(
		persistedState,
		aliveSessions,
		doneTaskIds,
		existingWorktreeTaskIds,
		holdBlockedTaskIds,
	);

	// ── 4b. Clear stale session allocation for tasks reconciled as pending ──
	// TP-037 (Bug #102b): Pending tasks that had a sessionName from a prior
	// failed resume but were never actually started need their allocation
	// metadata cleared so they can be freshly assigned to new lanes.
	// We also prune these tasks from persisted lane records so that
	// serializeBatchState() doesn't reintroduce stale sessionName via lane
	// fallback paths when outcome.sessionName is absent.
	const stalePendingTaskIds = new Set<string>();
	for (const reconciled of reconciledTasks) {
		if (reconciled.action === "pending") {
			const persistedTask = persistedState.tasks.find((t) => t.taskId === reconciled.taskId);
			if (persistedTask && persistedTask.sessionName) {
				execLog(
					"resume",
					persistedState.batchId,
					`clear-stale-session: ${reconciled.taskId} had stale session "${persistedTask.sessionName}" (lane ${persistedTask.laneNumber})`,
				);
				stalePendingTaskIds.add(reconciled.taskId);
				persistedTask.sessionName = "";
				persistedTask.laneNumber = 0;
			}
		}
	}
	// Prune stale-pending tasks from lane records so reconstructAllocatedLanes()
	// (and subsequent serializeBatchState()) won't map them back to the old lane.
	if (stalePendingTaskIds.size > 0) {
		for (const lane of persistedState.lanes) {
			lane.taskIds = lane.taskIds.filter((id) => !stalePendingTaskIds.has(id));
		}
	}

	// ── 5. Compute resume point ──────────────────────────────────
	const resumePoint = computeResumePoint(persistedState, reconciledTasks, runtimeWavePlan);
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
		onNotify(ORCH_MESSAGES.resumeReconnecting(resumePoint.reconnectTaskIds.length), "info");
	}

	if (resumePoint.resumeWaveIndex > 0) {
		onNotify(ORCH_MESSAGES.resumeSkippedWaves(resumePoint.resumeWaveIndex), "info");
	}

	if (resumePoint.mergeRetryWaveIndexes.length > 0) {
		onNotify(
			`🔀 ${resumePoint.mergeRetryWaveIndexes.length} wave(s) need merge retry: ${resumePoint.mergeRetryWaveIndexes.map((i) => `W${i + 1}`).join(", ")}`,
			"warning",
		);
	}

	// ── 6. Reconstruct runtime state ─────────────────────────────

	// Guard: orchBranch must be present for routing. Persisted states from
	// pre-TP-022 runs may have orchBranch="" (TP-020 defaults).
	// Check BEFORE mutating batchState so phase/batchId remain idle on rejection,
	// allowing future /orch-resume or /orch-abort to proceed.
	if (!persistedState.orchBranch) {
		onNotify(
			`❌ Cannot resume batch ${persistedState.batchId}: persisted state has no orch branch. ` +
				`This batch was created before orch-branch routing was implemented. ` +
				`Use /orch-abort to clean up, then start a new batch.`,
			"error",
		);
		// TP-040 R006: Reset phase on pre-execution early return
		batchState.phase = "idle";
		return;
	}

	batchState.phase = "executing";
	batchState.batchId = persistedState.batchId;
	batchState.baseBranch = persistedState.baseBranch || "";
	batchState.orchBranch = persistedState.orchBranch;

	batchState.mode = persistedState.mode;
	batchState.startedAt = persistedState.startedAt;
	// Preserve pauseSignal if already set during "launching" phase (TP-040)
	if (!batchState.pauseSignal?.paused) batchState.pauseSignal = { paused: false };
	batchState.totalWaves = persistedState.totalWaves;
	// TP-166: Restore task-level wave metadata for correct display.
	// Normalize: fall back to totalWaves for pre-TP-166 state files.
	batchState.taskLevelWaveCount = persistedState.taskLevelWaveCount ?? persistedState.totalWaves;
	batchState.roundToTaskWave = persistedState.roundToTaskWave
		? [...persistedState.roundToTaskWave]
		: undefined;
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
		for (let wi = resumePoint.resumeWaveIndex; wi < runtimeWavePlan.length; wi++) {
			for (const taskId of runtimeWavePlan[wi]) {
				if (persistedBlockedTaskIds.has(taskId)) {
					uncountedBlocked++;
				}
			}
		}
		if (uncountedBlocked > 0) {
			batchState.blockedTasks += uncountedBlocked;
			execLog(
				"resume",
				persistedState.batchId,
				`blocked counter fix: ${uncountedBlocked} persisted-blocked task(s) in unvisited waves added to blockedTasks`,
			);
		}
	}

	batchState.errors = [...persistedState.errors];
	batchState.endedAt = null;
	batchState.currentWaveIndex = resumePoint.resumeWaveIndex;
	batchState.waveResults = [];

	// v3: Carry forward resilience and diagnostics from persisted state
	batchState.resilience = persistedState.resilience;
	batchState.diagnostics = persistedState.diagnostics;
	// Carry forward merge HISTORY. The runtime starts fresh on every resume, so
	// without this the next checkpoint serialized only the merges appended by
	// this pass and earlier waves' records were dropped — a later resume then
	// re-flagged already-merged waves for retry (and catch-up re-selected their
	// lanes). Persisted records are 0-based; runtime is 1-based (converted once
	// here, back once in serializeBatchState). Order preserved (latest-wins reads).
	batchState.mergeResults = (persistedState.mergeResults ?? []).map(
		(mr) =>
			({
				waveIndex: mr.waveIndex + 1,
				status: mr.status,
				laneResults: [],
				failedLane: mr.failedLane,
				failureReason: mr.failureReason,
				totalDurationMs: 0,
			}) as MergeWaveResult,
	);
	// v4: Carry forward segment records (including dynamically expanded segments)
	batchState.segments = [...(persistedState.segments ?? [])];
	// #627: holds are authoritative and survive resume verbatim. Retry is not
	// release; only a ruling, an abort, or an acknowledged delivery closes one.
	batchState.holds = (persistedState.holds ?? []).map((h) => ({ ...h }));
	// #627: durable hold store, available to the re-execution/reconnect phase
	// below AND to the resumed waves. Strict persistence (throws), same
	// contract as the engine's. The persistence context is upgraded once the
	// wave-phase variables exist (see "holdPersistCtx" below).
	// Thunks, not values (Sage review, blocker 4): a strict checkpoint during
	// the re-execution phase must serialize the PERSISTED task table faithfully
	// (an empty outcome list would rewrite every task as pending with an empty
	// folder), and later checkpoints must follow `latestAllocatedLanes` /
	// `allTaskOutcomes` as those variables are reassigned.
	const preWaveOutcomes: LaneTaskOutcome[] = persistedState.tasks.map((t) => ({
		taskId: t.taskId,
		status: t.status,
		segmentId: t.activeSegmentId ?? null,
		startTime: t.startedAt,
		endTime: t.endedAt,
		exitReason: t.exitReason,
		sessionName: t.sessionName,
		doneFileFound: t.doneFileFound,
		laneNumber: t.laneNumber || undefined,
		// Recovery metadata must survive a strict checkpoint (Sage round 2, E).
		...(t.partialProgressCommits !== undefined
			? { partialProgressCommits: t.partialProgressCommits }
			: {}),
		...(t.partialProgressBranch !== undefined
			? { partialProgressBranch: t.partialProgressBranch }
			: {}),
		...(t.exitDiagnostic !== undefined ? { exitDiagnostic: t.exitDiagnostic } : {}),
	}));
	// Synthetic discovery for pre-wave checkpoints: persistRuntimeStateStrict
	// enriches taskFolder / repo fields / segment ids from `discovery.pending`;
	// without it a checkpoint would write taskFolder "" for every task.
	const preWaveDiscovery = {
		pending: new Map(
			persistedState.tasks.map((t) => [
				t.taskId,
				{
					taskId: t.taskId,
					taskFolder: t.taskFolder,
					promptRepoId: t.repoId,
					resolvedRepoId: t.resolvedRepoId,
					packetRepoId: t.packetRepoId,
					packetTaskPath: t.packetTaskPath,
					segmentIds: t.segmentIds,
					activeSegmentId: t.activeSegmentId,
				},
			]),
		),
		completed: new Map(),
	} as unknown as import("./types.ts").DiscoveryResult;
	/**
	 * Merge fresh discovery WITH the persisted fallback (Sage review round 3):
	 * discovery.pending only lists tasks still to run, so a checkpoint that
	 * relied on it alone wrote taskFolder "" for every completed/archived task
	 * — durable metadata loss on crash, and merge artifact staging skips tasks
	 * with no folder. Fresh entries win; persisted entries fill the gaps.
	 */
	const withPersistedFallback = (
		fresh: import("./types.ts").DiscoveryResult | null,
	): import("./types.ts").DiscoveryResult => {
		if (!fresh) return preWaveDiscovery;
		const pending = new Map(preWaveDiscovery.pending);
		for (const [id, task] of fresh.pending) pending.set(id, task);
		return { ...fresh, pending } as import("./types.ts").DiscoveryResult;
	};
	const preWaveLanes = reconstructAllocatedLanes(persistedState.lanes, persistedState.tasks);
	const holdPersistCtx: {
		wavePlan: () => string[][];
		lanes: () => AllocatedLane[];
		outcomes: () => LaneTaskOutcome[];
		discovery: () => import("./types.ts").DiscoveryResult | null;
	} = {
		wavePlan: () => runtimeWavePlan,
		lanes: () => preWaveLanes,
		outcomes: () => preWaveOutcomes,
		discovery: () => preWaveDiscovery,
	};
	const holdStore = createHoldStore(batchState, (reason) =>
		persistRuntimeStateStrict(
			reason,
			batchState,
			holdPersistCtx.wavePlan(),
			holdPersistCtx.lanes(),
			holdPersistCtx.outcomes(),
			holdPersistCtx.discovery(),
			stateRoot,
		),
	);
	// Carry forward unknown fields for roundtrip preservation
	if (persistedState._extraFields) {
		batchState._extraFields = persistedState._extraFields;
	}

	// ── 6b. TP-169: Verify orch branch exists in all workspace repos ────
	// During the original batch start, the orch branch was created in every
	// workspace repo. On resume, we verify it still exists. If it's missing
	// in any repo (e.g., deleted by user, corrupted), re-create it from the
	// repo's current branch so that worktree creation doesn't silently fall
	// back to the base branch, bypassing orch branch isolation.
	if (workspaceConfig && batchState.orchBranch) {
		for (const [repoId, repoConf] of workspaceConfig.repos) {
			const rRoot = repoConf.path;
			const check = runGit(["rev-parse", "--verify", `refs/heads/${batchState.orchBranch}`], rRoot);
			if (!check.ok) {
				// Orch branch missing in this repo — re-create from current HEAD
				const repoBranch = getCurrentBranch(rRoot) || "HEAD";
				const createRes = runGit(["branch", batchState.orchBranch, repoBranch], rRoot);
				if (createRes.ok) {
					execLog("resume", batchState.batchId, `re-created missing orch branch in ${repoId}`, {
						orchBranch: batchState.orchBranch,
						base: repoBranch,
					});
					onNotify(
						`⚠️ Orch branch "${batchState.orchBranch}" was missing in repo "${repoId}" — re-created from ${repoBranch}`,
						"warning",
					);
				} else {
					const errMsg =
						`Failed to re-create orch branch "${batchState.orchBranch}" in repo "${repoId}": ${createRes.stderr}. ` +
						`Cannot resume without orch branch isolation.`;
					execLog("resume", batchState.batchId, errMsg, {
						orchBranch: batchState.orchBranch,
						error: createRes.stderr,
					});
					throw new Error(errMsg);
				}
			}
		}
	}

	// ── 7. Re-run discovery for ParsedTask metadata ──────────────
	// We need fresh ParsedTask data (taskFolder, promptPath) for execution.
	// Use "all" to discover all areas.
	// (holdPersistCtx.discovery is upgraded right after this call — see below)
	const discovery = runDiscovery("all", runnerConfig.task_areas, cwd, {
		refreshDependencies: false,
		dependencySource: orchConfig.dependencies.source,
		useDependencyCache: orchConfig.dependencies.cache,
		workspaceConfig: workspaceConfig ?? null,
	});
	holdPersistCtx.discovery = () => withPersistedFallback(discovery);

	// Build dependency graph for skip-dependents policy
	const depGraph = buildDependencyGraph(discovery.pending, discovery.completed);
	batchState.dependencyGraph = depGraph;

	// Rehydrate discovered tasks with persisted segment metadata.
	// Dynamically expanded segments may reference tasks that have segment-level
	// fields (segmentIds, activeSegmentId, packetRepoId, packetTaskPath) set
	// during the prior run. Merge these back into discovered ParsedTask records
	// so execution can resume with correct segment context.
	for (const persistedTask of persistedState.tasks) {
		const parsed = discovery.pending.get(persistedTask.taskId);
		if (!parsed) continue;
		if (persistedTask.segmentIds?.length) {
			parsed.segmentIds = persistedTask.segmentIds;
		}
		if (persistedTask.activeSegmentId !== undefined) {
			parsed.activeSegmentId = persistedTask.activeSegmentId;
		}
		if (persistedTask.packetRepoId) {
			parsed.packetRepoId = persistedTask.packetRepoId;
		}
		if (persistedTask.packetTaskPath) {
			parsed.packetTaskPath = persistedTask.packetTaskPath;
		}
	}

	// ── 8. Handle alive sessions (reconnect) ─────────────────────
	// For tasks with alive sessions, we need to wait for them to complete.
	// We poll each alive session's .DONE file.
	const reconnectTasks = reconciledTasks.filter((t) => t.action === "reconnect");
	const reconnectFinalStatus = new Map<string, LaneTaskStatus>();

	if (reconnectTasks.length > 0) {
		// Wait for reconnected tasks to complete (poll .DONE files)
		for (const task of reconnectTasks) {
			const parsedTask = discovery.pending.get(task.taskId);
			if (!parsedTask) continue;

			// Find the lane info from persisted state
			const laneRecord = persistedState.lanes.find((l) => l.taskIds.includes(task.taskId));
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
				laneSessionId: laneRecord.laneSessionId,
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

			// TP-112: Runtime V2 reconnect.
			// Agent-host processes do not survive supervisor restart, so reconnect
			// uses terminate + rehydrate via executeLaneV2.
			execLog("resume", task.taskId, "V2 reconnect: terminate + rehydrate via lane-runner", {
				repoId: laneRecord.repoId ?? "(default)",
			});
			try {
				await terminateAliveV2Agents(stateRoot, persistedState.batchId, laneRecord.laneSessionId);
				const laneResult = await executeLaneV2(
					lane,
					orchConfig,
					laneRepoRoot,
					batchState.pauseSignal,
					workspaceRoot,
					!!workspaceConfig,
					{
						ORCH_BATCH_ID: batchState.batchId,
						...buildWorkerEnv(runnerConfig.worker),
						...buildReviewerEnv(runnerConfig.reviewer),
						...buildWorkerExcludeEnv(runnerConfig.workerExcludeExtensions),
					},
					emitAlert,
					undefined,
					undefined,
					holdStore,
				);
				const taskResult = laneResult.tasks.find((t) => t.taskId === task.taskId);
				if (taskResult?.status === "succeeded") {
					reconnectFinalStatus.set(task.taskId, "succeeded");
					completedTaskSet.add(task.taskId);
					failedTaskSet.delete(task.taskId);
					reconnectTaskSet.delete(task.taskId);
					batchState.succeededTasks++;
				} else {
					reconnectFinalStatus.set(task.taskId, "failed");
					failedTaskSet.add(task.taskId);
					completedTaskSet.delete(task.taskId);
					reconnectTaskSet.delete(task.taskId);
					batchState.failedTasks++;
				}
			} catch (err: unknown) {
				reconnectFinalStatus.set(task.taskId, "failed");
				failedTaskSet.add(task.taskId);
				completedTaskSet.delete(task.taskId);
				reconnectTaskSet.delete(task.taskId);
				batchState.failedTasks++;
				execLog(
					"resume",
					task.taskId,
					`V2 reconnect error: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	// ── 8b. Handle re-execute tasks (dead session + existing worktree) ──
	const reExecuteTasks = reconciledTasks.filter((t) => t.action === "re-execute");
	// Worktree preservation flag (declared before 8c/8d so a merge failure on
	// resume can set it; consumed by terminal cleanup).
	let preserveWorktreesForResume = false;
	const reExecuteFinalStatus = new Map<string, LaneTaskStatus>();
	// #629: the REAL lane outcome of a re-executed task (telemetry, exit
	// diagnostic, timestamps). Previously discarded — the synthesized outcome
	// below carried the persisted (already-cleared) diagnostic instead.
	const reExecuteOutcome = new Map<string, LaneTaskOutcome>();
	const reExecAllocatedLanes: AllocatedLane[] = [];

	if (reExecuteTasks.length > 0) {
		onNotify(
			`🔄 Re-executing ${reExecuteTasks.length} interrupted task(s) in existing worktrees...`,
			"info",
		);

		// #627 (Sage design review): re-execution was task-SERIAL — a restored
		// hold in the first slot would have parked every other interrupted lane
		// behind it. Run lanes in PARALLEL, serial WITHIN a lane (one worktree,
		// one worker at a time). Shared bookkeeping below is mutated only between
		// awaits, so it needs no locking.
		const reExecByLane = new Map<number, typeof reExecuteTasks>();
		for (const task of reExecuteTasks) {
			const laneRecord = persistedState.lanes.find((l) => l.taskIds.includes(task.taskId));
			const key = laneRecord?.laneNumber ?? -1;
			if (!reExecByLane.has(key)) reExecByLane.set(key, []);
			reExecByLane.get(key)!.push(task);
		}
		const reExecuteOne = async (task: (typeof reExecuteTasks)[number]): Promise<void> => {
			const parsedTask = discovery.pending.get(task.taskId);
			if (!parsedTask) return;

			const laneRecord = persistedState.lanes.find((l) => l.taskIds.includes(task.taskId));
			if (!laneRecord) return;

			const allocatedTask: AllocatedTask = {
				taskId: task.taskId,
				order: 0,
				task: parsedTask,
				estimatedMinutes: 0,
			};
			const lane: AllocatedLane = {
				laneNumber: laneRecord.laneNumber,
				laneId: laneRecord.laneId,
				laneSessionId: laneRecord.laneSessionId,
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
				session: laneRecord.laneSessionId,
				worktree: laneRecord.worktreePath,
				repoId: laneRecord.repoId ?? "(default)",
			});

			try {
				// TP-112: Runtime V2 re-execution.
				await terminateAliveV2Agents(stateRoot, batchState.batchId, laneRecord.laneSessionId);
				const laneResult = await executeLaneV2(
					lane,
					orchConfig,
					reExecRepoRoot,
					batchState.pauseSignal,
					workspaceRoot,
					!!workspaceConfig,
					{
						ORCH_BATCH_ID: batchState.batchId,
						...buildWorkerEnv(runnerConfig.worker),
						...buildReviewerEnv(runnerConfig.reviewer),
						...buildWorkerExcludeEnv(runnerConfig.workerExcludeExtensions),
					},
					emitAlert,
					undefined,
					undefined,
					holdStore,
				);
				const taskResult = laneResult.tasks.find((t) => t.taskId === task.taskId);
				const pollResult: { status: LaneTaskStatus; exitReason: string; doneFileFound: boolean } = {
					status: taskResult?.status ?? "failed",
					exitReason: taskResult?.exitReason ?? "V2 re-execution completed",
					doneFileFound: taskResult?.doneFileFound ?? false,
				};
				// #627: a HELD outcome (pause or hold-timeout while awaiting a ruling)
				// is interrupted-not-complete: the task stays held, segments untouched,
				// worktree preserved; the next resume re-enters the hold loop.
				if (pollResult.status === "held") {
					reExecuteFinalStatus.set(task.taskId, "held");
					if (taskResult) reExecuteOutcome.set(task.taskId, taskResult);
					execLog("resume", task.taskId, `re-execution held — ${pollResult.exitReason}`);
					return;
				}
				// #629: a PAUSE during re-execution surfaces as `skipped` from
				// executeLaneV2. That is not a terminal outcome: leave the task and
				// its segments pending/re-executable (the previous code marked the
				// task failed; treating the real outcome verbatim would make it an
				// unretryable `skipped`). Nothing else changes; the next resume
				// reconciles it again.
				if (
					pollResult.status === "pending" ||
					(pollResult.status === "skipped" && /paused/i.test(pollResult.exitReason))
				) {
					reExecuteFinalStatus.set(task.taskId, "pending");
					execLog(
						"resume",
						task.taskId,
						"re-execution paused — task remains pending for the next resume",
					);
					return;
				}
				if (taskResult) reExecuteOutcome.set(task.taskId, taskResult);

				// #629: keep SEGMENT authority — transition the EXECUTED segment record
				// to the re-execution result. Re-execution runs the unit built from the
				// task's activeSegmentId, i.e. ONE segment (segmentId null = whole
				// single-segment/legacy task). Without this a successful retry persisted
				// task=succeeded / segment=pending and the next resume normalized the
				// task straight back to pending.
				const segFinal: "succeeded" | "failed" =
					pollResult.status === "succeeded" ? "succeeded" : "failed";
				const executedSegmentId =
					taskResult?.segmentId ??
					persistedState.tasks.find((t) => t.taskId === task.taskId)?.activeSegmentId ??
					null;
				const touchedSegments = applyReExecutionOutcomeToSegments(
					batchState.segments,
					task.taskId,
					segFinal,
					{
						startTime: taskResult?.startTime,
						endTime: taskResult?.endTime,
						exitReason: pollResult.exitReason,
						exitDiagnostic: taskResult?.exitDiagnostic,
					},
					executedSegmentId,
				);
				if (touchedSegments.length > 0) {
					execLog("resume", task.taskId, `re-execution: segment records → ${segFinal}`, {
						segments: touchedSegments.join(","),
						executedSegmentId: executedSegmentId ?? "(whole task)",
					});
				}

				// Task completion is derived from the segment FRONTIER, not from one
				// segment's success: a non-final segment succeeding leaves the task
				// pending with downstream segments still to run.
				const frontierComplete = taskSegmentsAllSucceeded(batchState.segments, task.taskId);
				if (pollResult.status === "succeeded" && frontierComplete === false) {
					reExecuteFinalStatus.set(task.taskId, "pending");
					reExecuteOutcome.delete(task.taskId); // not a task-level outcome yet
					reExecuteTaskSet.delete(task.taskId);
					reExecAllocatedLanes.push(lane);
					// Advance the frontier so the next execution runs the NEXT segment (on
					// both the persisted record and the parsed task the wave loop will use).
					const nextSeg = advanceActiveSegment(
						{ tasks: persistedState.tasks, segments: batchState.segments } as never,
						task.taskId,
					);
					const parsedForFrontier = discovery.pending.get(task.taskId);
					if (parsedForFrontier) parsedForFrontier.activeSegmentId = nextSeg;
					execLog(
						"resume",
						task.taskId,
						`re-executed segment ${executedSegmentId} succeeded — task has further segments pending`,
					);
				} else if (pollResult.status === "succeeded") {
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
					execLog(
						"resume",
						task.taskId,
						`re-executed task ${pollResult.status}: ${pollResult.exitReason}`,
					);
				}
			} catch (err: unknown) {
				reExecuteFinalStatus.set(task.taskId, "failed");
				failedTaskSet.add(task.taskId);
				completedTaskSet.delete(task.taskId);
				reExecuteTaskSet.delete(task.taskId);
				batchState.failedTasks++;
				const msg = err instanceof Error ? err.message : String(err);
				execLog("resume", task.taskId, `re-execution error: ${msg}`);
				applyReExecutionOutcomeToSegments(batchState.segments, task.taskId, "failed", {
					exitReason: `re-execution error: ${msg}`,
				});
			}
		};
		await Promise.all(
			[...reExecByLane.values()].map(async (laneTasks) => {
				for (const task of laneTasks) {
					await reExecuteOne(task);
				}
			}),
		);
	}

	// ── 8c. Merge re-executed lane branches before cleanup ───────
	// Re-executed tasks completed outside the normal wave loop, so their
	// branches would not be merged by step 10. Merge them now.
	if (reExecAllocatedLanes.length > 0) {
		const succeededReExecTaskIds = [...reExecuteFinalStatus.entries()]
			.filter(([_, status]) => status === "succeeded")
			.map(([taskId]) => taskId);

		if (succeededReExecTaskIds.length > 0) {
			onNotify(`🔀 Merging ${reExecAllocatedLanes.length} re-executed lane branch(es)...`, "info");

			// Build synthetic WaveExecutionResult for mergeWaveByRepo()
			const syntheticLaneResults: LaneExecutionResult[] = reExecAllocatedLanes.map((lane) => ({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				tasks: lane.tasks.map((t) => ({
					taskId: t.taskId,
					status: "succeeded" as LaneTaskStatus,
					startTime: Date.now(),
					endTime: Date.now(),
					exitReason: "Re-executed task completed successfully",
					sessionName: lane.laneSessionId,
					doneFileFound: true,
					laneNumber: lane.laneNumber,
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

			const reExecMergeResult = await mergeWaveByRepo(
				reExecAllocatedLanes,
				syntheticWaveResult,
				RE_EXEC_WAVE_INDEX,
				orchConfig,
				repoRoot,
				batchState.batchId,
				batchState.orchBranch,
				workspaceConfig,
				stateRoot,
				agentRoot,
				runnerConfig.testing_commands,
				undefined, // healthMonitor
				undefined, // forceMixedOutcome
				resumeBackend,
			);

			if (reExecMergeResult.status === "succeeded") {
				onNotify(
					`✅ Re-executed branch merge complete: ${reExecMergeResult.laneResults.length} lane(s) merged`,
					"info",
				);

				// Clean up merged branches (resolve per-lane repo root for workspace mode)
				// TP-032 R006-3: Exclude verification_new_failure lanes from branch cleanup
				for (const lr of reExecMergeResult.laneResults) {
					if (
						!lr.error &&
						(lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED")
					) {
						const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
						deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
					}
				}
			} else {
				// Fail closed (mirrors 8d): a re-executed task that succeeded but whose
				// branch did not merge must not let the batch proceed to a state that
				// reads as complete with its work unmerged. Pause (resumable), preserve
				// worktrees; the next resume re-executes nothing for it (it is succeeded)
				// but 8d's catch-up merge picks its lane up.
				onNotify(
					`⚠️ Re-executed branch merge ${reExecMergeResult.status}: ${reExecMergeResult.failureReason || "unknown"} — batch paused with worktrees preserved; fix the conflict and orch_resume() to retry the merge.`,
					"warning",
				);
				batchState.pauseSignal.paused = true;
				batchState.pauseSignal.cause = "merge-failure";
				preserveWorktreesForResume = true;
				emitAlert({
					category: "merge-failure",
					summary:
						`🔴 Merge of re-executed task(s) ${succeededReExecTaskIds.join(", ")} failed on resume: ${reExecMergeResult.failureReason || "unknown"}
` +
						`  The work remains on the lane branch(es); the batch is paused with worktrees preserved.
` +
						`  Resolve the conflict, then orch_resume() — the catch-up merge re-runs automatically.`,
					context: {
						batchProgress: buildBatchProgressSnapshot(batchState),
						mergeError: reExecMergeResult.failureReason ?? undefined,
					},
				});
			}

			// Attribute the outcome to the ACTUAL original wave(s) of the re-executed
			// tasks (runtime 1-indexed), not the -1 sentinel: persistence clamps the
			// sentinel to wave 0, which mis-attributed a second-wave merge failure to
			// wave 0 and let the real wave keep an older success record.
			// (LAST wave per task — the same mapping selectCatchUpLanes uses for a
			// multi-segment task's lane.)
			const lastWaveOf = new Map<string, number>();
			runtimeWavePlan.forEach((wave, i) => {
				for (const id of wave) lastWaveOf.set(id, i);
			});
			const reExecWaves = new Set<number>();
			for (const id of succeededReExecTaskIds) {
				const w = lastWaveOf.get(id);
				if (w !== undefined) reExecWaves.add(w);
			}
			if (reExecWaves.size === 0) {
				batchState.mergeResults.push(reExecMergeResult);
			} else {
				for (const w of reExecWaves) {
					batchState.mergeResults.push({ ...reExecMergeResult, waveIndex: w + 1 });
				}
			}
		}
	}

	// ── 8d. Catch-up merge: succeeded-but-unmerged lane work ─────
	// A pause (or crash) that lands DURING a wave can leave tasks that succeeded
	// with their lane branches never merged — the wave's merge step did not run.
	// On resume the wave loop only merges what it re-executes, so that work was
	// silently dropped (Sage review of the owned-batch pause fix). Merge every
	// persisted lane whose tasks are all succeeded and whose wave has no
	// successful merge record. Idempotent: an already-merged branch is a no-op.
	// Skipped entirely when 8c already raised a merge-failure pause: a successful
	// subset catch-up must never certify a wave whose other lane work (the failed
	// 8c merge) remains unmerged — the next resume retries BOTH via this step.
	if (batchState.pauseSignal.cause !== "merge-failure") {
		const waveOfTask = new Map<string, number>();
		runtimeWavePlan.forEach((wave, i) => {
			for (const id of wave) waveOfTask.set(id, i);
		});
		const catchUpLanes: AllocatedLane[] = [];
		for (const laneRecord of selectCatchUpLanes(
			persistedState,
			runtimeWavePlan,
			new Set(reExecuteFinalStatus.keys()),
		)) {
			const laneRepoRoot = resolveRepoRoot(laneRecord.repoId, repoRoot, workspaceConfig);
			if (
				!runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${laneRecord.branch}`], laneRepoRoot)
					.ok
			) {
				continue; // branch gone — nothing to merge
			}
			catchUpLanes.push({
				laneNumber: laneRecord.laneNumber,
				laneId: laneRecord.laneId,
				laneSessionId: laneRecord.laneSessionId,
				worktreePath: laneRecord.worktreePath,
				branch: laneRecord.branch,
				tasks: laneRecord.taskIds
					// A task that succeeded may already be in the completed set (no ParsedTask).
					// Enrich a stub from the persisted record so merge staging can still find
					// the task folder (.DONE / STATUS / review artifacts).
					.map((id) => {
						const parsed = discovery.pending.get(id);
						if (parsed) return parsed;
						const rec = persistedState.tasks.find((t) => t.taskId === id);
						return {
							taskId: id,
							taskName: id,
							taskFolder: rec?.taskFolder ?? "",
							promptPath: rec?.taskFolder ? join(rec.taskFolder, "PROMPT.md") : "",
							fileScope: [],
							dependencies: [],
						} as unknown as ParsedTask;
					})
					.map((t) => ({ taskId: t.taskId, order: 0, task: t, estimatedMinutes: 0 })),
				strategy: "round-robin",
				estimatedLoad: 0,
				estimatedMinutes: 0,
				...(laneRecord.repoId !== undefined ? { repoId: laneRecord.repoId } : {}),
			});
		}
		if (catchUpLanes.length > 0) {
			const ids = catchUpLanes.flatMap((l) => l.tasks.map((t) => t.taskId));
			onNotify(
				`🔀 Merging ${catchUpLanes.length} succeeded-but-unmerged lane branch(es) from the interrupted wave (${ids.join(", ")})...`,
				"info",
			);
			const CATCH_UP_WAVE_INDEX = -1;
			const synthetic: WaveExecutionResult = {
				waveIndex: CATCH_UP_WAVE_INDEX,
				startedAt: Date.now(),
				endedAt: Date.now(),
				laneResults: catchUpLanes.map((lane) => ({
					laneNumber: lane.laneNumber,
					laneId: lane.laneId,
					tasks: lane.tasks.map((t) => ({
						taskId: t.taskId,
						status: "succeeded" as LaneTaskStatus,
						startTime: Date.now(),
						endTime: Date.now(),
						exitReason: "Succeeded before pause; merged on resume",
						sessionName: lane.laneSessionId,
						doneFileFound: true,
						laneNumber: lane.laneNumber,
					})),
					overallStatus: "succeeded" as const,
					startTime: Date.now(),
					endTime: Date.now(),
				})),
				policyApplied: orchConfig.failure.on_task_failure,
				stoppedEarly: false,
				failedTaskIds: [],
				skippedTaskIds: [],
				succeededTaskIds: ids,
				blockedTaskIds: [],
				laneCount: catchUpLanes.length,
				overallStatus: "succeeded",
				finalMonitorState: null,
				allocatedLanes: catchUpLanes,
			};
			const catchUp = await mergeWaveByRepo(
				catchUpLanes,
				synthetic,
				CATCH_UP_WAVE_INDEX,
				orchConfig,
				repoRoot,
				batchState.batchId,
				batchState.orchBranch,
				workspaceConfig,
				stateRoot,
				agentRoot,
				runnerConfig.testing_commands,
				undefined,
				undefined,
				resumeBackend,
			);
			if (catchUp.status === "succeeded") {
				onNotify(`✅ Catch-up merge complete: ${catchUp.laneResults.length} lane(s) merged`, "info");
			} else {
				// Normal merge-failure handling: the batch must NOT proceed to a state
				// that can read as complete while succeeded work sits unmerged. Pause
				// (resumable), preserve worktrees, and stop before the wave loop; the
				// next resume re-runs this catch-up (it is the retry mechanism).
				onNotify(
					`⚠️ Catch-up merge ${catchUp.status}: ${catchUp.failureReason || "unknown"} — the succeeded work remains on its lane branch(es). Batch paused; fix the conflict and orch_resume() to retry.`,
					"warning",
				);
				batchState.pauseSignal.paused = true;
				batchState.pauseSignal.cause = "merge-failure";
				preserveWorktreesForResume = true;
				emitAlert({
					category: "merge-failure",
					summary:
						`🔴 Catch-up merge failed on resume for ${ids.join(", ")}: ${catchUp.failureReason || "unknown"}
` +
						`  The succeeded work remains on its lane branch(es); the batch is paused with worktrees preserved.
` +
						`  Resolve the conflict, then orch_resume() — the catch-up merge re-runs automatically.`,
					context: {
						batchProgress: buildBatchProgressSnapshot(batchState),
						mergeError: catchUp.failureReason ?? undefined,
					},
				});
			}
			// Record it against the ORIGINAL wave(s) so the wave loop's merge-retry
			// logic sees those waves as merged (or as needing retry on failure).
			for (const w of new Set(
				catchUpLanes.flatMap((l) => l.tasks.map((t) => waveOfTask.get(t.taskId) ?? 0)),
			)) {
				batchState.mergeResults.push({ ...catchUp, waveIndex: w + 1 });
			}
		}
	}

	// ── 9. Persist state after reconciliation ────────────────────
	// Track state for persistence
	const wavePlan = runtimeWavePlan;
	persistedState.wavePlan = wavePlan;
	if (batchState.totalWaves < wavePlan.length) {
		batchState.totalWaves = wavePlan.length;
	}
	const allTaskOutcomes: LaneTaskOutcome[] = [];

	// Initialize latestAllocatedLanes from persisted lane records so that
	// early persistence calls (before the first resumed wave) retain lane
	// records with repo attribution (laneNumber, laneId, branch, repoId).
	// Without this, the `resume-reconciliation` checkpoint would serialize
	// empty lanes[], losing all lane context until a new wave allocates.
	let latestAllocatedLanes: AllocatedLane[] = reconstructAllocatedLanes(
		persistedState.lanes,
		persistedState.tasks,
	);

	// Track all repo roots encountered during execution (persisted + newly allocated).
	// Used by inter-wave reset and terminal cleanup to cover repos introduced
	// after resume starts (not present in persisted lanes).
	// Initialized from collectRepoRoots() helper for parity with other callers.
	const encounteredRepoRoots = new Set(collectRepoRoots(persistedState, repoRoot, workspaceConfig));

	// #627: from here on, hold persistence carries the full wave-phase context.
	holdPersistCtx.wavePlan = () => wavePlan;
	holdPersistCtx.lanes = () => latestAllocatedLanes;
	holdPersistCtx.outcomes = () => allTaskOutcomes;
	holdPersistCtx.discovery = () => withPersistedFallback(discovery ?? null);

	// Build outcomes from reconciled tasks
	for (const task of reconciledTasks) {
		const persistedTask = persistedState.tasks.find((t) => t.taskId === task.taskId);
		const reconnectStatus = reconnectFinalStatus.get(task.taskId);
		const reExecuteStatus = reExecuteFinalStatus.get(task.taskId);
		// #629: a re-executed task has a REAL outcome — use it verbatim (telemetry,
		// diagnostic, timestamps) rather than synthesizing one from stale state.
		const realOutcome = task.action === "re-execute" ? reExecuteOutcome.get(task.taskId) : undefined;
		if (realOutcome && (realOutcome.status === "succeeded" || realOutcome.status === "failed")) {
			allTaskOutcomes.push({
				...realOutcome,
				laneNumber: realOutcome.laneNumber ?? persistedTask?.laneNumber,
				// Preserve persisted partial-progress metadata when the fresh outcome
				// did not set it (recovery metadata; the stale diagnostic is NOT restored).
				partialProgressCommits:
					realOutcome.partialProgressCommits ?? persistedTask?.partialProgressCommits,
				partialProgressBranch:
					realOutcome.partialProgressBranch ?? persistedTask?.partialProgressBranch,
			});
			continue;
		}
		const status =
			task.action === "reconnect"
				? reconnectStatus || "running"
				: task.action === "re-execute"
					? reExecuteStatus || "pending"
					: task.liveStatus;
		const isTerminal =
			status === "succeeded" || status === "failed" || status === "stalled" || status === "skipped";
		if (status === "held") {
			// #627: keep the runner's own held outcome (reason, telemetry) when present.
			const heldOutcome = reExecuteOutcome.get(task.taskId);
			allTaskOutcomes.push(
				heldOutcome ?? {
					taskId: task.taskId,
					status: "held",
					startTime: persistedTask?.startedAt ?? null,
					endTime: null,
					exitReason: "Held — awaiting a ruling (resume)",
					sessionName: persistedTask?.sessionName ?? "",
					doneFileFound: false,
				},
			);
			continue;
		}
		allTaskOutcomes.push({
			taskId: task.taskId,
			status,
			startTime: persistedTask?.startedAt ?? null,
			endTime: isTerminal ? Date.now() : null,
			exitReason:
				task.action === "mark-complete"
					? ".DONE file found on resume"
					: task.action === "mark-failed"
						? "Session dead, no .DONE file, no worktree on resume"
						: task.action === "reconnect"
							? status === "succeeded"
								? "Reconnected task completed"
								: status === "failed"
									? "Reconnected task failed"
									: "Reconnected to alive session"
							: task.action === "re-execute"
								? status === "succeeded"
									? "Re-executed task completed"
									: status === "failed"
										? "Re-executed task failed"
										: "Re-executing in existing worktree"
								: (persistedTask?.exitReason ?? ""),
			sessionName: persistedTask?.sessionName ?? "",
			doneFileFound: status === "succeeded" ? true : task.doneFileFound,
			laneNumber: persistedTask?.laneNumber,
			// Carry forward partial progress from persisted state (TP-028)
			partialProgressCommits: persistedTask?.partialProgressCommits,
			partialProgressBranch: persistedTask?.partialProgressBranch,
			// v3: Carry forward exit diagnostic from persisted state (TP-030)
			exitDiagnostic: persistedTask?.exitDiagnostic,
		});
	}

	// ── 9b. Seed blocked dependents from reconciled failures ─────
	// Under skip-dependents policy, failures discovered during reconciliation
	// (mark-failed) or resolved during reconnect/re-execute must propagate
	// to their transitive dependents BEFORE the wave loop begins.
	if (orchConfig.failure.on_task_failure === "skip-dependents" && failedTaskSet.size > 0) {
		const reconciledBlocked = computeTransitiveDependents(
			failedTaskSet,
			depGraph,
			batchTaskScope(wavePlan),
		);
		for (const taskId of reconciledBlocked) {
			batchState.blockedTaskIds.add(taskId);
		}
		if (reconciledBlocked.size > 0) {
			execLog(
				"resume",
				batchState.batchId,
				`skip-dependents: ${reconciledBlocked.size} task(s) blocked from reconciled failures`,
				{
					blocked: [...reconciledBlocked].sort().join(","),
					sources: [...failedTaskSet].sort().join(","),
				},
			);
		}
	}

	persistRuntimeState(
		"resume-reconciliation",
		batchState,
		wavePlan,
		latestAllocatedLanes,
		allTaskOutcomes,
		discovery ?? null,
		stateRoot,
	);

	// ── 10. Continue wave execution ──────────────────────────────
	// We need to execute remaining waves starting from resumeWaveIndex.
	// For waves where some tasks are already done, we filter them out.

	const persistedStatusByTaskId = new Map(
		persistedState.tasks.map((task) => [task.taskId, task.status] as const),
	);

	// TP-166: Use task-level wave metadata for correct display.
	const roundToTaskWave = batchState.roundToTaskWave;
	const taskLevelWaveCount = batchState.taskLevelWaveCount;

	for (let waveIdx = resumePoint.resumeWaveIndex; waveIdx < wavePlan.length; waveIdx++) {
		// Check pause signal
		if (batchState.pauseSignal.paused) {
			batchState.phase = "paused";
			preserveWorktreesForResume = true; // every pause exit preserves recovery worktrees
			persistRuntimeState(
				"pause-before-wave",
				batchState,
				wavePlan,
				latestAllocatedLanes,
				allTaskOutcomes,
				discovery,
				stateRoot,
			);
			const { displayWave: pauseWave } = resolveDisplayWaveNumber(
				waveIdx,
				roundToTaskWave,
				taskLevelWaveCount,
			);
			onNotify(`⏸️  Batch paused before wave ${pauseWave}.`, "warning");
			break;
		}

		batchState.currentWaveIndex = waveIdx;
		persistRuntimeState(
			"wave-index-change",
			batchState,
			wavePlan,
			latestAllocatedLanes,
			allTaskOutcomes,
			discovery,
			stateRoot,
		);

		// Get wave tasks, filtering out completed/failed/skipped/blocked ones.
		// Persisted "skipped" tasks are terminal and must never be re-executed.
		let waveTasks = wavePlan[waveIdx].filter(
			(taskId) =>
				!completedTaskSet.has(taskId) &&
				!failedTaskSet.has(taskId) &&
				persistedStatusByTaskId.get(taskId) !== "skipped" &&
				!batchState.blockedTaskIds.has(taskId),
		);

		// Also filter tasks where discovery doesn't have them as pending
		waveTasks = waveTasks.filter((taskId) => discovery.pending.has(taskId));

		// Count only newly blocked tasks (not already persisted) to avoid double-counting.
		// persistedState.blockedTaskIds were already counted in persistedState.blockedTasks
		// which initialized batchState.blockedTasks.
		const blockedInWave = wavePlan[waveIdx].filter(
			(taskId) => batchState.blockedTaskIds.has(taskId) && !persistedBlockedTaskIds.has(taskId),
		);
		if (blockedInWave.length > 0) {
			batchState.blockedTasks += blockedInWave.length;
		}

		if (waveTasks.length === 0) {
			// TP-037 Bug #102: Check if this wave needs merge retry.
			// All tasks are terminal but the merge may have failed/been interrupted.
			if (resumePoint.mergeRetryWaveIndexes.includes(waveIdx)) {
				execLog(
					"resume",
					batchState.batchId,
					`wave ${waveIdx + 1}: all tasks done but merge needs retry`,
				);
				onNotify(
					`🔀 Wave ${resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave}: retrying merge (tasks already complete, merge was missing/failed)`,
					"info",
				);

				// Reconstruct lanes for this wave from persisted state
				const waveTaskIds = new Set(wavePlan[waveIdx]);
				const waveLaneRecords = persistedState.lanes.filter((lane) =>
					lane.taskIds.some((tid) => waveTaskIds.has(tid)),
				);
				const mergeRetryLanes = reconstructAllocatedLanes(waveLaneRecords, persistedState.tasks);

				// Build synthetic WaveExecutionResult from persisted terminal task states.
				// Crucial for orch_force_merge: tasks intentionally marked "skipped" must
				// remain skipped here (not failed), otherwise mixed-outcome detection would
				// trigger again and block the forced merge recovery path.
				const succeededTaskIds = wavePlan[waveIdx].filter((taskId) => completedTaskSet.has(taskId));
				const skippedTaskIds = wavePlan[waveIdx].filter(
					(taskId) => persistedStatusByTaskId.get(taskId) === "skipped",
				);
				const failedTaskIds = wavePlan[waveIdx].filter((taskId) => {
					const status = persistedStatusByTaskId.get(taskId);
					return status === "failed" || status === "stalled";
				});

				const syntheticLaneResults: LaneExecutionResult[] = mergeRetryLanes.map((lane) => {
					const laneTasks = lane.tasks.map((t) => {
						const persistedStatus = persistedStatusByTaskId.get(t.taskId);
						let status: LaneTaskStatus;
						if (completedTaskSet.has(t.taskId) || persistedStatus === "succeeded") {
							status = "succeeded";
						} else if (persistedStatus === "skipped") {
							status = "skipped";
						} else if (persistedStatus === "failed") {
							status = "failed";
						} else if (persistedStatus === "stalled") {
							status = "stalled";
						} else {
							status = "failed";
						}

						return {
							taskId: t.taskId,
							status,
							startTime: Date.now(),
							endTime: Date.now(),
							exitReason:
								status === "succeeded"
									? "Task completed (merge retry)"
									: status === "skipped"
										? "Task skipped (merge retry)"
										: status === "stalled"
											? "Task stalled (merge retry)"
											: "Task failed (merge retry)",
							sessionName: lane.laneSessionId,
							doneFileFound: status === "succeeded",
							laneNumber: lane.laneNumber,
						};
					});

					const laneHasHardFailure = laneTasks.some(
						(t) => t.status === "failed" || t.status === "stalled",
					);
					const laneHasSucceeded = laneTasks.some((t) => t.status === "succeeded");
					const overallStatus = laneHasHardFailure
						? laneHasSucceeded
							? "partial"
							: "failed"
						: "succeeded";

					return {
						laneNumber: lane.laneNumber,
						laneId: lane.laneId,
						tasks: laneTasks,
						overallStatus,
						startTime: Date.now(),
						endTime: Date.now(),
					};
				});

				const syntheticWaveResult: WaveExecutionResult = {
					waveIndex: waveIdx + 1,
					startedAt: Date.now(),
					endedAt: Date.now(),
					laneResults: syntheticLaneResults,
					policyApplied: orchConfig.failure.on_task_failure,
					stoppedEarly: false,
					failedTaskIds,
					skippedTaskIds,
					succeededTaskIds,
					blockedTaskIds: [],
					laneCount: mergeRetryLanes.length,
					overallStatus: "succeeded",
					finalMonitorState: null,
					allocatedLanes: mergeRetryLanes,
				};

				batchState.phase = "merging";
				persistRuntimeState(
					"merge-retry-start",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);

				const mergeRetryResult = await mergeWaveByRepo(
					mergeRetryLanes,
					syntheticWaveResult,
					waveIdx + 1,
					orchConfig,
					repoRoot,
					batchState.batchId,
					batchState.orchBranch,
					workspaceConfig,
					stateRoot,
					agentRoot,
					runnerConfig.testing_commands,
					undefined, // healthMonitor
					undefined, // forceMixedOutcome
					resumeBackend,
				);
				batchState.mergeResults.push(mergeRetryResult);

				if (mergeRetryResult.status === "succeeded") {
					onNotify(
						`✅ Wave ${resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave} merge retry succeeded`,
						"info",
					);
					// Clean up merged branches
					for (const lr of mergeRetryResult.laneResults) {
						if (
							!lr.error &&
							(lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED")
						) {
							const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
							deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
						}
					}
				} else {
					onNotify(
						`⚠️ Wave ${resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave} merge retry ${mergeRetryResult.status}: ${mergeRetryResult.failureReason || "unknown"}`,
						"warning",
					);
					// Apply merge failure policy (same as normal wave merge failure)
					const policyResult = computeMergeFailurePolicy(mergeRetryResult, waveIdx, orchConfig);
					execLog(
						"batch",
						batchState.batchId,
						`merge retry failure — applying ${policyResult.policy} policy`,
						policyResult.logDetails,
					);
					batchState.phase = policyResult.targetPhase;
					batchState.errors.push(policyResult.errorMessage);
					persistRuntimeState(
						policyResult.persistTrigger,
						batchState,
						wavePlan,
						latestAllocatedLanes,
						allTaskOutcomes,
						discovery,
						stateRoot,
					);
					onNotify(policyResult.notifyMessage, policyResult.notifyLevel);
					preserveWorktreesForResume = true;
					break;
				}

				batchState.phase = "executing";
				persistRuntimeState(
					"merge-retry-complete",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
			} else {
				execLog(
					"resume",
					batchState.batchId,
					`wave ${waveIdx + 1}: no tasks to execute (all completed/blocked)`,
				);
			}
			continue;
		}

		{
			const { displayWave, displayTotal } = resolveDisplayWaveNumber(
				waveIdx,
				roundToTaskWave,
				taskLevelWaveCount,
			);
			onNotify(
				ORCH_MESSAGES.orchWaveStart(
					displayWave,
					displayTotal,
					waveTasks.length,
					Math.min(waveTasks.length, orchConfig.orchestrator.max_lanes),
				),
				"info",
			);
		}

		const handleResumeMonitorUpdate: MonitorUpdateCallback = (monitorState) => {
			const changed = syncTaskOutcomesFromMonitor(monitorState, allTaskOutcomes);
			if (changed) {
				persistRuntimeState(
					"task-transition",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
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
			batchState.orchBranch,
			handleResumeMonitorUpdate,
			(lanes) => {
				latestAllocatedLanes = lanes;
				batchState.currentLanes = lanes;
				// Track repos from newly allocated lanes for cleanup coverage
				for (const lane of lanes) {
					encounteredRepoRoots.add(resolveRepoRoot(lane.repoId, repoRoot, workspaceConfig));
				}
				if (seedPendingOutcomesForAllocatedLanes(lanes, allTaskOutcomes)) {
					persistRuntimeState(
						"wave-lanes-allocated",
						batchState,
						wavePlan,
						latestAllocatedLanes,
						allTaskOutcomes,
						discovery,
						stateRoot,
					);
				}
			},
			workspaceConfig,
			resumeBackend,
			emitAlert,
			supervisorAutonomy,
			runnerConfig.reviewer,
			runnerConfig.worker,
			runnerConfig.workerExcludeExtensions ?? [],
			onLaneTerminated ?? undefined,
			onLaneRespawned ?? undefined,
			holdStore,
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

		{
			// #629: scope to batch tasks (dependency graph is repo-wide)
			const scope = batchTaskScope(wavePlan);
			for (const blocked of waveResult.blockedTaskIds) {
				if (scope.has(blocked)) batchState.blockedTaskIds.add(blocked);
			}
		}

		// ── TP-076: Emit supervisor alerts for task failures ────
		for (const taskId of waveResult.failedTaskIds) {
			const outcome = allTaskOutcomes.find((o) => o.taskId === taskId);
			const laneForTask = latestAllocatedLanes.find((l) => l.tasks.some((t) => t.taskId === taskId));
			// TP-195: corrected the lookup to the real source of segment
			// metadata. `batchState.tasks` does not exist on
			// `OrchBatchRuntimeState` (it's on `PersistedBatchState`); the
			// previous read would have thrown `undefined.find is not a
			// function` if hit at runtime. The allocated lane carries the
			// `ParsedTask` payload via `AllocatedTask.task`, which has
			// `segmentIds`/`activeSegmentId` already populated by discovery.
			const taskRecord = laneForTask?.tasks.find((t) => t.taskId === taskId)?.task;
			const exitReason = outcome?.exitReason || "unknown";
			const hasPartialProgress = (outcome?.partialProgressCommits ?? 0) > 0;
			const segmentFrontier = buildSupervisorSegmentFrontierSnapshot(
				taskId,
				taskRecord?.segmentIds,
				taskRecord?.activeSegmentId,
				batchState.segments,
				outcome?.segmentId,
			);
			const segmentId =
				outcome?.segmentId ??
				taskRecord?.activeSegmentId ??
				segmentFrontier?.activeSegmentId ??
				undefined;
			const repoId = segmentId
				? (segmentFrontier?.segments.find((segment) => segment.segmentId === segmentId)?.repoId ??
					laneForTask?.repoId)
				: laneForTask?.repoId;
			const segmentSummary = segmentId
				? `  Segment: ${segmentId}${repoId ? ` (repo: ${repoId})` : ""}\n`
				: "";
			const frontierSummary = segmentFrontier
				? `  Segment frontier: ${segmentFrontier.terminalSegments}/${segmentFrontier.totalSegments} terminal\n`
				: "";
			// TP-190 (#561): Mirror engine.ts emission — propagate the structured
			// exit category so /orch-resume task-failure alerts route through the
			// same supervisor playbook branches as /orch. Shared helper enforces
			// payload parity between the two emission sites.
			const { exitCategory, summaryLine: spawnFailureLine } = buildSpawnFailureAlertExtras(outcome);
			emitAlert({
				category: "task-failure",
				summary:
					`⚠️ Task failure: ${taskId}\n` +
					`  Exit reason: ${exitReason}\n` +
					spawnFailureLine +
					segmentSummary +
					frontierSummary +
					`  Lane: ${laneForTask?.laneId ?? "unknown"} (lane ${laneForTask?.laneNumber ?? "?"})\n` +
					`  Partial progress preserved: ${hasPartialProgress ? "yes" : "no"}\n` +
					`  Batch: wave ${resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave}/${taskLevelWaveCount ?? batchState.totalWaves}, ` +
					`${batchState.succeededTasks} succeeded, ${batchState.failedTasks} failed\n\n` +
					`Available actions:\n` +
					`  - orch_status() to inspect current state\n` +
					`  - orch_resume(force=true) to retry\n` +
					`  - Read STATUS.md and lane logs for diagnosis`,
				context: {
					taskId,
					segmentId,
					repoId,
					segmentFrontier,
					laneId: laneForTask?.laneId,
					laneNumber: laneForTask?.laneNumber,
					waveIndex: waveIdx,
					exitReason,
					exitCategory,
					partialProgress: hasPartialProgress,
					batchProgress: buildBatchProgressSnapshot(batchState),
				},
			});
		}

		// ── Pause finalizer (mirrors engine.ts; penster 20260906T194514) ──
		// Paused tasks are pending, never skipped; a wave with any is not complete.
		// Finalize as paused (worktrees preserved, no merge) and stop.
		{
			const pausedIds = waveResult.pausedTaskIds ?? [];
			const heldIds = waveResult.heldTaskIds ?? []; // #627
			const notAborting =
				batchState.pauseSignal.cause !== "abort" && waveResult.overallStatus !== "aborted";
			const operatorPaused = batchState.pauseSignal.paused && notAborting;
			if (notAborting && (pausedIds.length > 0 || heldIds.length > 0 || operatorPaused)) {
				batchState.phase = "paused";
				preserveWorktreesForResume = true;
				execLog("resume", batchState.batchId, `batch paused during wave ${waveIdx + 1}`, {
					cause: batchState.pauseSignal.cause ?? "operator",
					pendingTasks: pausedIds.join(",") || "(none)",
					heldTasks: heldIds.join(",") || "(none)",
				});
				persistRuntimeState(
					"pause-during-wave",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(
					`⏸️  Batch paused during wave ${waveIdx + 1}: ${pausedIds.length} task(s) remain pending. Worktrees preserved. Use orch_resume() to continue.`,
					"warning",
				);
				break;
			}
		}

		persistRuntimeState(
			"wave-execution-complete",
			batchState,
			wavePlan,
			latestAllocatedLanes,
			allTaskOutcomes,
			discovery,
			stateRoot,
		);

		const elapsedSec = Math.round((waveResult.endedAt - waveResult.startedAt) / 1000);
		{
			const { displayWave: completeDisplayWave } = resolveDisplayWaveNumber(
				waveIdx,
				roundToTaskWave,
				taskLevelWaveCount,
			);
			onNotify(
				ORCH_MESSAGES.orchWaveComplete(
					completeDisplayWave,
					waveResult.succeededTaskIds.length,
					waveResult.failedTaskIds.length,
					waveResult.skippedTaskIds.length,
					elapsedSec,
				),
				waveResult.failedTaskIds.length > 0 ? "warning" : "info",
			);
		}

		// Check failure policy
		if (waveResult.stoppedEarly) {
			if (waveResult.policyApplied === "stop-all") {
				batchState.phase = "stopped";
				persistRuntimeState(
					"stop-all",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-all"), "error");
				break;
			}
			if (waveResult.policyApplied === "stop-wave") {
				batchState.phase = "stopped";
				persistRuntimeState(
					"stop-wave",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
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
		const mixedOutcomeLanes = waveResult.laneResults.filter((lr) => {
			const hasSucceeded = lr.tasks.some((t) => t.status === "succeeded");
			const hasHardFailure = lr.tasks.some((t) => t.status === "failed" || t.status === "stalled");
			return hasSucceeded && hasHardFailure;
		});

		if (waveResult.succeededTaskIds.length > 0) {
			const mergeableLaneCount = waveResult.allocatedLanes.filter((lane) => {
				const outcome = laneOutcomeByNumber.get(lane.laneNumber);
				if (!outcome) return false;
				const hasSucceeded = outcome.tasks.some((t) => t.status === "succeeded");
				const hasHardFailure = outcome.tasks.some(
					(t) => t.status === "failed" || t.status === "stalled",
				);
				return hasSucceeded && !hasHardFailure;
			}).length;

			if (mergeableLaneCount > 0) {
				batchState.phase = "merging";
				persistRuntimeState(
					"merge-start",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(
					ORCH_MESSAGES.orchMergeStart(
						resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave,
						mergeableLaneCount,
					),
					"info",
				);

				mergeResult = await mergeWaveByRepo(
					waveResult.allocatedLanes,
					waveResult,
					waveIdx + 1,
					orchConfig,
					repoRoot,
					batchState.batchId,
					batchState.orchBranch,
					workspaceConfig,
					stateRoot,
					agentRoot,
					runnerConfig.testing_commands,
					undefined, // healthMonitor
					undefined, // forceMixedOutcome
					resumeBackend,
				);
				batchState.mergeResults.push(mergeResult);

				// Emit per-lane merge notifications
				for (const lr of mergeResult.laneResults) {
					const durationSec = Math.round(lr.durationMs / 1000);
					// TP-032 R006-3: Check lr.error first — verification_new_failure lanes
					// have error set even though lr.result.status may be SUCCESS/CONFLICT_RESOLVED.
					if (lr.error) {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.error), "error");
					} else if (lr.result?.status === "SUCCESS") {
						onNotify(
							ORCH_MESSAGES.orchMergeLaneSuccess(lr.laneNumber, lr.result.merge_commit, durationSec),
							"info",
						);
					} else if (lr.result?.status === "CONFLICT_RESOLVED") {
						onNotify(
							ORCH_MESSAGES.orchMergeLaneConflictResolved(
								lr.laneNumber,
								lr.result.conflicts.length,
								durationSec,
							),
							"info",
						);
					} else if (
						lr.result?.status === "CONFLICT_UNRESOLVED" ||
						lr.result?.status === "BUILD_FAILURE"
					) {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.result.status), "error");
					}
				}

				if (mixedOutcomeLanes.length > 0) {
					const mixedIds = mixedOutcomeLanes.map((l) => `lane-${l.laneNumber}`).join(", ");
					const failureReason =
						`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
						`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`;
					mergeResult = {
						...mergeResult,
						status: "partial",
						failedLane: mixedOutcomeLanes[0].laneNumber,
						failureReason,
					};
					// Update the already-pushed reference so persisted state reflects "partial"
					batchState.mergeResults[batchState.mergeResults.length - 1] = mergeResult;
				}

				// TP-032 R006-3: Exclude verification_new_failure lanes from success count
				const mergedCount = mergeResult.laneResults.filter(
					(r) =>
						!r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED"),
				).length;
				const mergeTotalSec = Math.round(mergeResult.totalDurationMs / 1000);

				if (mergeResult.status === "succeeded") {
					onNotify(
						ORCH_MESSAGES.orchMergeComplete(
							resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave,
							mergedCount,
							mergeTotalSec,
						),
						"info",
					);
				} else {
					onNotify(
						ORCH_MESSAGES.orchMergeFailed(
							resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave,
							mergeResult.failedLane ?? 0,
							mergeResult.failureReason || "unknown",
						),
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
				persistRuntimeState(
					"merge-complete",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
			} else if (mixedOutcomeLanes.length > 0) {
				const mixedIds = mixedOutcomeLanes.map((l) => `lane-${l.laneNumber}`).join(", ");
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
				// Keep mergeResults in sync even when no mergeable lane exists.
				// Downstream retry/update paths assume the current wave has an entry.
				batchState.mergeResults.push(mergeResult);
				onNotify(
					ORCH_MESSAGES.orchMergeFailed(
						resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave,
						mergeResult.failedLane,
						mergeResult.failureReason || "unknown",
					),
					"error",
				);
			} else {
				onNotify(
					ORCH_MESSAGES.orchMergeSkipped(
						resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave,
					),
					"info",
				);
			}
		} else {
			onNotify(
				ORCH_MESSAGES.orchMergeSkipped(
					resolveDisplayWaveNumber(waveIdx, roundToTaskWave, taskLevelWaveCount).displayWave,
				),
				"info",
			);
		}

		// ── TP-033: Safe-stop on rollback failure ─────────────────
		// When a verification rollback failed, force paused regardless of
		// on_merge_failure policy. The merge worktree and temp branch are
		// preserved for manual recovery using commands in the transaction record.
		if (mergeResult?.rollbackFailed) {
			// TP-033 R004-2: Include persistence error warning when transaction
			// record files may be missing, so operator knows to inspect manually
			const hasPersistErrors =
				mergeResult.persistenceErrors && mergeResult.persistenceErrors.length > 0;
			const persistWarning = hasPersistErrors
				? ` WARNING: ${mergeResult.persistenceErrors!.length} transaction record(s) failed to persist — recovery file(s) may be missing.`
				: "";

			execLog(
				"batch",
				batchState.batchId,
				"SAFE-STOP: verification rollback failed — forcing paused regardless of policy",
				{
					waveIndex: waveIdx,
					configPolicy: orchConfig.failure.on_merge_failure,
					...(hasPersistErrors ? { persistenceErrors: mergeResult.persistenceErrors } : {}),
				},
			);

			batchState.phase = "paused";
			batchState.errors.push(
				`Safe-stop at wave ${waveIdx + 1}: verification rollback failed. ` +
					`Merge worktree and temp branch preserved for recovery. ` +
					`Check transaction records in .pi/verification/ for recovery commands.` +
					persistWarning,
			);
			persistRuntimeState(
				"merge-rollback-safe-stop",
				batchState,
				wavePlan,
				latestAllocatedLanes,
				allTaskOutcomes,
				discovery,
				stateRoot,
			);
			onNotify(
				`🛑 Safe-stop: verification rollback failed at wave ${waveIdx + 1}. ` +
					`Batch force-paused. Merge worktree preserved for manual recovery. ` +
					`See .pi/verification/ transaction records for recovery commands.` +
					persistWarning,
				"error",
			);

			// ── TP-076: Emit supervisor alert for rollback safe-stop ──
			const rollbackRepoId = extractFailedRepoId(mergeResult) ?? undefined;
			emitAlert({
				category: "merge-failure",
				summary:
					`⚠️ Merge failed for wave ${waveIdx + 1} — verification rollback failed\n` +
					`  Batch force-paused for manual recovery.\n` +
					`  Check .pi/verification/ for recovery commands.\n\n` +
					`Available actions:\n` +
					`  - Check .pi/verification/ transaction records\n` +
					`  - orch_status() to inspect current state\n` +
					`  - orch_resume(force=true) after manual recovery`,
				context: {
					waveIndex: waveIdx,
					laneNumber: mergeResult.failedLane ?? undefined,
					repoId: rollbackRepoId,
					mergeError: `Safe-stop: verification rollback failed at wave ${waveIdx + 1}`,
					batchProgress: buildBatchProgressSnapshot(batchState),
				},
			});

			preserveWorktreesForResume = true;
			break;
		}

		// Handle merge failure — TP-033 Step 2 (R006): Retry policy matrix via shared applyMergeRetryLoop.
		// Uses the same centralized loop as engine.ts for guaranteed parity.
		if (mergeResult && (mergeResult.status === "failed" || mergeResult.status === "partial")) {
			// Initialize resilience state if not yet present
			if (!batchState.resilience) {
				batchState.resilience = defaultResilienceState();
			}

			const mergeRepoId = extractFailedRepoId(mergeResult) ?? undefined;
			const retryOutcome = await applyMergeRetryLoop(
				mergeResult,
				waveIdx,
				batchState.resilience.retryCountByScope,
				{
					performMerge: async () => {
						batchState.phase = "merging";
						return await mergeWaveByRepo(
							waveResult.allocatedLanes,
							waveResult,
							waveIdx + 1,
							orchConfig,
							repoRoot,
							batchState.batchId,
							batchState.orchBranch,
							workspaceConfig,
							stateRoot,
							agentRoot,
							runnerConfig.testing_commands,
							undefined, // healthMonitor
							undefined, // forceMixedOutcome
							resumeBackend,
						);
					},
					persist: (trigger) =>
						persistRuntimeState(
							trigger,
							batchState,
							wavePlan,
							latestAllocatedLanes,
							allTaskOutcomes,
							discovery,
							stateRoot,
						),
					log: (message, details) => execLog("batch", batchState.batchId, message, details),
					notify: (message, level) => onNotify(message, level),
					updateMergeResult: (result) => {
						mergeResult = result;
						batchState.mergeResults[batchState.mergeResults.length - 1] = result;
					},
					sleep: sleepSync,
				},
			);

			if (retryOutcome.kind === "retry_succeeded") {
				mergeResult = retryOutcome.mergeResult;
				batchState.phase = "executing";
				persistRuntimeState(
					"merge-retry-succeeded",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				// Fall through to normal post-merge flow
			} else if (retryOutcome.kind === "safe_stop") {
				mergeResult = retryOutcome.mergeResult;
				batchState.phase = "paused";
				batchState.errors.push(retryOutcome.errorMessage);
				persistRuntimeState(
					"merge-rollback-safe-stop",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(retryOutcome.notifyMessage, "error");

				// ── TP-076: Emit supervisor alert for merge safe-stop ──
				emitAlert({
					category: "merge-failure",
					summary:
						`⚠️ Merge failed for wave ${waveIdx + 1} — rollback failure\n` +
						`  Error: ${retryOutcome.errorMessage}\n\n` +
						`Available actions:\n` +
						`  - orch_status() to inspect current state\n` +
						`  - orch_resume(force=true) after manual recovery`,
					context: {
						waveIndex: waveIdx,
						laneNumber: mergeResult.failedLane ?? undefined,
						repoId: mergeRepoId,
						mergeError: retryOutcome.errorMessage,
						batchProgress: buildBatchProgressSnapshot(batchState),
					},
				});

				preserveWorktreesForResume = true;
				break;
			} else if (retryOutcome.kind === "exhausted") {
				// TP-033 R006-2: Force paused regardless of on_merge_failure config.
				mergeResult = retryOutcome.mergeResult;
				const exhaustionMsg =
					retryOutcome.errorMessage +
					` [${retryOutcome.classification ?? "unknown"} ${retryOutcome.lastDecision.currentAttempt}/${retryOutcome.lastDecision.maxAttempts}, scope=${retryOutcome.scopeKey}]`;

				execLog("batch", batchState.batchId, `merge retry exhausted — forcing paused`, {
					classification: retryOutcome.classification,
					scopeKey: retryOutcome.scopeKey,
					attempts: retryOutcome.lastDecision.currentAttempt,
					maxAttempts: retryOutcome.lastDecision.maxAttempts,
				});

				batchState.phase = "paused";
				batchState.errors.push(exhaustionMsg);
				persistRuntimeState(
					"merge-retry-exhausted",
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(retryOutcome.notifyMessage, "error");

				// ── TP-076: Emit supervisor alert for merge retry exhausted ──
				emitAlert({
					category: "merge-failure",
					summary:
						`⚠️ Merge failed for wave ${waveIdx + 1} — retry exhausted\n` +
						`  Classification: ${retryOutcome.classification ?? "unknown"}\n` +
						`  Error: ${exhaustionMsg}\n\n` +
						`Available actions:\n` +
						`  - Investigate merge failure and retry manually\n` +
						`  - orch_status() to inspect current state\n` +
						`  - orch_resume(force=true) after fixing the issue`,
					context: {
						waveIndex: waveIdx,
						laneNumber: mergeResult.failedLane ?? undefined,
						repoId: mergeRepoId,
						mergeError: exhaustionMsg,
						batchProgress: buildBatchProgressSnapshot(batchState),
					},
				});

				preserveWorktreesForResume = true;
				break;
			} else {
				// kind === "no_retry": fall through to standard on_merge_failure policy
				mergeResult = retryOutcome.mergeResult;
				const policyResult = computeMergeFailurePolicy(mergeResult, waveIdx, orchConfig);
				const classNote = retryOutcome.classification
					? ` [not retriable: ${retryOutcome.classification}, scope=${retryOutcome.scopeKey}]`
					: "";

				execLog(
					"batch",
					batchState.batchId,
					`merge failure — applying ${policyResult.policy} policy${classNote}`,
					policyResult.logDetails,
				);

				batchState.phase = policyResult.targetPhase;
				batchState.errors.push(policyResult.errorMessage + classNote);
				persistRuntimeState(
					policyResult.persistTrigger,
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(policyResult.notifyMessage + classNote, policyResult.notifyLevel);

				// ── TP-076: Emit supervisor alert for merge failure (no-retry policy) ──
				emitAlert({
					category: "merge-failure",
					summary:
						`⚠️ Merge failed for wave ${waveIdx + 1}\n` +
						`  Policy: ${policyResult.policy}${classNote}\n` +
						`  Error: ${mergeResult.failureReason || "unknown"}\n\n` +
						`Available actions:\n` +
						`  - Investigate failed merge\n` +
						`  - orch_status() to inspect current state\n` +
						`  - orch_resume(force=true) after fixing the issue`,
					context: {
						waveIndex: waveIdx,
						laneNumber: mergeResult.failedLane ?? undefined,
						repoId: mergeRepoId,
						mergeError: mergeResult.failureReason || "unknown",
						batchProgress: buildBatchProgressSnapshot(batchState),
					},
				});

				preserveWorktreesForResume = true;
				break;
			}
		}

		// Post-merge: reset worktrees for next wave
		// TP-032 R006-3: Exclude verification_new_failure lanes from branch cleanup
		if (mergeResult && mergeResult.status === "succeeded") {
			for (const lr of mergeResult.laneResults) {
				if (
					!lr.error &&
					(lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED")
				) {
					const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
					const ancestorCheck = runGit(
						["merge-base", "--is-ancestor", lr.sourceBranch, lr.targetBranch],
						laneRepoRoot,
					);
					if (ancestorCheck.ok) {
						deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
					}
				}
			}
		}

		// ── TP-028: Preserve partial progress before inter-wave reset ──
		// Hoisted outside the if-block so unsafeBranches is accessible to the
		// reset loop below — both blocks share the same guard condition.
		let ppUnsafeBranches = new Set<string>();
		if (waveIdx < persistedState.wavePlan.length - 1 && !batchState.pauseSignal.paused) {
			const ppOpId = resolveOperatorId(orchConfig);
			const ppResult = preserveFailedLaneProgress(
				latestAllocatedLanes,
				allTaskOutcomes,
				ppOpId,
				batchState.batchId,
				(repoId) => {
					const perRepoRoot = resolveRepoRoot(repoId, repoRoot, workspaceConfig);
					let targetBranch = batchState.orchBranch;
					if (repoId && perRepoRoot !== repoRoot) {
						try {
							targetBranch = resolveBaseBranch(
								repoId,
								perRepoRoot,
								batchState.orchBranch,
								workspaceConfig,
							);
						} catch {
							/* fall back to orchBranch */
						}
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			ppUnsafeBranches = ppResult.unsafeBranches;
			if (ppResult.results.some((r) => r.saved)) {
				execLog(
					"batch",
					batchState.batchId,
					`preserved partial progress for ${ppResult.results.filter((r) => r.saved).length} failed task(s) before inter-wave reset`,
				);
			}
			// Log per-task warnings for failed preservation attempts
			for (const r of ppResult.results) {
				if (!r.saved && (r.commitCount > 0 || r.error)) {
					execLog(
						"batch",
						batchState.batchId,
						`WARNING: Failed to preserve partial progress for task ${r.taskId} ` +
							`(${r.commitCount} commit(s) at risk on lane branch)`,
						{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" },
					);
				}
			}
			if (ppUnsafeBranches.size > 0) {
				execLog(
					"batch",
					batchState.batchId,
					`WARNING: ${ppUnsafeBranches.size} lane branch(es) could not be preserved — skipping reset for those lanes to prevent commit loss`,
					{ unsafeBranches: [...ppUnsafeBranches] },
				);
			}
			// TP-028: Stamp task outcomes with partial progress data for persistence
			applyPartialProgressToOutcomes(ppResult, allTaskOutcomes);
		}

		if (waveIdx < persistedState.wavePlan.length - 1 && !batchState.pauseSignal.paused) {
			const wtPrefix = orchConfig.orchestrator.worktree_prefix;
			const resetOpId = resolveOperatorId(orchConfig);
			// TP-029 R006: Track worktrees that failed reset AND removal
			// so the cleanup gate only fires on true stale state, not
			// successfully-reset reusable worktrees. (Parity with engine.ts)
			const failedRemovalWorktrees = new Map<
				string,
				{ repoId: string | undefined; paths: string[] }
			>();

			// Use encounteredRepoRoots which includes both persisted lanes
			// AND newly allocated lanes from resumed waves, ensuring repos
			// introduced after resume starts are covered.
			// Per-repo target branch: primary repo uses orchBranch, secondary
			// repos resolve their own branch (same as cleanup — see section 11).
			for (const perRepoRoot of encounteredRepoRoots) {
				const existingWorktrees = listWorktrees(wtPrefix, perRepoRoot, resetOpId, batchState.batchId);
				if (existingWorktrees.length > 0) {
					let targetBranch: string;
					if (perRepoRoot === repoRoot) {
						targetBranch = batchState.orchBranch;
					} else {
						const repoId = resolveRepoIdFromRoot(perRepoRoot, workspaceConfig);
						try {
							targetBranch = resolveBaseBranch(
								repoId,
								perRepoRoot,
								batchState.orchBranch,
								workspaceConfig,
							);
						} catch {
							// If resolution fails, fall back to orchBranch (reset will
							// fail gracefully and trigger worktree removal)
							targetBranch = batchState.orchBranch;
						}
					}
					for (const wt of existingWorktrees) {
						// TP-028: Skip reset for worktrees whose lane branch has
						// unsaved partial progress (preservation failed with commits)
						if (ppUnsafeBranches.has(wt.branch)) {
							execLog(
								"batch",
								batchState.batchId,
								`skipping worktree reset for lane ${wt.laneNumber} — branch "${wt.branch}" has unsaved partial progress`,
								{ path: wt.path, branch: wt.branch },
							);
							continue;
						}

						const resetResult = safeResetWorktree(wt, targetBranch, perRepoRoot);
						if (!resetResult.success) {
							// Track for the cleanup gate on ANY non-removal outcome: throw,
							// OR a #628 dirty refusal (refusal is NOT success — the worktree
							// still exists, preserving uncommitted work; never force-clean it).
							const trackFailedRemoval = () => {
								const perRepoId =
									perRepoRoot === repoRoot ? undefined : resolveRepoIdFromRoot(perRepoRoot, workspaceConfig);
								if (!failedRemovalWorktrees.has(perRepoRoot)) {
									failedRemovalWorktrees.set(perRepoRoot, { repoId: perRepoId, paths: [] });
								}
								failedRemovalWorktrees.get(perRepoRoot)!.paths.push(wt.path);
							};
							try {
								const rm = removeWorktree(wt, perRepoRoot);
								if (rm.refusedDirty) {
									execLog(
										"batch",
										batchState.batchId,
										`worktree removal REFUSED for lane ${wt.laneNumber}: ${rm.dirtyFileCount} uncommitted change(s) — preserve progress before cleanup (#628)`,
										{ path: wt.path },
									);
									trackFailedRemoval();
								}
							} catch {
								forceCleanupWorktree(wt, perRepoRoot, batchState.batchId);
								// Track this worktree for the cleanup gate — it may still be registered
								trackFailedRemoval();
							}
						}
					}
				}
			}

			// ── TP-029: Post-merge cleanup gate (parity with engine.ts) ──
			// Only gate on worktrees that the reset loop tried and failed
			// to remove. Successfully-reset reusable worktrees are expected
			// to remain registered — they will be reused in the next wave.
			// For each failed-removal worktree, verify it is still registered
			// before classifying it as truly stale.
			const cleanupGateFailures: CleanupGateRepoFailure[] = [];
			if (failedRemovalWorktrees.size > 0) {
				for (const [perRepoRoot, { repoId: perRepoId, paths: failedPaths }] of failedRemovalWorktrees) {
					const remaining = listWorktrees(wtPrefix, perRepoRoot, resetOpId, batchState.batchId);
					const remainingPaths = new Set(remaining.map((wt) => wt.path));
					// Only report worktrees that were targeted for removal but are still registered
					const stale = failedPaths.filter((p) => remainingPaths.has(p));
					if (stale.length > 0) {
						cleanupGateFailures.push({
							repoRoot: perRepoRoot,
							repoId: perRepoId,
							staleWorktrees: stale,
						});
					}
				}
			}

			if (cleanupGateFailures.length > 0) {
				const gatePolicyResult = computeCleanupGatePolicy(waveIdx, cleanupGateFailures);

				execLog(
					"batch",
					batchState.batchId,
					`cleanup gate failed — pausing batch`,
					gatePolicyResult.logDetails,
				);

				batchState.phase = gatePolicyResult.targetPhase;
				batchState.errors.push(gatePolicyResult.errorMessage);
				persistRuntimeState(
					gatePolicyResult.persistTrigger,
					batchState,
					wavePlan,
					latestAllocatedLanes,
					allTaskOutcomes,
					discovery,
					stateRoot,
				);
				onNotify(gatePolicyResult.notifyMessage, gatePolicyResult.notifyLevel);
				preserveWorktreesForResume = true;
				break;
			}
		}
	}

	// ── Pre-cleanup: Determine if worktrees should be preserved ──
	// TP-031 (R006): Parity with engine.ts — this check MUST run before cleanup
	// so that worktrees survive when failedTasks > 0. Without this, cleanup
	// deletes worktrees before the batch is marked "paused", breaking resumability.
	if (
		!preserveWorktreesForResume &&
		((batchState.phase as OrchBatchPhase) === "executing" ||
			(batchState.phase as OrchBatchPhase) === "merging") &&
		batchState.failedTasks > 0
	) {
		preserveWorktreesForResume = true;
		execLog(
			"resume",
			batchState.batchId,
			"pre-cleanup: failedTasks > 0 detected, preserving worktrees for resume",
		);
	}

	// ── 11. Cleanup and terminal state ───────────────────────────

	// #627 (Sage review round 2, blocker B): an unresolved hold is a hard gate on
	// completion, cleanup and state deletion — mirrors engine.ts. A task hidden
	// from discovery (e.g. by a .DONE at its canonical path) must not let the
	// batch fall through as complete with its hold still open.
	{
		const unresolved = (batchState.holds ?? []).filter(isHoldUnresolved);
		if (unresolved.length > 0) {
			preserveWorktreesForResume = true;
			if (
				(batchState.phase as OrchBatchPhase) === "executing" ||
				(batchState.phase as OrchBatchPhase) === "merging" ||
				(batchState.phase as OrchBatchPhase) === "completed"
			) {
				batchState.phase = "paused";
				if (!batchState.pauseSignal.paused) {
					batchState.pauseSignal.paused = true;
					batchState.pauseSignal.cause = "hold-timeout";
				}
			}
			execLog(
				"resume",
				batchState.batchId,
				`terminal gate: ${unresolved.length} unresolved hold(s) — batch parked, worktrees/branches preserved, no cleanup`,
				{ holds: unresolved.map((h) => `${h.escalationId}→${h.taskId}`).join(",") },
			);
			onNotify(
				`⏸️  ${unresolved.length} unit(s) still held awaiting a ruling (${unresolved.map((h) => h.taskId).join(", ")}). Batch parked; rule then orch_resume(force=true).`,
				"warning",
			);
		}
	}

	// ── TP-028: Preserve partial progress before terminal cleanup ──
	if (!preserveWorktreesForResume) {
		const ppOpId = resolveOperatorId(orchConfig);
		const ppResult = preserveFailedLaneProgress(
			latestAllocatedLanes,
			allTaskOutcomes,
			ppOpId,
			batchState.batchId,
			(repoId) => {
				const perRepoRoot = resolveRepoRoot(repoId, repoRoot, workspaceConfig);
				let targetBranch = batchState.orchBranch;
				if (repoId && perRepoRoot !== repoRoot) {
					try {
						targetBranch = resolveBaseBranch(repoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
					} catch {
						/* fall back to orchBranch */
					}
				}
				return { repoRoot: perRepoRoot, targetBranch };
			},
		);
		if (ppResult.results.some((r) => r.saved)) {
			execLog(
				"batch",
				batchState.batchId,
				`preserved partial progress for ${ppResult.results.filter((r) => r.saved).length} failed task(s) before terminal cleanup`,
			);
		}
		// Log warnings for failed preservation attempts — at terminal cleanup
		// we cannot skip deletion (batch is ending), but operators need to know
		// that commits may become unreachable via reflog only.
		for (const r of ppResult.results) {
			if (!r.saved && (r.commitCount > 0 || r.error)) {
				execLog(
					"batch",
					batchState.batchId,
					`WARNING: Failed to preserve partial progress for task ${r.taskId} ` +
						`(${r.commitCount} commit(s) may become unreachable after cleanup)`,
					{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" },
				);
			}
		}
		// TP-028: Stamp task outcomes with partial progress data for persistence
		applyPartialProgressToOutcomes(ppResult, allTaskOutcomes);
	}

	if (!preserveWorktreesForResume) {
		const wtPrefix = orchConfig.orchestrator.worktree_prefix;
		const cleanupOpId = resolveOperatorId(orchConfig);

		// Use encounteredRepoRoots which includes both persisted lanes
		// AND newly allocated lanes from resumed waves, ensuring repos
		// introduced after resume starts are cleaned up.
		//
		// Per-repo target branch resolution (workspace-mode correctness):
		// In repo mode, orchBranch is the correct target for all worktrees.
		// In workspace mode, the orchBranch only exists in the primary repo.
		// Secondary repos were merged against their own resolved base branch
		// (via resolveBaseBranch in mergeWaveByRepo), so unmerged-branch
		// protection must compare against that same per-repo branch.
		for (const perRepoRoot of encounteredRepoRoots) {
			let targetBranch: string | undefined;
			if (perRepoRoot === repoRoot) {
				// Primary repo: lane branches were merged into orchBranch
				targetBranch = batchState.orchBranch;
			} else {
				// Secondary repo (workspace mode): resolve the repo's own branch
				// using the same logic as mergeWaveByRepo. Find repoId by matching
				// the resolved path back to workspace config.
				const repoId = resolveRepoIdFromRoot(perRepoRoot, workspaceConfig);
				try {
					targetBranch = resolveBaseBranch(repoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
				} catch {
					// resolveBaseBranch may throw if HEAD is detached and no
					// defaultBranch is configured. Fall back to undefined which
					// skips branch protection (branches are deleted without
					// merge-status check — safe because successfully merged
					// branches were already cleaned up in post-merge steps).
					targetBranch = undefined;
				}
			}
			removeAllWorktrees(
				wtPrefix,
				perRepoRoot,
				cleanupOpId,
				targetBranch,
				batchState.batchId,
				orchConfig,
			);
		}
	}

	batchState.endedAt = Date.now();
	const totalElapsedSec = Math.round((batchState.endedAt - batchState.startedAt) / 1000);

	if (
		(batchState.phase as OrchBatchPhase) === "executing" ||
		(batchState.phase as OrchBatchPhase) === "merging"
	) {
		if (batchState.failedTasks > 0) {
			// TP-031: Parity with engine.ts — default to "paused" so the batch is
			// resumable without --force. "failed" is reserved for unrecoverable
			// invariant violations after retry exhaustion.
			// NOTE: preserveWorktreesForResume was already set pre-cleanup to ensure
			// worktrees survive; this just sets the phase for state persistence.
			batchState.phase = "paused";
		} else {
			batchState.phase = "completed";
		}
	}

	// ── Auto-Integration & Orch Branch Preservation (TP-022 Step 4) ──
	// Parity with engine.ts: auto-integrate if configured, else show manual guidance.
	// Gate: only run for terminal phases (completed/failed). Paused/stopped batches
	// are not yet done — integration would mutate refs prematurely.
	//
	// TP-043: "supervised" and "auto" integration modes are now owned by the
	// supervisor agent. Legacy engine fast-forward is removed — supervisor
	// handles all non-manual integration after batch_complete event.
	const mergedTaskCount = batchState.succeededTasks;
	// TP-195: hoist `batchState.phase` to a fresh local with the wide
	// `OrchBatchPhase` type. TypeScript's narrowing-on-property semantics
	// under `strict: false` carries assignments forward through the
	// function (visible in the `(batchState.phase as OrchBatchPhase) === ...`
	// pattern already used at lines ~3366/~3476 above), which here narrows
	// `batchState.phase` to a subtype that excludes `"completed"` and
	// `"failed"`. Hoisting to a typed local breaks the narrowing chain so
	// the comparisons typecheck without a per-call cast. Runtime
	// evaluation is identical.
	const phaseAtTerminal = batchState.phase as OrchBatchPhase;
	const isTerminalPhase = phaseAtTerminal === "completed" || phaseAtTerminal === "failed";
	if (
		isTerminalPhase &&
		!preserveWorktreesForResume &&
		batchState.orchBranch &&
		mergedTaskCount > 0
	) {
		if (
			orchConfig.orchestrator.integration === "supervised" ||
			orchConfig.orchestrator.integration === "auto"
		) {
			// TP-043: Supervisor-managed integration modes. Defer to supervisor.
			execLog(
				"resume",
				batchState.batchId,
				`integration deferred to supervisor (mode: ${orchConfig.orchestrator.integration})`,
			);
		} else {
			// Manual mode (default): show integration guidance
			onNotify(
				ORCH_MESSAGES.orchIntegrationManual(
					batchState.orchBranch,
					batchState.baseBranch,
					mergedTaskCount,
				),
				"info",
			);
		}
	}

	persistRuntimeState(
		"batch-terminal",
		batchState,
		wavePlan,
		latestAllocatedLanes,
		allTaskOutcomes,
		discovery,
		stateRoot,
	);

	// ── TP-076: Emit supervisor alert for batch completion ──────
	// TP-195: reuse the hoisted-typed phase to avoid the same narrowing
	// artifact as the `isTerminalPhase` check above.
	if (phaseAtTerminal === "completed" || phaseAtTerminal === "failed") {
		const batchDurationMs = batchState.endedAt ? batchState.endedAt - batchState.startedAt : 0;
		const durationStr =
			batchDurationMs > 0
				? `${Math.floor(batchDurationMs / 60000)}m ${Math.round((batchDurationMs % 60000) / 1000)}s`
				: "unknown";
		if (batchState.phase === "completed" && batchState.failedTasks === 0) {
			// Report outcomes and branch state SEPARATELY and truthfully (penster
			// 20260906T194514 saw "Merged … Ready for integration" on 0/1 succeeded
			// with an empty orch branch). Never say "merged" unless the orch branch is
			// verifiably ahead of base; a failed comparison is "unknown", not "nothing".
			const branchState = describeOrchBranchStateAcrossRepos(
				batchState.orchBranch,
				batchState.baseBranch,
				encounteredRepoRoots.keys(),
			);
			const hasSuccess = batchState.succeededTasks > 0;
			const outcomeLine =
				`  ${batchState.succeededTasks}/${batchState.totalTasks} tasks succeeded` +
				(batchState.skippedTasks > 0 ? `, ${batchState.skippedTasks} skipped` : "") +
				"\n";
			const nextStep =
				hasSuccess && branchState.kind === "ahead"
					? `Ready for integration. Run orch_integrate() or review first.`
					: branchState.kind === "ahead"
						? `⚠️ No task succeeded, yet ${branchState.detail} — partial work was merged; inspect before integrating.`
						: branchState.kind === "unknown"
							? `⚠️ Could not verify the orch branch (${branchState.detail}). Inspect before integrating.`
							: `Nothing to integrate: ${branchState.detail}.`;
			emitAlert({
				category: "batch-complete",
				summary:
					`${hasSuccess ? "✅" : "⚠️"} Batch ${batchState.batchId} completed\n` +
					outcomeLine +
					`  ${batchState.taskLevelWaveCount ?? batchState.totalWaves} wave(s), duration: ${durationStr}\n` +
					`  Orch branch ${batchState.orchBranch}: ${branchState.detail}\n\n` +
					nextStep,
				context: {
					batchProgress: buildBatchProgressSnapshot(batchState),
					batchDurationMs,
				},
			});
		} else {
			emitAlert({
				category: "batch-complete",
				summary:
					`⚠️ Batch ${batchState.batchId} finished with failures\n` +
					`  ${batchState.succeededTasks} succeeded, ${batchState.failedTasks} failed, ` +
					`${batchState.skippedTasks} skipped, ${batchState.blockedTasks} blocked\n` +
					`  Duration: ${durationStr}\n\n` +
					`Available actions:\n` +
					`  - orch_status() to review final state\n` +
					`  - orch_integrate() if succeeded work should be kept\n` +
					`  - orch_resume(force=true) to retry failed tasks`,
				context: {
					batchProgress: buildBatchProgressSnapshot(batchState),
					batchDurationMs,
				},
			});
		}
	}

	// ── TP-031: Emit diagnostic reports (JSONL + markdown) ──
	// Non-fatal: errors are logged but never crash batch finalization.
	emitDiagnosticReports(
		assembleDiagnosticInput(
			orchConfig,
			batchState,
			wavePlan,
			latestAllocatedLanes,
			allTaskOutcomes,
			stateRoot,
		),
	);

	if (batchState.phase === "paused" || batchState.phase === "stopped") {
		execLog("resume", batchState.batchId, "resumed batch ended in non-terminal state", {
			phase: batchState.phase,
		});
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

// TP-043: attemptAutoIntegration is no longer called from engine.ts or resume.ts.
// Supervisor-managed integration ("supervised" and "auto" modes) is handled by
// the supervisor agent after batch_complete. The helper remains in merge.ts for
// use by the supervisor's integration flow.
