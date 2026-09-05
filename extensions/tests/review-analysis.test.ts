/**
 * Review-analysis pure-helper tests — review-boundary notifications (Stage 3).
 *
 * parseFindingCounts / computeFindingTrend / parseReviewLabelFromPath are the
 * deterministic foundation for spiral-vs-converging adjudication. Sage flagged
 * these for first-class tests, especially mixed-delta trends and unknown-label
 * bucketing (never silently dropped).
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/review-analysis.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import {
	parseFindingCounts,
	computeFindingTrend,
	parseReviewLabelFromPath,
	parseReviewVerdict,
	latestReviewFilesPerGate,
	advanceReviewStreak,
	reconstructReviewStreaks,
	freshReviewStreakState,
	shouldFireSpiral,
	shouldFireOrderViolation,
	sanitizeSpiralConfig,
	OTHER_SEVERITY_BUCKET,
} from "../taskplane/review-analysis.ts";

const SPIRAL = { enabled: true, threshold: 3, cooldownReviews: 2 };
const adv = (
	state: ReturnType<typeof freshReviewStreakState>,
	disposition: string,
	counts: Record<string, number> | null = null,
) =>
	advanceReviewStreak(state, {
		disposition: disposition as never,
		counts,
		treatUnavailableAsNonApprove: false,
		recentCap: 6,
	});

const CORE = ["critical", "important", "minor"];

describe("review-analysis — parseFindingCounts", () => {
	it("counts code-review Issues Found by severity", () => {
		const md = `## Code Review: Step 4
### Verdict: REVISE
### Summary
Some summary.
### Issues Found
1. **[src/a.ts:10]** critical — null deref
2. **[src/b.ts:22]** important — missing test
3. **[src/c.ts:5]** minor — nit
4. **[src/d.ts:9]** important — edge case
### Pattern Violations
- none
`;
		expect(parseFindingCounts(md, CORE)).toEqual({ critical: 1, important: 2, minor: 1 });
	});

	it("counts plan-review '[Severity: X]' format", () => {
		const md = `### Issues Found
1. **[Severity: critical]** — broken approach
2. **[Severity: minor]** — naming
`;
		expect(parseFindingCounts(md, CORE)).toEqual({ critical: 1, minor: 1 });
	});

	it("supports a project-custom severity vocabulary (e.g. P0/P1/P2)", () => {
		const md = `### Issues Found
1. **[src/x:1]** P0 — data loss
2. **[src/y:2]** P2 — style
3. **[src/z:3]** P0 — crash
`;
		expect(parseFindingCounts(md, ["P0", "P1", "P2"])).toEqual({ P0: 2, P2: 1 });
	});

	it("buckets unknown-severity findings under 'other' (never silently dropped)", () => {
		const md = `### Issues Found
1. **[src/a:1]** critical — x
2. **[src/b:2]** wat — mystery severity
3. some finding with no severity tag at all
`;
		expect(parseFindingCounts(md, CORE)).toEqual({ critical: 1, [OTHER_SEVERITY_BUCKET]: 2 });
	});

	it("charges a line naming two labels to the higher severity (order-first)", () => {
		const md = `### Issues Found
1. **[src/a:1]** critical — also has a minor follow-up
`;
		expect(parseFindingCounts(md, CORE)).toEqual({ critical: 1 });
	});

	it("returns {} for a missing Issues Found section", () => {
		const md = `### Verdict: APPROVE
### Summary
Looks good.
`;
		expect(parseFindingCounts(md, CORE)).toEqual({});
	});

	it("stops at the next heading (doesn't count later sections)", () => {
		const md = `### Issues Found
1. **[a:1]** critical — x
### Suggestions
1. maybe rename critical_path variable
`;
		expect(parseFindingCounts(md, CORE)).toEqual({ critical: 1 });
	});

	it("is non-throwing on nullish/empty input", () => {
		expect(parseFindingCounts(null, CORE)).toEqual({});
		expect(parseFindingCounts(undefined, CORE)).toEqual({});
		expect(parseFindingCounts("", CORE)).toEqual({});
	});
});

describe("review-analysis — computeFindingTrend", () => {
	it("flat with no prior baseline", () => {
		const r = computeFindingTrend(null, { critical: 2 }, CORE);
		expect(r.trend).toBe("flat");
		expect(r.mixed).toBe(false);
	});

	it("dropping when the highest-severity count decreases", () => {
		const r = computeFindingTrend({ critical: 2, minor: 1 }, { critical: 1, minor: 1 }, CORE);
		expect(r.trend).toBe("dropping");
		expect(r.deltas.critical).toBe(-1);
		expect(r.mixed).toBe(false);
	});

	it("rising when the highest-severity count increases", () => {
		const r = computeFindingTrend({ critical: 1 }, { critical: 2 }, CORE);
		expect(r.trend).toBe("rising");
	});

	it("flat when nothing changed", () => {
		const r = computeFindingTrend({ critical: 1, minor: 2 }, { critical: 1, minor: 2 }, CORE);
		expect(r.trend).toBe("flat");
		expect(r.mixed).toBe(false);
	});

	it("mixed: criticals drop but minors rise → dropping (lexicographic) + mixed flag", () => {
		// The core spiral-vs-converging call: high severity improving is "let it run",
		// but the churn at low severity is surfaced via mixed.
		const r = computeFindingTrend({ critical: 3, minor: 1 }, { critical: 1, minor: 5 }, CORE);
		expect(r.trend).toBe("dropping");
		expect(r.mixed).toBe(true);
		expect(r.deltas.critical).toBe(-2);
		expect(r.deltas.minor).toBe(4);
	});

	it("mixed: criticals rise but minors drop → rising (highest severity wins)", () => {
		const r = computeFindingTrend({ critical: 1, minor: 5 }, { critical: 3, minor: 1 }, CORE);
		expect(r.trend).toBe("rising");
		expect(r.mixed).toBe(true);
	});

	it("skips unchanged high severity and decides on the next changed label", () => {
		const r = computeFindingTrend({ critical: 2, important: 3 }, { critical: 2, important: 1 }, CORE);
		expect(r.trend).toBe("dropping");
	});

	it("tracks the 'other' bucket in deltas", () => {
		const r = computeFindingTrend({ critical: 1 }, { critical: 1, other: 2 }, CORE);
		expect(r.deltas[OTHER_SEVERITY_BUCKET]).toBe(2);
		expect(r.trend).toBe("rising"); // only 'other' changed, upward
	});
});

describe("review-analysis — advanceReviewStreak", () => {
	it("increments round every boundary and the streak on REVISE/RETHINK", () => {
		const s = freshReviewStreakState();
		adv(s, "REVISE");
		adv(s, "RETHINK");
		expect(s.round).toBe(2);
		expect(s.consecutiveNonApprove).toBe(2);
	});

	it("resets the streak on APPROVE (round still advances)", () => {
		const s = freshReviewStreakState();
		adv(s, "REVISE");
		adv(s, "REVISE");
		adv(s, "APPROVE");
		expect(s.consecutiveNonApprove).toBe(0);
		expect(s.round).toBe(3);
	});

	it("REFUSED advances round but does NOT touch the streak", () => {
		const s = freshReviewStreakState();
		adv(s, "REVISE");
		adv(s, "REFUSED");
		expect(s.consecutiveNonApprove).toBe(1);
		expect(s.round).toBe(2);
	});

	it("UNAVAILABLE does not count by default; UNKNOWN never counts", () => {
		const s = freshReviewStreakState();
		adv(s, "UNAVAILABLE");
		adv(s, "UNKNOWN");
		expect(s.consecutiveNonApprove).toBe(0);
		expect(s.round).toBe(2);
	});

	it("UNAVAILABLE counts when treatUnavailableAsNonApprove is true", () => {
		const s = freshReviewStreakState();
		advanceReviewStreak(s, {
			disposition: "UNAVAILABLE",
			counts: null,
			treatUnavailableAsNonApprove: true,
			recentCap: 6,
		});
		expect(s.consecutiveNonApprove).toBe(1);
	});

	it("advances lastCounts only when counts are present, and bounds recentDispositions", () => {
		const s = freshReviewStreakState();
		adv(s, "REVISE", { critical: 2 });
		adv(s, "REVISE", null); // no counts → lastCounts unchanged
		expect(s.lastCounts).toEqual({ critical: 2 });
		for (let i = 0; i < 10; i++) adv(s, "REVISE");
		expect(s.recentDispositions.length).toBe(6); // capped
	});
});

describe("review-analysis — reconstructReviewStreaks (resume)", () => {
	it("replays per-step history so an in-progress spiral survives resume", () => {
		const events = [
			{ reviewStep: 4, disposition: "REVISE", findingCounts: { critical: 2 } },
			{ reviewStep: 4, disposition: "REVISE", findingCounts: { critical: 2 } },
			{ reviewStep: 2, disposition: "APPROVE" },
			{ reviewStep: 4, disposition: "RETHINK", findingCounts: { critical: 3 } },
		];
		const m = reconstructReviewStreaks(events, { treatUnavailableAsNonApprove: false, recentCap: 6 });
		expect(m.get("4")?.consecutiveNonApprove).toBe(3);
		expect(m.get("4")?.round).toBe(3);
		expect(m.get("4")?.lastCounts).toEqual({ critical: 3 });
		expect(m.get("2")?.consecutiveNonApprove).toBe(0);
	});

	it("ignores events without a numeric reviewStep", () => {
		const m = reconstructReviewStreaks([{ disposition: "REVISE" }], {
			treatUnavailableAsNonApprove: false,
			recentCap: 6,
		});
		expect(m.size).toBe(0);
	});
});

describe("review-analysis — shouldFireSpiral / shouldFireOrderViolation", () => {
	it("does not fire below threshold", () => {
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 2, round: 2, lastEscalationRound: null },
				SPIRAL,
				"flat",
			),
		).toBe(false);
	});

	it("fires on the first threshold crossing", () => {
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 3, round: 3, lastEscalationRound: null },
				SPIRAL,
				"flat",
			),
		).toBe(true);
	});

	it("does NOT re-fire while converging (trend dropping), even past cooldown", () => {
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 5, round: 6, lastEscalationRound: 3 },
				SPIRAL,
				"dropping",
			),
		).toBe(false);
	});

	it("re-fires when NOT converging and cooldown elapsed", () => {
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 5, round: 6, lastEscalationRound: 3 },
				SPIRAL,
				"rising",
			),
		).toBe(true);
		expect(
			shouldFireSpiral({ consecutiveNonApprove: 5, round: 5, lastEscalationRound: 3 }, SPIRAL, "flat"),
		).toBe(true);
	});

	it("suppresses re-fire within the cooldown window", () => {
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 5, round: 4, lastEscalationRound: 3 },
				SPIRAL,
				"rising",
			),
		).toBe(false);
	});

	it("respects enabled=false", () => {
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 9, round: 9, lastEscalationRound: null },
				{ ...SPIRAL, enabled: false },
				"rising",
			),
		).toBe(false);
	});

	it("order-violation fires first time, then throttles by cooldown", () => {
		expect(shouldFireOrderViolation({ round: 1, lastRefusedRound: null }, SPIRAL)).toBe(true);
		expect(shouldFireOrderViolation({ round: 2, lastRefusedRound: 1 }, SPIRAL)).toBe(false);
		expect(shouldFireOrderViolation({ round: 3, lastRefusedRound: 1 }, SPIRAL)).toBe(true);
	});

	it("enabled=false disables BOTH spiral and order-violation escalations", () => {
		const off = { ...SPIRAL, enabled: false };
		expect(shouldFireOrderViolation({ round: 1, lastRefusedRound: null }, off)).toBe(false);
		expect(
			shouldFireSpiral(
				{ consecutiveNonApprove: 9, round: 9, lastEscalationRound: null },
				off,
				"rising",
			),
		).toBe(false);
	});
});

describe("review-analysis — sanitizeSpiralConfig", () => {
	it("fills defaults when absent", () => {
		expect(sanitizeSpiralConfig(undefined)).toEqual({
			enabled: true,
			threshold: 3,
			cooldownReviews: 2,
			treatUnavailableAsNonApprove: false,
		});
	});

	it("clamps zero/negative threshold + cooldown to safe defaults (no escalate-every-review)", () => {
		const r = sanitizeSpiralConfig({ threshold: 0, cooldownReviews: -5 });
		expect(r.threshold).toBe(3);
		expect(r.cooldownReviews).toBe(2);
	});

	it("honors valid overrides and floors fractional values", () => {
		const r = sanitizeSpiralConfig({
			threshold: 5,
			cooldownReviews: 4,
			treatUnavailableAsNonApprove: true,
		});
		expect(r).toEqual({
			enabled: true,
			threshold: 5,
			cooldownReviews: 4,
			treatUnavailableAsNonApprove: true,
		});
		expect(sanitizeSpiralConfig({ threshold: 2.9 }).threshold).toBe(2);
	});

	it("only explicit false disables", () => {
		expect(sanitizeSpiralConfig({ enabled: false }).enabled).toBe(false);
		// Absent enabled (e.g. partial config) defaults to true.
		expect(sanitizeSpiralConfig({ threshold: 4 }).enabled).toBe(true);
	});
});

describe("review-analysis — parseReviewVerdict (#624 authoritative file verdict)", () => {
	it("parses ## Verdict and ### Verdict headings, case-insensitively", () => {
		expect(parseReviewVerdict("## Verdict: REVISE\n### Summary\n…")).toBe("REVISE");
		expect(parseReviewVerdict("### Verdict: APPROVE")).toBe("APPROVE");
		expect(parseReviewVerdict("#### Verdict: RETHINK — reconsider")).toBe("RETHINK");
		expect(parseReviewVerdict("## verdict: revise")).toBe("REVISE");
	});

	it("tolerates the [APPROVE | REVISE | RETHINK] template placeholder being replaced", () => {
		const md =
			"## Code Review: Step 1\n\n### Verdict: REVISE\n\n### Issues Found\n1. **[a:1]** critical — x\n";
		expect(parseReviewVerdict(md)).toBe("REVISE");
	});

	it("returns undefined when no verdict heading is present (empty/aborted review)", () => {
		expect(parseReviewVerdict("just some prose, no verdict")).toBe(undefined);
		expect(parseReviewVerdict("")).toBe(undefined);
		expect(parseReviewVerdict(null)).toBe(undefined);
		expect(parseReviewVerdict(undefined)).toBe(undefined);
	});

	// ── #624 severity upgrade: reviewer format variants (workers advanced past
	// REVISE because the old parser missed these and fell back approve-biased) ──

	it("parses bold, plain, dash, and bracket verdict formats", () => {
		expect(parseReviewVerdict("**Verdict:** REVISE\nbody")).toBe("REVISE");
		expect(parseReviewVerdict("Verdict: APPROVE")).toBe("APPROVE");
		expect(parseReviewVerdict("## Verdict — RETHINK")).toBe("RETHINK");
		expect(parseReviewVerdict("### Verdict - REVISE")).toBe("REVISE");
		expect(parseReviewVerdict("## Verdict: [REVISE]")).toBe("REVISE");
		expect(parseReviewVerdict("## Verdict: **APPROVE**")).toBe("APPROVE");
	});

	it("parses a verdict on the line after a bare Verdict heading", () => {
		expect(parseReviewVerdict("## Verdict\nREVISE: needs the null check fixed")).toBe("REVISE");
		expect(parseReviewVerdict("## Verdict\n\n  APPROVE")).toBe("APPROVE");
	});

	it("skips the template placeholder and finds the real verdict later", () => {
		const md = "### Verdict: [APPROVE | REVISE | RETHINK]\n\n## Verdict: REVISE\n";
		expect(parseReviewVerdict(md)).toBe("REVISE");
		// A placeholder alone is NOT a verdict.
		expect(parseReviewVerdict("### Verdict: [APPROVE | REVISE | RETHINK]")).toBe(undefined);
	});

	it("does not misread criteria prose as a verdict", () => {
		expect(parseReviewVerdict("Verdict criteria: APPROVE means the step passes")).toBe(undefined);
	});

	it("TP-2022 regression class: variant-format REVISE with 'approve' in the body is REVISE, never APPROVE", () => {
		const md = [
			"## Code Review: Step 1",
			"",
			"**Verdict:** REVISE",
			"",
			"### Summary",
			"I cannot approve this yet — the trusted coordinate is forgeable and the",
			"resolver claims Key Vault custody it does not have. Approval is blocked",
			"until the P1 findings below are addressed.",
			"",
			"### Issues Found",
			"1. **[src/coord.ts:42]** P1 — forgeable trusted coordinate",
		].join("\n");
		expect(parseReviewVerdict(md)).toBe("REVISE");
	});
});

describe("review-analysis — latestReviewFilesPerGate (#626 finalize gate)", () => {
	it("returns the highest R-number file per (type, step) gate", () => {
		const m = latestReviewFilesPerGate([
			"R001-plan-step1.md",
			"R002-code-step1.md",
			"R003-code-step1.md",
			"R004-code-step5.md",
			"R005-code-step1.md",
		]);
		expect(m.get("plan-step1")).toBe("R001-plan-step1.md");
		expect(m.get("code-step1")).toBe("R005-code-step1.md");
		expect(m.get("code-step5")).toBe("R004-code-step5.md");
		expect(m.size).toBe(3);
	});

	it("ignores non-review filenames and is case-tolerant", () => {
		const m = latestReviewFilesPerGate(["notes.md", ".gitkeep", "R010-CODE-step2.md"]);
		expect(m.get("code-step2")).toBe("R010-CODE-step2.md");
		expect(m.size).toBe(1);
	});

	it("TP-2037 scenario: latest code gate REVISE is identified as the blocking file", () => {
		// R004-code-step5 was the outstanding REVISE that merged anyway.
		const m = latestReviewFilesPerGate([
			"R001-plan-step1.md",
			"R002-code-step5.md",
			"R003-code-step5.md",
			"R004-code-step5.md",
		]);
		expect(m.get("code-step5")).toBe("R004-code-step5.md");
	});
});

describe("review-analysis — parseReviewLabelFromPath", () => {
	it("extracts the R{NNN}-{type}-step{N} label", () => {
		expect(parseReviewLabelFromPath(".reviews/R008-code-step4.md")).toBe("R008-code-step4");
		expect(parseReviewLabelFromPath("/abs/path/.reviews/R012-plan-step2.md")).toBe("R012-plan-step2");
		expect(parseReviewLabelFromPath("C:\\proj\\.reviews\\R003-code-step1.md")).toBe(
			"R003-code-step1",
		);
	});

	it("returns undefined for non-matching or nullish paths", () => {
		expect(parseReviewLabelFromPath("notes.md")).toBe(undefined);
		expect(parseReviewLabelFromPath("")).toBe(undefined);
		expect(parseReviewLabelFromPath(null)).toBe(undefined);
		expect(parseReviewLabelFromPath(undefined)).toBe(undefined);
	});
});
