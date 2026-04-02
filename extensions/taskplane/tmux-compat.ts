/**
 * Migration-only helpers for legacy TMUX-shaped persisted lane fields.
 *
 * Runtime V2 no longer accepts TMUX config/runtime contracts. The only
 * compatibility retained here is one-release state ingress normalization for
 * `lanes[].tmuxSessionName` → `lanes[].laneSessionId`.
 */

export interface LaneSessionAliasTarget {
	laneSessionId?: unknown;
	tmuxSessionName?: unknown;
}

/**
 * Read canonical + legacy lane session fields from a lane-like record.
 */
export function readLaneSessionAliases(target: LaneSessionAliasTarget): {
	laneSessionId: unknown;
	tmuxSessionName: unknown;
} {
	return {
		laneSessionId: target.laneSessionId,
		tmuxSessionName: target.tmuxSessionName,
	};
}

/**
 * Normalize tmuxSessionName -> laneSessionId in place and remove legacy key.
 */
export function normalizeLaneSessionAlias(target: LaneSessionAliasTarget): void {
	if (typeof target.laneSessionId !== "string" && typeof target.tmuxSessionName === "string") {
		target.laneSessionId = target.tmuxSessionName;
	}
	if ("tmuxSessionName" in target) {
		delete target.tmuxSessionName;
	}
}
