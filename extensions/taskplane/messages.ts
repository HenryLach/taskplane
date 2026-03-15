/**
 * User-facing message templates (ORCH_MESSAGES)
 * @module orch/messages
 */
import type { AbortMode } from "./types.ts";

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
		`🔀 [Wave ${waveNum}] Merging ${laneCount} lane(s) into develop...`,
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
		`🔄 Resetting ${lanes} worktree(s) to develop HEAD after wave ${waveNum}`,
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
} as const;


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
