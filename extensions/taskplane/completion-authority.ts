/**
 * completion-authority.ts — the single completion predicate (#627 Stage 2b).
 *
 * `authorizeCompletion()` is the one predicate every authoritative completion
 * path consults: the lane-runner's live finalize gate AND resume's `.DONE`
 * acceptance. It composes, in order and reporting ALL blockers (short-circuiting
 * nothing):
 *
 *   1. hold authority        — `evaluateCompletionAuthority` (NEVER skipped)
 *   2. blocking review gates  — latest REVISE/RETHINK per gate
 *   3. ratification validity  — a linked APPROVE whose ratification record is
 *                               missing / invalid / stale / drifted
 *
 * Steps 2–3 are the review-gate check (`findBlockingReviewGates`), which is
 * skipped for non-final segments (a non-final segment has no finalize decision —
 * only the last segment writes `.DONE`) but the hold check is always applied.
 *
 * The review-gate machinery (`BlockingReviewGate`, `RatificationGateCtx`,
 * `evaluateRatificationBlock`, `findBlockingReviewGates`) lives here so the
 * finalize gate and resume share one implementation. `#627 Stage 2a` behaviour
 * is preserved byte-for-byte: this is a relocation, not a rewrite.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evaluateCompletionAuthority, type HoldRecord } from "./hold-state.ts";
import {
	type GateRatification,
	isRatificationStale,
	parseRatificationLink,
	readRatifications,
	validateRatification,
} from "./ratification.ts";
import { latestReviewFilesPerGate, parseReviewVerdict } from "./review-analysis.ts";

export interface BlockingReviewGate {
	/** `{type}-step{N}` gate key */
	gate: string;
	/** Latest review filename for that gate */
	filename: string;
	verdict: "REVISE" | "RETHINK" | "APPROVE";
	/** #627: why an APPROVE gate is blocking (`missing …`, `invalid: <code>`, `stale …`). */
	reason?: string;
}

/**
 * Context needed to validate a ratified APPROVE at the finalize gate. Supplied
 * ONLY at the authoritative finalize decision; the pre-finalize/remediation
 * callers omit it and keep the verdict-only view (an APPROVE — even a ratified
 * one — is never blocking there; the finalize gate does the full check).
 */
export interface RatificationGateCtx {
	holds: readonly HoldRecord[];
	taskId: string;
	segmentId: string | null;
	headRevision: string | null;
	isAncestor: (a: string, b: string) => boolean;
	/**
	 * Working-tree drift probe. `{ ok:false }` when a git probe failed (fail-closed
	 * — refuse); otherwise `dirty` lists uncommitted changes that are NOT
	 * runtime-owned artifacts (source the ratified proof commit does not
	 * represent). Non-empty `dirty` ⇒ drift after ratification, refuse (R004/R005).
	 */
	workingTreeDrift: () => { dirty: string[]; failedProbe: string | null };
}

/**
 * Evaluate the ratification a linked APPROVE claims. Returns a human-readable
 * reason string when the gate MUST block, or null when the ratification is a
 * valid, non-stale authority record. Fail-closed: any read/validation problem
 * is a reason to block.
 */
export function evaluateRatificationBlock(
	reviewsDir: string,
	gate: string,
	linkId: string,
	ctx: RatificationGateCtx,
): string | null {
	let records: GateRatification[];
	try {
		records = readRatifications(reviewsDir);
	} catch (err) {
		return `invalid ratification store: ${err instanceof Error ? err.message : String(err)}`;
	}
	const record = records.find((r) => r.id === linkId);
	if (!record) return `missing record ${linkId}`;
	const v = validateRatification(record, {
		holds: ctx.holds,
		reviewsDir,
		taskId: ctx.taskId,
		segmentId: ctx.segmentId,
		// R003 issue 1: the record must be for THIS gate, not merely a valid record
		// for some other gate that reuses its id.
		gate,
		headRevision: ctx.headRevision,
		// R003 issue 2: at finalize the ratified proof must still BE the current
		// HEAD — code that changed after ratification is not covered by it.
		requireProofHeadMatch: true,
		readFile: (p: string) => readFileSync(p, "utf-8"),
		isAncestor: ctx.isAncestor,
	});
	if (v.ok === false) return `invalid: ${v.code} (${linkId})`;
	let filenames: string[];
	try {
		filenames = readdirSync(reviewsDir);
	} catch {
		filenames = [];
	}
	const stale = isRatificationStale(record, {
		reviewFilenames: filenames,
		readReview: (f: string) => readFileSync(join(reviewsDir, f), "utf-8"),
	});
	if (stale) return `stale (${linkId} is no longer the latest APPROVE for ${gate})`;
	// R004 issue 2: HEAD may equal the proof commit yet the working tree can carry
	// uncommitted source changes that the post-task `git add -A` would sweep into
	// the merge candidate. Bind authority to a clean (source) working tree.
	// R005 issue 2: a failed git probe is fail-closed, never "clean".
	const drift = ctx.workingTreeDrift();
	if (drift.failedProbe) return `working-tree probe failed (${drift.failedProbe})`;
	if (drift.dirty.length > 0) {
		return `working tree changed after ratification: ${drift.dirty.slice(0, 5).join(", ")}${drift.dirty.length > 5 ? " …" : ""}`;
	}
	return null;
}

/**
 * Scan a reviews directory and return every gate that blocks finalization
 * (#626 minimal finalize gate + #627 Stage 2a ratification binding). Unreadable
 * files are never blockers; a scan failure yields an empty list (fail-safe for
 * finalization, which must not be corrupted by an fs hiccup).
 *
 * When `ratifyCtx` is supplied (the authoritative finalize decision only), an
 * APPROVE review that carries a `Ratification:` link is blocking unless the
 * linked record validates and is not stale. An APPROVE with NO link keeps
 * today's behaviour (not blocking — the full coverage gate is #626/#626's
 * follow-up, out of scope here).
 */
export function findBlockingReviewGates(
	reviewsDir: string,
	ratifyCtx?: RatificationGateCtx,
): BlockingReviewGate[] {
	const blocking: BlockingReviewGate[] = [];
	try {
		if (!existsSync(reviewsDir)) return blocking;
		const latest = latestReviewFilesPerGate(readdirSync(reviewsDir));
		for (const [gate, filename] of latest) {
			try {
				const content = readFileSync(join(reviewsDir, filename), "utf-8");
				const verdict = parseReviewVerdict(content);
				if (verdict === "REVISE" || verdict === "RETHINK") {
					blocking.push({ gate, filename, verdict });
					continue;
				}
				if (verdict === "APPROVE" && ratifyCtx) {
					const linkId = parseRatificationLink(content);
					if (!linkId) continue; // unlinked APPROVE — not blocking (#626 follow-up)
					const reason = evaluateRatificationBlock(reviewsDir, gate, linkId, ratifyCtx);
					if (reason) blocking.push({ gate, filename, verdict: "APPROVE", reason });
				}
			} catch {
				/* unreadable review file — not a blocker */
			}
		}
	} catch {
		/* best effort */
	}
	return blocking;
}

// ── authorizeCompletion: the one predicate ────────────────────────────

export interface CompletionBlocker {
	kind: "hold" | "review-gate" | "ratification";
	/** Escalation id (hold) or gate key (review-gate/ratification). */
	ref: string;
	reason: string;
	/**
	 * Raw gate record for `review-gate`/`ratification` kinds. Carried so the
	 * finalize path can reuse `formatBlockingGates` and its `invalid-ratification`
	 * detection unchanged (behaviour-preservation); absent for `hold`.
	 */
	gate?: BlockingReviewGate;
}

export type CompletionDecision =
	| { allowed: true }
	| { allowed: false; blockers: CompletionBlocker[] };

export interface AuthorizeCompletionCtx {
	holds: readonly HoldRecord[];
	taskId: string;
	segmentId: string | null;
	reviewsDir: string;
	/** Worktree HEAD (or null when no worktree exists, e.g. some resume paths). */
	headRevision: string | null;
	isAncestor: (a: string, b: string) => boolean;
	/** The last segment of the unit — only it decides finalization (writes `.DONE`). */
	isFinalSegment: boolean;
	/**
	 * Working-tree drift probe used by the linked-APPROVE ratification check
	 * (R004/R005). Supplied by the live finalize gate; resume omits it and gets a
	 * clean probe (no live worktree drift to bind against). Only consulted when a
	 * linked APPROVE reaches the drift step.
	 */
	workingTreeDrift?: () => { dirty: string[]; failedProbe: string | null };
}

/**
 * The single completion predicate. Combines hold authority, blocking review
 * gates and linked-APPROVE ratification validity. Reports ALL blockers (does not
 * short-circuit). Hold authority is ALWAYS evaluated; the review-gate/ratification
 * checks are skipped for non-final segments (which never finalize).
 */
export function authorizeCompletion(ctx: AuthorizeCompletionCtx): CompletionDecision {
	const blockers: CompletionBlocker[] = [];

	// 1. Hold authority — never skipped.
	const holdAuth = evaluateCompletionAuthority(ctx.holds, ctx.taskId, ctx.segmentId);
	if (holdAuth.blocked) {
		for (const id of holdAuth.escalationIds) {
			blockers.push({ kind: "hold", ref: id, reason: holdAuth.reason });
		}
	}

	// 2 & 3. Review gates + linked-APPROVE ratification — final segment only.
	if (ctx.isFinalSegment) {
		const ratifyCtx: RatificationGateCtx = {
			holds: ctx.holds,
			taskId: ctx.taskId,
			segmentId: ctx.segmentId,
			headRevision: ctx.headRevision,
			isAncestor: ctx.isAncestor,
			workingTreeDrift: ctx.workingTreeDrift ?? (() => ({ dirty: [], failedProbe: null })),
		};
		for (const g of findBlockingReviewGates(ctx.reviewsDir, ratifyCtx)) {
			if (g.verdict === "APPROVE") {
				blockers.push({
					kind: "ratification",
					ref: g.gate,
					reason: g.reason ?? "ratified APPROVE is not trustworthy",
					gate: g,
				});
			} else {
				blockers.push({
					kind: "review-gate",
					ref: g.gate,
					reason: `latest review is ${g.verdict} (${g.filename})`,
					gate: g,
				});
			}
		}
	}

	return blockers.length === 0 ? { allowed: true } : { allowed: false, blockers };
}
