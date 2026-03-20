/**
 * Task-Runner Review Skip Tests — TP-036
 *
 * Tests for the low-risk step detection logic that skips plan and code
 * reviews for Step 0 (Preflight) and the final step (Delivery/Docs).
 *
 * Test categories:
 *   1.x — isLowRiskStep pure function (boundary detection)
 *   2.x — Review level interactions (level 0, 1, 2 with low-risk steps)
 *   3.x — Edge cases (single-step task, two-step task, large step counts)
 *
 * Run: npx vitest run tests/task-runner-review-skip.test.ts
 */

import { describe, it, expect } from "vitest";
import { isLowRiskStep } from "../task-runner.ts";

// ══════════════════════════════════════════════════════════════════════
// 1.x — isLowRiskStep pure function
// ══════════════════════════════════════════════════════════════════════

describe("1.x: isLowRiskStep boundary detection", () => {
	// ── Standard 4-step task (Steps 0, 1, 2, 3) ─────────────────────

	it("1.1: Step 0 in a 4-step task → low-risk (Preflight)", () => {
		expect(isLowRiskStep(0, 4)).toBe(true);
	});

	it("1.2: Step 3 (last) in a 4-step task → low-risk (final step)", () => {
		expect(isLowRiskStep(3, 4)).toBe(true);
	});

	it("1.3: Step 1 in a 4-step task → NOT low-risk (middle step)", () => {
		expect(isLowRiskStep(1, 4)).toBe(false);
	});

	it("1.4: Step 2 in a 4-step task → NOT low-risk (middle step)", () => {
		expect(isLowRiskStep(2, 4)).toBe(false);
	});

	// ── Review level 2 interactions ──────────────────────────────────
	// The review decision logic uses isLowRiskStep to gate BOTH plan
	// and code reviews. Verify that:
	//   - review level ≥ 1: plan review gated by isLowRiskStep
	//   - review level ≥ 2: code review gated by isLowRiskStep
	// Since the gating is: if (reviewLevel >= N) { if (isLowRiskStep) skip; else review; }
	// the pure function test verifies the correct inputs produce the right skip decision.

	it("1.5: Step 0 at review level 2 — both plan and code reviews should skip", () => {
		// isLowRiskStep returns true → both plan (level≥1) and code (level≥2) skip
		const reviewLevel = 2;
		const skip = isLowRiskStep(0, 4);
		expect(skip).toBe(true);
		// Plan review: reviewLevel >= 1 && skip → skipped ✓
		// Code review: reviewLevel >= 2 && skip → skipped ✓
		expect(reviewLevel >= 1 && skip).toBe(true);
		expect(reviewLevel >= 2 && skip).toBe(true);
	});

	it("1.6: Final step at review level 2 — both plan and code reviews should skip", () => {
		const reviewLevel = 2;
		const skip = isLowRiskStep(3, 4);
		expect(skip).toBe(true);
		expect(reviewLevel >= 1 && skip).toBe(true);
		expect(reviewLevel >= 2 && skip).toBe(true);
	});

	it("1.7: Middle step at review level 2 — reviews should NOT skip", () => {
		const reviewLevel = 2;
		const skip = isLowRiskStep(1, 4);
		expect(skip).toBe(false);
		// Plan review: reviewLevel >= 1 && !skip → review runs ✓
		// Code review: reviewLevel >= 2 && !skip → review runs ✓
		expect(reviewLevel >= 1 && !skip).toBe(true);
		expect(reviewLevel >= 2 && !skip).toBe(true);
	});

	// ── Review level 0 (all reviews disabled) ────────────────────────

	it("1.8: Review level 0 — no reviews regardless of step position", () => {
		const reviewLevel = 0;
		// Even if isLowRiskStep returns true, level 0 means no reviews at all
		// The outer gate: if (reviewLevel >= 1) never fires
		expect(reviewLevel >= 1).toBe(false);
		expect(reviewLevel >= 2).toBe(false);
		// isLowRiskStep is never consulted, but let's verify it still works
		expect(isLowRiskStep(0, 4)).toBe(true);
		expect(isLowRiskStep(1, 4)).toBe(false);
		expect(isLowRiskStep(3, 4)).toBe(true);
	});

	// ── Review level 1 (plan only) ──────────────────────────────────

	it("1.9: Review level 1, Step 0 — plan review skipped, no code review", () => {
		const reviewLevel = 1;
		const skip = isLowRiskStep(0, 4);
		expect(reviewLevel >= 1 && skip).toBe(true); // plan review gate → skip
		expect(reviewLevel >= 2).toBe(false); // code review gate never fires
	});

	it("1.10: Review level 1, middle step — plan review runs, no code review", () => {
		const reviewLevel = 1;
		const skip = isLowRiskStep(2, 4);
		expect(reviewLevel >= 1 && !skip).toBe(true); // plan review runs
		expect(reviewLevel >= 2).toBe(false); // code review gate never fires
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Edge cases
// ══════════════════════════════════════════════════════════════════════

describe("2.x: Edge cases", () => {
	it("2.1: Single-step task — Step 0 is both first AND last → low-risk", () => {
		// totalSteps=1, lastStepIndex=0, stepNumber=0 matches both conditions
		expect(isLowRiskStep(0, 1)).toBe(true);
	});

	it("2.2: Two-step task — Step 0 is low-risk", () => {
		expect(isLowRiskStep(0, 2)).toBe(true);
	});

	it("2.3: Two-step task — Step 1 (last) is low-risk", () => {
		expect(isLowRiskStep(1, 2)).toBe(true);
	});

	it("2.4: Two-step task — both steps are low-risk (no middle steps)", () => {
		// In a 2-step task, Step 0 is first and Step 1 is last
		// No middle steps exist — all reviews would be skipped
		expect(isLowRiskStep(0, 2)).toBe(true);
		expect(isLowRiskStep(1, 2)).toBe(true);
	});

	it("2.5: Three-step task — only Step 1 is NOT low-risk", () => {
		expect(isLowRiskStep(0, 3)).toBe(true);  // first
		expect(isLowRiskStep(1, 3)).toBe(false); // middle
		expect(isLowRiskStep(2, 3)).toBe(true);  // last
	});

	it("2.6: Large task (10 steps) — only first and last are low-risk", () => {
		expect(isLowRiskStep(0, 10)).toBe(true);   // first
		expect(isLowRiskStep(9, 10)).toBe(true);   // last
		// All middle steps
		for (let i = 1; i < 9; i++) {
			expect(isLowRiskStep(i, 10)).toBe(false);
		}
	});

	it("2.7: Zero totalSteps → false (defensive)", () => {
		expect(isLowRiskStep(0, 0)).toBe(false);
	});

	it("2.8: Negative totalSteps → false (defensive)", () => {
		expect(isLowRiskStep(0, -1)).toBe(false);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Integration: review gating decision matrix
// ══════════════════════════════════════════════════════════════════════

describe("3.x: Review gating decision matrix", () => {
	// This simulates the full decision logic from task-runner.ts:
	//   Plan review: if (reviewLevel >= 1) { if (isLowRisk) skip; else review; }
	//   Code review: if (reviewLevel >= 2) { if (isLowRisk) skip; else review; }

	type ReviewDecision = "skip" | "review" | "no-gate";

	function planReviewDecision(reviewLevel: number, stepNumber: number, totalSteps: number): ReviewDecision {
		if (reviewLevel < 1) return "no-gate";
		return isLowRiskStep(stepNumber, totalSteps) ? "skip" : "review";
	}

	function codeReviewDecision(reviewLevel: number, stepNumber: number, totalSteps: number): ReviewDecision {
		if (reviewLevel < 2) return "no-gate";
		return isLowRiskStep(stepNumber, totalSteps) ? "skip" : "review";
	}

	// ── Level 0: no reviews at all ──────────────────────────────────

	it("3.1: Level 0, Step 0 — no plan review, no code review", () => {
		expect(planReviewDecision(0, 0, 4)).toBe("no-gate");
		expect(codeReviewDecision(0, 0, 4)).toBe("no-gate");
	});

	it("3.2: Level 0, middle step — no plan review, no code review", () => {
		expect(planReviewDecision(0, 2, 4)).toBe("no-gate");
		expect(codeReviewDecision(0, 2, 4)).toBe("no-gate");
	});

	it("3.3: Level 0, final step — no plan review, no code review", () => {
		expect(planReviewDecision(0, 3, 4)).toBe("no-gate");
		expect(codeReviewDecision(0, 3, 4)).toBe("no-gate");
	});

	// ── Level 1: plan reviews only ──────────────────────────────────

	it("3.4: Level 1, Step 0 — plan review SKIPPED, no code review gate", () => {
		expect(planReviewDecision(1, 0, 4)).toBe("skip");
		expect(codeReviewDecision(1, 0, 4)).toBe("no-gate");
	});

	it("3.5: Level 1, middle step — plan review RUNS, no code review gate", () => {
		expect(planReviewDecision(1, 1, 4)).toBe("review");
		expect(codeReviewDecision(1, 1, 4)).toBe("no-gate");
	});

	it("3.6: Level 1, final step — plan review SKIPPED, no code review gate", () => {
		expect(planReviewDecision(1, 3, 4)).toBe("skip");
		expect(codeReviewDecision(1, 3, 4)).toBe("no-gate");
	});

	// ── Level 2: plan + code reviews ────────────────────────────────

	it("3.7: Level 2, Step 0 — plan review SKIPPED, code review SKIPPED", () => {
		expect(planReviewDecision(2, 0, 4)).toBe("skip");
		expect(codeReviewDecision(2, 0, 4)).toBe("skip");
	});

	it("3.8: Level 2, middle step — plan review RUNS, code review RUNS", () => {
		expect(planReviewDecision(2, 1, 4)).toBe("review");
		expect(codeReviewDecision(2, 1, 4)).toBe("review");
	});

	it("3.9: Level 2, final step — plan review SKIPPED, code review SKIPPED", () => {
		expect(planReviewDecision(2, 3, 4)).toBe("skip");
		expect(codeReviewDecision(2, 3, 4)).toBe("skip");
	});

	// ── Level 2, single-step task ───────────────────────────────────

	it("3.10: Level 2, single step (Step 0 is also final) — all reviews SKIPPED", () => {
		expect(planReviewDecision(2, 0, 1)).toBe("skip");
		expect(codeReviewDecision(2, 0, 1)).toBe("skip");
	});

	// ── Level 3+ (future-proofing) ──────────────────────────────────

	it("3.11: Level 3, Step 0 — both reviews still skip (higher levels don't change skip logic)", () => {
		expect(planReviewDecision(3, 0, 4)).toBe("skip");
		expect(codeReviewDecision(3, 0, 4)).toBe("skip");
	});

	it("3.12: Level 3, middle step — both reviews run", () => {
		expect(planReviewDecision(3, 1, 4)).toBe("review");
		expect(codeReviewDecision(3, 1, 4)).toBe("review");
	});
});
