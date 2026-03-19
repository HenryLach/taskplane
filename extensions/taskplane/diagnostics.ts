/**
 * Exit classification types and logic for task diagnostics.
 *
 * Defines the structured `TaskExitDiagnostic` type that replaces
 * free-text `exitReason` for deterministic retry decisions,
 * cost tracking, and dashboard telemetry.
 *
 * @module orch/diagnostics
 * @see docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md §1b
 */

import type { TokenCounts } from "./types.ts";

// Re-export TokenCounts so downstream consumers importing from diagnostics
// still get the type without a separate import from types.ts.
export type { TokenCounts } from "./types.ts";

// ── Exit Classification ──────────────────────────────────────────────

/**
 * All possible exit classifications for a task session.
 *
 * Each value maps to a specific failure mode that downstream consumers
 * (retry logic, dashboard, cost reports) can branch on deterministically.
 *
 * | Classification       | Meaning                                              |
 * |----------------------|------------------------------------------------------|
 * | `completed`          | `.DONE` file found — task finished successfully      |
 * | `api_error`          | API returned error (auth, rate limit, overload)      |
 * | `context_overflow`   | Hit context window limit (compactions + high ctx %)  |
 * | `wall_clock_timeout` | Killed by task-runner's max_worker_minutes timer     |
 * | `process_crash`      | Non-zero exit code with no API error indicators      |
 * | `session_vanished`   | Tmux session disappeared without exit summary        |
 * | `stall_timeout`      | No STATUS.md progress for stall_timeout minutes      |
 * | `user_killed`        | User manually killed the session (e.g., tmux kill)   |
 * | `unknown`            | Could not determine cause                            |
 */
export type ExitClassification =
	| "completed"
	| "api_error"
	| "context_overflow"
	| "wall_clock_timeout"
	| "process_crash"
	| "session_vanished"
	| "stall_timeout"
	| "user_killed"
	| "unknown";

/**
 * All classification values as a readonly array, for iteration and validation.
 */
export const EXIT_CLASSIFICATIONS: readonly ExitClassification[] = [
	"completed",
	"api_error",
	"context_overflow",
	"wall_clock_timeout",
	"process_crash",
	"session_vanished",
	"stall_timeout",
	"user_killed",
	"unknown",
] as const;

// ── Retry Record ─────────────────────────────────────────────────────

/**
 * A single API retry event from the RPC wrapper's exit summary.
 *
 * Captured from `auto_retry_start/end` RPC events.
 */
export interface RetryRecord {
	/** Retry attempt number (1-indexed) */
	attempt: number;
	/** Error message that triggered the retry */
	error: string;
	/** Delay in milliseconds before retrying */
	delayMs: number;
	/** Whether the retry succeeded */
	succeeded: boolean;
}

// ── Exit Summary ─────────────────────────────────────────────────────

/**
 * Exit summary written by rpc-wrapper.mjs on process exit.
 *
 * This is the wrapper's output artifact — a JSON file capturing
 * everything the wrapper observed during the session. The task-runner
 * reads this to build `TaskExitDiagnostic`.
 *
 * All fields are nullable/optional to handle partial writes when
 * the process crashes before accumulating complete data.
 */
export interface ExitSummary {
	/** Process exit code (null if killed by signal) */
	exitCode: number | null;
	/** Signal that killed the process (e.g., "SIGTERM"), null if clean exit */
	exitSignal: string | null;
	/** Accumulated token counts across all turns */
	tokens: TokenCounts | null;
	/** Total cost in USD */
	cost: number | null;
	/** Total tool calls made */
	toolCalls: number;
	/** API retry events observed */
	retries: RetryRecord[];
	/** Number of context compactions observed */
	compactions: number;
	/** Wall-clock duration of the session in seconds */
	durationSec: number;
	/** Last tool call description (e.g., "bash: npx vitest run") */
	lastToolCall: string | null;
	/** Error message if the session ended with an error */
	error: string | null;
}

// ── Classification Input ─────────────────────────────────────────────

/**
 * Structured input to `classifyExit()`.
 *
 * Aggregates all signals needed for deterministic classification.
 * Sources:
 * - `exitSummary`: from rpc-wrapper.mjs exit summary JSON (null if file missing)
 * - `doneFileFound`: from .DONE file presence check (task-runner)
 * - `timerKilled`: true if task-runner's max_worker_minutes timer killed the session
 * - `stallDetected`: true if monitoring detected no STATUS.md progress
 * - `userKilled`: true if user manually killed the session (e.g., /orch-abort, tmux kill)
 * - `contextPct`: estimated context utilization % (0-100), null if unknown
 *
 * Design: single structured input object (not positional args) for
 * extensibility as new signals are added in future phases.
 */
export interface ExitClassificationInput {
	/** Exit summary from rpc-wrapper.mjs. Null if the summary file was not found. */
	exitSummary: ExitSummary | null;
	/** Whether the .DONE file was found in the task folder */
	doneFileFound: boolean;
	/** Whether the task-runner's wall-clock timer killed the session */
	timerKilled: boolean;
	/** Whether monitoring detected a stall (no STATUS.md progress) */
	stallDetected: boolean;
	/** Whether the user manually killed the session */
	userKilled: boolean;
	/** Estimated context utilization percentage (0-100), null if unknown */
	contextPct: number | null;
}

// ── Task Exit Diagnostic ─────────────────────────────────────────────

/**
 * Structured diagnostic for a task session's exit.
 *
 * Sits alongside the legacy `exitReason: string` on `LaneTaskOutcome`
 * during the transition period (Phase 1). Promoted to canonical in
 * schema v3 (Phase 3).
 *
 * Produced by calling `classifyExit()` after the session ends, then
 * enriching with progress/context metadata from STATUS.md and git.
 */
export interface TaskExitDiagnostic {
	/** Deterministic exit classification */
	classification: ExitClassification;
	/** Process exit code (null if killed by signal or summary missing) */
	exitCode: number | null;
	/** Human-readable error message (null if clean exit) */
	errorMessage: string | null;
	/** Token usage breakdown (null if no summary available) */
	tokensUsed: TokenCounts | null;
	/** Estimated context utilization percentage (0-100, null if unknown) */
	contextPct: number | null;
	/** Number of commits on the task branch (partial progress indicator) */
	partialProgressCommits: number;
	/** Branch name with partial progress (null if no branch) */
	partialProgressBranch: string | null;
	/** Wall-clock duration of the session in seconds */
	durationSec: number;
	/** Last known step number from STATUS.md (null if unparsed) */
	lastKnownStep: number | null;
	/** Last known checkbox text from STATUS.md (null if unparsed) */
	lastKnownCheckbox: string | null;
	/** Repo identifier ("default" in repo mode, repo key in workspace mode) */
	repoId: string;
}

// ── Classification Logic ─────────────────────────────────────────────

/**
 * Threshold for context utilization percentage to consider "high".
 * Used in the `context_overflow` classification path:
 * compactions > 0 AND contextPct >= this threshold → context_overflow.
 */
export const CONTEXT_OVERFLOW_THRESHOLD_PCT = 90;

/**
 * Classify a task session's exit into a deterministic category.
 *
 * Uses a strict precedence order — the first matching condition wins.
 * This ensures deterministic results even when multiple signals are
 * present (e.g., a session that was both stalled AND crashed).
 *
 * **Classification precedence (highest → lowest):**
 *
 * | Priority | Condition                                            | Result              |
 * |----------|------------------------------------------------------|---------------------|
 * | 1        | `.DONE` file found                                   | `completed`         |
 * | 2        | Retries present with final retry failed               | `api_error`         |
 * | 3        | Compactions > 0 AND contextPct ≥ 90%                  | `context_overflow`  |
 * | 4        | Timer killed the session                              | `wall_clock_timeout`|
 * | 5        | Non-zero exit code, no API error                      | `process_crash`     |
 * | 6        | No exit summary file (session vanished)               | `session_vanished`  |
 * | 7        | Stall detected (no STATUS.md progress)                | `stall_timeout`     |
 * | 8        | User manually killed the session                      | `user_killed`       |
 * | 9        | None of the above                                    | `unknown`           |
 *
 * **Tie-break rationale:**
 * - `.DONE` always wins because the task succeeded regardless of how messy
 *   the session was (retries, compactions, etc.).
 * - `api_error` beats `context_overflow` because API failures are more
 *   actionable (auth fix, rate limit backoff).
 * - `wall_clock_timeout` beats `process_crash` because the timer kill
 *   explains the non-zero exit code.
 * - `session_vanished` (no summary) is checked after exit-code-based
 *   paths because those require the summary to exist.
 * - `stall_timeout` and `user_killed` are low-priority because they're
 *   external signals that may co-occur with other conditions.
 *
 * @param input - Aggregated signals from the session exit
 * @returns The exit classification string
 */
export function classifyExit(input: ExitClassificationInput): ExitClassification {
	const { exitSummary, doneFileFound, timerKilled, stallDetected, userKilled, contextPct } = input;

	// 1. .DONE file found → completed (task succeeded, regardless of session state)
	if (doneFileFound) {
		return "completed";
	}

	// 2. Retries present with final retry failed → api_error
	if (exitSummary?.retries && exitSummary.retries.length > 0) {
		const lastRetry = exitSummary.retries[exitSummary.retries.length - 1];
		if (!lastRetry.succeeded) {
			return "api_error";
		}
	}

	// 3. Compactions > 0 AND high context utilization → context_overflow
	if (exitSummary && exitSummary.compactions > 0) {
		const effectivePct = contextPct ?? 0;
		if (effectivePct >= CONTEXT_OVERFLOW_THRESHOLD_PCT) {
			return "context_overflow";
		}
	}

	// 4. Task-runner's wall-clock timer killed the session → wall_clock_timeout
	if (timerKilled) {
		return "wall_clock_timeout";
	}

	// 5. Non-zero exit code, no API error indicators → process_crash
	if (exitSummary && exitSummary.exitCode !== null && exitSummary.exitCode !== 0) {
		return "process_crash";
	}

	// 6. No exit summary file found → session_vanished
	if (exitSummary === null) {
		return "session_vanished";
	}

	// 7. Stall detected (no STATUS.md progress) → stall_timeout
	if (stallDetected) {
		return "stall_timeout";
	}

	// 8. User manually killed the session → user_killed
	if (userKilled) {
		return "user_killed";
	}

	// 9. None of the above → unknown
	return "unknown";
}
