/**
 * Sidecar Telemetry Utilities
 *
 * Canonical home for sidecar JSONL tailing and telemetry delta parsing.
 *
 * These utilities are used by the orchestrator to poll live worker telemetry
 * (token usage, tool calls, retry state) from sidecar JSONL files written by
 * the pi coding agent during task execution.
 *
 * @since TP-161
 */

import { existsSync, mkdirSync, statSync, openSync, readSync, closeSync } from "fs";
import { join, dirname } from "path";

// ── Sidecar Directory Resolution ──────────────────────────────────────

/**
 * Returns the .pi directory path for sidecar files (lane state, conversation logs).
 * In orchestrated mode, the orchestrator passes ORCH_SIDECAR_DIR pointing to the
 * MAIN repo's .pi/ directory (not the worktree's).
 */
export function getSidecarDir(): string {
	// Orchestrator provides the main repo .pi path
	const orchDir = process.env.ORCH_SIDECAR_DIR;
	if (orchDir) {
		if (!existsSync(orchDir)) mkdirSync(orchDir, { recursive: true });
		return orchDir;
	}
	// Fallback: walk up from cwd
	let dir = process.cwd();
	for (let i = 0; i < 10; i++) {
		const piDir = join(dir, ".pi");
		if (existsSync(piDir)) return piDir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	const piDir = join(process.cwd(), ".pi");
	if (!existsSync(piDir)) mkdirSync(piDir, { recursive: true });
	return piDir;
}

// ── Sidecar Tail State ────────────────────────────────────────────────

/**
 * Mutable state for incremental byte-offset sidecar JSONL reading.
 * One instance per sidecar file, persists across poll ticks within a session.
 */
export interface SidecarTailState {
	/** Byte offset of the next unread position in the sidecar file */
	offset: number;
	/** Partial trailing line from the last read (incomplete JSONL line) */
	partial: string;
	/** Whether a retry is currently active (persisted across ticks) */
	retryActive: boolean;
}

export function createSidecarTailState(): SidecarTailState {
	return { offset: 0, partial: "", retryActive: false };
}

// ── Sidecar Telemetry Delta ───────────────────────────────────────────

/**
 * Parsed telemetry accumulated from sidecar JSONL events.
 * Returned by tailSidecarJsonl() on each tick.
 */
export interface SidecarTelemetryDelta {
	/** Per-turn input tokens (sum of new message_end events in this tick) */
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Incremental cost from new message_end events */
	cost: number;
	/** Most recent totalTokens from message_end usage (cumulative, for context %) */
	latestTotalTokens: number;
	/** Tool calls observed in this tick */
	toolCalls: number;
	/** Last tool description from tool_execution_start */
	lastTool: string;
	/** Whether a retry is currently active (persisted across ticks via SidecarTailState) */
	retryActive: boolean;
	/** Total retries started in this tick */
	retriesStarted: number;
	/** Error message from the most recent auto_retry_start */
	lastRetryError: string;
	/** Whether any sidecar events were parsed in this tick (used for callback gating) */
	hadEvents: boolean;
	/** Authoritative context usage from pi get_session_stats (pi ≥ 0.63.0, null if unavailable) */
	contextUsage: { percent: number; totalTokens: number; maxTokens: number } | null;
	/** True when a get_session_stats response was seen but lacked contextUsage (older pi) */
	sawStatsResponseWithoutContextUsage: boolean;
}

// ── Incremental JSONL Tailing ─────────────────────────────────────────

/**
 * Incrementally read new lines from a sidecar JSONL file and parse telemetry events.
 *
 * O(new) per call — only reads bytes after the previous offset. Handles:
 * - File not yet created (returns zero delta)
 * - Empty reads (no new data since last tick)
 * - Partial trailing lines (buffered for next call)
 * - Malformed JSON lines (skipped with stderr warning, does not break iteration)
 *
 * The caller (poll loop) accumulates the returned deltas into TaskState.
 */
export function tailSidecarJsonl(filePath: string, tailState: SidecarTailState): SidecarTelemetryDelta {
	const delta: SidecarTelemetryDelta = {
		inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
		cost: 0, latestTotalTokens: 0, toolCalls: 0, lastTool: "",
		retryActive: tailState.retryActive, retriesStarted: 0, lastRetryError: "",
		hadEvents: false, contextUsage: null, sawStatsResponseWithoutContextUsage: false,
	};

	// Gracefully handle missing file (wrapper hasn't written yet)
	let fileSize: number;
	try {
		fileSize = statSync(filePath).size;
	} catch {
		return delta; // File doesn't exist yet — no-op
	}

	if (fileSize <= tailState.offset) {
		return delta; // No new data
	}

	// Read new bytes from offset to end of file
	const bytesToRead = fileSize - tailState.offset;
	const buf = Buffer.alloc(bytesToRead);
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return delta; // File became inaccessible between stat and open
	}
	try {
		readSync(fd, buf, 0, bytesToRead, tailState.offset);
	} catch {
		closeSync(fd);
		return delta; // Read error — try again next tick
	}
	closeSync(fd);
	tailState.offset = fileSize;

	// Split into lines, preserving any partial trailing line
	const chunk = tailState.partial + buf.toString("utf-8");
	const lines = chunk.split("\n");
	// Last element is either "" (if chunk ended with \n) or a partial line
	tailState.partial = lines.pop() || "";

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let event: any;
		try {
			event = JSON.parse(trimmed);
		} catch {
			// Malformed JSON — skip silently (concurrent write race, truncated line)
			continue;
		}

		if (!event || !event.type) continue;

		delta.hadEvents = true;

		switch (event.type) {
			case "message_end": {
				const usage = event.message?.usage;
				if (usage) {
					delta.inputTokens += usage.input || 0;
					delta.outputTokens += usage.output || 0;
					delta.cacheReadTokens += usage.cacheRead || 0;
					delta.cacheWriteTokens += usage.cacheWrite || 0;
					if (usage.cost) {
						delta.cost += typeof usage.cost === "object"
							? (usage.cost.total || 0)
							: (typeof usage.cost === "number" ? usage.cost : 0);
					}
					// totalTokens is cumulative (grows each turn) — use latest value.
					// Include cacheRead tokens: pi's totalTokens and the
					// input+output fallback both exclude cache reads, but cached
					// tokens still consume context window capacity.
					const rawTotal = usage.totalTokens
						|| ((usage.input || 0) + (usage.output || 0));
					const totalTokens = rawTotal + (usage.cacheRead || 0);
					if (totalTokens > delta.latestTotalTokens) {
						delta.latestTotalTokens = totalTokens;
					}
				}
				break;
			}

			case "tool_execution_start": {
				delta.toolCalls++;
				const toolDesc = event.toolName || "unknown";
				let argPreview = "";
				if (event.args) {
					if (typeof event.args === "string") {
						argPreview = event.args.slice(0, 80);
					} else if (typeof event.args === "object") {
						const firstVal = Object.values(event.args)[0];
						if (typeof firstVal === "string") {
							argPreview = (firstVal as string).slice(0, 80);
						}
					}
				}
				delta.lastTool = argPreview ? `${toolDesc} ${argPreview}` : toolDesc;
				break;
			}

			case "auto_retry_start": {
				delta.retriesStarted++;
				delta.lastRetryError = event.errorMessage || event.error || "unknown";
				tailState.retryActive = true;
				break;
			}

			case "auto_retry_end": {
				tailState.retryActive = false;
				break;
			}

			case "response": {
				// get_session_stats response from pi ≥ 0.63.0 — authoritative context usage
				if (event.success === true && event.data?.contextUsage) {
					const cu = event.data.contextUsage;
					// pi sends `percent` (pi ≥ 0.63.0); accept `percentUsed` as legacy fallback
					const pctValue = cu.percent ?? cu.percentUsed;
					if (typeof pctValue === "number") {
						delta.contextUsage = {
							percent: pctValue,
							totalTokens: cu.totalTokens || 0,
							maxTokens: cu.maxTokens || 0,
						};
					}
				} else if (event.success === true && event.data && !event.data.contextUsage) {
					// Successful get_session_stats response but no contextUsage — older pi
					delta.sawStatsResponseWithoutContextUsage = true;
				}
				break;
			}
		}
	}

	// Reflect persisted retry state into the delta for the caller
	delta.retryActive = tailState.retryActive;
	return delta;
}
