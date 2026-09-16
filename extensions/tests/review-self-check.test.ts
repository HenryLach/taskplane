/**
 * #657 — worker self-check gate before review_step; reviewer round semantics.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";
import {
	buildReviewRoundLines,
	reviewRoundForGate,
	selfCheckRefusal,
} from "../taskplane/agent-bridge-extension.ts";
import { buildReviewerEnv, buildWorkerEnv } from "../taskplane/execution.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(join(HERE, "..", rel), "utf-8");

const STATUS_NO_CHECK = `# TP-1 — Status

### Step 0: Design
**Status:** ✅ Complete
- [x] Design table written

### Step 1: Implement
**Status:** 🟨 In Progress
- [x] Do the thing
- [x] Test the thing

### Step 2: Docs
**Status:** ⬜ Not Started
- [ ] Update docs
`;

const SELF_CHECK = `
### Self-check (Step 1)

| Item | Evidence | Result |
|------|----------|--------|
| Do the thing | src/thing.ts:12-40 | OK |
| Design: fail-closed on missing id | src/thing.ts:22 | fixed in abc1234 |
| Completion criterion: tests pass | tests/thing.test.ts | OK |
`;

describe("#657 — selfCheckRefusal", () => {
	it("refuses when the section is missing, names the step", () => {
		const r = selfCheckRefusal(STATUS_NO_CHECK, 1);
		expect(r).toContain('no "### Self-check (Step 1)" section');
	});

	it("accepts a section with data rows placed after the step's checkboxes; heading level 4 and case-insensitive spelling also accepted", () => {
		const s = STATUS_NO_CHECK.replace("### Step 2: Docs", `${SELF_CHECK}\n### Step 2: Docs`);
		expect(selfCheckRefusal(s, 1)).toBe(null);
		const h4 = s.replace("### Self-check (Step 1)", "#### self-CHECK (step 1)");
		expect(selfCheckRefusal(h4, 1)).toBe(null);
	});

	it("refuses an empty section (header + separator only)", () => {
		const empty = STATUS_NO_CHECK.replace(
			"### Step 2: Docs",
			"### Self-check (Step 1)\n\n| Item | Evidence | Result |\n|------|----------|--------|\n\n### Step 2: Docs",
		);
		expect(selfCheckRefusal(empty, 1)).toContain("has no rows");
	});

	it("refuses a stale section that sits BEFORE the step's last checked box (pasted in early)", () => {
		const early = STATUS_NO_CHECK.replace(
			"- [x] Do the thing\n- [x] Test the thing",
			`- [x] Do the thing\n${SELF_CHECK}\n- [x] Test the thing`,
		);
		expect(selfCheckRefusal(early, 1)).toContain("appears before the step's last checked box");
	});

	it("is step-scoped: a self-check for step 1 does not satisfy step 2", () => {
		const s = STATUS_NO_CHECK.replace("### Step 2: Docs", `${SELF_CHECK}\n### Step 2: Docs`);
		expect(selfCheckRefusal(s, 2)).toContain("Step 2");
	});
});

describe("#657 — round semantics", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tp657-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("reviewRoundForGate counts prior files for THIS gate only and returns the latest as prior", () => {
		const reviews = join(dir, ".reviews");
		mkdirSync(reviews);
		expect(reviewRoundForGate(reviews, "code", 3)).toEqual({ round: 1, priorReviewPath: null });
		writeFileSync(join(reviews, "R001-plan-step3.md"), "Verdict: APPROVE");
		writeFileSync(join(reviews, "R002-code-step3.md"), "Verdict: REVISE");
		writeFileSync(join(reviews, "R003-code-step4.md"), "Verdict: REVISE");
		const r = reviewRoundForGate(reviews, "code", 3);
		expect(r.round).toBe(2);
		expect(r.priorReviewPath).toBe(join(reviews, "R002-code-step3.md"));
		expect(reviewRoundForGate(reviews, "plan", 3).round).toBe(2);
		expect(reviewRoundForGate(join(dir, "missing"), "code", 1).round).toBe(1);
	});

	it("round-1 lines demand exhaustiveness; round-2 lines scope to the fold, name the prior file, and restrict new findings to P0 by default", () => {
		const r1 = buildReviewRoundLines(1, null, "p0-only").join("\n");
		expect(r1).toContain("Review round: 1 of 2 (exhaustive)");
		expect(r1).toContain("List EVERY finding now");
		const r2 = buildReviewRoundLines(2, "/x/.reviews/R002-code-step3.md", "p0-only").join("\n");
		expect(r2).toContain("Review round: 2 (verify the fold)");
		expect(r2).toContain("R002-code-step3.md");
		expect(r2).toContain("ONLY at the top severity label");
		expect(r2).toContain("the verdict is APPROVE");
		const any = buildReviewRoundLines(2, "/x/p.md", "any").join("\n");
		expect(any).toContain("any severity");
		expect(any).not.toContain("ONLY at the top severity");
	});

	it("config → env: requireSelfCheck opt-out and round2NewFindings mode", () => {
		expect(buildWorkerEnv({ requireSelfCheck: false }).TASKPLANE_REQUIRE_SELF_CHECK).toBe("0");
		expect(buildWorkerEnv({}).TASKPLANE_REQUIRE_SELF_CHECK).toBe(undefined); // default = required
		expect(buildReviewerEnv({}).TASKPLANE_REVIEW_ROUND2_NEW_FINDINGS).toBe("p0-only");
		expect(buildReviewerEnv({ round2NewFindings: "any" }).TASKPLANE_REVIEW_ROUND2_NEW_FINDINGS).toBe(
			"any",
		);
		expect(readSrc("taskplane/config-loader.ts")).toContain(
			"requireSelfCheck: config.taskRunner.worker.requireSelfCheck",
		);
		expect(readSrc("taskplane/config-loader.ts")).toContain(
			"round2NewFindings: config.taskRunner.reviewer.round2NewFindings",
		);
	});

	it("review_step wiring: gate runs for code/test reviews before the counter increments, honours the opt-out, and both request prompts carry the round lines", () => {
		const src = readSrc("taskplane/agent-bridge-extension.ts");
		const gate = src.indexOf(
			'reviewType !== "plan" && process.env.TASKPLANE_REQUIRE_SELF_CHECK !== "0"',
		);
		const counter = src.indexOf("reviewCounter++;");
		expect(gate).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(counter);
		expect(src).toContain("review_step refused — self-check missing");
		expect((src.match(/\.\.\.roundLines,/g) ?? []).length).toBe(2);
		expect(src).toContain(
			"4. Read the worker's \"### Self-check (Step $" + '{stepNum})" table in STATUS.md',
		);
	});

	it("templates carry the contract: worker self-check step in the review path; reviewer round rules; reviewer-extension guideline", () => {
		const worker = readSrc("../templates/agents/task-worker.md");
		expect(worker).toContain("3. **Self-check (MANDATORY — `review_step` refuses without it).**");
		expect(worker).toContain("### Self-check (Step N)");
		expect(worker).toContain('4. **Call** `review_step(step=N, type="code", baseline=<sha>)`.');
		const reviewer = readSrc("../templates/agents/task-reviewer.md");
		expect(reviewer).toContain("### Round semantics (the gate has a hard 2-round cap)");
		expect(reviewer).toContain("**Round 1 — exhaustive.**");
		expect(reviewer).toContain("**Round ≥ 2 — verify the fold.**");
		expect(readSrc("reviewer-extension.ts")).toContain("Round semantics (#657)");
	});
});
