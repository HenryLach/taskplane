/**
 * TMUX session discovery and formatting
 * @module orch/sessions
 */
import { execSync } from "child_process";
import { join } from "path";

import { tmuxHasSession } from "./execution.ts";
import { ORCH_MESSAGES } from "./messages.ts";
import type { OrchBatchRuntimeState, OrchestratorSessionEntry } from "./types.ts";

// ── Session Discovery ────────────────────────────────────────────────

/**
 * List all TMUX sessions matching the orchestrator prefix.
 *
 * Parses `tmux list-sessions` output and filters by prefix.
 * Returns entries sorted alphabetically by session name.
 *
 * @param tmuxPrefix  - Prefix to match (e.g., "orch")
 * @param batchState  - Current batch state for enrichment (optional)
 * @returns Array of session entries
 */
export function listOrchSessions(
	tmuxPrefix: string,
	batchState?: OrchBatchRuntimeState,
): OrchestratorSessionEntry[] {
	let stdout = "";
	try {
		stdout = execSync('tmux list-sessions -F "#{session_name}"', {
			encoding: "utf-8",
			timeout: 5000,
		});
	} catch {
		// No tmux server running or no sessions
		return [];
	}

	const sessionNames = stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.filter(name => name.startsWith(`${tmuxPrefix}-`))
		.sort();

	if (sessionNames.length === 0) return [];

	// Build a lookup from current batch state for enrichment
	const laneLookup = new Map<string, { laneId: string; taskId: string | null; worktreePath: string }>();
	if (batchState && batchState.currentLanes.length > 0) {
		for (const lane of batchState.currentLanes) {
			laneLookup.set(lane.tmuxSessionName, {
				laneId: lane.laneId,
				taskId: lane.tasks.length > 0 ? lane.tasks[0].taskId : null,
				worktreePath: lane.worktreePath,
			});
		}
	}

	return sessionNames.map(name => {
		const laneInfo = laneLookup.get(name);
		return {
			sessionName: name,
			laneId: laneInfo?.laneId || "unknown",
			taskId: laneInfo?.taskId || null,
			status: tmuxHasSession(name) ? "alive" as const : "dead" as const,
			worktreePath: laneInfo?.worktreePath || "",
			attachCmd: `tmux attach -t ${name}`,
		};
	});
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

