/**
 * Review-analysis pure helpers — review-boundary supervisor notifications (Stage 3).
 *
 * These functions turn a reviewer's on-disk review markdown into the structured
 * signals the supervisor uses to distinguish a converging review loop from a
 * revision spiral: severity-bucketed finding counts, a converging-vs-circling
 * trend, and the review round label.
 *
 * DESIGN: strictly pure and dependency-free (no Pi, no fs, no execution/engine
 * imports) so they are trivially unit-testable and cannot introduce an import
 * cycle. The severity vocabulary is CONFIGURABLE (never hardcoded): core ships
 * ["critical","important","minor"], but a project whose reviewer emits e.g.
 * P0/P1/P2 supplies its own ordered list. Any finding whose severity matches no
 * configured label is bucketed under "other" so counts are never silently lost.
 *
 * @module taskplane/review-analysis
 */

import type { ReviewDisposition } from "./types.ts";

/** Sentinel bucket for findings whose severity matches no configured label. */
export const OTHER_SEVERITY_BUCKET = "other";

/** Coarse converging-vs-circling signal for a step's latest review vs the prior. */
export type FindingTrend = "dropping" | "flat" | "rising";

/** Result of comparing two rounds' finding counts. */
export interface FindingTrendResult {
	/**
	 * Lexicographic trend by severity order: the direction of the HIGHEST-severity
	 * label whose count changed. "dropping" = converging (let it run); "rising" =
	 * getting worse; "flat" = no change (or no prior baseline).
	 */
	trend: FindingTrend;
	/** Per-label delta (curr - prev), including OTHER_SEVERITY_BUCKET; 0 when unchanged. */
	deltas: Record<string, number>;
	/** True when some labels rose while others dropped (opposing movement). */
	mixed: boolean;
}

/**
 * Count review findings by severity from review markdown.
 *
 * Handles both shipped reviewer formats:
 *   - code:  `1. **[File:Line]** [Severity] — ...`
 *   - plan:  `1. **[Severity: critical/important/minor]** — ...`
 * plus project-custom severity vocabularies. Only findings inside the
 * `### Issues Found` section are counted; a missing section yields an empty map.
 *
 * Best-effort and NON-THROWING: malformed input yields the best partial count
 * it can (never throws), so a parse hiccup can't break the worker run.
 *
 * @param markdown       Raw review file contents.
 * @param severityLabels Ordered severity vocabulary (highest severity first).
 * @returns Map of severity label -> count for labels with >0 findings, plus an
 *          `other` bucket for unrecognized-severity findings when any exist.
 */
export function parseFindingCounts(
	markdown: string | undefined | null,
	severityLabels: string[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	if (!markdown || typeof markdown !== "string") return counts;
	const labels = severityLabels.filter((l) => typeof l === "string" && l.trim().length > 0);

	// Isolate the "Issues Found" section: from its heading to the next heading
	// (### or ##) or end of file. Case-insensitive on the heading text.
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	let inSection = false;
	const sectionLines: string[] = [];
	const issuesHeadingRe = /^#{2,4}\s+Issues\s+Found\b/i;
	const anyHeadingRe = /^#{2,4}\s+\S/;
	for (const line of lines) {
		if (!inSection) {
			if (issuesHeadingRe.test(line)) inSection = true;
			continue;
		}
		if (anyHeadingRe.test(line)) break; // next section
		sectionLines.push(line);
	}
	if (sectionLines.length === 0) return counts;

	// A finding entry is a list item: "1. ..." / "2) ..." / "- ..." / "* ...".
	const entryRe = /^\s*(?:\d+[.)]|[-*])\s+/;
	// Precompile per-label word-boundary matchers (case-insensitive).
	const labelMatchers = labels.map((label) => ({
		label,
		re: new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
	}));

	const bump = (bucket: string) => {
		counts[bucket] = (counts[bucket] ?? 0) + 1;
	};

	for (const raw of sectionLines) {
		if (!entryRe.test(raw)) continue; // not a finding line (blank, prose, etc.)
		// Assign the entry to the FIRST configured label (highest severity first)
		// that appears in the line; else the OTHER bucket. Taking highest-first
		// means a line mentioning two labels is charged to the more severe one.
		let assigned = false;
		for (const { label, re } of labelMatchers) {
			if (re.test(raw)) {
				bump(label);
				assigned = true;
				break;
			}
		}
		if (!assigned) bump(OTHER_SEVERITY_BUCKET);
	}

	return counts;
}

/**
 * Compare two rounds' finding counts into a converging-vs-circling trend.
 *
 * Uses a LEXICOGRAPHIC rule over the severity order (highest first): the coarse
 * `trend` is the direction of the highest-severity label whose count changed.
 * This matches human triage ("did the criticals go down?") and correctly reads
 * "criticals down, minors up" as `dropping` (converging at the severity that
 * matters) while still flagging `mixed: true` for nuance.
 *
 * @param prev           Prior round's counts, or null on the first review.
 * @param curr           Current round's counts.
 * @param severityLabels Ordered severity vocabulary (highest severity first).
 */
export function computeFindingTrend(
	prev: Record<string, number> | null | undefined,
	curr: Record<string, number>,
	severityLabels: string[],
): FindingTrendResult {
	const labels = [
		...severityLabels.filter((l) => typeof l === "string" && l.trim().length > 0),
		OTHER_SEVERITY_BUCKET,
	];
	const deltas: Record<string, number> = {};
	let anyUp = false;
	let anyDown = false;
	for (const label of labels) {
		const p = prev?.[label] ?? 0;
		const c = curr?.[label] ?? 0;
		const d = c - p;
		deltas[label] = d;
		if (d > 0) anyUp = true;
		if (d < 0) anyDown = true;
	}

	// No prior baseline → nothing to compare; report flat.
	if (!prev) {
		return { trend: "flat", deltas, mixed: false };
	}

	// Lexicographic: first (highest-severity) label with a non-zero delta decides.
	let trend: FindingTrend = "flat";
	for (const label of labels) {
		const d = deltas[label];
		if (d !== 0) {
			trend = d < 0 ? "dropping" : "rising";
			break;
		}
	}
	return { trend, deltas, mixed: anyUp && anyDown };
}

/**
 * Per-step review streak state (the spiral-detection core). This is the SHARED
 * transition model used both live (lane-runner) and during resume
 * reconstruction, so the two can never drift.
 */
export interface ReviewStreakState {
	/** Consecutive REVISE/RETHINK reviews on this step (reset on APPROVE). */
	consecutiveNonApprove: number;
	/** Count of verdict/attempt reviews seen for this step (the review round). */
	round: number;
	/** Finding counts from the previous round (for trend), or null. */
	lastCounts: Record<string, number> | null;
	/** Recent dispositions (oldest→newest, bounded). */
	recentDispositions: ReviewDisposition[];
}

/** A fresh, zeroed streak state. */
export function freshReviewStreakState(): ReviewStreakState {
	return { consecutiveNonApprove: 0, round: 0, lastCounts: null, recentDispositions: [] };
}

/**
 * Apply ONE review-boundary outcome to a step's streak state (mutates it). This
 * is the single source of truth for the counter transitions:
 *   - every END boundary increments `round`;
 *   - APPROVE resets the consecutive streak to 0;
 *   - REVISE/RETHINK (and UNAVAILABLE iff `treatUnavailableAsNonApprove`)
 *     increment the streak;
 *   - REFUSED / UNAVAILABLE / UNKNOWN otherwise leave the streak unchanged
 *     (orthogonal or non-verdict outcomes);
 *   - `lastCounts` advances only when this round produced finding counts;
 *   - `recentDispositions` is appended (bounded by `recentCap`).
 *
 * Escalation/cooldown decisions are intentionally NOT here — they are live-only
 * side effects layered on top by the caller.
 */
export function advanceReviewStreak(
	state: ReviewStreakState,
	opts: {
		disposition: ReviewDisposition | undefined;
		counts: Record<string, number> | null;
		treatUnavailableAsNonApprove: boolean;
		recentCap: number;
	},
): void {
	state.round += 1;
	if (opts.counts && Object.keys(opts.counts).length > 0) {
		state.lastCounts = opts.counts;
	}
	if (opts.disposition) {
		state.recentDispositions.push(opts.disposition);
		while (state.recentDispositions.length > opts.recentCap) state.recentDispositions.shift();
	}
	if (opts.disposition === "APPROVE") {
		state.consecutiveNonApprove = 0;
	} else if (
		opts.disposition === "REVISE" ||
		opts.disposition === "RETHINK" ||
		(opts.disposition === "UNAVAILABLE" && opts.treatUnavailableAsNonApprove)
	) {
		state.consecutiveNonApprove += 1;
	}
	// REFUSED / UNAVAILABLE (uncounted) / UNKNOWN: no streak change.
}

/**
 * Rebuild per-step streak state by replaying a task's historical review
 * boundaries (from events.jsonl) on resume — "maintain the truth" rather than
 * resetting counters to zero. Uses {@link advanceReviewStreak} so reconstruction
 * and the live path share identical transition semantics.
 *
 * @param events Ordered review END boundaries for ONE task: `{ reviewStep,
 *               disposition, findingCounts }` (review_completed / review_failed).
 * @returns Map keyed by `stepNum` string.
 */
export function reconstructReviewStreaks(
	events: Array<{
		reviewStep?: number;
		disposition?: ReviewDisposition | string;
		findingCounts?: Record<string, number> | null;
	}>,
	opts: { treatUnavailableAsNonApprove: boolean; recentCap: number },
): Map<string, ReviewStreakState> {
	const byStep = new Map<string, ReviewStreakState>();
	for (const e of events) {
		if (typeof e.reviewStep !== "number") continue;
		const key = String(e.reviewStep);
		let st = byStep.get(key);
		if (!st) {
			st = freshReviewStreakState();
			byStep.set(key, st);
		}
		advanceReviewStreak(st, {
			disposition: e.disposition as ReviewDisposition | undefined,
			counts: e.findingCounts ?? null,
			treatUnavailableAsNonApprove: opts.treatUnavailableAsNonApprove,
			recentCap: opts.recentCap,
		});
	}
	return byStep;
}

/** Tuning inputs for the spiral escalation decision. */
export interface SpiralGateConfig {
	enabled: boolean;
	threshold: number;
	cooldownReviews: number;
}

/** Fully-resolved spiral tuning (gate config + counter policy). */
export interface ResolvedSpiralConfig extends SpiralGateConfig {
	treatUnavailableAsNonApprove: boolean;
}

/**
 * Sanitize possibly-partial/malformed spiral config (from JSON env threading)
 * into a safe, fully-populated shape. Clamps `threshold` and `cooldownReviews`
 * to >= 1 (a zero/negative threshold would escalate on every review; a zero
 * cooldown would re-fire every round), and coerces the booleans. Absent →
 * sensible defaults (enabled, threshold 3, cooldown 2, don't count UNAVAILABLE).
 */
export function sanitizeSpiralConfig(
	raw:
		| Partial<{
				enabled: boolean;
				threshold: number;
				cooldownReviews: number;
				treatUnavailableAsNonApprove: boolean;
		  }>
		| null
		| undefined,
): ResolvedSpiralConfig {
	const intOr = (v: unknown, dflt: number): number => {
		const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : dflt;
		return n >= 1 ? n : dflt;
	};
	return {
		enabled: raw?.enabled !== false, // default true; only explicit false disables
		threshold: intOr(raw?.threshold, 3),
		cooldownReviews: intOr(raw?.cooldownReviews, 2),
		treatUnavailableAsNonApprove: raw?.treatUnavailableAsNonApprove === true,
	};
}

/**
 * Decide whether to fire (or re-fire) a revision-spiral escalation.
 *
 * - Never below threshold, or when disabled.
 * - First crossing (no prior escalation this streak) always fires.
 * - Re-fire only when NOT converging (trend is flat/rising, never "dropping")
 *   AND the cooldown spacing has elapsed since the last escalation. The
 *   trend gate is the key anti-nag rule: a converging spiral is left to run.
 *
 * Pure: the caller applies the side effect (fire + set lastEscalationRound).
 */
export function shouldFireSpiral(
	state: { consecutiveNonApprove: number; round: number; lastEscalationRound: number | null },
	cfg: SpiralGateConfig,
	trend: FindingTrend | undefined,
): boolean {
	if (!cfg.enabled) return false;
	if (state.consecutiveNonApprove < cfg.threshold) return false;
	if (state.lastEscalationRound === null) return true; // first escalation this streak
	const converging = trend === "dropping";
	const cooldownElapsed = state.round - state.lastEscalationRound >= cfg.cooldownReviews;
	return !converging && cooldownElapsed;
}

/**
 * Decide whether to fire an order-violation (REFUSED) escalation: actionable on
 * each occurrence, throttled by the cooldown spacing.
 *
 * Pure: the caller applies the side effect (fire + set lastRefusedRound).
 */
export function shouldFireOrderViolation(
	state: { round: number; lastRefusedRound: number | null },
	cfg: SpiralGateConfig,
): boolean {
	if (!cfg.enabled) return false;
	return (
		state.lastRefusedRound === null || state.round - state.lastRefusedRound >= cfg.cooldownReviews
	);
}

/**
 * Parse the reviewer's verdict directly from the review markdown file — the
 * authoritative source of truth (the reviewer always writes
 * `## Verdict: APPROVE|REVISE|RETHINK` to disk). Used by lane-runner to resolve
 * the disposition robustly even when the tool-return extraction upstream is
 * empty/ambiguous (#624). Matches the executor's verdict parser
 * (task-executor-core.ts).
 *
 * Returns the verdict as a {@link ReviewDisposition}, or undefined if no
 * recognizable `Verdict:` heading is present (e.g. an empty/aborted review).
 */
export function parseReviewVerdict(
	markdown: string | undefined | null,
): ReviewDisposition | undefined {
	if (!markdown || typeof markdown !== "string") return undefined;
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	// A verdict line starts with optional heading hashes and/or bold markers, then
	// the word "Verdict". Reviewer LLMs vary the format: '## Verdict: REVISE',
	// '**Verdict:** REVISE', 'Verdict - APPROVE', '#### Verdict — RETHINK',
	// '## Verdict: [REVISE]', or the token on the following line. The old
	// '/#{2,4}\\s*Verdict[:\\s]*(...)/' missed most variants, and the old caller
	// (review_step) fell back to an approve-biased substring scan — flipping
	// REVISE reviews to APPROVE (#624 severity upgrade: workers advanced past
	// REVISE verdicts and nearly shipped unreviewed code).
	const markerRe = /^\s*(?:#{1,4}\s*)?(?:\*{1,2}\s*)?Verdict\b/i;
	const tokenRe = /\b(APPROVE|REVISE|RETHINK)\b/gi;
	// After 'Verdict', only separators/decoration may precede the token — prose
	// like 'Verdict criteria: APPROVE means…' must NOT match.
	const firstTokenRe = /^[\s:\-—–*_[\]]*\b(APPROVE|REVISE|RETHINK)\b/i;

	const resolveFrom = (text: string): ReviewDisposition | undefined => {
		const tokens = [...text.matchAll(tokenRe)].map((t) => t[1].toUpperCase());
		const distinct = new Set(tokens);
		// 2+ distinct verdict words = the template placeholder
		// ('[APPROVE | REVISE | RETHINK]') or criteria prose — not a verdict.
		if (distinct.size !== 1) return undefined;
		const m = text.match(firstTokenRe);
		return m ? (m[1].toUpperCase() as ReviewDisposition) : undefined;
	};

	for (let i = 0; i < lines.length; i++) {
		const marker = lines[i].match(markerRe);
		if (!marker) continue;
		const rest = lines[i].slice((marker.index ?? 0) + marker[0].length);
		const fromLine = resolveFrom(rest);
		if (fromLine) return fromLine;
		// Token may sit on the next non-empty line ('## Verdict\nREVISE').
		if ([...rest.matchAll(tokenRe)].length === 0) {
			for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
				const next = lines[j].trim();
				if (!next) continue;
				const fromNext = resolveFrom(next);
				if (fromNext) return fromNext;
				break; // only the first non-empty line counts
			}
		}
		// Placeholder or prose — keep scanning for a later real verdict line.
	}
	return undefined;
}

/**
 * Group review filenames by gate (`{type}-step{N}`) and return the LATEST
 * (highest R-number) filename per gate. Filenames must follow the
 * `R{NNN}-{type}-step{N}.md` convention; non-matching names are ignored.
 *
 * Used by the #626 minimal finalize gate: a task must not finalize while any
 * gate's latest review verdict is still REVISE/RETHINK — a later re-review
 * (higher R number) with APPROVE clears the gate.
 *
 * Pure: operates on filename strings only.
 */
export function latestReviewFilesPerGate(filenames: string[]): Map<string, string> {
	const latest = new Map<string, { round: number; filename: string }>();
	for (const name of filenames) {
		const m = name.match(/^R(\d+)-([a-z]+)-step(\d+)\.md$/i);
		if (!m) continue;
		const round = Number.parseInt(m[1], 10);
		const gate = `${m[2].toLowerCase()}-step${m[3]}`;
		const existing = latest.get(gate);
		if (!existing || round > existing.round) {
			latest.set(gate, { round, filename: name });
		}
	}
	return new Map([...latest.entries()].map(([gate, v]) => [gate, v.filename]));
}

/**
 * Extract the review round label (e.g. "R008-code-step4") from a review file
 * path like ".reviews/R008-code-step4.md". Returns undefined if the path does
 * not match the expected R{NNN}-{type}-step{N} naming.
 *
 * @param reviewPath Review file path (relative or absolute), or nullish.
 */
export function parseReviewLabelFromPath(
	reviewPath: string | undefined | null,
): string | undefined {
	if (!reviewPath || typeof reviewPath !== "string") return undefined;
	const base = reviewPath.replace(/\\/g, "/").split("/").pop() ?? "";
	const m = base.match(/^(R\d+-[a-z]+-step\d+)\b/i);
	return m ? m[1] : undefined;
}
