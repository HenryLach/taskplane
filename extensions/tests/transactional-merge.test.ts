/**
 * Transactional Merge Envelope Tests — TP-033 Step 3
 *
 * Tests for the transactional merge envelope introduced in TP-033:
 *
 *   1.x — Transaction record: pre/post ref capture (baseHEAD, laneHEAD, mergedHEAD)
 *   2.x — Rollback: verification_new_failure triggers rollback to baseHEAD
 *   3.x — Safe-stop: rollback failure forces paused, preserves state, emits recovery
 *   4.x — Transaction persistence: persistTransactionRecord writes JSON to .pi/verification/
 *   5.x — Persistence warning: failure surfaces in merge outcome
 *   6.x — Engine/resume parity for safe-stop handling
 *
 * Run: npx vitest run tests/transactional-merge.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import type {
	TransactionRecord,
	TransactionStatus,
	MergeWaveResult,
	MergeLaneResult,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8");
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal TransactionRecord for testing. */
function makeTxnRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
	return {
		opId: "test-op",
		batchId: "test-batch",
		waveIndex: 0,
		laneNumber: 1,
		repoId: null,
		baseHEAD: "aaaa1111",
		laneHEAD: "bbbb2222",
		mergedHEAD: "cccc3333",
		status: "committed",
		rollbackAttempted: false,
		rollbackResult: null,
		recoveryCommands: [],
		startedAt: "2026-03-20T00:00:00.000Z",
		completedAt: "2026-03-20T00:01:00.000Z",
		...overrides,
	};
}

/** Build a minimal MergeLaneResult. */
function makeLaneResult(overrides: Partial<MergeLaneResult> = {}): MergeLaneResult {
	return {
		laneNumber: 1,
		laneId: "lane-1",
		sourceBranch: "task/lane-1",
		targetBranch: "orch/test",
		result: {
			status: "SUCCESS",
			source_branch: "task/lane-1",
			merge_commit: "cccc3333",
			conflicts: [],
			verification: { passed: true, commands: [], output: "" },
		},
		error: null,
		durationMs: 1000,
		...overrides,
	};
}

/** Build a minimal MergeWaveResult. */
function makeWaveResult(overrides: Partial<MergeWaveResult> = {}): MergeWaveResult {
	return {
		waveIndex: 0,
		status: "succeeded",
		laneResults: [makeLaneResult()],
		failedLane: null,
		failureReason: null,
		totalDurationMs: 1000,
		...overrides,
	};
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — Transaction Record: Pre/Post Ref Capture
// ══════════════════════════════════════════════════════════════════════

describe("1.x — Transaction record: pre/post ref capture", () => {
	it("1.1: TransactionRecord interface has all required ref fields", () => {
		const record = makeTxnRecord();

		// All ref fields must be present and typed
		expect(record.baseHEAD).toBe("aaaa1111");
		expect(record.laneHEAD).toBe("bbbb2222");
		expect(record.mergedHEAD).toBe("cccc3333");
		expect(record.opId).toBe("test-op");
		expect(record.batchId).toBe("test-batch");
		expect(record.waveIndex).toBe(0);
		expect(record.laneNumber).toBe(1);
		expect(record.repoId).toBeNull();
		expect(record.status).toBe("committed");
		expect(record.rollbackAttempted).toBe(false);
		expect(record.rollbackResult).toBeNull();
		expect(record.recoveryCommands).toEqual([]);
		expect(record.startedAt).toBeTruthy();
		expect(record.completedAt).toBeTruthy();
	});

	it("1.2: merge.ts captures baseHEAD via git rev-parse HEAD before merge", () => {
		const mergeSource = readSource("merge.ts");

		// baseHEAD must be captured before the lane merge starts
		expect(mergeSource).toContain("Capture baseHEAD");
		expect(mergeSource).toContain('git", ["rev-parse", "HEAD"]');
		// Must be captured from mergeWorkDir (the isolated merge worktree)
		expect(mergeSource).toContain("cwd: mergeWorkDir");
	});

	it("1.3: merge.ts captures laneHEAD via git rev-parse on lane branch", () => {
		const mergeSource = readSource("merge.ts");

		// laneHEAD must be captured from the lane's source branch tip
		expect(mergeSource).toContain("Capture laneHEAD");
		expect(mergeSource).toContain('git", ["rev-parse", lane.branch]');
	});

	it("1.4: merge.ts captures mergedHEAD after successful merge commit", () => {
		const mergeSource = readSource("merge.ts");

		// mergedHEAD is the HEAD of the merge worktree after the merge commit
		expect(mergeSource).toContain("Capture mergedHEAD");
		// Only captured when merge succeeded
		expect(mergeSource).toContain('mergeResult.status === "SUCCESS"');
		expect(mergeSource).toContain('mergeResult.status === "CONFLICT_RESOLVED"');
	});

	it("1.5: successful merge creates committed transaction record with all refs", () => {
		const mergeSource = readSource("merge.ts");

		// When merge succeeds, the txnStatus should be "committed"
		// and all three refs (baseHEAD, laneHEAD, mergedHEAD) should be populated
		expect(mergeSource).toContain("txnStatus");
		expect(mergeSource).toContain('"committed"');
		// Transaction record includes all three refs
		expect(mergeSource).toContain("baseHEAD,");
		expect(mergeSource).toContain("laneHEAD,");
		expect(mergeSource).toContain("mergedHEAD,");
	});

	it("1.6: failed merge (error path) creates merge_failed record with null mergedHEAD", () => {
		const mergeSource = readSource("merge.ts");

		// In the catch block, a failed merge should produce a merge_failed txn
		expect(mergeSource).toContain('status: "merge_failed"');
		// mergedHEAD should be null since merge never completed
		expect(mergeSource).toContain("mergedHEAD: null");
	});

	it("1.7: MergeWaveResult carries transactionRecords from lane merges", () => {
		const result = makeWaveResult({
			transactionRecords: [
				makeTxnRecord({ laneNumber: 1, status: "committed" }),
				makeTxnRecord({ laneNumber: 2, status: "committed" }),
			],
		});

		expect(result.transactionRecords).toHaveLength(2);
		expect(result.transactionRecords![0].laneNumber).toBe(1);
		expect(result.transactionRecords![1].laneNumber).toBe(2);
	});

	it("1.8: TransactionStatus covers all four outcomes", () => {
		const statuses: TransactionStatus[] = [
			"committed",
			"rolled_back",
			"rollback_failed",
			"merge_failed",
		];

		// Each status should be a valid TransactionStatus (type check implicit)
		for (const s of statuses) {
			const record = makeTxnRecord({ status: s });
			expect(record.status).toBe(s);
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Rollback: verification_new_failure triggers rollback to baseHEAD
// ══════════════════════════════════════════════════════════════════════

describe("2.x — Rollback: verification_new_failure triggers rollback", () => {
	it("2.1: merge.ts rolls back on verification_new_failure via git reset --hard", () => {
		const mergeSource = readSource("merge.ts");

		// When verification detects new failures, rollback must happen
		expect(mergeSource).toContain("verification_new_failure");
		expect(mergeSource).toContain('git", ["reset", "--hard", preLaneHead]');
		// The rollback target is baseHEAD (aliased as preLaneHead)
		expect(mergeSource).toContain("preLaneHead = baseHEAD");
	});

	it("2.2: successful rollback produces rolled_back transaction status", () => {
		const mergeSource = readSource("merge.ts");

		// After successful rollback:
		expect(mergeSource).toContain('txnStatus = "rolled_back"');
		expect(mergeSource).toContain('txnRollbackResult = "success"');
		expect(mergeSource).toContain("txnRollbackAttempted = true");
	});

	it("2.3: rollback sets blockAdvancement = false (only rollback failure blocks)", () => {
		const mergeSource = readSource("merge.ts");

		// Successful rollback should NOT set blockAdvancement
		// Only failed rollback should set it
		const rolledBackSection = mergeSource.indexOf('txnStatus = "rolled_back"');
		const successRollbackSection = mergeSource.substring(rolledBackSection - 200, rolledBackSection + 200);
		// blockAdvancement should NOT appear in the successful rollback path
		expect(successRollbackSection).not.toContain("blockAdvancement = true");
	});

	it("2.4: lane error annotation includes verification_new_failure details", () => {
		const mergeSource = readSource("merge.ts");

		// The lane result's error field must contain failure classification
		expect(mergeSource).toContain("verification_new_failure:");
		// And new failure count
		expect(mergeSource).toContain("verificationResult.newFailureCount");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Safe-stop: rollback failure forces paused + preserves state
// ══════════════════════════════════════════════════════════════════════

describe("3.x — Safe-stop: rollback failure handling", () => {
	it("3.1: failed rollback sets rollback_failed status and emits recovery commands", () => {
		const mergeSource = readSource("merge.ts");

		// Rollback failure path:
		expect(mergeSource).toContain('txnStatus = "rollback_failed"');
		expect(mergeSource).toContain("rollbackFailed = true");
		// Recovery commands are emitted
		expect(mergeSource).toContain("Recovery: manually reset merge worktree");
		expect(mergeSource).toContain("git reset --hard");
	});

	it("3.2: rollback failure sets blockAdvancement = true", () => {
		const mergeSource = readSource("merge.ts");

		// After rollback failure, blockAdvancement must be set
		const rollbackFailedIdx = mergeSource.indexOf('txnStatus = "rollback_failed"');
		const nearContext = mergeSource.substring(rollbackFailedIdx - 500, rollbackFailedIdx + 100);
		expect(nearContext).toContain("blockAdvancement = true");
	});

	it("3.3: no baseHEAD captured triggers safe-stop with recovery guidance", () => {
		const mergeSource = readSource("merge.ts");

		// When preLaneHead is empty, we can't roll back
		expect(mergeSource).toContain("no baseHEAD — cannot roll back");
		expect(mergeSource).toContain("no baseHEAD was captured for rollback");
		// This path also sets rollbackFailed = true
		expect(mergeSource).toContain("rollback impossible");
	});

	it("3.4: engine.ts forces paused on rollbackFailed regardless of on_merge_failure config", () => {
		const engineSource = readSource("engine.ts");

		// Engine must check rollbackFailed
		expect(engineSource).toContain("mergeResult?.rollbackFailed");
		// And force paused
		expect(engineSource).toContain("SAFE-STOP: verification rollback failed");
		expect(engineSource).toContain('batchState.phase = "paused"');
		// Recovery commands reference
		expect(engineSource).toContain("Check transaction records in .pi/verification/");
	});

	it("3.5: engine.ts preserves worktrees on safe-stop", () => {
		const engineSource = readSource("engine.ts");

		// After safe-stop, worktrees must be preserved for recovery
		const safeStopIdx = engineSource.indexOf("SAFE-STOP: verification rollback failed");
		const afterSafeStop = engineSource.substring(safeStopIdx, safeStopIdx + 1500);
		expect(afterSafeStop).toContain("preserveWorktreesForResume = true");
		expect(afterSafeStop).toContain("break");
	});

	it("3.6: resume.ts forces paused on rollbackFailed (parity with engine.ts)", () => {
		const resumeSource = readSource("resume.ts");

		// Resume must have the same safe-stop handling
		expect(resumeSource).toContain("mergeResult?.rollbackFailed");
		expect(resumeSource).toContain("SAFE-STOP: verification rollback failed");
		expect(resumeSource).toContain('batchState.phase = "paused"');
		expect(resumeSource).toContain("Check transaction records in .pi/verification/");
	});

	it("3.7: resume.ts preserves worktrees on safe-stop (parity with engine.ts)", () => {
		const resumeSource = readSource("resume.ts");

		const safeStopIdx = resumeSource.indexOf("SAFE-STOP: verification rollback failed");
		const afterSafeStop = resumeSource.substring(safeStopIdx, safeStopIdx + 1500);
		expect(afterSafeStop).toContain("preserveWorktreesForResume = true");
		expect(afterSafeStop).toContain("break");
	});

	it("3.8: MergeWaveResult rollbackFailed flag propagates from lane to wave result", () => {
		const result = makeWaveResult({
			status: "failed",
			rollbackFailed: true,
			failedLane: 1,
			failureReason: "rollback failed",
		});

		expect(result.rollbackFailed).toBe(true);
	});

	it("3.9: mergeWaveByRepo short-circuits remaining repo groups on rollbackFailed (R004-1)", () => {
		const mergeSource = readSource("merge.ts");

		// After detecting rollbackFailed in one repo, remaining repos are skipped
		expect(mergeSource).toContain("safe-stop: skipping");
		expect(mergeSource).toContain("remaining repo group(s) after rollback failure");
		// The break statement stops the repo loop
		expect(mergeSource).toContain("if (anyRollbackFailed)");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Transaction persistence: writes JSON to .pi/verification/
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Transaction record persistence", () => {
	it("4.1: persistTransactionRecord writes to correct path pattern", () => {
		const mergeSource = readSource("merge.ts");

		// Path: .pi/verification/{opId}/txn-b{batchId}-repo-{repoSlug}-wave-{n}-lane-{k}.json
		expect(mergeSource).toContain(".pi");
		expect(mergeSource).toContain("verification");
		expect(mergeSource).toContain("record.opId");
		expect(mergeSource).toContain("txn-b${record.batchId}");
		expect(mergeSource).toContain("repo-${repoSlug}");
		expect(mergeSource).toContain("wave-${record.waveIndex}");
		expect(mergeSource).toContain("lane-${record.laneNumber}");
	});

	it("4.2: repo mode uses 'default' slug when repoId is null/undefined", () => {
		const mergeSource = readSource("merge.ts");

		// When repoId is null, use "default" as slug
		expect(mergeSource).toContain('"default"');
		// Sanitize repoId for filesystem safety
		expect(mergeSource).toContain("replace(/[^a-zA-Z0-9_-]/g");
	});

	it("4.3: persistTransactionRecord is called after both success and error paths", () => {
		const mergeSource = readSource("merge.ts");

		// Count calls to persistTransactionRecord
		const successCallCount = (mergeSource.match(/persistTransactionRecord\(txnRecord/g) || []).length;
		const errorCallCount = (mergeSource.match(/persistTransactionRecord\(errorTxnRecord/g) || []).length;

		// Should be called at least once for success and once for error
		expect(successCallCount).toBeGreaterThanOrEqual(1);
		expect(errorCallCount).toBeGreaterThanOrEqual(1);
	});

	it("4.4: persistTransactionRecord is best-effort (does not throw on failure)", () => {
		const mergeSource = readSource("merge.ts");

		// The function uses try/catch and returns error string instead of throwing
		const fnStart = mergeSource.indexOf("function persistTransactionRecord");
		// Find the next function to bound the search
		const fnEnd = mergeSource.indexOf("\n}", fnStart + 100);
		const fnBody = mergeSource.substring(fnStart, fnEnd + 2);
		expect(fnBody).toContain("try {");
		expect(fnBody).toContain("catch (err");
		expect(fnBody).toContain("return null");
		expect(fnBody).toContain("return `lane");
	});

	it("4.5: transaction record JSON is pretty-printed", () => {
		const mergeSource = readSource("merge.ts");

		// JSON.stringify with indentation
		expect(mergeSource).toContain("JSON.stringify(record, null, 2)");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Persistence warning: failure surfaces in merge outcome (R004-2)
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Persistence warning propagation (R004-2)", () => {
	it("5.1: MergeWaveResult has persistenceErrors field", () => {
		const result = makeWaveResult({
			persistenceErrors: ["lane 1 (repo: default): ENOSPC: no space left on device"],
		});

		expect(result.persistenceErrors).toHaveLength(1);
		expect(result.persistenceErrors![0]).toContain("ENOSPC");
	});

	it("5.2: persistence errors accumulate across repo groups in mergeWaveByRepo", () => {
		const mergeSource = readSource("merge.ts");

		// allPersistenceErrors accumulates from all repo groups
		expect(mergeSource).toContain("allPersistenceErrors");
		expect(mergeSource).toContain("groupResult.persistenceErrors");
	});

	it("5.3: engine.ts includes persistence warning in safe-stop notification", () => {
		const engineSource = readSource("engine.ts");

		// The safe-stop path checks for persistence errors and includes warning
		expect(engineSource).toContain("persistenceErrors");
		expect(engineSource).toContain("transaction record(s) failed to persist");
		expect(engineSource).toContain("recovery file(s) may be missing");
	});

	it("5.4: resume.ts includes persistence warning in safe-stop notification (parity)", () => {
		const resumeSource = readSource("resume.ts");

		expect(resumeSource).toContain("persistenceErrors");
		expect(resumeSource).toContain("transaction record(s) failed to persist");
		expect(resumeSource).toContain("recovery file(s) may be missing");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Engine/resume parity for safe-stop and transaction handling
// ══════════════════════════════════════════════════════════════════════

describe("6.x — Engine/resume parity for safe-stop", () => {
	it("6.1: both engine.ts and resume.ts check rollbackFailed before merge failure handling", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		// In both files, rollbackFailed check must come BEFORE the general merge failure path
		const engineRollbackIdx = engineSource.indexOf("mergeResult?.rollbackFailed");
		const engineMergeFailIdx = engineSource.indexOf('mergeResult.status === "failed"');
		expect(engineRollbackIdx).toBeLessThan(engineMergeFailIdx);

		const resumeRollbackIdx = resumeSource.indexOf("mergeResult?.rollbackFailed");
		const resumeMergeFailIdx = resumeSource.indexOf('mergeResult.status === "failed"');
		expect(resumeRollbackIdx).toBeLessThan(resumeMergeFailIdx);
	});

	it("6.2: both files persist with trigger merge-rollback-safe-stop", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		expect(engineSource).toContain('"merge-rollback-safe-stop"');
		expect(resumeSource).toContain('"merge-rollback-safe-stop"');
	});

	it("6.3: both files emit 🛑 notification emoji on safe-stop", () => {
		const engineSource = readSource("engine.ts");
		const resumeSource = readSource("resume.ts");

		expect(engineSource).toContain("🛑 Safe-stop");
		expect(resumeSource).toContain("🛑 Safe-stop");
	});

	it("6.4: transaction records propagate through workspace mode mergeWaveByRepo", () => {
		const mergeSource = readSource("merge.ts");

		// In workspace mode, transaction records from each repo group are accumulated
		expect(mergeSource).toContain("allTransactionRecords");
		expect(mergeSource).toContain("groupResult.transactionRecords");
		// And attached to the aggregate result
		expect(mergeSource).toContain("aggregateResult.transactionRecords = allTransactionRecords");
	});

	it("6.5: rollbackFailed propagates from repo groups to aggregate in mergeWaveByRepo", () => {
		const mergeSource = readSource("merge.ts");

		// anyRollbackFailed flag tracks across repo groups
		expect(mergeSource).toContain("anyRollbackFailed");
		expect(mergeSource).toContain("groupResult.rollbackFailed");
		// And is set on the aggregate result
		expect(mergeSource).toContain("aggregateResult.rollbackFailed = true");
	});
});
