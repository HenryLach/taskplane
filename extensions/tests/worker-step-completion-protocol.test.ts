/**
 * Worker Step-Completion Protocol Tests — TP-186
 *
 * Covers the death-spiral fix from issue #537 / #542:
 *
 *   1.x — `templates/agents/task-worker.md` source-pattern checks for the
 *         three new prompt sections (Order of Operations, Recovery Recipe,
 *         Forbidden callout).
 *   2.x — `isStepMarkedComplete` helper behavior on representative
 *         STATUS.md fixtures.
 *   3.x — Wording-consistency checks: the prompt's Recovery Recipe and the
 *         engine guard's refusal message agree on the 3-step recovery
 *         sequence and commit message format.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/worker-step-completion-protocol.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import { isStepMarkedComplete } from "../taskplane/agent-bridge-extension.ts";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(__dirname, "..", "..");
const WORKER_PROMPT_PATH = join(REPO_ROOT, "templates", "agents", "task-worker.md");
// Normalize CRLF → LF so multi-line substring matches behave the same on
// Windows (where Git's autocrlf rewrites the on-disk file) and POSIX.
const WORKER_PROMPT = readFileSync(WORKER_PROMPT_PATH, "utf-8").replace(/\r\n/g, "\n");

// ─── 1.x — Prompt source-pattern checks ────────────────────────────────────

describe("1.x — task-worker.md prompt: TP-186 sections", () => {
	it("1.1 — contains the MANDATORY Order of Operations section", () => {
		// Heading uses the warning emoji + "Order of Operations" phrase.
		expect(WORKER_PROMPT).toContain("Order of Operations for steps with code review");
		// The MUST NOT prohibition that the entire fix hinges on.
		expect(WORKER_PROMPT).toContain("Workers MUST NOT mark a step `Status: ✅ Complete`");
		// 5–6 step numbered sequence: implement, commit, call review_step,
		// handle REVISE, mark Complete on APPROVE, move on.
		expect(WORKER_PROMPT).toContain("1. **Implement**");
		expect(WORKER_PROMPT).toContain("2. **Commit**");
		expect(WORKER_PROMPT).toContain('3. **Call** `review_step(step=N, type="code"');
		expect(WORKER_PROMPT).toContain("5. If the verdict is **APPROVE**");
		expect(WORKER_PROMPT).toContain("6. **Move to step N+1.**");
	});

	it("1.2 — contains the Recovery Recipe with the keyword 'revert'", () => {
		expect(WORKER_PROMPT).toContain(
			'Recovery: "I marked the step Complete, then the reviewer returned REVISE"',
		);
		// The recipe must explicitly use "revert" — that's the operative verb
		// the engine guard's refusal message also points at.
		expect(WORKER_PROMPT).toContain("**Revert STATUS.md**");
		expect(WORKER_PROMPT).toContain("revert premature step-N completion");
		// The recipe must reset the step's Status to In Progress.
		expect(WORKER_PROMPT).toContain("`**Status:** 🟨 In Progress`");
		// And it must point at the engine-side backstop so the worker knows
		// the guard exists if it forgets the recipe.
		expect(WORKER_PROMPT).toContain("`review_step` tool now refuses");
	});

	it("1.3 — contains the FORBIDDEN callout naming the death-spiral anti-pattern", () => {
		expect(WORKER_PROMPT).toContain("FORBIDDEN sequences");
		expect(WORKER_PROMPT).toContain("death-spiral anti-pattern");
		// Cross-references the existing Hydration Rules so workers see the
		// new rule as part of the same family of MUST NOTs.
		// Wording cross-references the existing Hydration Rules family. The
		// prompt wraps after "steps\"" so we match the unwrapped substring.
		expect(WORKER_PROMPT).toContain("NEVER add, remove, or renumber steps");
	});

	it("1.4 — preserves the existing 'Plan review happens BEFORE implementation' rule", () => {
		// Regression check: the new Order of Operations section is INSERTED
		// alongside the plan-review rule, not in place of it.
		expect(WORKER_PROMPT).toContain("Plan review happens BEFORE implementation");
		expect(WORKER_PROMPT).toContain("Correct sequence:");
	});

	it("1.4b — Resume Algorithm step 6 is Review-Level-aware (TP-189-E reconciliation regression guard)", () => {
		// TP-189 Cluster E reconciled the Resume Algorithm with the new
		// Order of Operations rule. Pre-TP-189, step 6 said "all items
		// checked → proceed to next step" — ambiguous for Review Level ≥ 2
		// where the step is NOT actually done until the code reviewer
		// returns APPROVE. The fix splits step 6 by Review Level. Guard
		// against accidental drift back to the pre-TP-189 wording.
		const stepSixIdx = WORKER_PROMPT.indexOf("6. When a step's checkbox items are all checked");
		expect(stepSixIdx).toBeGreaterThan(-1);
		const stepSixEnd = WORKER_PROMPT.indexOf("\n7. ", stepSixIdx);
		expect(stepSixEnd).toBeGreaterThan(stepSixIdx);
		const stepSix = WORKER_PROMPT.slice(stepSixIdx, stepSixEnd);
		// Both review-level branches must be enumerated.
		expect(stepSix).toContain("Review Level 0 or 1");
		expect(stepSix).toContain("Review Level 2 or 3");
		// And the Level 2/3 branch must direct the worker at the code
		// review and APPROVE-gating, not just "proceed to next step".
		expect(stepSix).toMatch(/review_step\(.*type="code"/);
		expect(stepSix).toContain("APPROVE");
		// Cross-reference to Order of Operations.
		expect(stepSix).toContain("Order of Operations");
	});

	it("1.5 — Handling verdicts section documents REFUSED + points at Recovery Recipe (sage TP-186 follow-up)", () => {
		// The Option B engine guard returns REFUSED. Workers must know how to
		// react. Without REFUSED in the Handling verdicts section, a worker
		// hitting the guard could spin trying to interpret the unfamiliar token.
		expect(WORKER_PROMPT).toContain("**REFUSED**");
		// The verdict entry must point at the Recovery Recipe (revert + commit + retry).
		const handlingIdx = WORKER_PROMPT.indexOf("**Handling verdicts:**");
		expect(handlingIdx).toBeGreaterThan(-1);
		const section = WORKER_PROMPT.slice(handlingIdx, handlingIdx + 2000);
		expect(section).toContain("REFUSED");
		expect(section).toContain("Recovery Recipe");
	});
});

// ─── 2.x — isStepMarkedComplete helper behavior ────────────────────────────

function withTempStatus(content: string, fn: (statusPath: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "tp186-status-"));
	const statusPath = join(dir, "STATUS.md");
	writeFileSync(statusPath, content, "utf-8");
	try {
		fn(statusPath);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("2.x — isStepMarkedComplete helper", () => {
	it("2.1 — returns true when target step heading shows Status: ✅ Complete", () => {
		const status = [
			"# TP-XYZ Status",
			"",
			"**Status:** 🟡 In Progress",
			"",
			"### Step 2: Implement the thing",
			"**Status:** ✅ Complete",
			"",
			"- [x] did stuff",
			"",
			"### Step 3: Next thing",
			"**Status:** 🟨 In Progress",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(true);
		});
	});

	it("2.2 — returns false when target step is still 🟨 In Progress, even if all checkboxes are [x]", () => {
		// This is the critical false-positive guard: pre-code-review state
		// (impl done, all boxes checked, Status still In Progress) MUST be
		// allowed through so the code reviewer can run.
		const status = [
			"# TP-XYZ Status",
			"",
			"**Status:** 🟡 In Progress",
			"",
			"### Step 2: Implement the thing",
			"**Status:** 🟨 In Progress",
			"",
			"- [x] item one",
			"- [x] item two",
			"- [x] item three",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
		});
	});

	it("2.3 — does NOT trip on the top-of-file task-level Status field", () => {
		// The top-of-file `**Status:** ✅ Complete` is not inside any
		// `### Step N:` section, so the guard must ignore it.
		const status = [
			"# TP-XYZ Status",
			"",
			"**Status:** ✅ Complete",
			"",
			"### Step 2: Implement the thing",
			"**Status:** 🟨 In Progress",
			"",
			"- [ ] not done yet",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
		});
	});

	it("2.4 — scopes the scan to the target step only (does not bleed into next step)", () => {
		// Step 2's section is In Progress, but Step 3 below it is Complete.
		// A query for step=2 must NOT return true.
		const status = [
			"### Step 2: Implement step 2",
			"**Status:** 🟨 In Progress",
			"",
			"- [x] partial",
			"",
			"### Step 3: Implement step 3",
			"**Status:** ✅ Complete",
			"",
			"- [x] done",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
			expect(isStepMarkedComplete(statusPath, 3)).toBe(true);
		});
	});

	it("2.5 — returns false when STATUS.md does not exist (fail-open)", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp186-status-missing-"));
		try {
			const missing = join(dir, "DOES-NOT-EXIST.md");
			expect(isStepMarkedComplete(missing, 2)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("2.6 — returns false when the step heading is absent (fail-open)", () => {
		// Worker queries step 99, which has no `### Step 99:` heading.
		// Must not refuse on unusual STATUS structures — the prompt-side
		// recipe is the primary defense.
		const status = ["### Step 1: Only step", "**Status:** ✅ Complete"].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 99)).toBe(false);
		});
	});

	it("2.7 — tolerates a parenthetical suffix on the Status line", () => {
		// e.g. `**Status:** ✅ Complete (code review APPROVE R002)` — workers
		// commonly annotate the status with the gating review id.
		const status = [
			"### Step 2: Implement the thing",
			"**Status:** ✅ Complete (code review APPROVE R002)",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(true);
		});
	});

	// ── TP-189-A3: fenced-code-block filter ────────────────────────────────

	it("2.8 — ignores `**Status:** ✅ Complete` inside a triple-backtick fenced block", () => {
		// A step that documents the literal status pattern as part of its
		// own body (e.g. instructions or examples) must NOT trip the guard.
		// The actual step Status remains `🟨 In Progress`.
		const status = [
			"### Step 2: Implement the thing",
			"**Status:** 🟨 In Progress",
			"",
			"Set the heading like this when done:",
			"",
			"```",
			"**Status:** ✅ Complete",
			"```",
			"",
			"- [x] item one",
			"",
			"### Step 3: Next",
			"**Status:** ⬜ Not Started",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
		});
	});

	it("2.9 — ignores `**Status:** ✅ Complete` inside a tilde-fenced block (~~~)", () => {
		// Markdown spec also allows ~~~ fences — the guard handles both.
		const status = [
			"### Step 2: Implement the thing",
			"**Status:** 🟨 In Progress",
			"",
			"~~~markdown",
			"**Status:** ✅ Complete",
			"~~~",
			"",
			"### Step 3: Next",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
		});
	});

	it("2.10 — still detects a real `**Status:** ✅ Complete` line OUTSIDE a fenced block (regression: fence filter does not over-match)", () => {
		// Defense in depth for 2.8/2.9: ensure the fence filter doesn't
		// accidentally suppress a legitimate Status line that appears
		// AFTER a closed fence in the same step's body.
		const status = [
			"### Step 2: Implement the thing",
			"",
			"```",
			"**Status:** ✅ Complete",
			"```",
			"",
			"**Status:** ✅ Complete",
			"",
			"### Step 3: Next",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(true);
		});
	});

	it("2.11 — a fence opened inside the step but never closed within the step's section does not bleed into adjacent step lookup", () => {
		// Pathological STATUS structure: an unclosed fence in step 2 would
		// have left the scanner in `inFence` state, but each call gets a
		// fresh scanner so a subsequent query for step 3 is not poisoned.
		// Note: with the CommonMark-aware fence tracking the `### Step 3:`
		// heading inside the unclosed fence is still treated as content
		// (not a step boundary) for the step=2 query, so the unclosed
		// fence effectively swallows the rest of the file. The step=3
		// query starts fresh from its own heading.
		const status = [
			"### Step 2: Bad fencing",
			"**Status:** 🟨 In Progress",
			"",
			"```",
			"unclosed fence body",
			"",
			"### Step 3: Next",
			"**Status:** ✅ Complete",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
			expect(isStepMarkedComplete(statusPath, 3)).toBe(true);
		});
	});

	it("2.12 — a `~~~` line inside an open backtick fence does NOT prematurely close the fence (mixed-delimiter regression for R002)", () => {
		// Sage caught: the prior implementation toggled inFence on ANY
		// `````/`~~~` line, so a `~~~` example inside a backtick-fenced
		// block prematurely closed the fence and let `**Status:** ✅ Complete`
		// inside the same code block match. The CommonMark-aware tracker
		// only closes on a matching delimiter (same char, length >= opener).
		const status = [
			"### Step 2: Documents fence syntax",
			"**Status:** 🟨 In Progress",
			"",
			"````markdown", // 4-backtick opener so inner ``` examples don't close it
			"Markdown supports both fence styles:",
			"~~~",
			"sample tilde block",
			"~~~",
			"```",
			"sample backtick block",
			"```",
			"And a worker would set the heading like:",
			"**Status:** ✅ Complete",
			"````", // matching 4-backtick closer
			"",
			"### Step 3: Next",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
		});
	});

	it("2.13b — a delimiter line with a trailing info string is NOT a closer (R003 follow-up)", () => {
		// Sage caught: a 4-backtick fence containing a ```javascript line
		// would have the inner line incorrectly treated as a closer, so
		// the literal `**Status:** ✅ Complete` later in the same fenced
		// block would false-positive. The CommonMark closer rule requires
		// a same-char/length delimiter on a line BY ITSELF (only optional
		// trailing whitespace).
		const status = [
			"### Step 2: Documents code blocks",
			"**Status:** 🟨 In Progress",
			"",
			"````", // 4-backtick opener (no info string)
			"Inside the outer fence we show shorter inner fences:",
			"```javascript", // not a closer: trailing 'javascript'
			"const x = 1;",
			"```", // also not a closer: only 3 backticks (< opener length 4)
			"And a literal status line still inside the outer fence:",
			"**Status:** ✅ Complete",
			"````", // matching 4-backtick closer with no trailing text
			"",
			"### Step 3: Next",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(false);
		});
	});

	it("2.13c — a closer with trailing whitespace only IS a valid closer", () => {
		// Defense in depth: trailing spaces/tabs on the closer line are
		// allowed by CommonMark and should not prevent the fence from closing.
		const status = [
			"### Step 2: Implement",
			"**Status:** 🟨 In Progress",
			"",
			"```",
			"code",
			"```   ", // closer with trailing spaces only
			"",
			"**Status:** ✅ Complete",
			"",
			"### Step 3: Next",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(true);
		});
	});

	it("2.13 — a backtick closer of equal length closes the fence (length >= opener length CommonMark semantics)", () => {
		// Defense in depth: the tracker should accept a closer with the
		// SAME length as the opener (the strict CommonMark rule is
		// >= opener length).
		const status = [
			"### Step 2: Implement",
			"**Status:** 🟨 In Progress",
			"",
			"```",
			"code block",
			"```",
			"",
			// This Status IS outside the now-closed fence — should match.
			"**Status:** ✅ Complete",
			"",
			"### Step 3: Next",
		].join("\n");
		withTempStatus(status, (statusPath) => {
			expect(isStepMarkedComplete(statusPath, 2)).toBe(true);
		});
	});
});

// ─── 3.x — Prompt ↔ guard wording consistency ──────────────────────────────

describe("3.x — Recovery Recipe / refusal message wording consistency", () => {
	it("3.1 — both name the same 3-step recovery sequence (revert / commit / re-call)", () => {
		// Read the engine source and confirm its refusal message uses the
		// same operative verbs as the prompt's Recovery Recipe. A drift here
		// is exactly the kind of bug TP-186 is preventing.
		const enginePath = join(REPO_ROOT, "extensions", "taskplane", "agent-bridge-extension.ts");
		const engineSrc = readFileSync(enginePath, "utf-8");

		// 1. Revert
		expect(engineSrc).toContain("Revert the step's Status to");
		expect(WORKER_PROMPT).toContain("**Revert STATUS.md**");
		// 2. Commit message format must match between prompt and refusal text.
		expect(engineSrc).toContain("revert premature step-${stepNum} completion");
		expect(WORKER_PROMPT).toContain("revert premature step-N completion");
		// 3. Re-call — prompt wraps the line, but the operative phrase
		// `review_step(step=N, type="code")` again` is uninterrupted.
		expect(engineSrc).toContain("Re-call review_step");
		expect(WORKER_PROMPT).toContain('`review_step(step=N, type="code")` again');
	});

	it("3.2 — engine refusal carries the literal token REFUSED and references the Order of Operations rule", () => {
		const enginePath = join(REPO_ROOT, "extensions", "taskplane", "agent-bridge-extension.ts");
		const engineSrc = readFileSync(enginePath, "utf-8");
		expect(engineSrc).toContain("REFUSED: Step ${stepNum} is already marked");
		expect(engineSrc).toContain("Per the Order of Operations rule");
	});

	it("3.3 — engine guard is gated on reviewType !== 'plan'", () => {
		// Source-pattern check: the guard MUST exempt plan reviews. Plan
		// reviews fire pre-implementation, when an empty STATUS is correct.
		const enginePath = join(REPO_ROOT, "extensions", "taskplane", "agent-bridge-extension.ts");
		const engineSrc = readFileSync(enginePath, "utf-8");
		expect(engineSrc).toContain('if (reviewType !== "plan" && isStepMarkedComplete(');
	});
});
