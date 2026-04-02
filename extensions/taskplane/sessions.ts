/**
 * Runtime V2 session discovery and formatting
 * @module orch/sessions
 */

import { ORCH_MESSAGES } from "./messages.ts";
import type { OrchBatchRuntimeState, OrchestratorSessionEntry } from "./types.ts";

// ── Session Discovery ────────────────────────────────────────────────

/**
 * List active orchestrator sessions from in-memory batch state.
 *
 * Runtime V2 no longer uses TMUX as the execution owner. Session rows are
 * derived from canonical lane session IDs in runtime state.
 *
 * @param _tmuxPrefix - Legacy parameter kept for API compatibility
 * @param batchState  - Current batch state for lane/task enrichment
 * @returns Array of session entries
 */
export function listOrchSessions(
	_tmuxPrefix: string,
	batchState?: OrchBatchRuntimeState,
): OrchestratorSessionEntry[] {
	if (!batchState || batchState.currentLanes.length === 0) return [];

	return batchState.currentLanes
		.map(lane => ({
			sessionName: lane.laneSessionId,
			laneId: lane.laneId,
			taskId: lane.tasks.length > 0 ? lane.tasks[0].taskId : null,
			status: "alive" as const,
			worktreePath: lane.worktreePath,
			attachCmd: "Runtime V2 (no tmux attach)",
		}))
		.sort((a, b) => a.sessionName.localeCompare(b.sessionName));
}

/**
 * Format session listing for display.
 */
export function formatOrchSessions(sessions: OrchestratorSessionEntry[]): string {
	if (sessions.length === 0) {
		return ORCH_MESSAGES.sessionsNone();
	}

	const lines: string[] = [ORCH_MESSAGES.sessionsHeader(sessions.length), ""];

	for (const s of sessions) {
		const statusIcon = s.status === "alive" ? "🟢" : "🔴";
		const taskInfo = s.taskId ? ` (${s.taskId})` : "";
		lines.push(`  ${statusIcon} ${s.sessionName} [${s.laneId}]${taskInfo}`);
		lines.push(`     ${s.attachCmd}`);
	}

	return lines.join("\n");
}
