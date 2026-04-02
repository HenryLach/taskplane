/**
 * Centralized compatibility helpers for legacy TMUX-shaped inputs.
 *
 * Runtime V2 no longer uses tmux as the execution backend, but ingress
 * paths still accept legacy tmux-shaped configuration/state fields.
 */

export type SupportedSpawnMode = "subprocess" | "tmux";

export interface SessionPrefixAliasTarget {
	sessionPrefix?: unknown;
	tmuxPrefix?: unknown;
}

export interface LaneSessionAliasTarget {
	laneSessionId?: unknown;
	tmuxSessionName?: unknown;
}

export interface SpawnModeCompatibility {
	value?: SupportedSpawnMode;
	isSupported: boolean;
	isLegacyTmux: boolean;
}

/**
 * Resolve canonical sessionPrefix from canonical/legacy inputs.
 */
export function resolveSessionPrefixAlias(
	sessionPrefix: unknown,
	tmuxPrefix: unknown,
): string | undefined {
	if (typeof sessionPrefix === "string") return sessionPrefix;
	if (typeof tmuxPrefix === "string") return tmuxPrefix;
	return undefined;
}

/**
 * Normalize tmuxPrefix -> sessionPrefix in place and remove legacy key.
 */
export function normalizeSessionPrefixAlias(target: SessionPrefixAliasTarget): void {
	const normalized = resolveSessionPrefixAlias(target.sessionPrefix, target.tmuxPrefix);
	if (normalized !== undefined) {
		target.sessionPrefix = normalized;
	}
	delete target.tmuxPrefix;
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

/**
 * Classify spawnMode values with legacy tmux compatibility info.
 */
export function classifySpawnModeCompatibility(spawnMode: unknown): SpawnModeCompatibility {
	if (spawnMode === "subprocess") {
		return { value: "subprocess", isSupported: true, isLegacyTmux: false };
	}
	if (spawnMode === "tmux") {
		return { value: "tmux", isSupported: true, isLegacyTmux: true };
	}
	return { isSupported: false, isLegacyTmux: false };
}

/**
 * True when spawnMode is legacy `tmux` compatibility value.
 */
export function isLegacyTmuxSpawnMode(spawnMode: unknown): boolean {
	return classifySpawnModeCompatibility(spawnMode).isLegacyTmux;
}

/**
 * Build canonical deprecation warning for legacy spawn_mode: tmux usage.
 */
export function formatSpawnModeTmuxDeprecation(configuredFields: string[]): string {
	return (
		"[taskplane] deprecation: spawn_mode \"tmux\" is legacy-only under Runtime V2 and will be removed in a future release. " +
		`Use \"subprocess\" instead. Configured field(s): ${configuredFields.join(", ")}.`
	);
}
