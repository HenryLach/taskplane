/**
 * Main batch execution engine
 * @module orch/engine
 */
import { existsSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";

import { formatDiscoveryResults, runDiscovery } from "./discovery.ts";
import { execLog, executeWave, tmuxKillSession } from "./execution.ts";
import type { MonitorUpdateCallback } from "./execution.ts";
import { getCurrentBranch, runGit } from "./git.ts";
import { attemptAutoIntegration, mergeWaveByRepo } from "./merge.ts";
import { computeMergeFailurePolicy, formatRepoMergeSummary, ORCH_MESSAGES } from "./messages.ts";
import { resolveOperatorId } from "./naming.ts";
import { deleteBatchState, loadBatchHistory, persistRuntimeState, saveBatchHistory, seedPendingOutcomesForAllocatedLanes, syncTaskOutcomesFromMonitor, upsertTaskOutcome } from "./persistence.ts";
import { listOrchSessions } from "./sessions.ts";
import { FATAL_DISCOVERY_CODES, generateBatchId } from "./types.ts";
import type { AllocatedLane, BatchHistorySummary, BatchTaskSummary, BatchWaveSummary, DiscoveryResult, LaneExecutionResult, LaneTaskOutcome, MergeWaveResult, OrchBatchPhase, OrchBatchRuntimeState, OrchestratorConfig, TaskRunnerConfig, TokenCounts, WorkspaceConfig } from "./types.ts";
import { buildDependencyGraph, computeWaves, resolveRepoRoot, validateGraph } from "./waves.ts";
import { deleteBranchBestEffort, forceCleanupWorktree, formatPreflightResults, listWorktrees, removeAllWorktrees, removeWorktree, runPreflight, safeResetWorktree, sleepSync } from "./worktree.ts";

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

		// ── Workspace mode: commit task artifacts to task-area repos ─
		// In workspace mode, workers write .DONE and STATUS.md to the
		// canonical task folder (e.g., shared-libs/task-management/...) via
		// absolute paths, not to the lane worktree. These changes land as
		// uncommitted modifications in the task-area repo's working tree.
		// Commit them before the merge step so they appear in the orch branch.
		if (workspaceConfig && waveResult.succeededTaskIds.length > 0) {
			commitWorkspaceTaskArtifacts(discoveryRef, workspaceRoot ?? repoRoot, waveIdx + 1, batchState.batchId);
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
				);
				allMergeResults.push(mergeResult);
				batchState.mergeResults.push(mergeResult);

				// Persist state after merge so dashboard shows wave merge results
				persistRuntimeState("merge-complete", batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);

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

		// ── Handle merge failure ─────────────────────────────────
		// Apply config.failure.on_merge_failure policy via shared helper
		// for guaranteed parity with resume.ts (TP-005 Step 2).
		if (mergeResult && (mergeResult.status === "failed" || mergeResult.status === "partial")) {
			const policyResult = computeMergeFailurePolicy(mergeResult, waveIdx, orchConfig);

			execLog("batch", batchState.batchId, `merge failure — applying ${policyResult.policy} policy`, policyResult.logDetails);

			batchState.phase = policyResult.targetPhase;
			batchState.errors.push(policyResult.errorMessage);
			persistRuntimeState(policyResult.persistTrigger, batchState, wavePlan, latestAllocatedLanes, allTaskOutcomes, discoveryRef, stateRoot);
			onNotify(policyResult.notifyMessage, policyResult.notifyLevel);
			// DO NOT cleanup/reset worktrees — preserve state for debugging/resume
			preserveWorktreesForResume = true;
			break;
		}

		// NOTE: Merged branch cleanup is deferred to Phase 3, AFTER worktree
		// removal. git branch -D fails if a worktree has the branch checked out.

		// ── Post-merge: Reset worktrees for next wave ────────────
		// Only reset if merge succeeded AND there are more waves
		if (waveIdx < rawWaves.length - 1 && !batchState.pauseSignal.paused) {
			const prefix = orchConfig.orchestrator.worktree_prefix;
			const resetOpId = resolveOperatorId(orchConfig);
			const existingWorktrees = listWorktrees(prefix, repoRoot, resetOpId, batchState.batchId);

			if (existingWorktrees.length > 0) {
				onNotify(
					ORCH_MESSAGES.orchWorktreeReset(waveIdx + 1, existingWorktrees.length),
					"info",
				);

				const targetBranch = batchState.orchBranch;
				for (const wt of existingWorktrees) {
					const resetResult = safeResetWorktree(wt, targetBranch, repoRoot);
					if (!resetResult.success) {
						execLog("batch", batchState.batchId, `worktree reset failed for lane ${wt.laneNumber}`, {
							error: resetResult.error || "unknown",
							path: wt.path,
						});
						// If reset fails, remove this worktree so the next wave can recreate it cleanly.
						try {
							removeWorktree(wt, repoRoot);
							execLog("batch", batchState.batchId, `removed unrecoverable worktree for lane ${wt.laneNumber}`);
						} catch (removeErr: unknown) {
							execLog("batch", batchState.batchId, `removeWorktree failed for lane ${wt.laneNumber}, attempting force cleanup`, {
								error: removeErr instanceof Error ? removeErr.message : String(removeErr),
								path: wt.path,
							});
							// Last resort: force-remove the directory and prune git worktree state.
							// This handles cases where git has partially deregistered the worktree
							// or undeletable files (e.g., Windows reserved names like "nul") block removal.
							forceCleanupWorktree(wt, repoRoot, batchState.batchId);
						}
					} else {
						execLog("batch", batchState.batchId, `worktree reset OK for lane ${wt.laneNumber}`);
					}
				}
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

		// Clean up worktrees — use orchBranch to protect unmerged work.
		// Lane branches were merged into orchBranch (not baseBranch), so
		// unmerged-branch detection must compare against orchBranch.
		const targetBranch = batchState.orchBranch;
		const cleanupOpId = resolveOperatorId(orchConfig);
		execLog("batch", batchState.batchId, "cleaning up worktrees");
		const removeResult = removeAllWorktrees(prefix, repoRoot, cleanupOpId, targetBranch, batchState.batchId, orchConfig);

		// Log preserved branches
		for (const p of removeResult.preserved) {
			execLog("batch", batchState.batchId, `preserving unmerged branch as saved ref`, {
				branch: p.branch,
				savedBranch: p.savedBranch,
				lane: p.laneNumber,
				target: targetBranch,
				commitCount: p.unmergedCount ?? 0,
			});
		}

		if (removeResult.failed.length > 0) {
			const failedPaths = removeResult.failed.map(f => f.worktree.path).join(", ");
			execLog("batch", batchState.batchId, `worktree cleanup: ${removeResult.removed.length} removed, ${removeResult.failed.length} failed, ${removeResult.preserved.length} preserved`, {
				failedPaths,
			});
		} else if (removeResult.totalAttempted > 0) {
			execLog("batch", batchState.batchId, `worktree cleanup: ${removeResult.removed.length} removed, ${removeResult.preserved.length} preserved`);
		}

		// ── Post-worktree-removal: Clean up merged branches ──────
		// This MUST run after worktree removal because git branch -D
		// fails if any worktree still has the branch checked out.
		// In workspace mode, each lane's branch lives in its owning repo,
		// so we resolve the correct repo root per lane using repoId.
		for (const mergeResult of allMergeResults) {
			if (mergeResult.status === "succeeded" || mergeResult.status === "partial") {
				for (const lr of mergeResult.laneResults) {
					if (lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED") {
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
			batchState.phase = "failed";
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


// ── Workspace Task Artifact Commit ───────────────────────────────────

/**
 * In workspace mode, commit task artifacts (.DONE, STATUS.md) that workers
 * wrote to the canonical task folder in the task-area repo.
 *
 * Workers write to absolute paths (e.g., shared-libs/task-management/.../TP-002/.DONE)
 * which land as uncommitted changes in the task-area repo's working tree.
 * This function finds all task-area repos with dirty task files and commits them
 * so they appear in the lane branches and merge correctly.
 *
 * Best-effort: failures are logged but don't block the batch.
 */
function commitWorkspaceTaskArtifacts(
	discovery: DiscoveryResult | null,
	workspaceRoot: string,
	waveIndex: number,
	batchId: string,
): void {
	if (!discovery) return;

	// Collect unique repo roots that contain task folders
	const repoRootsWithTasks = new Set<string>();
	for (const [, task] of discovery.pending) {
		const taskFolder = resolve(task.taskFolder);
		// Walk up to find the git repo root for this task folder
		const gitResult = runGit(["rev-parse", "--show-toplevel"], dirname(taskFolder));
		if (gitResult.ok) {
			repoRootsWithTasks.add(gitResult.stdout.trim().replace(/\\/g, "/"));
		}
	}

	for (const taskRepoRoot of repoRootsWithTasks) {
		// Check for uncommitted changes
		const statusResult = runGit(["status", "--porcelain", "--", "task-management/"], taskRepoRoot);
		if (!statusResult.ok) {
			// Try without path filter (task area might have different name)
			const statusAll = runGit(["status", "--porcelain"], taskRepoRoot);
			if (!statusAll.ok || !statusAll.stdout.trim()) continue;
		}
		if (statusResult.ok && !statusResult.stdout.trim()) continue;

		// Stage task artifacts (only .DONE and STATUS.md files)
		const lines = (statusResult.stdout || "").split("\n").filter(l => l.trim());
		let hasTaskArtifacts = false;
		for (const line of lines) {
			const file = line.slice(3).trim();
			if (file.endsWith(".DONE") || file.endsWith("STATUS.md")) {
				const addResult = runGit(["add", file], taskRepoRoot);
				if (addResult.ok) hasTaskArtifacts = true;
			}
		}

		if (!hasTaskArtifacts) continue;

		// Commit
		const commitResult = runGit(
			["commit", "-m", `checkpoint: wave ${waveIndex} task artifacts (.DONE, STATUS.md)`],
			taskRepoRoot,
		);
		if (commitResult.ok) {
			execLog("batch", batchId, `committed workspace task artifacts`, {
				repoRoot: taskRepoRoot,
				wave: waveIndex,
			});
		} else if (!commitResult.stderr.includes("nothing to commit")) {
			execLog("batch", batchId, `workspace task artifact commit failed (non-fatal): ${commitResult.stderr.slice(0, 200)}`, {
				repoRoot: taskRepoRoot,
			});
		}
	}
}

// ── Dashboard Widget (Step 6) ────────────────────────────────────────

