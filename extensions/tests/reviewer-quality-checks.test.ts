/**
 * Sub-fix A (TP-188 / #541) — reviewer Quality-check verification section.
 *
 * Source-pattern tests that verify templates/agents/task-reviewer.md contains
 * the new Quality-check verification section and the key behavioral keywords
 * the reviewer is supposed to honor at runtime:
 *   - typecheck / lint / format
 *   - severity `important`
 *   - REVISE downgrade rule
 *   - bash tool already allowed (no allowlist change required)
 *   - hybrid command discovery (config first, package.json fallback)
 *
 * Run:
 *   cd extensions && node --experimental-strip-types --experimental-test-module-mocks \\
 *     --no-warnings --import ./tests/loader.mjs \\
 *     --test tests/reviewer-quality-checks.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const reviewerPromptPath = join(__dirname, "..", "..", "templates", "agents", "task-reviewer.md");
const reviewerPromptSrc = readFileSync(reviewerPromptPath, "utf-8");

describe("TP-188 sub-fix A: reviewer prompt has Quality-check verification section", () => {
	it("1.1: section exists with the expected heading", () => {
		expect(reviewerPromptSrc).toContain("## Quality-check verification");
	});

	it("1.2: section is restricted to code reviews", () => {
		// Plan reviews must skip — explicit instruction prevents wasted invocations
		// and confusing failures (no code exists to typecheck during plan review).
		const lower = reviewerPromptSrc.toLowerCase();
		expect(lower).toMatch(/code review/);
		expect(lower).toMatch(/skip[^\n]*plan|plan[^\n]*skip/);
	});

	it("1.3: lists the three quality-check categories", () => {
		const lower = reviewerPromptSrc.toLowerCase();
		expect(lower).toContain("typecheck");
		expect(lower).toContain("lint");
		expect(lower).toContain("format");
	});

	it("1.4: hybrid command discovery — taskRunner.testing.commands then package.json fallback", () => {
		expect(reviewerPromptSrc).toContain("taskRunner.testing.commands");
		expect(reviewerPromptSrc.toLowerCase()).toContain("package.json");
	});

	it("1.4b: package.json fallback fires on partial-config (sage TP-188 follow-up)", () => {
		// Sage code review flagged that the original wording only triggered the
		// package.json fallback when taskRunner.testing.commands was absent.
		// If the map exists but lacks relevant keys (typecheck/lint/format:check),
		// reviewers were instructed to skip even when package.json scripts existed.
		// The fix: fallback when no relevant commands are *discovered* in step 1,
		// not only when the map is absent.
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		// Look for both the absent-map case AND the no-relevant-keys case.
		expect(section).toMatch(/no relevant commands|no keys matching|absent OR/i);
	});

	it("1.4c: prefers format:check over mutating format command (sage TP-188 follow-up)", () => {
		// Sage flagged: a non-suffixed `format` script typically rewrites files
		// in place, which would mutate the working tree the reviewer is supposed
		// to be evaluating. The reviewer prompt should explicitly prefer
		// format:check (non-mutating) over format.
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		expect(section).toMatch(/Prefer .format:check. over .format.|do not run mutating commands/i);
	});

	it("1.5: surfaces failures as Issues Found with severity `important`", () => {
		// Both the Issues Found target and the explicit important severity word
		// must be present in the new section.
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		expect(sectionStart).toBeGreaterThan(-1);
		expect(sectionEnd).toBeGreaterThan(sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		expect(section).toContain("Issues Found");
		expect(section.toLowerCase()).toContain("important");
	});

	it("1.6: verdict downgrade rule — failing checks force REVISE", () => {
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		expect(section).toContain("REVISE");
		// Must explicitly note that this overrides a behavioural APPROVE
		expect(section.toLowerCase()).toMatch(/approve[\s\S]{0,200}revise|revise[\s\S]{0,200}approve/);
	});

	it("1.7: notes that bash is already in the reviewer tool allowlist", () => {
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		// Test contract: section must reference `bash` so a future maintainer
		// reading the prompt understands no allowlist change was required.
		expect(section.toLowerCase()).toContain("bash");
	});

	it("1.8: section sits between How You Work and Verdict Criteria (so Verdict still anchors the reviewer)", () => {
		const howYouWorkIdx = reviewerPromptSrc.indexOf("## How You Work");
		const qualityIdx = reviewerPromptSrc.indexOf("## Quality-check verification");
		const verdictIdx = reviewerPromptSrc.indexOf("## Verdict Criteria");
		expect(howYouWorkIdx).toBeGreaterThan(-1);
		expect(qualityIdx).toBeGreaterThan(howYouWorkIdx);
		expect(verdictIdx).toBeGreaterThan(qualityIdx);
	});

	it("1.9: explicitly excludes the project test suite from this section", () => {
		// The intent is fast static checks only; the worker's Testing & Verification
		// step still owns running the full test suite.
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		expect(section.toLowerCase()).toMatch(
			/do not run[^\n]*test suite|not[^\n]*full[^\n]*test|fast static/,
		);
	});

	it("1.10: skip-silently rule — missing config + missing scripts must not trigger REVISE on its own", () => {
		const sectionStart = reviewerPromptSrc.indexOf("## Quality-check verification");
		const sectionEnd = reviewerPromptSrc.indexOf("## Verdict Criteria", sectionStart);
		const section = reviewerPromptSrc.slice(sectionStart, sectionEnd);
		expect(section.toLowerCase()).toMatch(/skip silently|skip[^\n]*silently/);
	});
});
