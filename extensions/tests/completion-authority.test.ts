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
const { collectDoneTaskIdsForResume } = await import("../taskplane/resume.ts");
const { createHoldRecord } = await import("../taskplane/hold-state.ts");
type HoldRecord = import("../taskplane/hold-state.ts").HoldRecord;
type PersistedBatchState = import("../taskplane/types.ts").PersistedBatchState;

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

// ── Step 2: resume `.DONE` acceptance uses the same predicate ──────────

describe("collectDoneTaskIdsForResume — completion authority on resume", () => {
	let warnings: string[];
	let originalWarn: typeof console.warn;

	function hush() {
		warnings = [];
		originalWarn = console.warn;
		console.warn = (msg: unknown) => {
			warnings.push(typeof msg === "string" ? msg : String(msg));
		};
	}
	function restore() {
		console.warn = originalWarn;
	}

	/** A single-segment (legacy) state whose `.DONE` lives in `taskFolder`. */
	function makeState(taskId: string, taskFolder: string): PersistedBatchState {
		return {
			batchId: "tp199-resume",
			phase: "executing",
			lanes: [],
			tasks: [
				{
					taskId,
					taskFolder,
					areaName: "test",
					promptPath: join(taskFolder, "PROMPT.md"),
					status: "pending",
					attempts: 0,
				} as unknown as PersistedBatchState["tasks"][number],
			],
			waves: [],
			segments: [],
		} as unknown as PersistedBatchState;
	}

	/** Create a task folder with a `.DONE` and a `.reviews` dir. */
	function seedTaskFolder(root: string, taskId: string): { folder: string; reviews: string } {
		const folder = join(root, taskId);
		const reviews = join(folder, ".reviews");
		mkdirSync(reviews, { recursive: true });
		writeFileSync(join(folder, ".DONE"), "Completed\n");
		return { folder, reviews };
	}

	it(".DONE + latest review REVISE → NOT collected (refused by completion authority)", () => {
		const root = tmp();
		hush();
		try {
			const { folder, reviews } = seedTaskFolder(root, "TP-RA");
			writeReview(reviews, `R001-${GATE}.md`, "REVISE");
			const result = collectDoneTaskIdsForResume(makeState("TP-RA", folder), root);
			assert.equal(result.has("TP-RA"), false);
			assert.ok(
				warnings.some((w) => w.includes("TP-RA") && w.includes("refused by completion authority")),
				"expected a completion-authority refusal warning",
			);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it(".DONE + APPROVE (unlinked) → collected", () => {
		const root = tmp();
		hush();
		try {
			const { folder, reviews } = seedTaskFolder(root, "TP-RB");
			writeReview(reviews, `R001-${GATE}.md`, "APPROVE");
			const result = collectDoneTaskIdsForResume(makeState("TP-RB", folder), root);
			assert.equal(result.has("TP-RB"), true);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it(".DONE + linked APPROVE with a missing ratification record → NOT collected", () => {
		const root = tmp();
		hush();
		try {
			const { folder, reviews } = seedTaskFolder(root, "TP-RC");
			writeReview(reviews, `R002-${GATE}.md`, "APPROVE", "\nRatification: ratif-nope\n");
			const result = collectDoneTaskIdsForResume(makeState("TP-RC", folder), root);
			assert.equal(result.has("TP-RC"), false);
			assert.ok(
				warnings.some(
					(w) => w.includes("TP-RC") && w.includes("ratification") && w.includes("ratif-nope"),
				),
				"expected a ratification refusal warning",
			);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});
});
