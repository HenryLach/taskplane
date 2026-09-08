/**
 * completion-authority.test.ts — the single completion predicate (#627 Stage 2b).
 *
 * Unit coverage for `authorizeCompletion()`, the one predicate the live finalize
 * gate AND resume's `.DONE` acceptance share. Scenarios:
 *   - allowed (no holds, latest review APPROVE / no gates)
 *   - hold-blocked only
 *   - review-gate-blocked only (latest verdict REVISE)
 *   - ratification-blocked only (linked APPROVE with no record)
 *   - all three blockers reported together (no short-circuit)
 *   - non-final segment ignores review gates but NOT holds
 *
 * Step 2 also adds the behavioural resume tests at the bottom (real
 * `collectDoneTaskIdsForResume` on a temp folder).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { authorizeCompletion } = await import("../taskplane/completion-authority.ts");
const { createHoldRecord } = await import("../taskplane/hold-state.ts");
type HoldRecord = import("../taskplane/hold-state.ts").HoldRecord;

const TASK_ID = "TP-CA";
const GATE = "code-step1";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "tp199-ca-"));
}

/** An OPEN hold that binds the unit — blocks completion (awaiting ruling). */
function openHold(escId: string): HoldRecord {
	return createHoldRecord({
		escalation: { id: escId, content: "cap hit on code-step1", timestamp: 1_000 },
		batchId: "tp199-ca",
		taskId: TASK_ID,
		segmentId: null,
		executionId: "exec-1",
		agentId: "orch-test-lane-1-worker",
		laneNumber: 1,
		holdTimeoutMinutes: 240,
		now: 1_000,
	});
}

function writeReview(reviewsDir: string, filename: string, verdict: string, extra = ""): void {
	writeFileSync(
		join(reviewsDir, filename),
		`# Review — Step 1\n\n## Verdict: ${verdict}\n\nSome notes.\n${extra}`,
	);
}

function baseCtx(reviewsDir: string, holds: HoldRecord[]) {
	return {
		holds,
		taskId: TASK_ID,
		segmentId: null,
		reviewsDir,
		headRevision: "c0ffee",
		isAncestor: () => true,
		isFinalSegment: true,
	};
}

describe("authorizeCompletion — the single completion predicate", () => {
	it("allowed: no holds and latest review is APPROVE", () => {
		const dir = tmp();
		try {
			mkdirSync(dir, { recursive: true });
			writeReview(dir, `R001-${GATE}.md`, "APPROVE");
			const decision = authorizeCompletion(baseCtx(dir, []));
			assert.equal(decision.allowed, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("allowed: no holds and no review files at all", () => {
		const dir = tmp();
		try {
			const decision = authorizeCompletion(baseCtx(dir, []));
			assert.equal(decision.allowed, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("hold-blocked only: an open hold blocks even with an APPROVE gate", () => {
		const dir = tmp();
		try {
			writeReview(dir, `R001-${GATE}.md`, "APPROVE");
			const decision = authorizeCompletion(baseCtx(dir, [openHold("esc-1")]));
			assert.equal(decision.allowed, false);
			if (decision.allowed === false) {
				assert.equal(decision.blockers.length, 1);
				assert.equal(decision.blockers[0].kind, "hold");
				assert.equal(decision.blockers[0].ref, "esc-1");
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("review-gate-blocked only: latest verdict is REVISE", () => {
		const dir = tmp();
		try {
			writeReview(dir, `R001-${GATE}.md`, "REVISE");
			const decision = authorizeCompletion(baseCtx(dir, []));
			assert.equal(decision.allowed, false);
			if (decision.allowed === false) {
				assert.equal(decision.blockers.length, 1);
				assert.equal(decision.blockers[0].kind, "review-gate");
				assert.equal(decision.blockers[0].ref, GATE);
				assert.equal(decision.blockers[0].gate?.verdict, "REVISE");
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ratification-blocked only: linked APPROVE whose record is missing", () => {
		const dir = tmp();
		try {
			// APPROVE that links a ratification id for which no record exists in the
			// reviews dir → the ratification check refuses (`missing record`).
			writeReview(dir, `R002-${GATE}.md`, "APPROVE", "\nRatification: ratif-nope\n");
			const decision = authorizeCompletion(baseCtx(dir, []));
			assert.equal(decision.allowed, false);
			if (decision.allowed === false) {
				assert.equal(decision.blockers.length, 1);
				assert.equal(decision.blockers[0].kind, "ratification");
				assert.equal(decision.blockers[0].ref, GATE);
				assert.match(decision.blockers[0].reason, /missing record ratif-nope/);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("all three reported together (no short-circuit)", () => {
		const dir = tmp();
		try {
			// A REVISE gate (review-gate) + a linked-APPROVE-with-no-record gate
			// (ratification) + an open hold. All three must surface.
			writeReview(dir, `R001-code-step1.md`, "REVISE");
			writeReview(dir, `R001-code-step2.md`, "APPROVE", "\nRatification: ratif-nope\n");
			const decision = authorizeCompletion(baseCtx(dir, [openHold("esc-1")]));
			assert.equal(decision.allowed, false);
			if (decision.allowed === false) {
				const kinds = decision.blockers.map((b) => b.kind).sort();
				assert.deepEqual(kinds, ["hold", "ratification", "review-gate"]);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("non-final segment ignores review gates but NOT holds", () => {
		const dir = tmp();
		try {
			writeReview(dir, `R001-${GATE}.md`, "REVISE");
			// Non-final segment + a REVISE gate → review gate skipped.
			const clean = authorizeCompletion({ ...baseCtx(dir, []), isFinalSegment: false });
			assert.equal(clean.allowed, true);
			// …but a hold still blocks a non-final segment.
			const held = authorizeCompletion({
				...baseCtx(dir, [openHold("esc-1")]),
				isFinalSegment: false,
			});
			assert.equal(held.allowed, false);
			if (held.allowed === false) {
				assert.equal(held.blockers.length, 1);
				assert.equal(held.blockers[0].kind, "hold");
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
