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

// ── Token Counts (Diagnostics) ───────────────────────────────────────

/**
 * Token usage breakdown for a single session.
 *
 * Matches the RPC exit-summary `tokens` shape: four count fields only.
 * Cost is tracked separately as a top-level field on `ExitSummary` and
 * `TaskExitDiagnostic`, not embedded in the token counts.
 *
 * This is distinct from `TokenCounts` in `types.ts` (which bundles
 * `costUsd` for batch-history aggregation). Downstream consumers that
 * need to convert can merge `{ ...sessionTokens, costUsd: cost }`.
 */
export interface SessionTokenCounts {
	/** Input tokens consumed */
	input: number;
	/** Output tokens generated */
	output: number;
	/** Tokens served from cache (read) */
	cacheRead: number;
	/** Tokens written to cache */
	cacheWrite: number;
}

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
 * | `model_access_error` | Model unavailable (401/403/429, model not found)     |
 * | `context_overflow`   | Hit context window limit (compactions + high ctx %)  |
 * | `unsafe_submodule_dirty` | Task left a submodule worktree with uncommitted changes |
 * | `unsafe_submodule_unpublished_commit` | Task advanced a submodule to a local-only commit |
 * | `unsafe_submodule_unreachable_ref` | Task/merge introduced a submodule gitlink clones cannot fetch |
 * | `wall_clock_timeout` | Killed by task-runner's max_worker_minutes timer     |
 * | `process_crash`      | Non-zero exit code with no API error indicators      |
 * | `session_vanished`   | Session disappeared without exit summary             |
 * | `stall_timeout`      | No STATUS.md progress for stall_timeout minutes      |
 * | `user_killed`        | User manually killed the session (e.g., forced process kill) |
 * | `unknown`            | Could not determine cause                            |
 */
export type ExitClassification =
	| "completed"
	| "api_error"
	| "model_access_error"
	| "context_overflow"
	| "unsafe_submodule_dirty"
	| "unsafe_submodule_unpublished_commit"
	| "unsafe_submodule_unreachable_ref"
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
	"model_access_error",
	"context_overflow",
	"unsafe_submodule_dirty",
	"unsafe_submodule_unpublished_commit",
	"unsafe_submodule_unreachable_ref",
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
 * **Field optionality rationale:**
 * The wrapper initializes counters (toolCalls, compactions, durationSec,
 * retries) at startup, so they are always present even on crash — these
 * are required. Fields that depend on RPC event accumulation (tokens,
 * cost, lastToolCall, error) are nullable — they may be absent if the
 * process crashes before capturing any events. `exitCode` and
 * `exitSignal` are optional (`?`) because the wrapper may crash before
 * the Node exit handler fires, producing a partial JSON artifact that
 * `JSON.parse()` succeeds on but lacks these fields.
 *
 * Consumers MUST use `typeof` guards on optional/nullable fields before
 * branching (e.g., `typeof exitCode === "number"` rather than `!== null`).
 */
export interface ExitSummary {
	/** Process exit code. Optional — may be absent if wrapper crashes before exit handler fires. Null if killed by signal. */
	exitCode?: number | null;
	/** Signal that killed the process (e.g., "SIGTERM"). Optional — may be absent on crash. Null if clean exit. */
	exitSignal?: string | null;
	/** Accumulated token counts across all turns (null if no message_end events received) */
	tokens: SessionTokenCounts | null;
	/** Total cost in USD (null if no cost data received) */
	cost: number | null;
	/** Total tool calls made (initialized to 0 at startup) */
	toolCalls: number;
	/** API retry events observed (initialized to [] at startup) */
	retries: RetryRecord[];
	/** Number of context compactions observed (initialized to 0 at startup) */
	compactions: number;
	/** Wall-clock duration of the session in seconds (always written, even on crash) */
	durationSec: number;
	/** Last tool call description (e.g., "bash: node --test tests/*.test.ts"), null if no tools were called */
	lastToolCall: string | null;
	/** Error message if the session ended with an error, null on clean exit */
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
 * - `contextKilled`: true if the task-runner explicitly killed the session due to context limit
 * - `stallDetected`: true if monitoring detected no STATUS.md progress
 * - `userKilled`: true if user manually killed the session (e.g., /orch-abort, forced process kill)
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
	/** Whether the task-runner explicitly killed the session due to context limit (TP-026) */
	contextKilled?: boolean;
	/** Explicit unsafe-submodule failure category when runtime safety checks reject the result */
	unsafeSubmoduleKind?: "dirty-worktree" | "unpublished-commit" | "unreachable-ref" | null;
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
	tokensUsed: SessionTokenCounts | null;
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
 * Patterns that indicate a model access error (as opposed to a generic API error).
 *
 * These patterns match error messages from API providers when:
 * - The model is not found or deprecated
 * - Authentication/authorization fails (HTTP 401/403)
 * - Rate limits are hit specifically for the model (HTTP 429)
 * - API key is expired or invalid
 *
 * The patterns are case-insensitive and tested against the error string.
 *
 * @since TP-055
 */
export const MODEL_ACCESS_ERROR_PATTERNS: readonly RegExp[] = [
	/\b(?:401|403)\b/,                          // HTTP auth/forbidden status codes
	/\b429\b/,                                   // HTTP rate limit
	/model[_ ]not[_ ]found/i,                    // Model not found
	/model[_ ](?:is[_ ])?unavailable/i,          // Model unavailable
	/model[_ ](?:has[_ ]been[_ ])?deprecated/i,  // Model deprecated
	/api[_ ]key[_ ](?:expired|invalid|revoked)/i, // API key issues
	/invalid[_ ]api[_ ]key/i,                     // Invalid API key (alternate phrasing)
	/authentication[_ ](?:failed|error|required)/i, // Auth failures
	/authorization[_ ](?:failed|error|denied)/i,    // Authz failures
	/access[_ ]denied/i,                          // Generic access denied
	/permission[_ ]denied/i,                      // Permission denied
	/quota[_ ]exceeded/i,                         // Quota exceeded
	/rate[_ ]limit/i,                             // Rate limit (phrase)
	/insufficient[_ ]quota/i,                     // Insufficient quota
];

/**
 * Test whether an error message indicates a model access error.
 *
 * Used by `classifyExit()` to distinguish model-specific failures from
 * generic API errors, enabling targeted fallback to the session model.
 *
 * @param errorMessage - Error message to test
 * @returns true if the error matches a model access pattern
 * @since TP-055
 */
export function isModelAccessError(errorMessage: string): boolean {
	if (!errorMessage) return false;
	return MODEL_ACCESS_ERROR_PATTERNS.some(pattern => pattern.test(errorMessage));
}

/**
 * Classify a task session's exit into a deterministic category.
 *
 * Uses a strict precedence order — the first matching condition wins.
 * This ensures deterministic results even when multiple signals are
 * present (e.g., a session that was both stalled AND crashed).
 *
 * **Classification precedence (highest → lowest):**
 *
 * | Priority | Condition                                            | Result               |
 * |----------|------------------------------------------------------|----------------------|
 * | 1        | `.DONE` file found                                   | `completed`          |
 * | 2a       | Retries with model-access error pattern               | `model_access_error` |
 * | 2b       | Retries present with final retry failed               | `api_error`          |
 * | 2c       | Error message has model-access pattern (no retries)   | `model_access_error` |
 * | 3        | Compactions > 0 AND contextPct ≥ 90%                  | `context_overflow`   |
 * | 3b       | Task-runner explicitly context-killed                  | `context_overflow`   |
 * | 4        | Runtime safety rejected unsafe submodule state        | `unsafe_submodule_*` |
 * | 5        | Timer killed the session                              | `wall_clock_timeout` |
 * | 6        | Non-zero exit code, no API error                      | `process_crash`      |
 * | 7        | No exit summary file (session vanished)               | `session_vanished`   |
 * | 8        | Stall detected (no STATUS.md progress)                | `stall_timeout`      |
 * | 9        | User manually killed the session                      | `user_killed`        |
 * | 10       | None of the above                                    | `unknown`            |
 *
 * **Tie-break rationale:**
 * - `.DONE` always wins because the task succeeded regardless of how messy
 *   the session was (retries, compactions, etc.).
 * - `model_access_error` beats generic `api_error` because it's more specific
 *   and enables targeted fallback (retry with session model).
 * - `api_error` beats `context_overflow` because API failures are more
 *   actionable (auth fix, rate limit backoff).
 * - Explicit unsafe-submodule failures beat generic process crashes because
 *   the runtime safety guard already knows why the task was rejected.
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
	const contextKilled = input.contextKilled ?? false;
	const unsafeSubmoduleKind = input.unsafeSubmoduleKind ?? null;

	// 1. .DONE file found → completed (task succeeded, regardless of session state)
	if (doneFileFound) {
		return "completed";
	}

	// 2a. Retries present with model-access error pattern → model_access_error
	// 2b. Retries present with final retry failed → api_error
	if (exitSummary?.retries && exitSummary.retries.length > 0) {
		const lastRetry = exitSummary.retries[exitSummary.retries.length - 1];
		if (!lastRetry.succeeded) {
			// Check if the retry error indicates a model access issue
			if (isModelAccessError(lastRetry.error)) {
				return "model_access_error";
			}
			return "api_error";
		}
	}

	// 2c. Error message (no retries) indicates model access issue → model_access_error
	if (exitSummary?.error && isModelAccessError(exitSummary.error)) {
		return "model_access_error";
	}

	// 3. Compactions > 0 AND high context utilization → context_overflow
	if (exitSummary && exitSummary.compactions > 0) {
		const effectivePct = contextPct ?? 0;
		if (effectivePct >= CONTEXT_OVERFLOW_THRESHOLD_PCT) {
			return "context_overflow";
		}
	}

	// 3b. Task-runner explicitly killed session due to context limit → context_overflow
	// Catches cases where exit summary is missing (wrapper crashed) or compactions=0
	// but the task-runner's own context guard triggered the kill.
	if (contextKilled) {
		return "context_overflow";
	}

	// 4. Runtime safety rejected an unsafe submodule/gitlink state.
	if (unsafeSubmoduleKind === "dirty-worktree") {
		return "unsafe_submodule_dirty";
	}
	if (unsafeSubmoduleKind === "unpublished-commit") {
		return "unsafe_submodule_unpublished_commit";
	}
	if (unsafeSubmoduleKind === "unreachable-ref") {
		return "unsafe_submodule_unreachable_ref";
	}

	// 5. Task-runner's wall-clock timer killed the session → wall_clock_timeout
	if (timerKilled) {
		return "wall_clock_timeout";
	}

	// 6. Non-zero exit code, no API error indicators → process_crash
	// Guard with typeof to handle partial summaries where exitCode may be undefined
	if (exitSummary && typeof exitSummary.exitCode === "number" && exitSummary.exitCode !== 0) {
		return "process_crash";
	}

	// 7. No exit summary file found → session_vanished
	if (exitSummary === null) {
		return "session_vanished";
	}

	// 8. Stall detected (no STATUS.md progress) → stall_timeout
	if (stallDetected) {
		return "stall_timeout";
	}

	// 9. User manually killed the session → user_killed
	if (userKilled) {
		return "user_killed";
	}

	// 10. None of the above → unknown
	return "unknown";
}
