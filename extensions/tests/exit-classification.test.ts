/**
 * Exit Classification Tests — TP-025 Step 3
 *
 * Table-driven tests for classifyExit() covering all 9 classification paths
 * plus precedence collision cases.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/exit-classification.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import {
	classifyExit,
	EXIT_CLASSIFICATIONS,
	CONTEXT_OVERFLOW_THRESHOLD_PCT,
	type ExitClassificationInput,
	type ExitSummary,
	type ExitClassification,
} from "../taskplane/diagnostics.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal valid ExitSummary with overrides. */
function makeSummary(overrides: Partial<ExitSummary> = {}): ExitSummary {
	return {
		exitCode: 0,
		exitSignal: null,
		tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
		cost: 0.01,
		toolCalls: 1,
		retries: [],
		compactions: 0,
		durationSec: 10,
		lastToolCall: "bash: echo hello",
		error: null,
		...overrides,
	};
}

/** Build a minimal ExitClassificationInput with overrides. */
function makeInput(overrides: Partial<ExitClassificationInput> = {}): ExitClassificationInput {
	return {
		exitSummary: makeSummary(),
		doneFileFound: false,
		timerKilled: false,
		stallDetected: false,
		userKilled: false,
		contextPct: null,
		...overrides,
	};
}

// ── 1. Basic Classification Paths ────────────────────────────────────

describe("classifyExit — all 9 classification paths", () => {
	const cases: Array<{
		name: string;
		input: ExitClassificationInput;
		expected: ExitClassification;
	}> = [
		{
			name: "completed — .DONE file found, clean exit",
			input: makeInput({ doneFileFound: true }),
			expected: "completed",
		},
		{
			name: "model_access_error — retries with rate_limit_exceeded pattern",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "rate_limit_exceeded", delayMs: 5000, succeeded: false },
					],
				}),
			}),
			expected: "model_access_error",
		},
		{
			name: "api_error — retries present, last retry failed, non-model error",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "server_overloaded_please_retry", delayMs: 5000, succeeded: false },
					],
				}),
			}),
			expected: "api_error",
		},
		{
			name: "api_error — multiple retries, last retry failed",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [
						{ attempt: 1, error: "rate_limit", delayMs: 1000, succeeded: true },
						{ attempt: 2, error: "overloaded", delayMs: 2000, succeeded: false },
					],
				}),
			}),
			expected: "api_error",
		},
		{
			name: "NOT api_error — retries present but last retry succeeded",
			input: makeInput({
				exitSummary: makeSummary({
					exitCode: 1,
					retries: [
						{ attempt: 1, error: "rate_limit", delayMs: 1000, succeeded: true },
					],
				}),
			}),
			// last retry succeeded → skip api_error, move to process_crash (exitCode=1)
			expected: "process_crash",
		},
		{
			name: "context_overflow — compactions > 0 and high context %",
			input: makeInput({
				exitSummary: makeSummary({ compactions: 2 }),
				contextPct: CONTEXT_OVERFLOW_THRESHOLD_PCT,
			}),
			expected: "context_overflow",
		},
		{
			name: "context_overflow — exactly at threshold (90%)",
			input: makeInput({
				exitSummary: makeSummary({ compactions: 1 }),
				contextPct: 90,
			}),
			expected: "context_overflow",
		},
		{
			name: "NOT context_overflow — compactions > 0 but low context %",
			input: makeInput({
				exitSummary: makeSummary({ compactions: 1, exitCode: 1 }),
				contextPct: 50,
			}),
			// contextPct < 90 → skip context_overflow, fall through to process_crash
			expected: "process_crash",
		},
		{
			name: "NOT context_overflow — compactions > 0 but null contextPct (defaults to 0)",
			input: makeInput({
				exitSummary: makeSummary({ compactions: 1, exitCode: 1 }),
				contextPct: null,
			}),
			expected: "process_crash",
		},
		{
			name: "unsafe_submodule_dirty — explicit dirty submodule rejection",
			input: makeInput({
				unsafeSubmoduleKind: "dirty-worktree",
				exitSummary: makeSummary({ exitCode: 1, error: "Unsafe submodule state after task success: repo has uncommitted submodule changes" }),
			}),
			expected: "unsafe_submodule_dirty",
		},
		{
			name: "unsafe_submodule_unpublished_commit — explicit local-only submodule commit rejection",
			input: makeInput({
				unsafeSubmoduleKind: "unpublished-commit",
				exitSummary: makeSummary({ exitCode: 1, error: "Unsafe submodule state after task success: repo points to local commit abcdef12 not reachable on origin" }),
			}),
			expected: "unsafe_submodule_unpublished_commit",
		},
		{
			name: "unsafe_submodule_unreachable_ref — explicit unreachable gitlink rejection",
			input: makeInput({
				unsafeSubmoduleKind: "unreachable-ref",
				exitSummary: makeSummary({ exitCode: 1, error: "submodule_unreachable_ref: libs/my_lib@abcdef12 on origin" }),
			}),
			expected: "unsafe_submodule_unreachable_ref",
		},
		{
			name: "wall_clock_timeout — timer killed the session",
			input: makeInput({ timerKilled: true }),
			expected: "wall_clock_timeout",
		},
		{
			name: "process_crash — non-zero exit code, no API error",
			input: makeInput({
				exitSummary: makeSummary({ exitCode: 1 }),
			}),
			expected: "process_crash",
		},
		{
			name: "process_crash — exit code 137 (OOM kill)",
			input: makeInput({
				exitSummary: makeSummary({ exitCode: 137 }),
			}),
			expected: "process_crash",
		},
		{
			name: "session_vanished — no exit summary (null)",
			input: makeInput({ exitSummary: null }),
			expected: "session_vanished",
		},
		{
			name: "stall_timeout — stall detected, clean exit otherwise",
			input: makeInput({ stallDetected: true }),
			expected: "stall_timeout",
		},
		{
			name: "user_killed — user manually killed",
			input: makeInput({ userKilled: true }),
			expected: "user_killed",
		},
		{
			name: "unknown — clean exit, no .DONE, no issues detected",
			input: makeInput(),
			expected: "unknown",
		},
	];

	for (const tc of cases) {
		it(tc.name, () => {
			expect(classifyExit(tc.input)).toBe(tc.expected);
		});
	}
});

// ── 2. Precedence Collision Tests ────────────────────────────────────

describe("classifyExit — precedence collisions", () => {
	const precedenceCases: Array<{
		name: string;
		input: ExitClassificationInput;
		expected: ExitClassification;
		rationale: string;
	}> = [
		{
			name: ".DONE wins over failed retries (api_error)",
			input: makeInput({
				doneFileFound: true,
				exitSummary: makeSummary({
					retries: [{ attempt: 1, error: "overloaded", delayMs: 1000, succeeded: false }],
				}),
			}),
			expected: "completed",
			rationale: ".DONE means the task succeeded regardless of session messiness",
		},
		{
			name: ".DONE wins over context_overflow",
			input: makeInput({
				doneFileFound: true,
				exitSummary: makeSummary({ compactions: 3 }),
				contextPct: 99,
			}),
			expected: "completed",
			rationale: ".DONE means the task succeeded even with compactions",
		},
		{
			name: ".DONE wins over timerKilled",
			input: makeInput({
				doneFileFound: true,
				timerKilled: true,
			}),
			expected: "completed",
			rationale: ".DONE appeared just before timer fired",
		},
		{
			name: ".DONE wins over process_crash (non-zero exit)",
			input: makeInput({
				doneFileFound: true,
				exitSummary: makeSummary({ exitCode: 1 }),
			}),
			expected: "completed",
			rationale: ".DONE means success even if pi crashed during cleanup",
		},
		{
			name: ".DONE wins over session_vanished (null summary)",
			input: makeInput({
				doneFileFound: true,
				exitSummary: null,
			}),
			expected: "completed",
			rationale: ".DONE means success even if summary file is missing",
		},
		{
			name: ".DONE wins over stallDetected + userKilled",
			input: makeInput({
				doneFileFound: true,
				stallDetected: true,
				userKilled: true,
			}),
			expected: "completed",
			rationale: ".DONE always wins",
		},
		{
			name: "api_error beats context_overflow",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [{ attempt: 1, error: "auth_error", delayMs: 0, succeeded: false }],
					compactions: 2,
				}),
				contextPct: 95,
			}),
			expected: "api_error",
			rationale: "API failures are more actionable than context overflow",
		},
		{
			name: "model_access_error beats wall_clock_timeout (rate_limit retry)",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [{ attempt: 1, error: "rate_limit", delayMs: 5000, succeeded: false }],
				}),
				timerKilled: true,
			}),
			expected: "model_access_error",
			rationale: "Model access error (rate_limit) is the root cause; timeout is a side effect",
		},
		{
			name: "api_error beats wall_clock_timeout (generic server error retry)",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [{ attempt: 1, error: "internal_server_error", delayMs: 5000, succeeded: false }],
				}),
				timerKilled: true,
			}),
			expected: "api_error",
			rationale: "Generic API error is the root cause; timeout is a side effect",
		},
		{
			name: "context_overflow beats wall_clock_timeout",
			input: makeInput({
				exitSummary: makeSummary({ compactions: 1 }),
				contextPct: 95,
				timerKilled: true,
			}),
			expected: "context_overflow",
			rationale: "Context overflow is the root cause; timeout may be secondary",
		},
		{
			name: "contextKilled beats session_vanished (no summary)",
			input: makeInput({
				exitSummary: null,
				contextKilled: true,
			}),
			expected: "context_overflow",
			rationale: "Explicit context kill is authoritative even when summary is missing",
		},
		{
			name: "contextKilled beats wall_clock_timeout",
			input: makeInput({
				contextKilled: true,
				timerKilled: true,
			}),
			expected: "context_overflow",
			rationale: "Context kill (3b) has higher precedence than timer (4)",
		},
		{
			name: ".DONE beats contextKilled",
			input: makeInput({
				doneFileFound: true,
				contextKilled: true,
			}),
			expected: "completed",
			rationale: ".DONE always wins (priority 1)",
		},
		{
			name: "api_error beats contextKilled",
			input: makeInput({
				exitSummary: makeSummary({
					retries: [{ attempt: 1, error: "auth", delayMs: 0, succeeded: false }],
				}),
				contextKilled: true,
			}),
			expected: "api_error",
			rationale: "API error (priority 2) beats context kill (priority 3b)",
		},
		{
			name: "unsafe_submodule_unpublished_commit beats process_crash",
			input: makeInput({
				unsafeSubmoduleKind: "unpublished-commit",
				exitSummary: makeSummary({ exitCode: 1, error: "Unsafe submodule state after task success: repo points to local commit abcdef12 not reachable on origin" }),
			}),
			expected: "unsafe_submodule_unpublished_commit",
			rationale: "Explicit runtime safety rejection is more specific than a generic non-zero exit",
		},
		{
			name: "unsafe_submodule_dirty beats wall_clock_timeout",
			input: makeInput({
				unsafeSubmoduleKind: "dirty-worktree",
				timerKilled: true,
			}),
			expected: "unsafe_submodule_dirty",
			rationale: "Runtime safety rejection is the root cause when both signals appear",
		},
		{
			name: "unsafe_submodule_unreachable_ref beats session_vanished",
			input: makeInput({
				unsafeSubmoduleKind: "unreachable-ref",
				exitSummary: null,
			}),
			expected: "unsafe_submodule_unreachable_ref",
			rationale: "Explicit unsafe-submodule classification is authoritative even without a wrapper summary",
		},
		{
			name: "wall_clock_timeout beats process_crash (non-zero exit)",
			input: makeInput({
				exitSummary: makeSummary({ exitCode: 137 }),
				timerKilled: true,
			}),
			expected: "wall_clock_timeout",
			rationale: "Timer kill explains the non-zero exit code",
		},
		{
			name: "process_crash beats session_vanished (summary exists with non-zero)",
			input: makeInput({
				exitSummary: makeSummary({ exitCode: 1 }),
				stallDetected: true,
				userKilled: true,
			}),
			expected: "process_crash",
			rationale: "Non-zero exit code is more specific than stall/user-kill",
		},
		{
			name: "stall_timeout beats user_killed (when both present, summary exists with exitCode 0)",
			input: makeInput({
				stallDetected: true,
				userKilled: true,
			}),
			expected: "stall_timeout",
			rationale: "Stall is checked before user_killed in precedence",
		},
		{
			name: "session_vanished (null summary) beats stallDetected + userKilled",
			input: makeInput({
				exitSummary: null,
				stallDetected: true,
				userKilled: true,
			}),
			// session_vanished is checked at priority 6, before stall (7) and user_killed (8)
			expected: "session_vanished",
			rationale: "Null summary → session_vanished takes priority over stall/user signals",
		},
	];

	for (const tc of precedenceCases) {
		it(`${tc.name} [${tc.rationale}]`, () => {
			expect(classifyExit(tc.input)).toBe(tc.expected);
		});
	}
});

// ── 3. Edge Cases ────────────────────────────────────────────────────

describe("classifyExit — edge cases", () => {
	it("exitCode undefined in summary (partial crash) → skips process_crash, falls to unknown", () => {
		// Simulate a partial summary where exitCode was never set
		const summary = makeSummary();
		delete (summary as any).exitCode;
		const result = classifyExit(makeInput({ exitSummary: summary }));
		// typeof undefined !== "number", so process_crash check is skipped
		expect(result).toBe("unknown");
	});

	it("exitCode === null (killed by signal) → skips process_crash", () => {
		const result = classifyExit(makeInput({
			exitSummary: makeSummary({ exitCode: null, exitSignal: "SIGTERM" }),
		}));
		// exitCode is null (not a number), so process_crash check doesn't fire
		expect(result).toBe("unknown");
	});

	it("exitCode === 0 → not process_crash (clean exit)", () => {
		const result = classifyExit(makeInput({
			exitSummary: makeSummary({ exitCode: 0 }),
		}));
		expect(result).toBe("unknown");
	});

	it("empty retries array → not api_error", () => {
		const result = classifyExit(makeInput({
			exitSummary: makeSummary({ retries: [], exitCode: 0 }),
		}));
		expect(result).toBe("unknown");
	});

	it("compactions > 0 but contextPct exactly 89 → not context_overflow", () => {
		const result = classifyExit(makeInput({
			exitSummary: makeSummary({ compactions: 1, exitCode: 0 }),
			contextPct: 89,
		}));
		// 89 < 90 threshold → not context_overflow, exitCode=0 → not crash → unknown
		expect(result).toBe("unknown");
	});

	it("contextKilled → context_overflow (even without compactions or summary)", () => {
		// Task-runner explicitly killed the session due to context limit,
		// but wrapper crashed before writing exit summary
		const result = classifyExit(makeInput({
			exitSummary: null,
			contextKilled: true,
		}));
		// contextKilled (3b) beats session_vanished (6)
		expect(result).toBe("context_overflow");
	});

	it("contextKilled → context_overflow (summary exists but compactions=0)", () => {
		// Wrapper didn't record compactions but task-runner detected context limit
		const result = classifyExit(makeInput({
			exitSummary: makeSummary({ compactions: 0, exitCode: 0 }),
			contextKilled: true,
			contextPct: 50,
		}));
		expect(result).toBe("context_overflow");
	});

	it("contextKilled=false (default) → no change to existing behavior", () => {
		const result = classifyExit(makeInput({
			exitSummary: makeSummary({ exitCode: 0 }),
		}));
		// contextKilled defaults to false via ?? in classifyExit
		expect(result).toBe("unknown");
	});

	it("contextKilled undefined → treated as false (backward compatible)", () => {
		const input: ExitClassificationInput = {
			exitSummary: makeSummary({ exitCode: 0 }),
			doneFileFound: false,
			timerKilled: false,
			stallDetected: false,
			userKilled: false,
			contextPct: null,
			// contextKilled intentionally not set
		};
		expect(classifyExit(input)).toBe("unknown");
	});
});

// ── 4. Constants Verification ────────────────────────────────────────

describe("EXIT_CLASSIFICATIONS constant", () => {
	it("contains exactly 13 values", () => {
		expect(EXIT_CLASSIFICATIONS).toHaveLength(13);
	});

	it("includes all expected values", () => {
		const expected: ExitClassification[] = [
			"completed", "api_error", "model_access_error", "context_overflow",
			"unsafe_submodule_dirty", "unsafe_submodule_unpublished_commit", "unsafe_submodule_unreachable_ref",
			"wall_clock_timeout", "process_crash", "session_vanished",
			"stall_timeout", "user_killed", "unknown",
		];
		for (const val of expected) {
			expect(EXIT_CLASSIFICATIONS).toContain(val);
		}
	});
});

describe("CONTEXT_OVERFLOW_THRESHOLD_PCT", () => {
	it("is 90", () => {
		expect(CONTEXT_OVERFLOW_THRESHOLD_PCT).toBe(90);
	});
});
