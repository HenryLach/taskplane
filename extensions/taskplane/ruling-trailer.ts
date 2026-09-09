/**
 * ruling-trailer.ts — commit-message ruling citation validation (#627 Stage 2b).
 *
 * A worker that is held may only cite the ruling that released it via a
 * STRUCTURED trailer:
 *
 *     Taskplane-Ruling: <ruling id>[, <ruling id>…]
 *
 * The runtime validates every citation against the durable hold table. A
 * citation is trustworthy ONLY when some hold that BINDS THIS UNIT carries a
 * ruling with that id. Anything else — an unknown id, an id whose hold belongs
 * to another unit, or a prose claim of a ruling with no trailer — is FLAGGED
 * (surfaced to the supervisor + written to the audit trail) and NEVER treated
 * as approval. A ruling releases execution; it does not approve work.
 *
 * These functions are pure (no fs / git): the lane-runner feeds them the commit
 * message text and the current holds.
 */

import { type HoldRecord, holdsForUnit } from "./hold-state.ts";

export interface RulingCitations {
	/** Ids cited via the `Taskplane-Ruling:` trailer (comma-split, trimmed). */
	trailerIds: string[];
	/** Lines that claim a ruling in prose (outside a trailer) — the raw line text. */
	proseClaims: string[];
}

export interface RulingCitationFlag {
	kind: "unknown-ruling" | "wrong-unit" | "prose-claim";
	/** The offending ruling id (unknown/wrong-unit) or the prose line (prose-claim). */
	ref: string;
	reason: string;
}

/** `Taskplane-Ruling: id[, id…]` — case-insensitive, leading whitespace tolerated. */
const TRAILER_RE = /^[ \t]*Taskplane-Ruling:[ \t]*(.+?)[ \t]*$/i;
/** A prose mention of a (cap) ruling — the candidate pattern outside a trailer. */
const PROSE_RE = /\b(?:(?:cap )?ruling|ruled)\b/i;
/**
 * A prose mention is a CLAIM only when it asserts a ruling was received/applied:
 * an `R###` review reference, a verdict token, or "per / applied / implemented /
 * as ruled / ruling (FIX)" language. Hold BOOKKEEPING ("pending operator
 * ruling", "awaiting a ruling", "requesting a ruling", "hold … ruling") is not
 * a claim — penster 20260909T000015 flagged `hold(TP-1919): record HARD HOLD on
 * Step 2 pending operator ruling` as a false positive.
 */
const CLAIM_RE =
	/\bR\d{3}\b|\((?:FIX|ACCEPT|REJECT|APPROVE)\)|\b(?:per|apply|applied|applies|applying|implement|implemented|implementing|follow|following|honou?r|honou?ring)\b[^.\n]{0,40}\bruling\b|\bruling\b[^.\n]{0,40}\b(?:applied|implemented|received|says|said)\b|\bas ruled\b/i;
const BOOKKEEPING_RE =
	/\b(?:pending|awaiting|await|requesting|requested|request|need(?:s|ed)?|hold|held|holding|until|before|without|no)\b[^.\n]{0,40}\bruling\b/i;

/** Is this non-trailer line an affirmative ruling claim (vs. hold bookkeeping)? */
export function isProseRulingClaim(line: string): boolean {
	if (!PROSE_RE.test(line)) return false;
	if (BOOKKEEPING_RE.test(line) && !/\bR\d{3}\b|\((?:FIX|ACCEPT|REJECT|APPROVE)\)/i.test(line)) {
		return false;
	}
	return CLAIM_RE.test(line);
}

/**
 * Split a commit message into structured trailer citations and prose ruling
 * claims. A trailer line is never also counted as a prose claim (the literal
 * `Taskplane-Ruling` header contains the word "Ruling").
 */
export function parseRulingCitations(commitMessage: string | null | undefined): RulingCitations {
	const trailerIds: string[] = [];
	const proseClaims: string[] = [];
	const lines = (commitMessage ?? "").replace(/\r\n/g, "\n").split("\n");
	for (const line of lines) {
		const m = TRAILER_RE.exec(line);
		if (m) {
			for (const id of m[1]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)) {
				trailerIds.push(id);
			}
			continue; // trailer line — not a prose claim
		}
		if (isProseRulingClaim(line)) {
			proseClaims.push(line.trim());
		}
	}
	return { trailerIds, proseClaims };
}

/**
 * Validate parsed citations against the durable holds. A trailer id is valid
 * only when a hold BINDING this unit carries a ruling with that id; otherwise
 * it is flagged `wrong-unit` (the id exists on another unit's hold) or
 * `unknown-ruling` (no hold carries it at all). Every prose claim is flagged.
 * Returns a (possibly empty) list of flags — flags are diagnostics, never
 * approvals.
 */
export function validateRulingCitations(
	citations: RulingCitations,
	holds: readonly HoldRecord[],
	unit: { taskId: string; segmentId: string | null },
): RulingCitationFlag[] {
	const flags: RulingCitationFlag[] = [];
	const unitLabel = unit.segmentId ? `${unit.taskId}::${unit.segmentId}` : unit.taskId;

	// Ruling ids on holds that bind THIS unit (the only trustworthy citations).
	const unitRulingIds = new Set(
		holdsForUnit(holds, unit.taskId, unit.segmentId)
			.map((h) => h.ruling?.id)
			.filter((id): id is string => typeof id === "string"),
	);
	// Ruling ids on ANY hold — used to distinguish "wrong unit" from "unknown".
	const allRulingIds = new Set(
		holds.map((h) => h.ruling?.id).filter((id): id is string => typeof id === "string"),
	);

	for (const id of citations.trailerIds) {
		if (unitRulingIds.has(id)) continue; // valid citation
		if (allRulingIds.has(id)) {
			flags.push({
				kind: "wrong-unit",
				ref: id,
				reason: `ruling ${id} is carried by a hold of another unit, not ${unitLabel}`,
			});
		} else {
			flags.push({
				kind: "unknown-ruling",
				ref: id,
				reason: `no hold carries ruling ${id}`,
			});
		}
	}

	for (const claim of citations.proseClaims) {
		flags.push({
			kind: "prose-claim",
			ref: claim,
			reason: `commit claims a ruling in prose (cite rulings only via the Taskplane-Ruling trailer): "${claim}"`,
		});
	}

	return flags;
}
