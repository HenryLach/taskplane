/**
 * User-facing message templates (ORCH_MESSAGES)
 * @module orch/messages
 */
import type { AbortMode, MergeWaveResult, OrchestratorConfig, RepoMergeOutcome } from "./types.ts";

// ── Message Templates ────────────────────────────────────────────────

/**
 * Deterministic message templates for user-facing /orch commands.
 * Ensures consistent UX across invocations.
 */
export const ORCH_MESSAGES = {
	// /orch
	orchStarting: (batchId: string, waves: number, tasks: number) =>
		`🚀 Starting batch ${batchId}: ${waves} wave(s), ${tasks} task(s)`,
	orchWaveStart: (waveNum: number, totalWaves: number, tasks: number, lanes: number) =>
		`\n🌊 Wave ${waveNum}/${totalWaves}: ${tasks} task(s) across ${lanes} lane(s)`,
	orchWaveComplete: (waveNum: number, succeeded: number, failed: number, skipped: number, elapsedSec: number) =>
		`✅ Wave ${waveNum} complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (${elapsedSec}s)`,
	orchMergeStart: (waveNum: number, laneCount: number) =>
		`🔀 [Wave ${waveNum}] Merging ${laneCount} lane(s) into target branch...`,
	orchMergeLaneSuccess: (laneNum: number, commit: string, durationSec: number) =>
		`  ✅ Lane ${laneNum} merged (${commit.slice(0, 8)}, ${durationSec}s)`,
	orchMergeLaneConflictResolved: (laneNum: number, conflictCount: number, durationSec: number) =>
		`  ⚡ Lane ${laneNum} merged with ${conflictCount} auto-resolved conflict(s) (${durationSec}s)`,
	orchMergeLaneFailed: (laneNum: number, reason: string) =>
		`  ❌ Lane ${laneNum} merge failed: ${reason}`,
	orchMergeComplete: (waveNum: number, mergedCount: number, totalSec: number) =>
		`🔀 [Wave ${waveNum}] Merge complete: ${mergedCount} lane(s) merged (${totalSec}s)`,
	orchMergeFailed: (waveNum: number, laneNum: number, reason: string) =>
		`❌ [Wave ${waveNum}] Merge failed at lane ${laneNum}: ${reason}`,
	orchMergeSkipped: (waveNum: number) =>
		`📝 [Wave ${waveNum}] No successful lanes to merge`,
	orchMergePlaceholder: (waveNum: number) =>
		`🔀 [Wave ${waveNum}] Merge: placeholder — Step 3 (TS-008) will replace with mergeWave()`,
	orchWorktreeReset: (waveNum: number, lanes: number) =>
		`🔄 Resetting ${lanes} worktree(s) to target branch HEAD after wave ${waveNum}`,
	orchBatchComplete: (batchId: string, succeeded: number, failed: number, skipped: number, blocked: number, elapsedSec: number) => {
		const lines = [`\n🏁 Batch ${batchId} complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped, ${blocked} blocked (${elapsedSec}s)`];
		if (failed > 0 || blocked > 0) {
			lines.push("");
			if (blocked > 0) {
				lines.push(`   ${blocked} task(s) were blocked because upstream tasks failed.`);
			}
			lines.push("   Next steps:");
			lines.push("   • /orch-status     — review what failed and why");
			lines.push("   • /orch-resume     — retry from the failed wave");
			lines.push("   • /orch-abort      — clean up and start fresh");
		}
		return lines.join("\n");
	},
	orchBatchFailed: (batchId: string, reason: string) =>
		`\n❌ Batch ${batchId} failed: ${reason}`,
	orchBatchStopped: (batchId: string, policy: string) =>
		`\n⛔ Batch ${batchId} stopped by ${policy} policy`,

	// /orch-pause
	pauseNoBatch: () => "No active batch is running. Use /orch <areas|all> to start.",
	pauseAlreadyPaused: (batchId: string) => `Batch ${batchId} is already paused.`,
	pauseActivated: (batchId: string) =>
		`⏸️  Pausing batch ${batchId}... lanes will stop after their current tasks complete.`,

	// /orch-sessions
	sessionsNone: () => "No orchestrator TMUX sessions found.",
	sessionsHeader: (count: number) => `🖥️  ${count} orchestrator session(s):`,

	// /orch orphan detection
	orphanDetectionResume: (batchId: string, sessionCount: number) =>
		`🔄 Found ${sessionCount} running orchestrator session(s) from batch ${batchId}.\n` +
		`   Use /orch-resume to continue, or /orch-abort to clean up.`,
	orphanDetectionAbort: (sessionCount: number) =>
		`⚠️ Found ${sessionCount} orphan orchestrator session(s) without usable state.\n` +
		`   Use /orch-abort to clean up before starting a new batch.`,
	orphanDetectionCleanup: () =>
		`🧹 Cleaned up stale batch state file. Starting fresh.`,

	// /orch-resume
	resumeStarting: (batchId: string, phase: string) =>
		`🔄 Resuming batch ${batchId} (was: ${phase})...`,
	resumeReconciled: (batchId: string, completed: number, pending: number, failed: number, reconnecting: number, reExecuting: number = 0) =>
		`📊 Batch ${batchId} reconciliation: ${completed} completed, ${pending} pending, ${failed} failed, ${reconnecting} reconnecting` +
		(reExecuting > 0 ? `, ${reExecuting} re-executing` : ""),
	resumeSkippedWaves: (skippedCount: number) =>
		`⏭️  Skipping ${skippedCount} completed wave(s)`,
	resumeReconnecting: (sessionCount: number) =>
		`🔗 Reconnecting to ${sessionCount} alive session(s)...`,
	resumeNoState: () =>
		`❌ No batch to resume. No batch-state.json file found.\n` +
		`   Use /orch <areas|all> to start a new batch.`,
	resumeInvalidState: (error: string) =>
		`❌ Cannot resume: batch state file is invalid.\n` +
		`   Error: ${error}\n` +
		`   Delete .pi/batch-state.json and start a new batch.`,
	resumePhaseNotResumable: (batchId: string, phase: string, reason: string) =>
		`❌ Cannot resume batch ${batchId} (phase: ${phase}).\n` +
		`   ${reason}`,
	resumeComplete: (batchId: string, succeeded: number, failed: number, skipped: number, blocked: number, elapsedSec: number) =>
		`\n🏁 Resumed batch ${batchId} complete: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped, ${blocked} blocked (${elapsedSec}s total)`,

	// /orch-abort
	abortGracefulStarting: (batchId: string, sessionCount: number) =>
		`⏳ Graceful abort of batch ${batchId}: signaling ${sessionCount} session(s) to checkpoint and exit...`,
	abortGracefulWaiting: (batchId: string, graceSec: number) =>
		`⏳ Waiting up to ${graceSec}s for sessions to checkpoint and exit...`,
	abortGracefulForceKill: (count: number) =>
		`⚠️ Force-killing ${count} session(s) that did not exit within timeout`,
	abortGracefulComplete: (batchId: string, graceful: number, forceKilled: number, durationSec: number) =>
		`✅ Graceful abort complete for batch ${batchId}: ${graceful} exited gracefully, ${forceKilled} force-killed (${durationSec}s)`,
	abortHardStarting: (batchId: string, sessionCount: number) =>
		`⚡ Hard abort of batch ${batchId}: killing ${sessionCount} session(s) immediately...`,
	abortHardComplete: (batchId: string, killed: number, durationSec: number) =>
		`✅ Hard abort complete for batch ${batchId}: ${killed} session(s) killed (${durationSec}s)`,
	abortPartialFailure: (failureCount: number) =>
		`⚠️ ${failureCount} error(s) during abort (see details above)`,
	abortNoBatch: () =>
		`No active batch to abort. Use /orch <areas|all> to start a batch.`,
	abortComplete: (mode: AbortMode, sessionsKilled: number) =>
		`🏁 Abort (${mode}) complete: ${sessionsKilled} session(s) terminated. Worktrees and branches preserved.`,
	// /orch merge — repo-scoped partial summary (TP-005 Step 1)
	orchMergePartialRepoSummary: (waveNum: number, repoLines: string[]) =>
		`⚠️ [Wave ${waveNum}] Merge partially succeeded — repo outcomes diverged:\n${repoLines.join("\n")}`,
} as const;


// ── Repo-Scoped Merge Summary (TP-005) ──────────────────────────────

/**
 * Status emoji for repo merge outcome.
 */
function repoStatusIcon(status: RepoMergeOutcome["status"]): string {
	switch (status) {
		case "succeeded": return "✅";
		case "partial": return "⚠️";
		case "failed": return "❌";
		default: return "❓";
	}
}

/**
 * Format a repo-divergence summary for a partial merge wave result.
 *
 * Returns null if:
 * - repoResults is empty or undefined (mono-repo mode)
 * - all repos have the same status (no divergence)
 * - there is only one repo group (divergence is meaningless)
 *
 * When the partial result is caused by mixed-outcome lanes within
 * a single repo (not repo divergence), this returns null to avoid
 * misleading "cross-repo divergence" messaging.
 *
 * The returned string is a complete, ready-to-emit message.
 *
 * @param mergeResult - The MergeWaveResult with status "partial"
 * @returns Formatted summary string, or null if no repo-divergence summary applies
 */
export function formatRepoMergeSummary(mergeResult: MergeWaveResult): string | null {
	const repoResults = mergeResult.repoResults;

	// No repo attribution → mono-repo mode, no summary
	if (!repoResults || repoResults.length === 0) {
		return null;
	}

	// Single repo group → divergence is meaningless (partial is lane-level)
	if (repoResults.length < 2) {
		return null;
	}

	// Check for actual divergence: are there different statuses across repos?
	const statuses = new Set(repoResults.map(r => r.status));
	if (statuses.size < 2) {
		// All repos have the same status (e.g., all "partial") —
		// the partial is from within-repo lane failures, not cross-repo divergence
		return null;
	}

	// Build per-repo summary lines (sorted by repoId, which repoResults already is)
	const repoLines = repoResults.map(r => {
		const repoLabel = r.repoId ?? "(default)";
		const icon = repoStatusIcon(r.status);
		const mergedCount = r.laneResults.filter(
			lr => lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED",
		).length;
		const totalCount = r.laneResults.length;
		let detail = `${mergedCount}/${totalCount} lane(s) merged`;
		if (r.failureReason) {
			detail += ` — ${r.failureReason.slice(0, 150)}`;
		}
		return `   ${icon} ${repoLabel}: ${detail}`;
	});

	return ORCH_MESSAGES.orchMergePartialRepoSummary(mergeResult.waveIndex, repoLines);
}


// ── Merge Failure Policy Application (TP-005 Step 2) ─────────────────

/**
 * Result of applying the merge failure policy.
 *
 * Pure function output — callers use this to perform state mutations
 * and notifications consistently. Ensures engine.ts and resume.ts
 * apply identical pause/abort transitions.
 */
export interface MergeFailurePolicyResult {
	/** The applied policy: "pause" or "abort". */
	policy: "pause" | "abort";
	/** Target phase for batchState.phase. */
	targetPhase: "paused" | "stopped";
	/** Error message to push to batchState.errors. */
	errorMessage: string;
	/** Persistence trigger label. */
	persistTrigger: "merge-failure-pause" | "merge-failure-abort";
	/** User-facing notification message. */
	notifyMessage: string;
	/** Notification level for onNotify. */
	notifyLevel: "error";
	/** Comma-separated failed lane identifiers for logging. */
	failedLaneIds: string;
	/** Structured log details for execLog. */
	logDetails: {
		failedLane: number;
		failedLaneIds: string;
		reason: string;
	};
}

/**
 * Compute the merge failure policy application result.
 *
 * This is a **pure function** — it computes all outputs deterministically
 * from the merge result and config, without performing any side effects.
 *
 * Both engine.ts and resume.ts MUST use this function to guarantee
 * identical failure attribution, phase transitions, error messages,
 * and notifications on repo-scoped merge failures.
 *
 * Failure attribution rules (priority chain):
 * 1. Lane-level: lanes with CONFLICT_UNRESOLVED, BUILD_FAILURE, or error
 *    → formatted as `lane-<N>` (comma-separated).
 * 2. Fallback: if no lane-level failures but `mergeResult.failedLane`
 *    is non-null, uses `lane-<N>` as the identifier.
 * 3. Repo-level: if no lane-level failures and failedLane is null
 *    (repo setup failure), uses `repo:<repoId>` from repoResults
 *    entries with non-succeeded status. Sorted deterministically.
 * - The failure reason is truncated to 200 chars for notifications and
 *   logged in full in batchState.errors.
 *
 * @param mergeResult  - The merge wave result with status "failed" or "partial"
 * @param waveIndex    - 0-based wave index (displayed as 1-indexed)
 * @param config       - Orchestrator configuration (for on_merge_failure policy)
 * @returns Policy result object for callers to apply
 */
export function computeMergeFailurePolicy(
	mergeResult: MergeWaveResult,
	waveIndex: number,
	config: OrchestratorConfig,
): MergeFailurePolicyResult {
	const waveNum = waveIndex + 1;
	const mergeFailurePolicy = config.failure.on_merge_failure;

	// Build failed lane identifiers from lane results.
	// Priority chain:
	//   1. Lane-level: lanes with CONFLICT_UNRESOLVED, BUILD_FAILURE, or error
	//   2. Fallback: failedLane from mergeResult (single lane ID)
	//   3. Repo-level: repos with non-succeeded status from repoResults
	//      (catches setup failures where failedLane=null and no lane results)
	let failedLaneIds = mergeResult.laneResults
		.filter(r => r.result?.status === "CONFLICT_UNRESOLVED" || r.result?.status === "BUILD_FAILURE" || r.error)
		.map(r => `lane-${r.laneNumber}`)
		.join(", ");
	if (!failedLaneIds && mergeResult.failedLane !== null) {
		failedLaneIds = `lane-${mergeResult.failedLane}`;
	}
	if (!failedLaneIds && mergeResult.repoResults && mergeResult.repoResults.length > 0) {
		// Repo-level fallback for setup failures (no lane results, failedLane=null).
		// Uses sorted repoResults order for determinism.
		failedLaneIds = mergeResult.repoResults
			.filter(r => r.status !== "succeeded")
			.map(r => `repo:${r.repoId ?? "default"}`)
			.join(", ");
	}

	const reason = mergeResult.failureReason || "unknown";
	const reasonTruncated = reason.slice(0, 200);

	const logDetails = {
		failedLane: mergeResult.failedLane ?? 0,
		failedLaneIds,
		reason: reasonTruncated,
	};

	const errorMessage =
		`Merge failed at wave ${waveNum}: ${reason}. ` +
		(mergeFailurePolicy === "pause"
			? `Batch paused. Resolve conflicts and use /orch-resume to continue.`
			: `Batch aborted by on_merge_failure policy.`);

	const laneDetail = failedLaneIds ? ` (${failedLaneIds})` : "";

	let notifyMessage: string;
	if (mergeFailurePolicy === "pause") {
		notifyMessage =
			`⏸️  Batch paused due to merge failure at wave ${waveNum}${laneDetail}. ` +
			`Reason: ${reasonTruncated}. ` +
			`Resolve conflicts and resume.`;
	} else {
		notifyMessage =
			`⛔ Batch aborted due to merge failure at wave ${waveNum}${laneDetail}. ` +
			`Reason: ${reasonTruncated}.`;
	}

	return {
		policy: mergeFailurePolicy,
		targetPhase: mergeFailurePolicy === "pause" ? "paused" : "stopped",
		errorMessage,
		persistTrigger: mergeFailurePolicy === "pause" ? "merge-failure-pause" : "merge-failure-abort",
		notifyMessage,
		notifyLevel: "error",
		failedLaneIds,
		logDetails,
	};
}


// ── Resume ORCH_MESSAGES ─────────────────────────────────────────────

// Note: These are added via extension to the ORCH_MESSAGES object below.

// ── Resume Orchestration ─────────────────────────────────────────────

/**
 * Resume an interrupted batch from persisted state.
 *
 * Flow:
 * 1. Load and validate batch-state.json
 * 2. Check phase eligibility (paused/executing/merging only)
 * 3. Check for alive TMUX sessions and .DONE files
 * 4. Reconcile persisted state against live signals
 * 5. Compute resume point (which wave to start from)
 * 6. Reconstruct runtime state and continue execution
 *
 * @param orchConfig     - Orchestrator configuration
 * @param runnerConfig   - Task runner configuration
 * @param cwd            - Repository root
 * @param batchState     - Mutable batch state (will be populated from persisted state)
 * @param onNotify       - Callback for user-facing messages
 * @param onMonitorUpdate - Optional callback for dashboard updates
 */
