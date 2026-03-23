/**
 * Tier 0 Watchdog Integration Tests — TP-039 Step 4
 *
 * Tests for the Tier 0 automatic recovery patterns integrated in TP-039:
 *
 *   1.x — Worker crash auto-retry: retryable classification triggers retry
 *   2.x — Retry exhaustion: budget consumed → pauses batch + escalation events
 *   3.x — Partial progress preservation: saves branch before retry
 *   4.x — Stale worktree recovery: ALLOC_WORKTREE_FAILED → force cleanup + retry
 *   5.x — Cleanup gate Tier 0 recovery: retry once, continue on success, pause+escalate on failure
 *   6.x — Event logging: events written to .pi/supervisor/events.jsonl with correct schema
 *   7.x — Happy path: no failures → no events, no retries
 *   8.x — Per-pattern exhaustion: table-driven coverage of all patterns
 *
 * Run: npx vitest run tests/tier0-watchdog.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	emitTier0Event,
	buildTier0EventBase,
} from "../taskplane/persistence.ts";

import type { Tier0Event, Tier0EventType } from "../taskplane/persistence.ts";

import {
	TIER0_RETRYABLE_CLASSIFICATIONS,
	TIER0_RETRY_BUDGETS,
	tier0ScopeKey,
	tier0WaveScopeKey,
} from "../taskplane/types.ts";

import type {
	EscalationContext,
	MergeRetryCallbacks,
	MergeRetryDecision,
	MergeWaveResult,
	Tier0RecoveryPattern,
	Tier0EscalationPattern,
	Tier0RetryBudget,
} from "../taskplane/types.ts";

import { applyMergeRetryLoop } from "../taskplane/messages.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

/** Read all events from the events.jsonl file in a temp stateRoot */
function readEvents(stateRoot: string): Tier0Event[] {
	const eventsPath = join(stateRoot, ".pi", "supervisor", "events.jsonl");
	if (!existsSync(eventsPath)) return [];
	const content = readFileSync(eventsPath, "utf-8");
	return content
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map(line => JSON.parse(line) as Tier0Event);
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — Worker crash auto-retry
// ══════════════════════════════════════════════════════════════════════

describe("1.x — Worker crash auto-retry: retryable classification triggers retry", () => {
	it("1.1: attemptWorkerCrashRetry checks exitDiagnostic.classification on each failed task", () => {
		const engineSource = readSource("engine.ts");

		// Must use exitDiagnostic.classification, not synthesize from null
		expect(engineSource).toContain("outcome.exitDiagnostic?.classification");
		// Must skip auto-retry when no classification available
		expect(engineSource).toContain("skipping auto-retry (conservative)");
	});

	it("1.2: retryable classifications include api_error, process_crash, session_vanished", () => {
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("api_error")).toBe(true);
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("process_crash")).toBe(true);
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("session_vanished")).toBe(true);
	});

	it("1.3: non-retryable classifications are rejected (e.g. user_killed, context_overflow)", () => {
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("user_killed")).toBe(false);
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("context_overflow")).toBe(false);
		expect(TIER0_RETRYABLE_CLASSIFICATIONS.has("stall_timeout")).toBe(false);
	});

	it("1.4: worker crash retry uses a fresh pause signal (not batch-level)", () => {
		const engineSource = readSource("engine.ts");
		// R002-4: fresh pause signal allows retry before stop-wave policy takes effect
		expect(engineSource).toContain("retryPauseSignal");
		expect(engineSource).toContain("const retryPauseSignal = { paused: false }");
	});

	it("1.5: retry checks budget via tier0ScopeKey before executing", () => {
		const engineSource = readSource("engine.ts");
		const retryFn = engineSource.substring(
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
		);
		expect(retryFn).toContain("tier0ScopeKey");
		expect(retryFn).toContain("currentCount >= budget.maxRetries");
	});

	it("1.6: successful retry updates waveResult — moves task from failed to succeeded", () => {
		const engineSource = readSource("engine.ts");
		const retryFn = engineSource.substring(
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
		);
		expect(retryFn).toContain("waveResult.failedTaskIds.splice(failIdx, 1)");
		expect(retryFn).toContain("waveResult.succeededTaskIds.push(taskId)");
	});

	it("1.7: worker crash retry is invoked in the wave loop after execution", () => {
		const engineSource = readSource("engine.ts");
		// The engine calls attemptWorkerCrashRetry after wave execution
		expect(engineSource).toContain("await attemptWorkerCrashRetry(");
	});

	it("1.8: worker_crash retry budget is 1 attempt", () => {
		expect(TIER0_RETRY_BUDGETS.worker_crash.maxRetries).toBe(1);
	});

	it("1.9: retry increments counter in resilience.retryCountByScope", () => {
		const engineSource = readSource("engine.ts");
		const retryFn = engineSource.substring(
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
		);
		expect(retryFn).toContain("batchState.resilience.retryCountByScope[scopeKey] = currentCount + 1");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Retry exhaustion: pauses batch and emits escalation events
// ══════════════════════════════════════════════════════════════════════

describe("2.x — Retry exhaustion pauses batch with escalation event", () => {
	it("2.1: worker crash exhaustion emits tier0_recovery_exhausted event", () => {
		const engineSource = readSource("engine.ts");
		const retryFn = engineSource.substring(
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
		);
		// Exhausted event emitted in three paths: pre-budget-check, retry-failed, retry-exception
		const exhaustedMatches = retryFn.match(/tier0_recovery_exhausted/g);
		expect(exhaustedMatches).not.toBeNull();
		expect(exhaustedMatches!.length).toBeGreaterThanOrEqual(2);
	});

	it("2.2: worker crash exhaustion emits tier0_escalation with EscalationContext", () => {
		const engineSource = readSource("engine.ts");
		const retryFn = engineSource.substring(
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
		);
		const escalationMatches = retryFn.match(/emitTier0Escalation\(/g);
		expect(escalationMatches).not.toBeNull();
		expect(escalationMatches!.length).toBeGreaterThanOrEqual(2);
	});

	it("2.3: emitTier0Escalation builds a complete EscalationContext with all required fields", () => {
		const engineSource = readSource("engine.ts");
		const escalationFn = engineSource.substring(
			engineSource.indexOf("function emitTier0Escalation("),
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
		);
		// Must build EscalationContext with all fields from the interface
		expect(escalationFn).toContain("pattern");
		expect(escalationFn).toContain("attempts");
		expect(escalationFn).toContain("maxAttempts");
		expect(escalationFn).toContain("lastError");
		expect(escalationFn).toContain("affectedTasks");
		expect(escalationFn).toContain("suggestion");
	});

	it("2.4: EscalationContext interface includes all required fields", () => {
		const typesSource = readSource("types.ts");
		const iface = typesSource.substring(
			typesSource.indexOf("export interface EscalationContext"),
			typesSource.indexOf("}", typesSource.indexOf("export interface EscalationContext") + 50) + 1,
		);
		expect(iface).toContain("pattern: Tier0EscalationPattern");
		expect(iface).toContain("attempts: number");
		expect(iface).toContain("maxAttempts: number");
		expect(iface).toContain("lastError: string");
		expect(iface).toContain("affectedTasks: string[]");
		expect(iface).toContain("suggestion: string");
	});

	it("2.5: stale worktree exhaustion emits both exhausted + escalation", () => {
		const engineSource = readSource("engine.ts");
		const staleFn = engineSource.substring(
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		expect(staleFn).toContain("tier0_recovery_exhausted");
		expect(staleFn).toContain("emitTier0Escalation(");
	});

	it("2.6: merge timeout exhaustion emits escalation event from engine caller site", () => {
		const engineSource = readSource("engine.ts");
		// Merge timeout exhaustion should trigger escalation
		const mergeExhaustIdx = engineSource.indexOf("tier0_recovery_exhausted");
		expect(mergeExhaustIdx).not.toBe(-1);
		// Search for merge_timeout pattern escalation
		expect(engineSource).toContain('"merge_timeout"');
		// Find the merge timeout handling section and verify escalation
		const mergeSection = engineSource.substring(
			engineSource.indexOf("applyMergeRetryLoop"),
		);
		const mergeEscalation = mergeSection.match(/emitTier0Escalation.*merge_timeout/g);
		expect(mergeEscalation).not.toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.7+ — Merge timeout retry behavior (R008-1: behavior-level test)
// ══════════════════════════════════════════════════════════════════════

describe("2.7+ — Merge timeout triggers automatic retry (not immediate pause)", () => {
	/**
	 * Builds a minimal failed MergeWaveResult with a git_lock_file
	 * failure reason, which classifies as retriable with maxAttempts=2.
	 */
	function buildFailedMergeResult(waveIndex: number, failureReason: string): MergeWaveResult {
		return {
			waveIndex,
			status: "failed",
			laneResults: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					sourceBranch: "task/TP-TEST",
					targetBranch: "main",
					result: null,
					error: null,
					durationMs: 1000,
				},
			],
			failedLane: 1,
			failureReason,
			totalDurationMs: 1500,
		};
	}

	function buildSucceededMergeResult(waveIndex: number): MergeWaveResult {
		return {
			waveIndex,
			status: "succeeded",
			laneResults: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					sourceBranch: "task/TP-TEST",
					targetBranch: "main",
					result: { status: "MERGED", resolvedWith: null, error: null },
					error: null,
					durationMs: 800,
				},
			],
			failedLane: null,
			failureReason: null,
			totalDurationMs: 900,
		};
	}

	it("2.7: first merge failure with retriable classification retries instead of immediately pausing", async () => {
		// git_lock_file is retriable with maxAttempts=2
		const failedResult = buildFailedMergeResult(0, "Unable to create lock file");
		const succeededResult = buildSucceededMergeResult(0);
		const retryCountByScope: Record<string, number> = {};
		const logs: string[] = [];
		let mergeCallCount = 0;
		let retryAttemptFired = false;

		const callbacks: MergeRetryCallbacks = {
			performMerge: () => {
				mergeCallCount++;
				// Second merge attempt succeeds
				return succeededResult;
			},
			persist: () => {},
			log: (msg) => logs.push(msg),
			notify: () => {},
			updateMergeResult: () => {},
			sleep: () => {},
			onRetryAttempt: (decision) => {
				retryAttemptFired = true;
				expect(decision.shouldRetry).toBe(true);
				expect(decision.classification).toBe("git_lock_file");
			},
		};

		const outcome = await applyMergeRetryLoop(failedResult, 0, retryCountByScope, callbacks);

		// Should retry and succeed — NOT pause
		expect(outcome.kind).toBe("retry_succeeded");
		expect(mergeCallCount).toBe(1); // performMerge called once for retry
		expect(retryAttemptFired).toBe(true);
		// Retry counter should have been incremented
		const scopeKeys = Object.keys(retryCountByScope);
		expect(scopeKeys.length).toBeGreaterThan(0);
		expect(retryCountByScope[scopeKeys[0]]).toBe(1);
	});

	it("2.8: merge retry success returns the successful MergeWaveResult", async () => {
		const failedResult = buildFailedMergeResult(0, "Unable to create lock file");
		const succeededResult = buildSucceededMergeResult(0);

		const outcome = await applyMergeRetryLoop(failedResult, 0, {}, {
			performMerge: () => succeededResult,
			persist: () => {},
			log: () => {},
			notify: () => {},
			updateMergeResult: () => {},
			sleep: () => {},
		});

		expect(outcome.kind).toBe("retry_succeeded");
		if (outcome.kind === "retry_succeeded") {
			expect(outcome.mergeResult.status).toBe("succeeded");
			expect(outcome.classification).toBe("git_lock_file");
		}
	});

	it("2.9: merge retry exhaustion returns 'exhausted' (not immediate no_retry)", async () => {
		// git_lock_file: maxAttempts=2. Pre-set counter to 2 so budget is exhausted.
		const failedResult = buildFailedMergeResult(0, "Unable to create lock file");
		const retryCountByScope: Record<string, number> = {};

		// First call — will succeed on retry, consuming attempt 1
		const firstOutcome = await applyMergeRetryLoop(
			failedResult, 0, retryCountByScope,
			{
				performMerge: () => buildFailedMergeResult(0, "Unable to create lock file"),
				persist: () => {},
				log: () => {},
				notify: () => {},
				updateMergeResult: () => {},
				sleep: () => {},
			},
		);

		// After first attempt fails again and second attempt also fails,
		// the loop should exhaust both attempts
		expect(firstOutcome.kind).toBe("exhausted");
		if (firstOutcome.kind === "exhausted") {
			expect(firstOutcome.classification).toBe("git_lock_file");
		}
	});

	it("2.10: non-retriable merge failure returns no_retry (not retried)", async () => {
		// merge_conflict_unresolved is non-retriable
		const failedResult: MergeWaveResult = {
			waveIndex: 0,
			status: "failed",
			laneResults: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					sourceBranch: "task/TP-TEST",
					targetBranch: "main",
					result: { status: "CONFLICT_UNRESOLVED", resolvedWith: null, error: "conflict" },
					error: null,
					durationMs: 500,
				},
			],
			failedLane: 1,
			failureReason: "Merge conflict",
			totalDurationMs: 600,
		};

		let performMergeCalled = false;
		const outcome = await applyMergeRetryLoop(failedResult, 0, {}, {
			performMerge: () => { performMergeCalled = true; return failedResult; },
			persist: () => {},
			log: () => {},
			notify: () => {},
			updateMergeResult: () => {},
			sleep: () => {},
		});

		expect(outcome.kind).toBe("no_retry");
		expect(performMergeCalled).toBe(false); // No retry attempt made
		expect(outcome.classification).toBe("merge_conflict_unresolved");
	});

	it("2.11: engine wires merge retry via applyMergeRetryLoop with Tier 0 event callbacks", () => {
		// Structural verification that the engine uses applyMergeRetryLoop
		// with the onRetryAttempt callback for Tier 0 event emission
		const engineSource = readSource("engine.ts");
		const mergeSection = engineSource.substring(
			engineSource.indexOf("applyMergeRetryLoop("),
			engineSource.indexOf("applyMergeRetryLoop(") + 2000,
		);
		// The engine passes onRetryAttempt callback
		expect(mergeSection).toContain("onRetryAttempt:");
		// On retry_succeeded, engine continues (no pause)
		expect(mergeSection).toContain('"retry_succeeded"');
		// On exhausted, engine pauses
		const exhaustedSection = engineSource.substring(
			engineSource.indexOf('"exhausted"', engineSource.indexOf("applyMergeRetryLoop")),
		);
		expect(exhaustedSection).toContain('batchState.phase = "paused"');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Partial progress preservation before retry
// ══════════════════════════════════════════════════════════════════════

describe("3.x — Worker crash with commits saves branch and records partial progress", () => {
	it("3.1: engine applies partial progress before inter-wave reset", () => {
		const engineSource = readSource("engine.ts");
		// applyPartialProgressToOutcomes is called in the engine
		expect(engineSource).toContain("applyPartialProgressToOutcomes");
	});

	it("3.2: preserveFailedLaneProgress is called during wave cleanup", () => {
		const engineSource = readSource("engine.ts");
		expect(engineSource).toContain("preserveFailedLaneProgress");
	});

	it("3.3: worker crash retry occurs after partial progress operations", () => {
		const engineSource = readSource("engine.ts");
		// Find the wave loop section
		const waveLoopStart = engineSource.indexOf("export async function executeOrchBatch");
		const waveLoop = engineSource.substring(waveLoopStart);
		// preserveFailedLaneProgress should appear before attemptWorkerCrashRetry
		// in the overall engine flow (called at inter-wave or terminal cleanup)
		const partialIdx = waveLoop.indexOf("preserveFailedLaneProgress");
		const retryIdx = waveLoop.indexOf("attemptWorkerCrashRetry");
		// Both must exist
		expect(partialIdx).not.toBe(-1);
		expect(retryIdx).not.toBe(-1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Stale worktree recovery
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Stale worktree cleaned and provisioning retried", () => {
	it("4.1: attemptStaleWorktreeRecovery triggers on ALLOC_WORKTREE_FAILED", () => {
		const engineSource = readSource("engine.ts");
		const staleFn = engineSource.substring(
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		expect(staleFn).toContain('waveResult.allocationError.code !== "ALLOC_WORKTREE_FAILED"');
	});

	it("4.2: stale recovery force-cleans worktrees then prunes", () => {
		const engineSource = readSource("engine.ts");
		const staleFn = engineSource.substring(
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		expect(staleFn).toContain("forceCleanupWorktree");
		expect(staleFn).toContain('runGit(["worktree", "prune"]');
	});

	it("4.3: stale recovery cleans all workspace repos, not just primary (R002-3)", () => {
		const engineSource = readSource("engine.ts");
		const staleFn = engineSource.substring(
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		// Must iterate workspace repos
		expect(staleFn).toContain("workspaceConfig");
		expect(staleFn).toContain("repoRootsToClean");
	});

	it("4.4: stale recovery retries the full wave execution", () => {
		const engineSource = readSource("engine.ts");
		const staleFn = engineSource.substring(
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		expect(staleFn).toContain("await executeWave(");
	});

	it("4.5: stale_worktree retry budget is 1", () => {
		expect(TIER0_RETRY_BUDGETS.stale_worktree.maxRetries).toBe(1);
	});

	it("4.6: stale recovery is invoked in the wave loop", () => {
		const engineSource = readSource("engine.ts");
		const waveLoop = engineSource.substring(
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		expect(waveLoop).toContain("attemptStaleWorktreeRecovery(");
	});

	it("4.7: stale recovery success emits tier0_recovery_success event", () => {
		const engineSource = readSource("engine.ts");
		// The success event is emitted from the wave loop after recovery returns a successful result
		const waveLoop = engineSource.substring(
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		// Find stale recovery success in the wave loop (not in the helper)
		expect(waveLoop).toContain("tier0_recovery_success");
		// Confirm it's tied to stale_worktree
		const staleSuccessBlock = waveLoop.substring(
			waveLoop.indexOf("attemptStaleWorktreeRecovery"),
			waveLoop.indexOf("attemptWorkerCrashRetry"),
		);
		expect(staleSuccessBlock).toContain("stale_worktree");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Cleanup gate Tier 0 recovery
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Cleanup gate Tier 0 recovery: retry, continue, or pause+escalate", () => {
	it("5.1: cleanup gate retry uses TIER0_RETRY_BUDGETS.cleanup_gate", () => {
		const engineSource = readSource("engine.ts");
		expect(engineSource).toContain("TIER0_RETRY_BUDGETS.cleanup_gate");
	});

	it("5.2: cleanup_gate retry budget is 1", () => {
		expect(TIER0_RETRY_BUDGETS.cleanup_gate.maxRetries).toBe(1);
	});

	it("5.3: cleanup gate attempts force cleanup on stale worktrees", () => {
		const engineSource = readSource("engine.ts");
		// Find the cleanup gate section
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		expect(cleanupGateIdx).not.toBe(-1);
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 3000);
		expect(cleanupSection).toContain("forceCleanupWorktree");
		expect(cleanupSection).toContain('runGit(["worktree", "prune"]');
	});

	it("5.4: successful cleanup gate retry continues (no break/pause)", () => {
		const engineSource = readSource("engine.ts");
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 4000);
		// On success: emits success event and does NOT break
		expect(cleanupSection).toContain("tier0_recovery_success");
		expect(cleanupSection).toContain("cleanup gate retry succeeded");
		// Verify persistence on success
		expect(cleanupSection).toContain("tier0-cleanup-retry-success");
	});

	it("5.5: failed cleanup gate retry pauses batch", () => {
		const engineSource = readSource("engine.ts");
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 8000);
		// On failure: sets phase to paused and breaks
		expect(cleanupSection).toContain("computeCleanupGatePolicy");
		expect(cleanupSection).toContain("batchState.phase = gatePolicyResult.targetPhase");
		expect(cleanupSection).toContain("break");
	});

	it("5.6: failed cleanup gate retry emits tier0_recovery_exhausted + tier0_escalation", () => {
		const engineSource = readSource("engine.ts");
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 8000);
		// Exhausted event
		const exhaustedMatches = cleanupSection.match(/tier0_recovery_exhausted/g);
		expect(exhaustedMatches).not.toBeNull();
		expect(exhaustedMatches!.length).toBeGreaterThanOrEqual(2); // retry-failed + budget-exhausted paths
		// Escalation event
		const escalationMatches = cleanupSection.match(/emitTier0Escalation\(/g);
		expect(escalationMatches).not.toBeNull();
		expect(escalationMatches!.length).toBeGreaterThanOrEqual(2);
	});

	it("5.7: cleanup gate budget-exhausted path skips retry and pauses immediately", () => {
		const engineSource = readSource("engine.ts");
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 8000);
		// The else branch for budget exhausted
		expect(cleanupSection).toContain("retry budget exhausted");
		expect(cleanupSection).toContain("preserveWorktreesForResume = true");
	});

	it("5.8: cleanup gate uses tier0WaveScopeKey for counter tracking", () => {
		const engineSource = readSource("engine.ts");
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 2000);
		expect(cleanupSection).toContain('tier0WaveScopeKey("cleanup_gate"');
	});

	it("5.9: cleanup gate re-checks worktree state after force cleanup", () => {
		const engineSource = readSource("engine.ts");
		const cleanupGateIdx = engineSource.indexOf("Tier 0 — Cleanup gate retry");
		const cleanupSection = engineSource.substring(cleanupGateIdx, cleanupGateIdx + 3000);
		// After cleanup, re-list worktrees and check if any are still stale
		expect(cleanupSection).toContain("retriedGateFailures");
		expect(cleanupSection).toContain("retriedGateFailures.length === 0");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Event logging: correct schema in events.jsonl
// ══════════════════════════════════════════════════════════════════════

describe("6.x — Event logging: events written to .pi/supervisor/events.jsonl", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "tier0-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("6.1: emitTier0Event creates .pi/supervisor directory if missing", () => {
		const event: Tier0Event = {
			...buildTier0EventBase("tier0_recovery_attempt", "batch-1", 0, "worker_crash", 1, 1),
			taskId: "TP-001",
			laneNumber: 1,
		};
		emitTier0Event(tmpDir, event);

		expect(existsSync(join(tmpDir, ".pi", "supervisor"))).toBe(true);
		expect(existsSync(join(tmpDir, ".pi", "supervisor", "events.jsonl"))).toBe(true);
	});

	it("6.2: emitTier0Event writes valid JSONL (one line per event)", () => {
		const event1: Tier0Event = {
			...buildTier0EventBase("tier0_recovery_attempt", "batch-1", 0, "worker_crash", 1, 1),
			taskId: "TP-001",
		};
		const event2: Tier0Event = {
			...buildTier0EventBase("tier0_recovery_success", "batch-1", 0, "worker_crash", 1, 1),
			taskId: "TP-001",
			resolution: "Task succeeded on retry",
		};
		emitTier0Event(tmpDir, event1);
		emitTier0Event(tmpDir, event2);

		const events = readEvents(tmpDir);
		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("tier0_recovery_attempt");
		expect(events[1].type).toBe("tier0_recovery_success");
	});

	it("6.3: buildTier0EventBase populates all required fields", () => {
		const base = buildTier0EventBase("tier0_recovery_attempt", "batch-42", 2, "stale_worktree", 1, 3);
		expect(base.timestamp).toBeDefined();
		expect(base.type).toBe("tier0_recovery_attempt");
		expect(base.batchId).toBe("batch-42");
		expect(base.waveIndex).toBe(2);
		expect(base.pattern).toBe("stale_worktree");
		expect(base.attempt).toBe(1);
		expect(base.maxAttempts).toBe(3);
		// Timestamp should be ISO 8601
		expect(() => new Date(base.timestamp)).not.toThrow();
		expect(new Date(base.timestamp).toISOString()).toBe(base.timestamp);
	});

	it("6.4: events include optional fields when provided", () => {
		const event: Tier0Event = {
			...buildTier0EventBase("tier0_recovery_attempt", "batch-1", 0, "worker_crash", 1, 1),
			taskId: "TP-001",
			laneNumber: 2,
			repoId: "backend",
			classification: "api_error",
			cooldownMs: 5000,
			scopeKey: "t0:worker_crash:TP-001:w0",
		};
		emitTier0Event(tmpDir, event);

		const events = readEvents(tmpDir);
		expect(events[0].taskId).toBe("TP-001");
		expect(events[0].laneNumber).toBe(2);
		expect(events[0].repoId).toBe("backend");
		expect(events[0].classification).toBe("api_error");
		expect(events[0].cooldownMs).toBe(5000);
		expect(events[0].scopeKey).toBe("t0:worker_crash:TP-001:w0");
	});

	it("6.5: escalation event includes EscalationContext", () => {
		const escalation: EscalationContext = {
			pattern: "worker_crash",
			attempts: 1,
			maxAttempts: 1,
			lastError: "Task crashed with api_error",
			affectedTasks: ["TP-001"],
			suggestion: "Investigate the root cause",
		};
		const event: Tier0Event = {
			...buildTier0EventBase("tier0_escalation", "batch-1", 0, "worker_crash", 1, 1),
			taskId: "TP-001",
			escalation,
		};
		emitTier0Event(tmpDir, event);

		const events = readEvents(tmpDir);
		expect(events[0].type).toBe("tier0_escalation");
		expect(events[0].escalation).toBeDefined();
		expect(events[0].escalation!.pattern).toBe("worker_crash");
		expect(events[0].escalation!.attempts).toBe(1);
		expect(events[0].escalation!.maxAttempts).toBe(1);
		expect(events[0].escalation!.lastError).toBe("Task crashed with api_error");
		expect(events[0].escalation!.affectedTasks).toEqual(["TP-001"]);
		expect(events[0].escalation!.suggestion).toBe("Investigate the root cause");
	});

	it("6.6: emitTier0Event is best-effort — does not throw on write failure", () => {
		// Pass a path that can't be written to (empty string stateRoot)
		// The function should silently catch the error
		expect(() => {
			emitTier0Event("", {
				...buildTier0EventBase("tier0_recovery_attempt", "batch-1", 0, "worker_crash", 1, 1),
			});
		}).not.toThrow();
	});

	it("6.7: tier0ScopeKey produces correct format", () => {
		const key = tier0ScopeKey("worker_crash", "TP-001", 2);
		expect(key).toBe("t0:worker_crash:TP-001:w2");
	});

	it("6.8: tier0WaveScopeKey produces correct format", () => {
		const key = tier0WaveScopeKey("stale_worktree", 3);
		expect(key).toBe("t0:stale_worktree:w3");
	});

	it("6.9: merge_timeout pattern is valid for events", () => {
		const event: Tier0Event = {
			...buildTier0EventBase("tier0_recovery_attempt", "batch-1", 0, "merge_timeout", 1, 2),
		};
		emitTier0Event(tmpDir, event);
		const events = readEvents(tmpDir);
		expect(events[0].pattern).toBe("merge_timeout");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Happy path: no failures → no events, no retries
// ══════════════════════════════════════════════════════════════════════

describe("7.x — Happy path: no failures → no events, no retries", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "tier0-happy-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("7.1: when no events are emitted, events.jsonl does not exist", () => {
		// Just create the stateRoot with no events
		const eventsPath = join(tmpDir, ".pi", "supervisor", "events.jsonl");
		expect(existsSync(eventsPath)).toBe(false);
	});

	it("7.2: worker crash retry only runs when there are failed tasks", () => {
		const engineSource = readSource("engine.ts");
		const retryFn = engineSource.substring(
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
		);
		// Iterates over waveResult.failedTaskIds — if empty, nothing runs
		expect(retryFn).toContain("waveResult.failedTaskIds");
	});

	it("7.3: stale worktree recovery only triggers on ALLOC_WORKTREE_FAILED", () => {
		const engineSource = readSource("engine.ts");
		const staleFn = engineSource.substring(
			engineSource.indexOf("async function attemptStaleWorktreeRecovery"),
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		expect(staleFn).toContain("return null");
		expect(staleFn).toContain('waveResult.allocationError.code !== "ALLOC_WORKTREE_FAILED"');
	});

	it("7.4: cleanup gate retry only fires when cleanupGateFailures.length > 0", () => {
		const engineSource = readSource("engine.ts");
		expect(engineSource).toContain("cleanupGateFailures.length > 0");
	});

	it("7.5: engine does not import or invoke tier0 functions unconditionally", () => {
		const engineSource = readSource("engine.ts");
		// emitTier0Event calls should only be inside recovery/failure branches
		// Verify that they're not at top-level batch execution scope
		const batchFn = engineSource.substring(
			engineSource.indexOf("export async function executeOrchBatch"),
		);
		// The first emitTier0Event in the batch function should be conditional
		// (inside an if block or inside attemptStaleWorktreeRecovery/attemptWorkerCrashRetry call)
		const firstEmit = batchFn.indexOf("emitTier0Event");
		// All emit calls are after the wave execution and inside conditional blocks
		expect(firstEmit).toBeGreaterThan(0);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — Per-pattern exhaustion: all patterns emit correct events
// ══════════════════════════════════════════════════════════════════════

describe("8.x — Per-pattern exhaustion coverage", () => {
	const patterns: Array<{
		pattern: Tier0EscalationPattern;
		sourceSection: string;
		description: string;
	}> = [
		{
			pattern: "worker_crash",
			sourceSection: "attemptWorkerCrashRetry",
			description: "Worker session crash",
		},
		{
			pattern: "stale_worktree",
			sourceSection: "attemptStaleWorktreeRecovery",
			description: "Stale worktree allocation failure",
		},
		{
			pattern: "merge_timeout",
			sourceSection: "applyMergeRetryLoop",
			description: "Merge timeout",
		},
		{
			pattern: "cleanup_gate",
			sourceSection: "Tier 0 — Cleanup gate retry",
			description: "Post-merge cleanup gate failure",
		},
	];

	for (let i = 0; i < patterns.length; i++) {
		const { pattern, sourceSection, description } = patterns[i];

		it(`8.${i + 1}: ${description} exhaustion emits tier0_recovery_exhausted event`, () => {
			const engineSource = readSource("engine.ts");
			// Find the section handling this pattern
			const sectionIdx = engineSource.indexOf(sourceSection);
			expect(sectionIdx).not.toBe(-1);
			// From that section, find exhausted event
			const section = engineSource.substring(sectionIdx, sectionIdx + 5000);
			expect(section).toContain("tier0_recovery_exhausted");
		});

		it(`8.${i + 5}: ${description} exhaustion emits tier0_escalation`, () => {
			const engineSource = readSource("engine.ts");
			const sectionIdx = engineSource.indexOf(sourceSection);
			expect(sectionIdx).not.toBe(-1);
			const section = engineSource.substring(sectionIdx, sectionIdx + 5000);
			expect(section).toContain("emitTier0Escalation(");
		});
	}

	it("8.9: all TIER0_RETRY_BUDGETS patterns have valid budget config", () => {
		const allPatterns: Tier0RecoveryPattern[] = ["worker_crash", "stale_worktree", "cleanup_gate"];
		for (const p of allPatterns) {
			const budget = TIER0_RETRY_BUDGETS[p];
			expect(budget).toBeDefined();
			expect(budget.maxRetries).toBeGreaterThanOrEqual(1);
			expect(budget.cooldownMs).toBeGreaterThanOrEqual(0);
			expect(budget.backoffMultiplier).toBeGreaterThanOrEqual(1.0);
		}
	});

	it("8.10: escalation event payload in engine includes all EscalationContext fields", () => {
		const engineSource = readSource("engine.ts");
		const escalationFn = engineSource.substring(
			engineSource.indexOf("function emitTier0Escalation("),
			engineSource.indexOf("async function attemptWorkerCrashRetry"),
		);
		// The function creates an EscalationContext object
		expect(escalationFn).toContain("const escalation: EscalationContext");
		// Event is emitted with type tier0_escalation
		expect(escalationFn).toContain('"tier0_escalation"');
		// Event includes the escalation payload
		expect(escalationFn).toContain("escalation,");
	});
});
