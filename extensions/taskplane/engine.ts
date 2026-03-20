/**
 * Main batch execution engine
 * @module orch/engine
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { join, resolve } from "path";

import { formatDiscoveryResults, runDiscovery } from "./discovery.ts";
import { execLog, executeWave, tmuxKillSession } from "./execution.ts";
import type { MonitorUpdateCallback } from "./execution.ts";
import { getCurrentBranch, runGit } from "./git.ts";
import { attemptAutoIntegration, mergeWaveByRepo } from "./merge.ts";
import { applyMergeRetryLoop, computeCleanupGatePolicy, computeMergeFailurePolicy, formatRepoMergeSummary, ORCH_MESSAGES } from "./messages.ts";
import type { CleanupGateRepoFailure } from "./messages.ts";
import { assembleDiagnosticInput, emitDiagnosticReports } from "./diagnostic-reports.ts";
import { resolveOperatorId } from "./naming.ts";
import { applyPartialProgressToOutcomes, deleteBatchState, loadBatchHistory, persistRuntimeState, saveBatchHistory, seedPendingOutcomesForAllocatedLanes, syncTaskOutcomesFromMonitor, upsertTaskOutcome } from "./persistence.ts";
import { listOrchSessions } from "./sessions.ts";
import { defaultResilienceState, FATAL_DISCOVERY_CODES, generateBatchId } from "./types.ts";
import type { AllocatedLane, BatchHistorySummary, BatchTaskSummary, BatchWaveSummary, DiscoveryResult, LaneExecutionResult, LaneTaskOutcome, MergeWaveResult, OrchBatchPhase, OrchBatchRuntimeState, OrchestratorConfig, TaskRunnerConfig, TokenCounts, WorkspaceConfig } from "./types.ts";
import { buildDependencyGraph, computeWaves, resolveBaseBranch, resolveRepoRoot, validateGraph } from "./waves.ts";
import { deleteBranchBestEffort, forceCleanupWorktree, formatPreflightResults, listWorktrees, preserveFailedLaneProgress, removeAllWorktrees, removeWorktree, runPreflight, safeResetWorktree, sleepSync } from "./worktree.ts";

// ── /orch Execution Engine ───────────────────────────────────────────

/**
 * Execute the full /orch batch: discover → plan → execute waves → cleanup.
 *
 * This is the core orchestration loop that ties together all prior steps.
 *
 * @param args        - User arguments (areas/paths/all)
 * @param orchConfig  - Orchestrator configuration
 * @param runnerConfig - Task runner configuration
 * @param cwd         - Current working directory (repo root)
 * @param batchState  - Mutable batch state (updated throughout execution)
 * @param onNotify    - Callback for user-facing messages
 * @param onMonitorUpdate - Optional callback for dashboard updates
 * @param workspaceConfig - Workspace configuration for repo routing (null = repo mode)
 * @param workspaceRoot - Workspace root for resolving task area paths (defaults to cwd)
 */
export async function executeOrchBatch(
	args: string,
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
	// which is where .pi/ config lives. In repo mode, workspaceRoot === repoRoot.
	const stateRoot = workspaceRoot ?? cwd;

	// ── Phase 1: Planning ────────────────────────────────────────
	batchState.phase = "planning";
	batchState.batchId = generateBatchId();
	batchState.startedAt = Date.now();
	batchState.pauseSignal = { paused: false };
	batchState.mergeResults = [];
	batchState.mode = workspaceConfig ? "workspace" : "repo";

	// Capture the current branch as the base for worktrees and merge target
	const detectedBranch = getCurrentBranch(repoRoot);
	if (!detectedBranch) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push("Cannot determine current branch (detached HEAD or not a git repo)");
		onNotify("❌ Cannot determine current branch. Ensure HEAD is on a branch (not detached).", "error");
		return;
	}
	batchState.baseBranch = detectedBranch;

	// When true, final cleanup is skipped so failed merge state is preserved
	// for manual intervention and TS-009 resume flow.
	let preserveWorktreesForResume = false;

	// ── State persistence tracking (TS-009 Step 2) ───────────────
	// Accumulated task outcomes across all waves for state serialization.
	let allTaskOutcomes: LaneTaskOutcome[] = [];
	// Merge results accumulated across waves (for branch cleanup after worktree removal).
	const allMergeResults: MergeWaveResult[] = [];
	// Latest allocated lanes (updated each wave for serialization).
	let latestAllocatedLanes: AllocatedLane[] = [];
	// Wave plan as array of task ID arrays (set after wave computation).
	let wavePlan: string[][] = [];
	// Reference to discovery result for enriching taskFolder paths.
	let discoveryRef: DiscoveryResult | null = null;
	// TP-029: Track all repo roots encountered during execution.
	// Maps repoRoot → repoId (undefined for primary/repo-mode).
	// Used by inter-wave reset and terminal cleanup to iterate ALL repos
	// that had lanes, not just the primary repoRoot. Parity with resume.ts.
	const encounteredRepoRoots = new Map<string, string | undefined>();
	encounteredRepoRoots.set(repoRoot, undefined); // always include primary

	execLog("batch", batchState.batchId, "starting batch planning");

	// Preflight
	const preflight = runPreflight(orchConfig, repoRoot);
	onNotify(formatPreflightResults(preflight), preflight.passed ? "info" : "error");
	if (!preflight.passed) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push("Preflight check failed");
		return;
	}

	// Discovery — task area paths in task-runner.yaml are workspace-relative.
	// In repo mode workspaceRoot === repoRoot, so this is always correct.
	const discoveryRoot = workspaceRoot ?? cwd;
	const discovery = runDiscovery(args, runnerConfig.task_areas, discoveryRoot, {
		refreshDependencies: false,
		dependencySource: orchConfig.dependencies.source,
		useDependencyCache: orchConfig.dependencies.cache,
		workspaceConfig: workspaceConfig ?? null,
	});
	onNotify(formatDiscoveryResults(discovery), discovery.errors.length > 0 ? "warning" : "info");

	// Check for fatal errors
	const fatalCodes = new Set<string>(FATAL_DISCOVERY_CODES);
	const fatalErrors = discovery.errors.filter((e) => fatalCodes.has(e.code));
	if (fatalErrors.length > 0) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		batchState.errors.push("Discovery had fatal errors — cannot proceed");
		onNotify("❌ Cannot execute due to discovery errors above.", "error");
		const hasRoutingErrors = fatalErrors.some(
			(e) => e.code === "TASK_REPO_UNRESOLVED" || e.code === "TASK_REPO_UNKNOWN",
		);
		if (hasRoutingErrors) {
			onNotify(
				"💡 Check PROMPT Repo: fields, area repo_id config, and routing.default_repo in workspace config.",
				"info",
			);
		}
		const hasStrictErrors = fatalErrors.some(
			(e) => e.code === "TASK_ROUTING_STRICT",
		);
		if (hasStrictErrors) {
			onNotify(
				"💡 Strict routing is enabled (routing.strict: true). Every task must declare an explicit execution target.\n" +
				"   Add a `## Execution Target` section with `Repo: <id>` to each task's PROMPT.md.\n" +
				"   To disable strict routing, set `routing.strict: false` in workspace config.",
				"info",
			);
		}
		return;
	}

	if (discovery.pending.size === 0) {
		batchState.phase = "completed";
		batchState.endedAt = Date.now();
		onNotify("No pending tasks found. Nothing to execute.", "info");
		return;
	}

	// Build dependency graph
	const depGraph = buildDependencyGraph(discovery.pending, discovery.completed);
	batchState.dependencyGraph = depGraph;

	// Validate graph
	const validation = validateGraph(depGraph, discovery.pending, discovery.completed);
	if (!validation.valid) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		const errMsgs = validation.errors.map(e => `[${e.code}] ${e.message}`).join("\n");
		batchState.errors.push(`Graph validation failed:\n${errMsgs}`);
		onNotify(`❌ Dependency graph errors:\n${errMsgs}`, "error");
		return;
	}

	// Compute waves
	const { waves: rawWaves, errors: waveErrors } = computeWaves(depGraph, discovery.completed, discovery.pending);
	if (waveErrors.length > 0) {
		batchState.phase = "failed";
		batchState.endedAt = Date.now();
		const errMsgs = waveErrors.map(e => `[${e.code}] ${e.message}`).join("\n");
		batchState.errors.push(`Wave computation failed:\n${errMsgs}`);
		onNotify(`❌ Wave computation errors:\n${errMsgs}`, "error");
		return;
	}

	batchState.totalWaves = rawWaves.length;
	batchState.totalTasks = rawWaves.reduce((sum, w) => sum + w.length, 0);

	// Store wave plan and discovery for state persistence
	wavePlan = rawWaves;
	discoveryRef = discovery;

	// ── Create orchestrator-managed branch ───────────────────────
	// Created after all planning validations pass (preflight, discovery,
	// graph validation, wave computation) to avoid orphan branches on
	// planning-phase early exits.
	// The orch branch isolates all batch work from the user's current branch.
	// Worktrees branch from it; merges target it via update-ref.
	const opId = resolveOperatorId(orchConfig);
	const orchBranch = `orch/${opId}-${batchState.batchId}`;

	// In workspace mode, create the orch branch in every repo that might
	// have tasks. In repo mode, create it only in the single repo.
	if (workspaceConfig) {
		let orchBranchFailed = false;
		for (const [repoId, repoConf] of workspaceConfig.repos) {
			const rRoot = repoConf.path;
			const repoBranch = getCurrentBranch(rRoot) || "HEAD";
			const result = runGit(["branch", orchBranch, repoBranch], rRoot);
			if (result.ok) {
				execLog("batch", batchState.batchId, `created orch branch in ${repoId}`, { orchBranch, base: repoBranch });
			} else {
				const errDetail = result.stderr || result.stdout || "unknown error";
				execLog("batch", batchState.batchId, `failed to create orch branch in ${repoId}: ${errDetail}`);
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Failed to create orch branch '${orchBranch}' in ${repoId}: ${errDetail}`);
				onNotify(`❌ Failed to create orch branch '${orchBranch}' in ${repoId}: ${errDetail}`, "error");
				orchBranchFailed = true;
				break;
			}
		}
		if (orchBranchFailed) return;
	} else {
		const branchResult = runGit(["branch", orchBranch, batchState.baseBranch], repoRoot);
		if (!branchResult.ok) {
			batchState.phase = "failed";
			batchState.endedAt = Date.now();
			const errDetail = branchResult.stderr || branchResult.stdout || "unknown error";
			batchState.errors.push(`Failed to create orch branch '${orchBranch}': ${errDetail}`);
			onNotify(`❌ Failed to create orch branch '${orchBranch}': ${errDetail}`, "error");
			return;
		}
		execLog("batch", batchState.batchId, "created orch branch", { orchBranch, baseBranch: batchState.baseBranch });
	}
	batchState.orchBranch = orchBranch;

	onNotify(
		ORCH_MESSAGES.orchStarting(batchState.batchId, rawWaves.length, batchState.totalTasks),
		"info",
	);

	// ── Phase 2: Wave Execution Loop ─────────────────────────────
	batchState.phase = "executing";

	// ── TS-009: Persist state on batch start (after wave computation) ──
	persistRuntimeState("batch-start", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

	for (let waveIdx = 0; waveIdx < rawWaves.length; waveIdx++) {
		// Check pause signal before starting each wave
		if (batchState.pauseSignal.paused) {
			batchState.phase = "paused";
			execLog("batch", batchState.batchId, `batch paused before wave ${waveIdx + 1}`);
			onNotify(`⏸️  Batch paused before wave ${waveIdx + 1}. Resume not yet implemented (TS-009).`, "warning");
			// ── TS-009: Persist state on pause ──
			persistRuntimeState("pause-before-wave", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			break;
		}

		batchState.currentWaveIndex = waveIdx;

		// ── TS-009: Persist state on wave index change ──
		persistRuntimeState("wave-index-change", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

		// Filter wave tasks against blockedTaskIds
		let waveTasks = rawWaves[waveIdx].filter(
			taskId => !batchState.blockedTaskIds.has(taskId),
		);

		// Log blocked tasks if any were filtered
		const blockedInWave = rawWaves[waveIdx].filter(
			taskId => batchState.blockedTaskIds.has(taskId),
		);
		if (blockedInWave.length > 0) {
			execLog("batch", batchState.batchId, `wave ${waveIdx + 1}: skipping ${blockedInWave.length} blocked task(s)`, {
				blocked: blockedInWave.join(","),
			});
			batchState.blockedTasks += blockedInWave.length;
		}

		if (waveTasks.length === 0) {
			execLog("batch", batchState.batchId, `wave ${waveIdx + 1}: no tasks to execute (all blocked)`);
			continue;
		}

		onNotify(
			ORCH_MESSAGES.orchWaveStart(waveIdx + 1, rawWaves.length, waveTasks.length, Math.min(waveTasks.length, orchConfig.orchestrator.max_lanes)),
			"info",
		);

		const handleWaveMonitorUpdate: MonitorUpdateCallback = (monitorState) => {
			const changed = syncTaskOutcomesFromMonitor(monitorState, allTaskOutcomes);
			if (changed) {
				persistRuntimeState("task-transition", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
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
			handleWaveMonitorUpdate,
			(lanes) => {
				latestAllocatedLanes = lanes;
				batchState.currentLanes = lanes;
				// TP-029: Track repos from newly allocated lanes for cleanup coverage
				for (const lane of lanes) {
					const laneRepoRoot = resolveRepoRoot(lane.repoId, repoRoot, workspaceConfig);
					encounteredRepoRoots.set(laneRepoRoot, lane.repoId);
				}
				if (seedPendingOutcomesForAllocatedLanes(lanes, allTaskOutcomes)) {
					persistRuntimeState("wave-lanes-allocated", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				}
			},
			workspaceConfig,
		);

		batchState.waveResults.push(waveResult);
		batchState.currentLanes = []; // Clear current lanes after wave completes

		// ── TS-009: Accumulate task outcomes from this wave ──
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

		// Add newly blocked tasks
		for (const blocked of waveResult.blockedTaskIds) {
			batchState.blockedTaskIds.add(blocked);
		}

		// ── TS-009: Persist state after wave execution ──
		persistRuntimeState("wave-execution-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

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

		// Check if we should stop based on task failure policy
		if (waveResult.stoppedEarly) {
			if (waveResult.policyApplied === "stop-all") {
				batchState.phase = "stopped";
				// ── TS-009: Persist state on stop-all ──
				persistRuntimeState("stop-all", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-all"), "error");
				break;
			}
			if (waveResult.policyApplied === "stop-wave") {
				batchState.phase = "stopped";
				// ── TS-009: Persist state on stop-wave ──
				persistRuntimeState("stop-wave", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(ORCH_MESSAGES.orchBatchStopped(batchState.batchId, "stop-wave"), "error");
				break;
			}
		}

		// ── Wave Merge ───────────────────────────────────────────
		// Only merge if there are succeeded tasks in this wave
		let mergeResult: MergeWaveResult | null = null;

		// Build lane outcome lookup and detect mixed-outcome lanes
		// (succeeded work + failed/stalled task in same lane).
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
				// ── TS-009: Persist state on executing→merging transition ──
				persistRuntimeState("merge-start", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(ORCH_MESSAGES.orchMergeStart(waveIdx + 1, mergeableLaneCount), "info");

				mergeResult = mergeWaveByRepo(
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
				);
				allMergeResults.push(mergeResult);
				batchState.mergeResults.push(mergeResult);

				// Persist state after merge so dashboard shows wave merge results
				persistRuntimeState("merge-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

				// Emit per-lane merge notifications
				for (const lr of mergeResult.laneResults) {
					const durationSec = Math.round(lr.durationMs / 1000);
					// TP-032 R006-3: Check lr.error first — verification_new_failure lanes
					// have error set even though lr.result.status may be SUCCESS/CONFLICT_RESOLVED.
					if (lr.error) {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.error), "error");
					} else if (lr.result?.status === "SUCCESS") {
						onNotify(ORCH_MESSAGES.orchMergeLaneSuccess(lr.laneNumber, lr.result.merge_commit, durationSec), "info");
					} else if (lr.result?.status === "CONFLICT_RESOLVED") {
						onNotify(ORCH_MESSAGES.orchMergeLaneConflictResolved(lr.laneNumber, lr.result.conflicts.length, durationSec), "info");
					} else if (lr.result?.status === "CONFLICT_UNRESOLVED" || lr.result?.status === "BUILD_FAILURE") {
						onNotify(ORCH_MESSAGES.orchMergeLaneFailed(lr.laneNumber, lr.result.status), "error");
					}
				}

				// If any lane has mixed outcomes, do not silently discard succeeded work.
				// Force merge failure handling so state is preserved for manual resolution.
				if (mixedOutcomeLanes.length > 0) {
					const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
					const failureReason =
						`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
						`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`;
					execLog("merge", `W${waveIdx + 1}`, "mixed-outcome lanes detected — escalating to merge failure handling", {
						mixedLaneIds: mixedIds,
					});
					mergeResult = {
						...mergeResult,
						status: "partial",
						failedLane: mixedOutcomeLanes[0].laneNumber,
						failureReason,
					};
				}

				// Emit overall merge result notification
				// TP-032 R006-3: Exclude verification_new_failure lanes from success count
				const mergedCount = mergeResult.laneResults.filter(
					r => !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED"),
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

				// Restore phase to executing (may be overridden below by failure handling)
				batchState.phase = "executing";
				// ── TS-009: Persist state after merge (merging→executing) ──
				persistRuntimeState("merge-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
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
				// No mergeable lanes and no mixed outcomes (e.g., only skipped tasks)
				onNotify(ORCH_MESSAGES.orchMergeSkipped(waveIdx + 1), "info");
			}
		} else {
			// No succeeded tasks — skip merge entirely
			onNotify(ORCH_MESSAGES.orchMergeSkipped(waveIdx + 1), "info");
		}

		// ── TP-033: Safe-stop on rollback failure ─────────────────
		// When a verification rollback failed, force paused regardless of
		// on_merge_failure policy. The merge worktree and temp branch are
		// preserved for manual recovery using commands in the transaction record.
		if (mergeResult?.rollbackFailed) {
			// TP-033 R004-2: Include persistence error warning when transaction
			// record files may be missing, so operator knows to inspect manually
			const hasPersistErrors = mergeResult.persistenceErrors && mergeResult.persistenceErrors.length > 0;
			const persistWarning = hasPersistErrors
				? ` WARNING: ${mergeResult.persistenceErrors!.length} transaction record(s) failed to persist — recovery file(s) may be missing.`
				: "";

			execLog("batch", batchState.batchId, "SAFE-STOP: verification rollback failed — forcing paused regardless of policy", {
				waveIndex: waveIdx,
				configPolicy: orchConfig.failure.on_merge_failure,
				...(hasPersistErrors ? { persistenceErrors: mergeResult.persistenceErrors } : {}),
			});

			batchState.phase = "paused";
			batchState.errors.push(
				`Safe-stop at wave ${waveIdx + 1}: verification rollback failed. ` +
				`Merge worktree and temp branch preserved for recovery. ` +
				`Check transaction records in .pi/verification/ for recovery commands.` +
				persistWarning
			);
			persistRuntimeState("merge-rollback-safe-stop", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			onNotify(
				`🛑 Safe-stop: verification rollback failed at wave ${waveIdx + 1}. ` +
				`Batch force-paused. Merge worktree preserved for manual recovery. ` +
				`See .pi/verification/ transaction records for recovery commands.` +
				persistWarning,
				"error",
			);
			preserveWorktreesForResume = true;
			break;
		}

		// ── Handle merge failure ─────────────────────────────────
		// TP-033 Step 2 (R006): Retry policy matrix via shared applyMergeRetryLoop.
		// Classifies the failure, loops retries per the matrix (supports maxAttempts>1),
		// and on exhaustion forces paused regardless of on_merge_failure config.
		if (mergeResult && (mergeResult.status === "failed" || mergeResult.status === "partial")) {
			// Initialize resilience state if not yet present (fresh batch)
			if (!batchState.resilience) {
				batchState.resilience = defaultResilienceState();
			}

			const retryOutcome = applyMergeRetryLoop(
				mergeResult,
				waveIdx,
				batchState.resilience.retryCountByScope,
				{
					performMerge: () => {
						batchState.phase = "merging";
						return mergeWaveByRepo(
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
						);
					},
					persist: (trigger) => persistRuntimeState(trigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot),
					log: (message, details) => execLog("batch", batchState.batchId, message, details),
					notify: (message, level) => onNotify(message, level),
					updateMergeResult: (result) => {
						mergeResult = result;
						allMergeResults[allMergeResults.length - 1] = result;
						batchState.mergeResults[batchState.mergeResults.length - 1] = result;
					},
					sleep: sleepSync,
				},
			);

			if (retryOutcome.kind === "retry_succeeded") {
				mergeResult = retryOutcome.mergeResult;
				batchState.phase = "executing";
				persistRuntimeState("merge-retry-succeeded", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				// Fall through to normal post-merge flow (worktree cleanup, etc.)
			} else if (retryOutcome.kind === "safe_stop") {
				mergeResult = retryOutcome.mergeResult;
				batchState.phase = "paused";
				batchState.errors.push(retryOutcome.errorMessage);
				persistRuntimeState("merge-rollback-safe-stop", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(retryOutcome.notifyMessage, "error");
				preserveWorktreesForResume = true;
				break;
			} else if (retryOutcome.kind === "exhausted") {
				// TP-033 R006-2: Force paused regardless of on_merge_failure config.
				// Retry exhaustion takes precedence over config policy.
				mergeResult = retryOutcome.mergeResult;
				const exhaustionMsg = retryOutcome.errorMessage +
					` [${retryOutcome.classification ?? "unknown"} ${retryOutcome.lastDecision.currentAttempt}/${retryOutcome.lastDecision.maxAttempts}, scope=${retryOutcome.scopeKey}]`;

				execLog("batch", batchState.batchId, `merge retry exhausted — forcing paused`, {
					classification: retryOutcome.classification,
					scopeKey: retryOutcome.scopeKey,
					attempts: retryOutcome.lastDecision.currentAttempt,
					maxAttempts: retryOutcome.lastDecision.maxAttempts,
				});

				batchState.phase = "paused";
				batchState.errors.push(exhaustionMsg);
				persistRuntimeState("merge-retry-exhausted", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(retryOutcome.notifyMessage, "error");
				preserveWorktreesForResume = true;
				break;
			} else {
				// kind === "no_retry": fall through to standard on_merge_failure policy
				mergeResult = retryOutcome.mergeResult;
				const policyResult = computeMergeFailurePolicy(mergeResult, waveIdx, orchConfig);
				const classNote = retryOutcome.classification
					? ` [not retriable: ${retryOutcome.classification}, scope=${retryOutcome.scopeKey}]`
					: "";

				execLog("batch", batchState.batchId, `merge failure — applying ${policyResult.policy} policy${classNote}`, policyResult.logDetails);

				batchState.phase = policyResult.targetPhase;
				batchState.errors.push(policyResult.errorMessage + classNote);
				persistRuntimeState(policyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(policyResult.notifyMessage + classNote, policyResult.notifyLevel);
				// DO NOT cleanup/reset worktrees — preserve state for debugging/resume
				preserveWorktreesForResume = true;
				break;
			}
		}

		// NOTE: Merged branch cleanup is deferred to Phase 3, AFTER worktree
		// removal. git branch -D fails if a worktree has the branch checked out.

		// ── TP-028: Preserve partial progress before inter-wave reset ──
		// Failed tasks may have commits on their lane branch that would be lost
		// when the worktree is reset for the next wave. Save these as named
		// branches before any branch-destructive reset/removal occurs.
		// Hoisted outside the if-block so unsafeBranches is accessible to the
		// reset loop below — both blocks share the same guard condition.
		let ppUnsafeBranches = new Set<string>();
		if (waveIdx < rawWaves.length - 1 && !batchState.pauseSignal.paused) {
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
						} catch { /* fall back to orchBranch */ }
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			ppUnsafeBranches = ppResult.unsafeBranches;
			if (ppResult.results.some(r => r.saved)) {
				execLog("batch", batchState.batchId,
					`preserved partial progress for ${ppResult.results.filter(r => r.saved).length} failed task(s) before inter-wave reset`);
			}
			// Log per-task warnings for failed preservation attempts
			for (const r of ppResult.results) {
				if (!r.saved && (r.commitCount > 0 || r.error)) {
					execLog("batch", batchState.batchId,
						`WARNING: Failed to preserve partial progress for task ${r.taskId} ` +
						`(${r.commitCount} commit(s) at risk on lane branch)`,
						{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" });
				}
			}
			if (ppUnsafeBranches.size > 0) {
				execLog("batch", batchState.batchId,
					`WARNING: ${ppUnsafeBranches.size} lane branch(es) could not be preserved — skipping reset for those lanes to prevent commit loss`,
					{ unsafeBranches: [...ppUnsafeBranches] });
			}
			// TP-028: Stamp task outcomes with partial progress data for persistence
			applyPartialProgressToOutcomes(ppResult, allTaskOutcomes);
		}

		// ── Post-merge: Reset worktrees for next wave ────────────
		// Only reset if merge succeeded AND there are more waves.
		// TP-029: Iterate ALL encountered repo roots (not just primary repoRoot)
		// so that repos active in wave N but not in the final wave still get reset.
		// Follows the resume.ts encounteredRepoRoots pattern for parity.
		if (waveIdx < rawWaves.length - 1 && !batchState.pauseSignal.paused) {
			const resetPrefix = orchConfig.orchestrator.worktree_prefix;
			const resetOpId = resolveOperatorId(orchConfig);
			let totalResetWorktrees = 0;
			// TP-029 R006: Track worktrees that failed reset AND removal
			// so the cleanup gate only fires on true stale state, not
			// successfully-reset reusable worktrees.
			const failedRemovalWorktrees = new Map<string, { repoId: string | undefined; paths: string[] }>();

			for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
				const existingWorktrees = listWorktrees(resetPrefix, perRepoRoot, resetOpId, batchState.batchId);
				if (existingWorktrees.length === 0) continue;
				totalResetWorktrees += existingWorktrees.length;

				// Per-repo target branch: primary repo uses orchBranch,
				// secondary repos resolve their own branch (parity with resume.ts).
				let targetBranch: string;
				if (perRepoRoot === repoRoot) {
					targetBranch = batchState.orchBranch;
				} else {
					try {
						targetBranch = resolveBaseBranch(perRepoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
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
						execLog("batch", batchState.batchId,
							`skipping worktree reset for lane ${wt.laneNumber} — branch "${wt.branch}" has unsaved partial progress`,
							{ path: wt.path, branch: wt.branch });
						continue;
					}

					const resetResult = safeResetWorktree(wt, targetBranch, perRepoRoot);
					if (!resetResult.success) {
						execLog("batch", batchState.batchId, `worktree reset failed for lane ${wt.laneNumber}`, {
							error: resetResult.error || "unknown",
							path: wt.path,
							repoId: perRepoId ?? "(default)",
						});
						// If reset fails, remove this worktree so the next wave can recreate it cleanly.
						try {
							removeWorktree(wt, perRepoRoot);
							execLog("batch", batchState.batchId, `removed unrecoverable worktree for lane ${wt.laneNumber}`);
						} catch (removeErr: unknown) {
							execLog("batch", batchState.batchId, `removeWorktree failed for lane ${wt.laneNumber}, attempting force cleanup`, {
								error: removeErr instanceof Error ? removeErr.message : String(removeErr),
								path: wt.path,
							});
							// Last resort: force-remove the directory and prune git worktree state.
							forceCleanupWorktree(wt, perRepoRoot, batchState.batchId);
							// Track this worktree for the cleanup gate — it may still be registered
							if (!failedRemovalWorktrees.has(perRepoRoot)) {
								failedRemovalWorktrees.set(perRepoRoot, { repoId: perRepoId, paths: [] });
							}
							failedRemovalWorktrees.get(perRepoRoot)!.paths.push(wt.path);
						}
					} else {
						execLog("batch", batchState.batchId, `worktree reset OK for lane ${wt.laneNumber}`);
					}
				}
			}

			if (totalResetWorktrees > 0) {
				onNotify(
					ORCH_MESSAGES.orchWorktreeReset(waveIdx + 1, totalResetWorktrees),
					"info",
				);
			}

			// ── TP-029: Post-merge cleanup gate ──────────────────────
			// Only gate on worktrees that the reset loop tried and failed
			// to remove. Successfully-reset reusable worktrees are expected
			// to remain registered — they will be reused in the next wave.
			// For each failed-removal worktree, verify it is still registered
			// before classifying it as truly stale.
			const cleanupGateFailures: CleanupGateRepoFailure[] = [];
			if (failedRemovalWorktrees.size > 0) {
				for (const [perRepoRoot, { repoId: perRepoId, paths: failedPaths }] of failedRemovalWorktrees) {
					const remaining = listWorktrees(resetPrefix, perRepoRoot, resetOpId, batchState.batchId);
					const remainingPaths = new Set(remaining.map(wt => wt.path));
					// Only report worktrees that were targeted for removal but are still registered
					const stale = failedPaths.filter(p => remainingPaths.has(p));
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

				execLog("batch", batchState.batchId, `cleanup gate failed — pausing batch`, gatePolicyResult.logDetails);

				batchState.phase = gatePolicyResult.targetPhase;
				batchState.errors.push(gatePolicyResult.errorMessage);
				persistRuntimeState(gatePolicyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
				onNotify(gatePolicyResult.notifyMessage, gatePolicyResult.notifyLevel);
				// Preserve remaining worktrees for manual cleanup — do NOT remove them
				preserveWorktreesForResume = true;
				break;
			}
		}
	}

	// ── Save batch history (before cleanup deletes sidecar files) ────
	try {
		// Read token data from sidecar files while they still exist
		const piDir = join(stateRoot, ".pi");
		const laneTokens = new Map<string, TokenCounts>();
		try {
			const files = readdirSync(piDir).filter(f => f.startsWith("lane-state-") && f.endsWith(".json"));
			for (const f of files) {
				try {
					const raw = readFileSync(join(piDir, f), "utf-8").trim();
					if (!raw) continue;
					const data = JSON.parse(raw);
					if (data.prefix) {
						laneTokens.set(data.prefix, {
							input: data.workerInputTokens || 0,
							output: data.workerOutputTokens || 0,
							cacheRead: data.workerCacheReadTokens || 0,
							cacheWrite: data.workerCacheWriteTokens || 0,
							costUsd: data.workerCostUsd || 0,
						});
					}
				} catch { /* skip invalid files */ }
			}
		} catch { /* .pi dir may not exist */ }

		// Build per-task summaries from allTaskOutcomes + wave plan
		const taskSummaries: BatchTaskSummary[] = allTaskOutcomes.map((to) => {
			// Find which wave and lane this task ran in
			let wave = 0, lane = 0;
			for (let wi = 0; wi < wavePlan.length; wi++) {
				if (wavePlan[wi].includes(to.taskId)) { wave = wi + 1; break; }
			}
			// Match lane via tmux session name
			const laneMatch = to.sessionName?.match(/lane-(\d+)/);
			if (laneMatch) lane = parseInt(laneMatch[1]);

			// Compute duration from start/end times
			const durationMs = (to.startTime && to.endTime) ? (to.endTime - to.startTime) : 0;

			// Get tokens for this lane (cumulative — shared across tasks in same lane)
			const tokens = laneTokens.get(to.sessionName) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };

			return {
				taskId: to.taskId,
				taskName: to.taskId,
				status: to.status as BatchTaskSummary["status"],
				wave,
				lane,
				durationMs,
				tokens,
				exitReason: to.exitReason || null,
			};
		});

		// Build per-wave summaries
		const waveSummaries: BatchWaveSummary[] = wavePlan.map((taskIds, wi) => {
			const waveTasks = taskSummaries.filter(t => t.wave === wi + 1);
			const mergeResult = batchState.mergeResults.find(mr => mr.waveIndex === wi + 1);
			const waveTokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
			for (const t of waveTasks) {
				waveTokens.input += t.tokens.input;
				waveTokens.output += t.tokens.output;
				waveTokens.cacheRead += t.tokens.cacheRead;
				waveTokens.cacheWrite += t.tokens.cacheWrite;
				waveTokens.costUsd += t.tokens.costUsd;
			}
			const waveDuration = waveTasks.reduce((sum, t) => Math.max(sum, t.durationMs), 0);
			return {
				wave: wi + 1,
				tasks: taskIds,
				mergeStatus: mergeResult?.status || "skipped",
				durationMs: waveDuration,
				tokens: waveTokens,
			};
		});

		// Aggregate batch tokens
		const batchTokens: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
		for (const ws of waveSummaries) {
			batchTokens.input += ws.tokens.input;
			batchTokens.output += ws.tokens.output;
			batchTokens.cacheRead += ws.tokens.cacheRead;
			batchTokens.cacheWrite += ws.tokens.cacheWrite;
			batchTokens.costUsd += ws.tokens.costUsd;
		}

		// Determine history status from actual outcomes, not batchState.phase
		// (phase hasn't been set to "completed" yet at this point in the flow).
		const historyStatus: "completed" | "partial" | "failed" | "aborted" =
			batchState.failedTasks > 0
				? (batchState.succeededTasks > 0 ? "partial" : "failed")
				: batchState.succeededTasks > 0
					? "completed"
					: "aborted";

		const summary: BatchHistorySummary = {
			batchId: batchState.batchId,
			status: historyStatus,
			startedAt: batchState.startedAt,
			endedAt: Date.now(),
			durationMs: Date.now() - batchState.startedAt,
			totalWaves: wavePlan.length,
			totalTasks: batchState.totalTasks,
			succeededTasks: batchState.succeededTasks,
			failedTasks: batchState.failedTasks,
			skippedTasks: batchState.skippedTasks,
			blockedTasks: batchState.blockedTasks,
			tokens: batchTokens,
			tasks: taskSummaries,
			waves: waveSummaries,
		};

		saveBatchHistory(stateRoot, summary);
	} catch (err) {
		execLog("batch", batchState.batchId, `failed to save batch history: ${err}`);
	}

	// ── Pre-cleanup: Determine if worktrees should be preserved ──
	// TP-031 (R006): This check MUST run before cleanup so that worktrees
	// survive when failedTasks > 0. Without this, cleanup deletes worktrees
	// before the batch is marked "paused", breaking resumability.
	if (!preserveWorktreesForResume &&
		((batchState.phase as OrchBatchPhase) === "executing" || (batchState.phase as OrchBatchPhase) === "merging") &&
		batchState.failedTasks > 0) {
		preserveWorktreesForResume = true;
		execLog("batch", batchState.batchId, "pre-cleanup: failedTasks > 0 detected, preserving worktrees for resume");
	}

	// ── Phase 3: Cleanup ─────────────────────────────────────────
	const prefix = orchConfig.orchestrator.worktree_prefix;

	if (preserveWorktreesForResume) {
		execLog("batch", batchState.batchId, "skipping final cleanup to preserve worktrees/branches for resume");
	} else {
		// Kill any lingering lane tmux sessions BEFORE removing worktrees.
		// On Windows, tmux sessions with cwd inside the worktree lock the
		// directory, causing git worktree remove to fail.
		const orchPrefix = orchConfig.orchestrator.tmux_prefix;
		const lingering = listOrchSessions(orchPrefix, batchState);
		if (lingering.length > 0) {
			execLog("batch", batchState.batchId, `killing ${lingering.length} lingering tmux session(s) before cleanup`);
			for (const sess of lingering) {
				tmuxKillSession(sess.sessionName);
			}
			sleepSync(1000); // Give OS time to release file locks
		}

		// Clean up sidecar files (lane state, worker conversation, merge artifacts)
		const piDir = join(stateRoot, ".pi");
		try {
			const sidecarFiles = readdirSync(piDir).filter(
				f => f.startsWith("lane-state-") ||
					f.startsWith("worker-conversation-") ||
					f.startsWith("merge-result-") ||
					f.startsWith("merge-request-"),
			);
			for (const f of sidecarFiles) {
				try { unlinkSync(join(piDir, f)); } catch { /* best effort */ }
			}
			if (sidecarFiles.length > 0) {
				execLog("batch", batchState.batchId, `cleaned up ${sidecarFiles.length} sidecar file(s)`);
			}
		} catch { /* .pi dir may not exist */ }

		// ── TP-028: Preserve partial progress before terminal cleanup ──
		// Save failed task commits as named branches before worktree removal
		// destroys the lane branches. Uses the last wave's allocated lanes
		// to map failed tasks to their lane branches.
		{
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
						} catch { /* fall back to orchBranch */ }
					}
					return { repoRoot: perRepoRoot, targetBranch };
				},
			);
			if (ppResult.results.some(r => r.saved)) {
				execLog("batch", batchState.batchId,
					`preserved partial progress for ${ppResult.results.filter(r => r.saved).length} failed task(s) before terminal cleanup`);
			}
			// Log warnings for failed preservation attempts — at terminal cleanup
			// we cannot skip deletion (batch is ending), but operators need to know
			// that commits may become unreachable via reflog only.
			for (const r of ppResult.results) {
				if (!r.saved && (r.commitCount > 0 || r.error)) {
					execLog("batch", batchState.batchId,
						`WARNING: Failed to preserve partial progress for task ${r.taskId} ` +
						`(${r.commitCount} commit(s) may become unreachable after cleanup)`,
						{ taskId: r.taskId, commitCount: r.commitCount, error: r.error ?? "unknown" });
				}
			}
			// TP-028: Stamp task outcomes with partial progress data for persistence
			applyPartialProgressToOutcomes(ppResult, allTaskOutcomes);
		}

		// TP-029: Clean up worktrees across ALL encountered repos (not just primary).
		// Per-repo target branch resolution: primary repo uses orchBranch,
		// secondary repos resolve their own branch via resolveBaseBranch.
		// Parity with resume.ts:1475-1507.
		const cleanupOpId = resolveOperatorId(orchConfig);
		execLog("batch", batchState.batchId, "cleaning up worktrees");

		for (const [perRepoRoot, perRepoId] of encounteredRepoRoots) {
			let targetBranch: string | undefined;
			if (perRepoRoot === repoRoot) {
				// Primary repo: lane branches were merged into orchBranch
				targetBranch = batchState.orchBranch;
			} else {
				// Secondary repo (workspace mode): resolve the repo's own branch
				try {
					targetBranch = resolveBaseBranch(perRepoId, perRepoRoot, batchState.orchBranch, workspaceConfig);
				} catch {
					// Fall back to undefined — skips branch protection
					// (safe because successfully merged branches were already cleaned)
					targetBranch = undefined;
				}
			}
			const removeResult = removeAllWorktrees(prefix, perRepoRoot, cleanupOpId, targetBranch, batchState.batchId, orchConfig);

			// Log preserved branches
			for (const p of removeResult.preserved) {
				execLog("batch", batchState.batchId, `preserving unmerged branch as saved ref`, {
					branch: p.branch,
					savedBranch: p.savedBranch,
					lane: p.laneNumber,
					target: targetBranch,
					commitCount: p.unmergedCount ?? 0,
					repoId: perRepoId ?? "(default)",
				});
			}

			if (removeResult.failed.length > 0) {
				const failedPaths = removeResult.failed.map(f => f.worktree.path).join(", ");
				execLog("batch", batchState.batchId, `worktree cleanup: ${removeResult.removed.length} removed, ${removeResult.failed.length} failed, ${removeResult.preserved.length} preserved`, {
					failedPaths,
					repoId: perRepoId ?? "(default)",
				});
			} else if (removeResult.totalAttempted > 0) {
				execLog("batch", batchState.batchId, `worktree cleanup: ${removeResult.removed.length} removed, ${removeResult.preserved.length} preserved`, {
					repoId: perRepoId ?? "(default)",
				});
			}
		}

		// NOTE: Empty .worktrees base-dir cleanup (subdirectory mode) is handled
		// inside removeAllWorktrees() when config is passed — no duplicate pass needed here.

		// ── Post-worktree-removal: Clean up merged branches ──────
		// This MUST run after worktree removal because git branch -D
		// fails if any worktree still has the branch checked out.
		// In workspace mode, each lane's branch lives in its owning repo,
		// so we resolve the correct repo root per lane using repoId.
		for (const mergeResult of allMergeResults) {
			if (mergeResult.status === "succeeded" || mergeResult.status === "partial") {
				for (const lr of mergeResult.laneResults) {
					// TP-032 R006-3: Exclude verification_new_failure lanes from branch cleanup
					// (their merge commits were rolled back, so the branch is NOT merged)
					if (!lr.error && (lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED")) {
						const laneRepoRoot = resolveRepoRoot(lr.repoId, repoRoot, workspaceConfig);
						const ancestorCheck = runGit(
							["merge-base", "--is-ancestor", lr.sourceBranch, lr.targetBranch],
							laneRepoRoot,
						);
						if (ancestorCheck.ok) {
							const deleted = deleteBranchBestEffort(lr.sourceBranch, laneRepoRoot);
							if (deleted) {
								execLog("batch", batchState.batchId, `deleted merged branch ${lr.sourceBranch}`, {
									repoId: lr.repoId ?? "(default)",
								});
							} else {
								execLog("batch", batchState.batchId, `warning: failed to delete merged branch ${lr.sourceBranch} — retained for manual cleanup`, {
									repoId: lr.repoId ?? "(default)",
								});
							}
						} else {
							execLog("batch", batchState.batchId, `warning: branch ${lr.sourceBranch} not fully merged into ${lr.targetBranch} — retained`, {
								repoId: lr.repoId ?? "(default)",
							});
						}
					}
				}
			}
		}
	}

	// Set final state
	batchState.endedAt = Date.now();
	const totalElapsedSec = Math.round((batchState.endedAt - batchState.startedAt) / 1000);

	// Determine final batch state. Cast to OrchBatchPhase to bypass control-flow
	// narrowing — mergeWave() is synchronous but could leave phase as "merging"
	// if an unexpected throw occurs between setting "merging" and restoring "executing".
	if ((batchState.phase as OrchBatchPhase) === "executing" || (batchState.phase as OrchBatchPhase) === "merging") {
		// Normal completion (not stopped, paused, or aborted)
		if (batchState.failedTasks > 0) {
			// TP-031: Default to "paused" so the batch is resumable without --force.
			// "failed" is reserved for unrecoverable invariant violations after retry
			// exhaustion (not yet implemented — will be added when retry logic lands).
			// NOTE: preserveWorktreesForResume was already set pre-cleanup to ensure
			// worktrees survive; this just sets the phase for state persistence.
			batchState.phase = "paused";
		} else {
			batchState.phase = "completed";
		}
	}

	// ── Auto-Integration & Orch Branch Preservation (TP-022 Step 4) ──
	// After all waves are done, optionally fast-forward baseBranch to orchBranch.
	// Auto-integration never converts a successful batch into "failed" — failures
	// are warnings that preserve the orch branch for manual integration.
	// Gate: only run for terminal phases (completed/failed). Paused/stopped batches
	// are not yet done — integration would mutate refs prematurely.
	let autoIntegrated = false;
	const mergedTaskCount = batchState.succeededTasks;
	const isTerminalPhase = batchState.phase === "completed" || batchState.phase === "failed";
	if (isTerminalPhase && !preserveWorktreesForResume && batchState.orchBranch && mergedTaskCount > 0) {
		if (orchConfig.orchestrator.integration === "auto") {
			autoIntegrated = attemptAutoIntegration(
				batchState.orchBranch,
				batchState.baseBranch,
				repoRoot,
				batchState.batchId,
				"batch",
				onNotify,
			);
		}
		// Manual mode (default) or auto-integration skipped: show integration guidance
		if (!autoIntegrated) {
			onNotify(
				ORCH_MESSAGES.orchIntegrationManual(batchState.orchBranch, batchState.baseBranch, mergedTaskCount),
				"info",
			);
		}
	}

	// ── TS-009: Persist terminal state ──
	persistRuntimeState("batch-terminal", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

	// ── TP-031: Emit diagnostic reports (JSONL + markdown) ──
	// Non-fatal: errors are logged but never crash batch finalization.
	emitDiagnosticReports(assembleDiagnosticInput(orchConfig, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, stateRoot));

	if (batchState.phase === "paused" || batchState.phase === "stopped") {
		execLog("batch", batchState.batchId, "batch ended in non-terminal execution state; completion banner suppressed", {
			phase: batchState.phase,
		});
	} else {
		onNotify(
			ORCH_MESSAGES.orchBatchComplete(
				batchState.batchId,
				batchState.succeededTasks,
				batchState.failedTasks,
				batchState.skippedTasks,
				batchState.blockedTasks,
				totalElapsedSec,
				batchState.orchBranch,
				batchState.baseBranch,
			),
			batchState.failedTasks > 0 ? "warning" : "info",
		);

		// ── Preserve state for /orch-integrate when orch branch exists ──
		// If integration is "manual" and we have an orch branch, keep the
		// state file so /orch-integrate can find orchBranch and baseBranch.
		// Only delete state if there's no orch branch to integrate.
		if (batchState.phase === "completed") {
			if (batchState.orchBranch) {
				execLog("state", batchState.batchId, "state file preserved for /orch-integrate", {
					orchBranch: batchState.orchBranch,
				});
			} else {
				// Legacy mode (no orch branch) — clean up state
				try {
					deleteBatchState(stateRoot);
					execLog("state", batchState.batchId, "state file deleted on clean completion");
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					execLog("state", batchState.batchId, `failed to delete state file: ${msg}`);
				}
			}
		}
	}
}


// ── Dashboard Widget (Step 6) ────────────────────────────────────────

