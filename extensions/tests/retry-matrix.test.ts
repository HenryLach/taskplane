/**
 * Retry Policy Matrix Tests — TP-033 Step 3
 *
 * Tests for the merge retry policy matrix introduced in TP-033:
 *
 *   1.x — classifyMergeFailure: maps MergeWaveResult to classification
 *   2.x — computeMergeRetryDecision: pure retry/no-retry/exhaustion logic
 *   3.x — Non-retriable class: merge_conflict_unresolved immediate no-retry
 *   4.x — Multi-attempt retry: git_lock_file retries up to maxAttempts=2
 *   5.x — Cooldown delay: enforced between retry attempts
 *   6.x — Retry counter persistence: counters scoped by repoId:w{N}:l{K}
 *   7.x — Exhaustion: forces paused regardless of on_merge_failure config
 *   8.x — Engine/resume parity for retry loop
 *   9.x — Workspace-scoped counters: repoId in scope key
 *  10.x — applyMergeRetryLoop: shared loop semantics
 *
 * Run: npx vitest run tests/retry-matrix.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	classifyMergeFailure,
	computeMergeRetryDecision,
	buildMergeRetryScopeKey,
	extractFailedRepoId,
	applyMergeRetryLoop,
} from "../taskplane/messages.ts";
import type { MergeRetryCallbacks } from "../taskplane/types.ts";
import {
	MERGE_RETRY_POLICY_MATRIX,
	MERGE_FAILURE_CLASSIFICATIONS,
} from "../taskplane/types.ts";
import type {
	MergeWaveResult,
	MergeLaneResult,
	MergeFailureClassification,
	MergeRetryDecision,
	MergeRetryLoopOutcome,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8");
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeLaneResult(overrides: Partial<MergeLaneResult> = {}): MergeLaneResult {
	return {
		laneNumber: 1,
		laneId: "lane-1",
		sourceBranch: "task/lane-1",
		targetBranch: "orch/test",
		result: null,
		error: null,
		durationMs: 1000,
		...overrides,
	};
}

function makeWaveResult(overrides: Partial<MergeWaveResult> = {}): MergeWaveResult {
	return {
		waveIndex: 0,
		status: "failed",
		laneResults: [makeLaneResult()],
		failedLane: 1,
		failureReason: "test failure",
		totalDurationMs: 1000,
		...overrides,
	};
}

/** Build mock callbacks for applyMergeRetryLoop testing. */
function makeMockCallbacks(options: {
	performMergeResults?: MergeWaveResult[];
} = {}): {
	callbacks: MergeRetryCallbacks;
	logs: string[];
	notifications: Array<{ message: string; level: string }>;
	persistTriggers: string[];
	sleepCalls: number[];
	mergeCallCount: number;
} {
	const mergeResults = options.performMergeResults ?? [];
	let mergeIdx = 0;
	const logs: string[] = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const persistTriggers: string[] = [];
	const sleepCalls: number[] = [];
	const tracker = { mergeCallCount: 0 };

	const callbacks: MergeRetryCallbacks = {
		performMerge: () => {
			tracker.mergeCallCount++;
			return mergeResults[mergeIdx++] ?? makeWaveResult({ status: "succeeded" });
		},
		persist: (trigger) => persistTriggers.push(trigger),
		log: (message) => logs.push(message),
		notify: (message, level) => notifications.push({ message, level }),
		updateMergeResult: () => {},
		sleep: (ms) => sleepCalls.push(ms),
	};

	return { callbacks, logs, notifications, persistTriggers, sleepCalls, mergeCallCount: 0, ...{ get mergeCallCount() { return tracker.mergeCallCount; } } as any };
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — classifyMergeFailure
// ══════════════════════════════════════════════════════════════════════

describe("1.x — classifyMergeFailure", () => {
	it("1.1: verification_new_failure lane error → verification_new_failure", () => {
		const result = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 3 new failure(s)" }),
			],
		});

		expect(classifyMergeFailure(result)).toBe("verification_new_failure");
	});

	it("1.2: CONFLICT_UNRESOLVED status → merge_conflict_unresolved", () => {
		const result = makeWaveResult({
			laneResults: [
				makeLaneResult({
					result: {
						status: "CONFLICT_UNRESOLVED",
						source_branch: "task/lane-1",
						merge_commit: "",
						conflicts: [{ file: "src/a.ts", type: "content" }],
						verification: { passed: false, commands: [], output: "" },
					},
				}),
			],
		});

		expect(classifyMergeFailure(result)).toBe("merge_conflict_unresolved");
	});

	it("1.3: lock file error → git_lock_file", () => {
		const result = makeWaveResult({
			failureReason: "Unable to create '/repo/.git/index.lock': File exists",
		});

		expect(classifyMergeFailure(result)).toBe("git_lock_file");
	});

	it("1.4: cleanup error → cleanup_post_merge_failed", () => {
		const result = makeWaveResult({
			failureReason: "Stale worktree cleanup failed for lane 1",
		});

		expect(classifyMergeFailure(result)).toBe("cleanup_post_merge_failed");
	});

	it("1.5: dirty worktree → git_worktree_dirty", () => {
		const result = makeWaveResult({
			failureReason: "Dirty worktree state in merge workspace",
		});

		expect(classifyMergeFailure(result)).toBe("git_worktree_dirty");
	});

	it("1.6: unknown failure reason → null (unclassifiable)", () => {
		const result = makeWaveResult({
			failureReason: "Some completely unknown error",
			laneResults: [makeLaneResult({ error: "random error" })],
		});

		expect(classifyMergeFailure(result)).toBeNull();
	});

	it("1.7: verification_new_failure takes priority over pattern-matched reason", () => {
		const result = makeWaveResult({
			failureReason: "lock file issue",
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 new failure(s)" }),
			],
		});

		// Lane-level errors are checked first
		expect(classifyMergeFailure(result)).toBe("verification_new_failure");
	});

	it("1.8: empty laneResults with no failureReason → null", () => {
		const result = makeWaveResult({
			laneResults: [],
			failureReason: null,
		});

		expect(classifyMergeFailure(result)).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — computeMergeRetryDecision
// ══════════════════════════════════════════════════════════════════════

describe("2.x — computeMergeRetryDecision", () => {
	it("2.1: null classification → shouldRetry=false", () => {
		const decision = computeMergeRetryDecision(null, 0);

		expect(decision.shouldRetry).toBe(false);
		expect(decision.reason).toContain("Unclassifiable");
	});

	it("2.2: verification_new_failure at count 0 → shouldRetry=true, cooldown=0", () => {
		const decision = computeMergeRetryDecision("verification_new_failure", 0);

		expect(decision.shouldRetry).toBe(true);
		expect(decision.cooldownMs).toBe(0);
		expect(decision.currentAttempt).toBe(1);
		expect(decision.maxAttempts).toBe(1);
	});

	it("2.3: verification_new_failure at count 1 → shouldRetry=false (exhausted)", () => {
		const decision = computeMergeRetryDecision("verification_new_failure", 1);

		expect(decision.shouldRetry).toBe(false);
		expect(decision.reason).toContain("exhausted");
		expect(decision.exhaustionAction).toBe("pause");
	});

	it("2.4: git_lock_file at count 0 → shouldRetry=true, cooldown=3000", () => {
		const decision = computeMergeRetryDecision("git_lock_file", 0);

		expect(decision.shouldRetry).toBe(true);
		expect(decision.cooldownMs).toBe(3000);
		expect(decision.currentAttempt).toBe(1);
		expect(decision.maxAttempts).toBe(2);
	});

	it("2.5: git_lock_file at count 1 → shouldRetry=true (second attempt)", () => {
		const decision = computeMergeRetryDecision("git_lock_file", 1);

		expect(decision.shouldRetry).toBe(true);
		expect(decision.cooldownMs).toBe(3000);
		expect(decision.currentAttempt).toBe(2);
	});

	it("2.6: git_lock_file at count 2 → shouldRetry=false (exhausted)", () => {
		const decision = computeMergeRetryDecision("git_lock_file", 2);

		expect(decision.shouldRetry).toBe(false);
		expect(decision.reason).toContain("exhausted");
	});

	it("2.7: cleanup_post_merge_failed → cooldown=2000, exhaustionAction=pause_wave_gate", () => {
		const decision = computeMergeRetryDecision("cleanup_post_merge_failed", 0);

		expect(decision.shouldRetry).toBe(true);
		expect(decision.cooldownMs).toBe(2000);
		expect(decision.exhaustionAction).toBe("pause_wave_gate");
	});

	it("2.8: git_worktree_dirty → cooldown=2000, maxAttempts=1", () => {
		const decision = computeMergeRetryDecision("git_worktree_dirty", 0);

		expect(decision.shouldRetry).toBe(true);
		expect(decision.cooldownMs).toBe(2000);
		expect(decision.maxAttempts).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Non-retriable class: merge_conflict_unresolved
// ══════════════════════════════════════════════════════════════════════

describe("3.x — Non-retriable class: merge_conflict_unresolved", () => {
	it("3.1: merge_conflict_unresolved is not retriable", () => {
		const policy = MERGE_RETRY_POLICY_MATRIX["merge_conflict_unresolved"];

		expect(policy.retriable).toBe(false);
		expect(policy.maxAttempts).toBe(0);
	});

	it("3.2: computeMergeRetryDecision for merge_conflict_unresolved → no retry", () => {
		const decision = computeMergeRetryDecision("merge_conflict_unresolved", 0);

		expect(decision.shouldRetry).toBe(false);
		expect(decision.exhaustionAction).toBe("pause_escalation");
		expect(decision.reason).toContain("not retriable");
	});

	it("3.3: applyMergeRetryLoop returns no_retry for merge_conflict_unresolved", async () => {
		const result = makeWaveResult({
			laneResults: [
				makeLaneResult({
					result: {
						status: "CONFLICT_UNRESOLVED",
						source_branch: "task/lane-1",
						merge_commit: "",
						conflicts: [{ file: "src/a.ts", type: "content" }],
						verification: { passed: false, commands: [], output: "" },
					},
				}),
			],
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks();

		const outcome = await applyMergeRetryLoop(result, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("no_retry");
		if (outcome.kind === "no_retry") {
			expect(outcome.classification).toBe("merge_conflict_unresolved");
		}
	});

	it("3.4: non-retriable class does NOT increment retry counter", async () => {
		const result = makeWaveResult({
			laneResults: [
				makeLaneResult({
					result: {
						status: "CONFLICT_UNRESOLVED",
						source_branch: "task/lane-1",
						merge_commit: "",
						conflicts: [{ file: "src/a.ts", type: "content" }],
						verification: { passed: false, commands: [], output: "" },
					},
				}),
			],
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks();

		await applyMergeRetryLoop(result, 0, counters, mock.callbacks);

		// Counter should NOT have been incremented
		expect(Object.keys(counters)).toHaveLength(0);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Multi-attempt retry: git_lock_file
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Multi-attempt retry: git_lock_file (maxAttempts=2)", () => {
	it("4.1: git_lock_file allows 2 retry attempts", () => {
		const policy = MERGE_RETRY_POLICY_MATRIX["git_lock_file"];

		expect(policy.retriable).toBe(true);
		expect(policy.maxAttempts).toBe(2);
		expect(policy.cooldownMs).toBe(3000);
	});

	it("4.2: first retry succeeds → retry_succeeded outcome", async () => {
		const failResult = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		const outcome = await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("retry_succeeded");
		expect(counters["default:w0:l1"]).toBe(1);
	});

	it("4.3: first retry fails with same error, second retry succeeds", async () => {
		const failResult1 = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const failResult2 = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [failResult2, successResult] });

		const outcome = await applyMergeRetryLoop(failResult1, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("retry_succeeded");
		expect(counters["default:w0:l1"]).toBe(2); // Two attempts used
	});

	it("4.4: both retries fail → exhausted outcome", async () => {
		const failResult1 = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const failResult2 = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const failResult3 = makeWaveResult({
			failureReason: "Unable to create lock file",
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [failResult2, failResult3] });

		const outcome = await applyMergeRetryLoop(failResult1, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("exhausted");
		if (outcome.kind === "exhausted") {
			expect(outcome.classification).toBe("git_lock_file");
			expect(outcome.lastDecision.currentAttempt).toBe(2);
			expect(outcome.lastDecision.maxAttempts).toBe(2);
		}
	});

	it("4.5: multi-attempt retry uses correct scope key", async () => {
		const failResult = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		await applyMergeRetryLoop(failResult, 2, counters, mock.callbacks);

		// Scope key should be default:w2:l1 (waveIdx=2, laneNumber=1)
		expect(counters["default:w2:l1"]).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Cooldown delay enforced between retry attempts
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Cooldown delay enforcement", () => {
	it("5.1: verification_new_failure has cooldown=0 (immediate retry)", () => {
		const policy = MERGE_RETRY_POLICY_MATRIX["verification_new_failure"];
		expect(policy.cooldownMs).toBe(0);
	});

	it("5.2: git_lock_file has cooldown=3000ms", () => {
		const policy = MERGE_RETRY_POLICY_MATRIX["git_lock_file"];
		expect(policy.cooldownMs).toBe(3000);
	});

	it("5.3: cleanup_post_merge_failed has cooldown=2000ms", () => {
		const policy = MERGE_RETRY_POLICY_MATRIX["cleanup_post_merge_failed"];
		expect(policy.cooldownMs).toBe(2000);
	});

	it("5.4: git_worktree_dirty has cooldown=2000ms", () => {
		const policy = MERGE_RETRY_POLICY_MATRIX["git_worktree_dirty"];
		expect(policy.cooldownMs).toBe(2000);
	});

	it("5.5: applyMergeRetryLoop calls sleep with correct cooldown for git_lock_file", async () => {
		const failResult = makeWaveResult({
			failureReason: "Unable to create lock file",
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		// Should have called sleep(3000) once
		expect(mock.sleepCalls).toEqual([3000]);
	});

	it("5.6: applyMergeRetryLoop does NOT call sleep for verification_new_failure (cooldown=0)", async () => {
		const failResult = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 new failure(s)" }),
			],
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		// No sleep calls — cooldown is 0
		expect(mock.sleepCalls).toEqual([]);
	});

	it("5.7: multi-attempt retry calls sleep for each attempt", async () => {
		const failResult1 = makeWaveResult({ failureReason: "lock file" });
		const failResult2 = makeWaveResult({ failureReason: "lock file" });
		const failResult3 = makeWaveResult({ failureReason: "lock file" });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [failResult2, failResult3] });

		await applyMergeRetryLoop(failResult1, 0, counters, mock.callbacks);

		// Two retry attempts, each with 3000ms cooldown
		expect(mock.sleepCalls).toEqual([3000, 3000]);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Retry counter persistence
// ══════════════════════════════════════════════════════════════════════

describe("6.x — Retry counter persistence", () => {
	it("6.1: buildMergeRetryScopeKey with repo mode (undefined repoId) → 'default:w{N}:l{K}'", () => {
		expect(buildMergeRetryScopeKey(undefined, 0, 1)).toBe("default:w0:l1");
		expect(buildMergeRetryScopeKey(null, 2, 3)).toBe("default:w2:l3");
	});

	it("6.2: buildMergeRetryScopeKey with workspace mode → '{repoId}:w{N}:l{K}'", () => {
		expect(buildMergeRetryScopeKey("api", 0, 1)).toBe("api:w0:l1");
		expect(buildMergeRetryScopeKey("frontend", 1, 2)).toBe("frontend:w1:l2");
	});

	it("6.3: retry loop increments counter in retryCountByScope", async () => {
		const failResult = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 new failure" }),
			],
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		expect(counters["default:w0:l1"]).toBe(1);
	});

	it("6.4: retry loop persists state after increment (merge-retry-increment trigger)", async () => {
		const failResult = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 new failure" }),
			],
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		expect(mock.persistTriggers).toContain("merge-retry-increment");
		expect(mock.persistTriggers).toContain("merge-retry-start");
		expect(mock.persistTriggers).toContain("merge-retry-complete");
	});

	it("6.5: counters survive across separate retry loop invocations (pre-existing count)", () => {
		const counters: Record<string, number> = { "default:w0:l1": 1 };

		// verification_new_failure at count=1 → exhausted (max=1)
		const decision = computeMergeRetryDecision("verification_new_failure", counters["default:w0:l1"]);

		expect(decision.shouldRetry).toBe(false);
		expect(decision.reason).toContain("exhausted");
	});

	it("6.6: engine.ts initializes resilience state before retry loop", () => {
		const engineSource = readSource("engine.ts");

		// Must initialize resilience before accessing retryCountByScope
		expect(engineSource).toContain("batchState.resilience");
		expect(engineSource).toContain("defaultResilienceState()");
		expect(engineSource).toContain("batchState.resilience.retryCountByScope");
	});

	it("6.7: resume.ts initializes resilience state before retry loop (parity)", () => {
		const resumeSource = readSource("resume.ts");

		expect(resumeSource).toContain("batchState.resilience");
		expect(resumeSource).toContain("defaultResilienceState()");
		expect(resumeSource).toContain("batchState.resilience.retryCountByScope");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Exhaustion: forces paused regardless of config
// ══════════════════════════════════════════════════════════════════════

describe("7.x — Exhaustion forces paused", () => {
	it("7.1: exhaustion outcome from applyMergeRetryLoop includes classification diagnostics", async () => {
		const failResult1 = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 2 new failure(s)" }),
			],
		});
		const failResult2 = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 2 new failure(s)" }),
			],
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [failResult2] });

		const outcome = await applyMergeRetryLoop(failResult1, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("exhausted");
		if (outcome.kind === "exhausted") {
			expect(outcome.classification).toBe("verification_new_failure");
			expect(outcome.scopeKey).toBe("default:w0:l1");
			expect(outcome.lastDecision.currentAttempt).toBe(1);
			expect(outcome.lastDecision.maxAttempts).toBe(1);
			expect(outcome.errorMessage).toContain("exhausted");
		}
	});

	it("7.2: engine.ts forces paused on exhausted outcome (not config policy)", () => {
		const engineSource = readSource("engine.ts");

		// The exhausted path must set phase to paused directly
		const exhaustedIdx = engineSource.indexOf('retryOutcome.kind === "exhausted"');
		expect(exhaustedIdx).toBeGreaterThan(-1);

		// TP-039: Window increased from 1200 to 2400 to accommodate Tier 0 event
		// emission block inserted before phase assignment in the exhausted branch.
		const afterExhausted = engineSource.substring(exhaustedIdx, exhaustedIdx + 2400);
		expect(afterExhausted).toContain('batchState.phase = "paused"');
		expect(afterExhausted).toContain("merge-retry-exhausted");
		expect(afterExhausted).toContain("preserveWorktreesForResume = true");
		expect(afterExhausted).toContain("break");
	});

	it("7.3: resume.ts forces paused on exhausted outcome (parity with engine.ts)", () => {
		const resumeSource = readSource("resume.ts");

		const exhaustedIdx = resumeSource.indexOf('retryOutcome.kind === "exhausted"');
		expect(exhaustedIdx).toBeGreaterThan(-1);

		const afterExhausted = resumeSource.substring(exhaustedIdx, exhaustedIdx + 1200);
		expect(afterExhausted).toContain('batchState.phase = "paused"');
		expect(afterExhausted).toContain("merge-retry-exhausted");
		expect(afterExhausted).toContain("preserveWorktreesForResume = true");
		expect(afterExhausted).toContain("break");
	});

	it("7.4: engine.ts includes diagnostic info in exhaustion error (classification + attempts + scope)", () => {
		const engineSource = readSource("engine.ts");

		const exhaustedIdx = engineSource.indexOf('retryOutcome.kind === "exhausted"');
		const afterExhausted = engineSource.substring(exhaustedIdx, exhaustedIdx + 800);

		// Error message should include classification, attempt count, and scope key
		expect(afterExhausted).toContain("retryOutcome.classification");
		expect(afterExhausted).toContain("retryOutcome.lastDecision.currentAttempt");
		expect(afterExhausted).toContain("retryOutcome.lastDecision.maxAttempts");
		expect(afterExhausted).toContain("retryOutcome.scopeKey");
	});

	it("7.5: exhaustion does NOT call computeMergeFailurePolicy (bypasses config)", () => {
		const engineSource = readSource("engine.ts");

		// The exhausted branch should NOT reference computeMergeFailurePolicy
		const exhaustedIdx = engineSource.indexOf('retryOutcome.kind === "exhausted"');
		const nextElse = engineSource.indexOf("} else", exhaustedIdx);
		const exhaustedBlock = engineSource.substring(exhaustedIdx, nextElse);
		expect(exhaustedBlock).not.toContain("computeMergeFailurePolicy");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — Engine/resume parity for retry loop
// ══════════════════════════════════════════════════════════════════════

describe("8.x — Engine/resume parity for retry loop", () => {
	it("8.1: both files use applyMergeRetryLoop (shared implementation)", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		expect(engineSource).toContain("applyMergeRetryLoop(");
		expect(resumeSource).toContain("applyMergeRetryLoop(");
	});

	it("8.2: both files import applyMergeRetryLoop from messages.ts", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		expect(engineSource).toContain("applyMergeRetryLoop");
		expect(resumeSource).toContain("applyMergeRetryLoop");
		// Verify import source
		expect(engineSource).toContain('from "./messages.ts"');
		expect(resumeSource).toContain('from "./messages.ts"');
	});

	it("8.3: both files handle all four outcome kinds (retry_succeeded, safe_stop, exhausted, no_retry)", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		for (const kind of ["retry_succeeded", "safe_stop", "exhausted", "no_retry"]) {
			expect(engineSource).toContain(`"${kind}"`);
			expect(resumeSource).toContain(`"${kind}"`);
		}
	});

	it("8.4: both files persist with merge-retry-succeeded trigger on success", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		expect(engineSource).toContain('"merge-retry-succeeded"');
		expect(resumeSource).toContain('"merge-retry-succeeded"');
	});

	it("8.5: both files set phase to executing on retry success", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		// After retry_succeeded:
		const engineSuccIdx = engineSource.indexOf('"retry_succeeded"');
		const engineSuccBlock = engineSource.substring(engineSuccIdx, engineSuccIdx + 300);
		expect(engineSuccBlock).toContain('batchState.phase = "executing"');

		const resumeSuccIdx = resumeSource.indexOf('"retry_succeeded"');
		const resumeSuccBlock = resumeSource.substring(resumeSuccIdx, resumeSuccIdx + 300);
		expect(resumeSuccBlock).toContain('batchState.phase = "executing"');
	});

	it("8.6: no_retry outcome falls through to computeMergeFailurePolicy in both files", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		// The no_retry path should call computeMergeFailurePolicy
		// (it's the only path that respects config policy)
		const engineNoRetryIdx = engineSource.indexOf('"no_retry"');
		const engineAfterNoRetry = engineSource.substring(engineNoRetryIdx, engineNoRetryIdx + 500);
		expect(engineAfterNoRetry).toContain("computeMergeFailurePolicy");

		const resumeNoRetryIdx = resumeSource.indexOf('"no_retry"');
		const resumeAfterNoRetry = resumeSource.substring(resumeNoRetryIdx, resumeNoRetryIdx + 500);
		expect(resumeAfterNoRetry).toContain("computeMergeFailurePolicy");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9.x — Workspace-scoped counters
// ══════════════════════════════════════════════════════════════════════

describe("9.x — Workspace-scoped counters (repoId in scope key)", () => {
	it("9.1: extractFailedRepoId extracts repoId from failed lane result", () => {
		const result = makeWaveResult({
			failedLane: 1,
			laneResults: [
				makeLaneResult({
					laneNumber: 1,
					error: "verification_new_failure: 1 failure",
					repoId: "api",
					result: null,
				}),
			],
		});

		expect(extractFailedRepoId(result)).toBe("api");
	});

	it("9.2: extractFailedRepoId falls back to repoResults for setup failures (failedLane=null)", () => {
		const result = makeWaveResult({
			failedLane: null,
			failureReason: "worktree setup failed",
			laneResults: [],
			repoResults: [
				{
					repoId: "backend",
					status: "failed",
					laneResults: [],
					failedLane: null,
					failureReason: "setup error",
				},
			],
		});

		expect(extractFailedRepoId(result)).toBe("backend");
	});

	it("9.3: extractFailedRepoId returns undefined when no repo info available", () => {
		const result = makeWaveResult({
			failedLane: null,
			laneResults: [],
			repoResults: [],
		});

		expect(extractFailedRepoId(result)).toBeUndefined();
	});

	it("9.4: workspace mode uses repoId in scope key", () => {
		const result = makeWaveResult({
			failedLane: 1,
			failureReason: "lock file error",
			laneResults: [
				makeLaneResult({
					laneNumber: 1,
					error: null,
					repoId: "api",
				}),
			],
		});

		// extractFailedRepoId with a BUILD_FAILURE result
		const resultWithStatus = makeWaveResult({
			failedLane: 1,
			failureReason: "lock file error",
			laneResults: [
				makeLaneResult({
					laneNumber: 1,
					repoId: "api",
					result: {
						status: "BUILD_FAILURE",
						source_branch: "task/lane-1",
						merge_commit: "",
						conflicts: [],
						verification: { passed: false, commands: [], output: "" },
					},
				}),
			],
		});

		const repoId = extractFailedRepoId(resultWithStatus);
		expect(repoId).toBe("api");

		const scopeKey = buildMergeRetryScopeKey(repoId, 0, 1);
		expect(scopeKey).toBe("api:w0:l1");
	});

	it("9.5: different repos get different scope keys (isolation)", () => {
		const key1 = buildMergeRetryScopeKey("api", 0, 1);
		const key2 = buildMergeRetryScopeKey("frontend", 0, 1);
		const key3 = buildMergeRetryScopeKey(undefined, 0, 1);

		expect(key1).toBe("api:w0:l1");
		expect(key2).toBe("frontend:w0:l1");
		expect(key3).toBe("default:w0:l1");

		// All three keys are different
		expect(new Set([key1, key2, key3]).size).toBe(3);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 10.x — applyMergeRetryLoop: shared loop semantics
// ══════════════════════════════════════════════════════════════════════

describe("10.x — applyMergeRetryLoop shared loop semantics", () => {
	it("10.1: safe-stop during retry returns safe_stop outcome", async () => {
		const failResult = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 failure" }),
			],
		});
		const rollbackFailResult = makeWaveResult({
			status: "failed",
			rollbackFailed: true,
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [rollbackFailResult] });

		const outcome = await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("safe_stop");
		if (outcome.kind === "safe_stop") {
			expect(outcome.errorMessage).toContain("Safe-stop");
			expect(outcome.notifyMessage).toContain("🛑");
		}
	});

	it("10.2: safe-stop with persistence errors includes warning in message", async () => {
		const failResult = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 failure" }),
			],
		});
		const rollbackFailResult = makeWaveResult({
			status: "failed",
			rollbackFailed: true,
			persistenceErrors: ["lane 1: ENOSPC"],
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [rollbackFailResult] });

		const outcome = await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		expect(outcome.kind).toBe("safe_stop");
		if (outcome.kind === "safe_stop") {
			expect(outcome.errorMessage).toContain("WARNING");
			expect(outcome.errorMessage).toContain("transaction record");
		}
	});

	it("10.3: classification changes between retries are handled correctly", async () => {
		// First failure: lock file. Retry returns: cleanup failure.
		const lockFailResult = makeWaveResult({
			failureReason: "lock file error",
		});
		const cleanupFailResult = makeWaveResult({
			failureReason: "cleanup error occurred",
		});

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [cleanupFailResult] });

		const outcome = await applyMergeRetryLoop(lockFailResult, 0, counters, mock.callbacks);

		// After the first retry fails with a different classification,
		// the loop re-classifies and checks the new class's policy.
		// cleanup_post_merge_failed has maxAttempts=1, so at count=1 it's exhausted
		expect(outcome.kind).toBe("exhausted");
		if (outcome.kind === "exhausted") {
			expect(outcome.classification).toBe("cleanup_post_merge_failed");
		}
	});

	it("10.4: retry loop emits notifications for each attempt", async () => {
		const failResult = makeWaveResult({
			failureReason: "lock file error",
		});
		const failResult2 = makeWaveResult({
			failureReason: "lock file error",
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [failResult2, successResult] });

		await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		// Should have received retry notifications (🔄 for each attempt, ✅ for success)
		const retryNotifs = mock.notifications.filter(n => n.message.includes("🔄"));
		expect(retryNotifs.length).toBeGreaterThanOrEqual(2);

		const successNotifs = mock.notifications.filter(n => n.message.includes("✅"));
		expect(successNotifs.length).toBe(1);
	});

	it("10.5: retry loop persists state at correct points (increment, start, complete)", async () => {
		const failResult = makeWaveResult({
			laneResults: [
				makeLaneResult({ error: "verification_new_failure: 1 failure" }),
			],
		});
		const successResult = makeWaveResult({ status: "succeeded", failedLane: null, failureReason: null });

		const counters: Record<string, number> = {};
		const mock = makeMockCallbacks({ performMergeResults: [successResult] });

		await applyMergeRetryLoop(failResult, 0, counters, mock.callbacks);

		// Persistence should happen in order: increment → start → complete
		const idx_inc = mock.persistTriggers.indexOf("merge-retry-increment");
		const idx_start = mock.persistTriggers.indexOf("merge-retry-start");
		const idx_complete = mock.persistTriggers.indexOf("merge-retry-complete");

		expect(idx_inc).toBeGreaterThanOrEqual(0);
		expect(idx_start).toBeGreaterThan(idx_inc);
		expect(idx_complete).toBeGreaterThan(idx_start);
	});

	it("10.6: all five merge failure classifications are covered in matrix", () => {
		expect(MERGE_FAILURE_CLASSIFICATIONS).toEqual([
			"verification_new_failure",
			"merge_conflict_unresolved",
			"cleanup_post_merge_failed",
			"git_worktree_dirty",
			"git_lock_file",
		]);

		for (const cls of MERGE_FAILURE_CLASSIFICATIONS) {
			expect(MERGE_RETRY_POLICY_MATRIX[cls]).toBeDefined();
		}
	});

	it("10.7: policy matrix values match roadmap specification", () => {
		const m = MERGE_RETRY_POLICY_MATRIX;

		// verification_new_failure: 1 retry, 0ms cooldown
		expect(m.verification_new_failure.retriable).toBe(true);
		expect(m.verification_new_failure.maxAttempts).toBe(1);
		expect(m.verification_new_failure.cooldownMs).toBe(0);
		expect(m.verification_new_failure.exhaustionAction).toBe("pause");

		// merge_conflict_unresolved: no retry
		expect(m.merge_conflict_unresolved.retriable).toBe(false);
		expect(m.merge_conflict_unresolved.maxAttempts).toBe(0);
		expect(m.merge_conflict_unresolved.exhaustionAction).toBe("pause_escalation");

		// cleanup_post_merge_failed: 1 retry, 2000ms, wave gate
		expect(m.cleanup_post_merge_failed.retriable).toBe(true);
		expect(m.cleanup_post_merge_failed.maxAttempts).toBe(1);
		expect(m.cleanup_post_merge_failed.cooldownMs).toBe(2000);
		expect(m.cleanup_post_merge_failed.exhaustionAction).toBe("pause_wave_gate");

		// git_worktree_dirty: 1 retry, 2000ms
		expect(m.git_worktree_dirty.retriable).toBe(true);
		expect(m.git_worktree_dirty.maxAttempts).toBe(1);
		expect(m.git_worktree_dirty.cooldownMs).toBe(2000);
		expect(m.git_worktree_dirty.exhaustionAction).toBe("pause");

		// git_lock_file: 2 retries, 3000ms
		expect(m.git_lock_file.retriable).toBe(true);
		expect(m.git_lock_file.maxAttempts).toBe(2);
		expect(m.git_lock_file.cooldownMs).toBe(3000);
		expect(m.git_lock_file.exhaustionAction).toBe("pause");
	});
});
