/**
 * User-facing message templates (ORCH_MESSAGES)
 * @module orch/messages
 */
import type { AbortMode, MergeFailureClassification, MergeRetryCallbacks, MergeRetryDecision, MergeRetryLoopOutcome, MergeRetryPolicy, MergeWaveResult, OrchestratorConfig, RepoMergeOutcome } from "./types.ts";
import { MERGE_RETRY_POLICY_MATRIX } from "./types.ts";

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
	orchBatchComplete: (batchId: string, succeeded: number, failed: number, skipped: number, blocked: number, elapsedSec: number, orchBranch?: string, baseBranch?: string) => {
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
		if (orchBranch && succeeded > 0) {
			lines.push("");
			lines.push(`   ℹ All work is on orch branch: ${orchBranch}`);
			lines.push(`   Your ${baseBranch || "working"} branch was not modified.`);
			if (baseBranch) {
				lines.push(`   Preview: git log ${baseBranch}..${orchBranch}`);
			}
			lines.push("");
			lines.push("   To apply the changes:");
			lines.push("   • /orch-integrate           Apply now (fast-forward, recommended)");
			lines.push("   • /orch-integrate --pr      Push orch branch & open a PR for team review");
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

	// /orch-resume --force
	forceResumeStarting: (batchId: string, phase: string) =>
		`⚠️ Force-resuming batch ${batchId} from ${phase} state. Running pre-resume diagnostics...`,
	forceResumeDiagnosticsFailed: (batchId: string) =>
		`❌ Cannot force-resume batch ${batchId}: pre-resume diagnostics failed.\n` +
		`   Fix the issues above, then retry /orch-resume --force.`,

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

	// /orch integration — post-batch integration guidance (TP-022 Step 4)
	orchIntegrationAutoSuccess: (orchBranch: string, baseBranch: string) =>
		`✅ Auto-integrated: ${baseBranch} fast-forwarded to ${orchBranch}.`,
	orchIntegrationAutoFailed: (orchBranch: string, baseBranch: string, reason: string) =>
		`⚠️ Auto-integration skipped: ${reason}\n` +
		`   Orch branch ${orchBranch} preserved. Integrate manually:\n` +
		`   git log ${baseBranch}..${orchBranch}\n` +
		`   git merge ${orchBranch}`,
	orchIntegrationManual: (orchBranch: string, baseBranch: string, mergedTaskCount: number) => {
		const lines = [
			`ℹ️ Batch complete. Orch branch ${orchBranch} has ${mergedTaskCount} merged task(s).`,
			`   Review and integrate:`,
			`   git log ${baseBranch}..${orchBranch}`,
			`   git merge ${orchBranch}`,
		];
		return lines.join("\n");
	},
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
		// TP-032 R006-3: Exclude verification_new_failure lanes from success count
		const mergedCount = r.laneResults.filter(
			lr => !lr.error && (lr.result?.status === "SUCCESS" || lr.result?.status === "CONFLICT_RESOLVED"),
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


// ── Cleanup Gate Policy (TP-029 Step 2) ──────────────────────────────

/**
 * Per-repo cleanup failure detail.
 * Collected during post-merge inter-wave verification.
 */
export interface CleanupGateRepoFailure {
	/** Repo root path that has stale worktrees */
	repoRoot: string;
	/** Repo ID (undefined for primary/repo-mode) */
	repoId: string | undefined;
	/** Paths of stale worktrees still registered after cleanup */
	staleWorktrees: string[];
}

/**
 * Result of applying the cleanup gate policy.
 *
 * Pure function output — callers use this to perform state mutations
 * and notifications consistently. Ensures engine.ts and resume.ts
 * apply identical pause transitions on cleanup failure.
 */
export interface CleanupGatePolicyResult {
	/** Always "pause" — cleanup failures block next wave but preserve merged work */
	policy: "pause";
	/** Target phase for batchState.phase */
	targetPhase: "paused";
	/** Error message to push to batchState.errors */
	errorMessage: string;
	/** Persistence trigger label — matches spec classification naming */
	persistTrigger: "cleanup_post_merge_failed";
	/** User-facing notification message */
	notifyMessage: string;
	/** Notification level for onNotify */
	notifyLevel: "error";
	/** Structured log details for execLog */
	logDetails: {
		waveNumber: number;
		failedRepoCount: number;
		totalStaleWorktrees: number;
		repos: Array<{ repoId: string; staleCount: number }>;
	};
}

/**
 * Compute the cleanup gate policy result for post-merge verification failure.
 *
 * This is a **pure function** — it computes all outputs deterministically
 * from the wave index and per-repo failure details, without performing any
 * side effects.
 *
 * Both engine.ts and resume.ts MUST use this function to guarantee
 * identical failure attribution, phase transitions, error messages,
 * and notifications when post-merge cleanup leaves stale worktrees.
 *
 * The cleanup gate always pauses (never aborts) because:
 * - Merged commits are already on the orch branch and must not be lost
 * - The operator can manually remove stale worktrees and `/orch-resume`
 *
 * @param waveIndex  - 0-based wave index (displayed as 1-indexed)
 * @param failures   - Per-repo cleanup failure details
 * @returns Policy result object for callers to apply
 */
export function computeCleanupGatePolicy(
	waveIndex: number,
	failures: CleanupGateRepoFailure[],
): CleanupGatePolicyResult {
	const waveNum = waveIndex + 1;
	const failedRepoCount = failures.length;
	const totalStaleWorktrees = failures.reduce((sum, f) => sum + f.staleWorktrees.length, 0);

	const repos = failures.map(f => ({
		repoId: f.repoId ?? "(default)",
		staleCount: f.staleWorktrees.length,
	}));

	const repoDetail = repos.map(r => `${r.repoId} (${r.staleCount} stale)`).join(", ");

	const errorMessage =
		`Post-merge cleanup failed at wave ${waveNum}: ${totalStaleWorktrees} stale worktree(s) ` +
		`in ${failedRepoCount} repo(s) [${repoDetail}]. ` +
		`Batch paused. Remove stale worktrees manually and use /orch-resume to continue.`;

	// Build recovery commands for each failed repo
	const recoveryLines: string[] = [];
	for (const f of failures) {
		const label = f.repoId ?? "default";
		for (const wt of f.staleWorktrees) {
			recoveryLines.push(`     git worktree remove --force "${wt}"  # repo: ${label}`);
		}
	}

	const notifyMessage =
		`⏸️  Batch paused: post-merge cleanup failed at wave ${waveNum}.\n` +
		`   ${totalStaleWorktrees} stale worktree(s) in ${failedRepoCount} repo(s): ${repoDetail}\n` +
		`   Manual recovery:\n` +
		recoveryLines.join("\n") + "\n" +
		`   Then: /orch-resume`;

	return {
		policy: "pause",
		targetPhase: "paused",
		errorMessage,
		persistTrigger: "cleanup_post_merge_failed",
		notifyMessage,
		notifyLevel: "error",
		logDetails: {
			waveNumber: waveNum,
			failedRepoCount,
			totalStaleWorktrees,
			repos,
		},
	};
}

// ── Merge Retry Policy (TP-033 Step 2) ───────────────────────────────

/**
 * Classify a merge failure into a MergeFailureClassification.
 *
 * Inspects the MergeWaveResult — lane errors, failure reasons, and merge
 * result statuses — to determine which retry policy class applies.
 *
 * Classification priority (first match wins):
 * 1. `verification_new_failure` — any lane error starts with "verification_new_failure"
 * 2. `merge_conflict_unresolved` — any lane result has CONFLICT_UNRESOLVED status
 * 3. `cleanup_post_merge_failed` — failure reason contains "cleanup" or "stale worktree"
 * 4. `git_lock_file` — failure reason contains "lock" or ".lock"
 * 5. `git_worktree_dirty` — failure reason contains "dirty" or "worktree"
 * 6. `null` — unclassifiable (treated as non-retriable by callers)
 *
 * This is a **pure function** — no side effects.
 *
 * @param mergeResult - The failed MergeWaveResult to classify
 * @returns Classification or null if no merge-retry class matches
 * @since TP-033
 */
export function classifyMergeFailure(mergeResult: MergeWaveResult): MergeFailureClassification | null {
	// Check lane-level errors first (most specific)
	for (const lr of mergeResult.laneResults) {
		if (lr.error && lr.error.startsWith("verification_new_failure")) {
			return "verification_new_failure";
		}
	}

	// Check lane result statuses
	for (const lr of mergeResult.laneResults) {
		if (lr.result?.status === "CONFLICT_UNRESOLVED") {
			return "merge_conflict_unresolved";
		}
	}

	// Check failure reason string patterns
	const reason = (mergeResult.failureReason || "").toLowerCase();

	// Lock file detection: git operations fail with "Unable to create '.../.git/index.lock': File exists"
	if (reason.includes("lock") || reason.includes(".lock")) {
		return "git_lock_file";
	}

	// Cleanup failures: stale worktrees or cleanup errors
	if (reason.includes("cleanup") || reason.includes("stale worktree")) {
		return "cleanup_post_merge_failed";
	}

	// Dirty worktree: git operations fail due to uncommitted changes
	if (reason.includes("dirty") || reason.includes("worktree")) {
		return "git_worktree_dirty";
	}

	return null;
}

/**
 * Compute the retry decision for a merge failure.
 *
 * Given the failure classification and the current retry count for the
 * relevant scope, returns a decision indicating whether to retry, the
 * cooldown to wait, or the exhaustion action to take.
 *
 * This is a **pure function** — both engine.ts and resume.ts MUST use
 * this function to guarantee identical retry behavior.
 *
 * @param classification - The classified merge failure (null = unclassifiable)
 * @param currentRetryCount - Current retry attempts for this scope (0 = first failure)
 * @returns Retry decision with all fields populated
 * @since TP-033
 */
export function computeMergeRetryDecision(
	classification: MergeFailureClassification | null,
	currentRetryCount: number,
): MergeRetryDecision {
	// Unclassifiable failures are never retried
	if (classification === null) {
		return {
			shouldRetry: false,
			cooldownMs: 0,
			reason: "Unclassifiable merge failure — no retry policy available",
			currentAttempt: currentRetryCount,
			maxAttempts: 0,
			classification: "merge_conflict_unresolved", // placeholder for type safety
			exhaustionAction: "pause",
		};
	}

	const policy: MergeRetryPolicy = MERGE_RETRY_POLICY_MATRIX[classification];

	if (!policy.retriable) {
		return {
			shouldRetry: false,
			cooldownMs: 0,
			reason: `${classification} is not retriable — immediate ${policy.exhaustionAction}`,
			currentAttempt: currentRetryCount,
			maxAttempts: 0,
			classification,
			exhaustionAction: policy.exhaustionAction,
		};
	}

	if (currentRetryCount >= policy.maxAttempts) {
		return {
			shouldRetry: false,
			cooldownMs: 0,
			reason: `${classification} retry exhausted (${currentRetryCount}/${policy.maxAttempts}) — ${policy.exhaustionAction}`,
			currentAttempt: currentRetryCount,
			maxAttempts: policy.maxAttempts,
			classification,
			exhaustionAction: policy.exhaustionAction,
		};
	}

	return {
		shouldRetry: true,
		cooldownMs: policy.cooldownMs,
		reason: `${classification} retry ${currentRetryCount + 1}/${policy.maxAttempts}` +
			(policy.cooldownMs > 0 ? ` (cooldown: ${policy.cooldownMs}ms)` : ""),
		currentAttempt: currentRetryCount + 1,
		maxAttempts: policy.maxAttempts,
		classification,
		exhaustionAction: policy.exhaustionAction,
	};
}

/**
 * Build the merge retry scope key for persisted retry counters.
 *
 * Format: `{repoId}:w{waveIndex}:l{laneNumber}`
 * - In workspace mode: uses the repo ID (e.g., "api:w0:l1")
 * - In repo mode (repoId undefined/null): uses "default" (e.g., "default:w0:l1")
 *
 * NOTE: This is a different key format from the task-scoped format in v3 types
 * (`{taskId}:w{waveIndex}:l{laneNumber}`). The merge retry scope is intentionally
 * repo-scoped because merge failures are per-repo, not per-task. Both formats
 * coexist in `resilience.retryCountByScope` — the prefix disambiguates them.
 *
 * @param repoId - Repo ID (undefined/null in repo mode)
 * @param waveIndex - 0-based wave index
 * @param laneNumber - Lane number
 * @returns Scope key string
 * @since TP-033
 */
export function buildMergeRetryScopeKey(
	repoId: string | undefined | null,
	waveIndex: number,
	laneNumber: number,
): string {
	const repo = repoId ?? "default";
	return `${repo}:w${waveIndex}:l${laneNumber}`;
}

/**
 * Extract the repo ID for a failed merge from the MergeWaveResult.
 *
 * Priority:
 * 1. Lane-level: find the failed lane result and use its repoId
 * 2. Repo-level: when failedLane is null (setup failure), check repoResults
 *    for the first failed repo group
 * 3. Fallback: undefined (will become "default" in scope key)
 *
 * This ensures workspace-mode setup failures (e.g., worktree dirty before
 * any lane starts) still get repo-scoped counters rather than all collapsing
 * into "default:w{N}:l0".
 *
 * @param mergeResult - The failed MergeWaveResult
 * @returns Repo ID or undefined if not determinable
 * @since TP-033 R006
 */
export function extractFailedRepoId(mergeResult: MergeWaveResult): string | undefined {
	const failedLaneNum = mergeResult.failedLane;

	// 1. Try lane-level extraction
	if (failedLaneNum !== null && failedLaneNum !== undefined) {
		const failedLaneResult = mergeResult.laneResults.find(
			lr => lr.laneNumber === failedLaneNum &&
				(lr.error || lr.result?.status === "CONFLICT_UNRESOLVED" || lr.result?.status === "BUILD_FAILURE"),
		);
		if (failedLaneResult?.repoId) return failedLaneResult.repoId;
	}

	// 2. Repo-level fallback for setup failures (failedLane === null)
	if (mergeResult.repoResults && mergeResult.repoResults.length > 0) {
		const failedRepo = mergeResult.repoResults.find(
			rr => rr.status === "failed" || rr.status === "partial",
		);
		if (failedRepo?.repoId) return failedRepo.repoId;
	}

	// 3. If failureReason mentions a specific repo path, we could parse it,
	//    but that's fragile. Return undefined → "default" in scope key.
	return undefined;
}

/**
 * Shared merge retry loop used by both engine.ts and resume.ts.
 *
 * Wraps the retry cycle in a loop: after each failed retry, re-classifies
 * the latest mergeResult, recomputes the retry decision using the persisted
 * counter, and continues until success, safe-stop, or exhaustion/non-retriable.
 *
 * This is the **single implementation** of retry loop semantics.
 * Engine.ts and resume.ts provide callbacks for their specific side effects
 * (persistence, merge invocation, notification) to guarantee parity.
 *
 * **Important:** On retry exhaustion, this returns `kind: "exhausted"` which
 * the caller MUST handle by forcing `paused` phase regardless of
 * `on_merge_failure` config. The exhaustion action from the matrix takes
 * precedence over config policy.
 *
 * @param mergeResult - The initial failed merge result
 * @param waveIdx - 0-based wave index (for logging)
 * @param retryCountByScope - Mutable reference to persisted retry counters
 * @param callbacks - Side-effect callbacks for persistence/merge/logging
 * @returns Outcome describing what happened during the retry cycle
 * @since TP-033 R006
 */
export function applyMergeRetryLoop(
	mergeResult: MergeWaveResult,
	waveIdx: number,
	retryCountByScope: Record<string, number>,
	callbacks: MergeRetryCallbacks,
): MergeRetryLoopOutcome {
	let currentResult = mergeResult;

	// Classify the initial failure
	let classification = classifyMergeFailure(currentResult);
	const failedRepoId = extractFailedRepoId(currentResult);
	const failedLaneNum = currentResult.failedLane ?? 0;
	const scopeKey = buildMergeRetryScopeKey(failedRepoId, waveIdx, failedLaneNum);
	const currentRetryCount = retryCountByScope[scopeKey] ?? 0;

	// Check if any retry is possible at all
	const initialDecision = computeMergeRetryDecision(classification, currentRetryCount);

	if (!initialDecision.shouldRetry) {
		// Non-retriable or already exhausted before we start
		if (classification !== null && initialDecision.currentAttempt > 0) {
			// Previously had retries — this is exhaustion
			return {
				kind: "exhausted",
				mergeResult: currentResult,
				classification,
				scopeKey,
				lastDecision: initialDecision,
				errorMessage: `Merge retry exhausted at wave ${waveIdx + 1}: ${initialDecision.reason}`,
				notifyMessage: `⏸️ Merge retry exhausted at wave ${waveIdx + 1}. ${initialDecision.reason}`,
			};
		}
		// No retry was ever possible
		return {
			kind: "no_retry",
			mergeResult: currentResult,
			classification,
			scopeKey,
		};
	}

	// Enter retry loop
	let lastDecision = initialDecision;

	while (lastDecision.shouldRetry) {
		// Increment counter in persisted state
		retryCountByScope[scopeKey] = lastDecision.currentAttempt;

		callbacks.log(`merge retry: ${lastDecision.reason}`, {
			classification,
			scopeKey,
			attempt: lastDecision.currentAttempt,
			maxAttempts: lastDecision.maxAttempts,
			cooldownMs: lastDecision.cooldownMs,
		});

		callbacks.persist("merge-retry-increment");
		callbacks.notify(
			`🔄 Merge retry (${lastDecision.reason}) at wave ${waveIdx + 1}. ` +
			(lastDecision.cooldownMs > 0 ? `Waiting ${lastDecision.cooldownMs}ms before retry...` : "Retrying immediately..."),
			"warning",
		);

		if (lastDecision.cooldownMs > 0) {
			callbacks.sleep(lastDecision.cooldownMs);
		}

		// Re-invoke merge
		callbacks.persist("merge-retry-start");
		currentResult = callbacks.performMerge();
		callbacks.updateMergeResult(currentResult);
		callbacks.persist("merge-retry-complete");

		// Check outcome
		if (currentResult.status === "succeeded") {
			callbacks.notify(`✅ Merge retry succeeded at wave ${waveIdx + 1}.`, "info");
			return {
				kind: "retry_succeeded",
				mergeResult: currentResult,
			};
		}

		if (currentResult.rollbackFailed) {
			// Safe-stop takes priority
			const hasPersistErrors = currentResult.persistenceErrors && currentResult.persistenceErrors.length > 0;
			const persistWarning = hasPersistErrors
				? ` WARNING: ${currentResult.persistenceErrors!.length} transaction record(s) failed to persist.`
				: "";

			return {
				kind: "safe_stop",
				mergeResult: currentResult,
				errorMessage:
					`Safe-stop at wave ${waveIdx + 1}: verification rollback failed after retry. ` +
					`Merge worktree and temp branch preserved for recovery.` + persistWarning,
				notifyMessage:
					`🛑 Safe-stop: verification rollback failed at wave ${waveIdx + 1} after retry. ` +
					`Batch force-paused.` + persistWarning,
			};
		}

		// Retry failed — re-classify and check if we can retry again
		classification = classifyMergeFailure(currentResult);
		const updatedCount = retryCountByScope[scopeKey] ?? 0;
		lastDecision = computeMergeRetryDecision(classification, updatedCount);
	}

	// Loop ended: exhaustion
	return {
		kind: "exhausted",
		mergeResult: currentResult,
		classification,
		scopeKey,
		lastDecision,
		errorMessage: `Merge retry exhausted at wave ${waveIdx + 1}: ${lastDecision.reason}`,
		notifyMessage: `⏸️ Merge retry exhausted at wave ${waveIdx + 1}. ${lastDecision.reason}`,
	};
}

// ── Integrate Cleanup Acceptance (TP-029 Step 3) ─────────────────────

/**
 * Per-repo acceptance check findings after /orch-integrate.
 * Collected by scanning all workspace repos (not just repos that had the orch branch).
 */
export interface IntegrateCleanupRepoFindings {
	/** Repo root path */
	repoRoot: string;
	/** Repo ID (undefined for repo-mode / primary) */
	repoId: string | undefined;
	/** Stale lane worktrees still registered (git worktree list matches) */
	staleWorktrees: string[];
	/** Stale lane branches (task/{opId}-lane-*) */
	staleLaneBranches: string[];
	/** Stale orch branches (orch/{opId}-{batchId}) */
	staleOrchBranches: string[];
	/** Batch-scoped autostash entries still present */
	staleAutostashEntries: string[];
	/** Non-empty .worktrees/ containers */
	nonEmptyWorktreeContainers: string[];
}

/**
 * Result of the /orch-integrate cleanup acceptance check.
 * Pure function output — callers use this to format the summary notification.
 */
export interface IntegrateCleanupResult {
	/** True if all repos pass all acceptance criteria */
	clean: boolean;
	/** Notification severity level: "info" when clean, "warning" when dirty */
	notifyLevel: "info" | "warning";
	/** Per-repo findings (only repos with at least one finding) */
	dirtyRepos: IntegrateCleanupRepoFindings[];
	/** User-facing cleanup report (appended to integrate summary) */
	report: string;
}

/**
 * Compute the integrate cleanup result from per-repo acceptance findings.
 *
 * This is a **pure function** — computes all outputs deterministically
 * from the per-repo findings without side effects.
 *
 * The acceptance criteria (roadmap 2d) are:
 * 1. No registered lane worktrees remain in any workspace repo
 * 2. No lane branches remain (task/{opId}-lane-*)
 * 3. No orch branches remain (orch/{opId}-{batchId})
 * 4. No stale autostash from current batch remains
 * 5. No non-empty .worktrees/ containers remain
 *
 * @param repoFindings  - Per-repo findings from scanning all workspace repos
 * @returns Cleanup result with pass/fail verdict and human-readable report
 */
export function computeIntegrateCleanupResult(
	repoFindings: IntegrateCleanupRepoFindings[],
): IntegrateCleanupResult {
	// Filter to repos that have at least one issue
	const dirtyRepos = repoFindings.filter(r =>
		r.staleWorktrees.length > 0 ||
		r.staleLaneBranches.length > 0 ||
		r.staleOrchBranches.length > 0 ||
		r.staleAutostashEntries.length > 0 ||
		r.nonEmptyWorktreeContainers.length > 0,
	);

	if (dirtyRepos.length === 0) {
		return {
			clean: true,
			notifyLevel: "info",
			dirtyRepos: [],
			report: "🧹 Cleanup verified: no stale worktrees, branches, or autostash entries remain.",
		};
	}

	// Build per-repo detail lines
	const details: string[] = [];
	for (const repo of dirtyRepos) {
		const label = repo.repoId ?? "(default)";
		const issues: string[] = [];
		if (repo.staleWorktrees.length > 0) {
			issues.push(`${repo.staleWorktrees.length} stale worktree(s)`);
		}
		if (repo.staleLaneBranches.length > 0) {
			issues.push(`${repo.staleLaneBranches.length} lane branch(es)`);
		}
		if (repo.staleOrchBranches.length > 0) {
			issues.push(`${repo.staleOrchBranches.length} orch branch(es)`);
		}
		if (repo.staleAutostashEntries.length > 0) {
			issues.push(`${repo.staleAutostashEntries.length} autostash entr(ies)`);
		}
		if (repo.nonEmptyWorktreeContainers.length > 0) {
			issues.push(`${repo.nonEmptyWorktreeContainers.length} non-empty .worktrees/ container(s)`);
		}
		details.push(`  ${label}: ${issues.join(", ")}`);
	}

	// Build recovery commands
	const recovery: string[] = [];
	for (const repo of dirtyRepos) {
		const label = repo.repoId ?? "default";
		for (const wt of repo.staleWorktrees) {
			recovery.push(`  git worktree remove --force "${wt}"  # repo: ${label}`);
		}
		for (const br of repo.staleLaneBranches) {
			recovery.push(`  git branch -D "${br}"  # repo: ${label}`);
		}
		for (const br of repo.staleOrchBranches) {
			recovery.push(`  git branch -D "${br}"  # repo: ${label}`);
		}
		for (const entry of repo.staleAutostashEntries) {
			recovery.push(`  git stash drop "${entry}"  # repo: ${label}`);
		}
	}

	const report =
		`⚠️ Cleanup incomplete — residual artifacts found:\n` +
		details.join("\n") +
		(recovery.length > 0 ? `\n  Manual cleanup:\n${recovery.join("\n")}` : "");

	return {
		clean: false,
		notifyLevel: "warning",
		dirtyRepos,
		report,
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
