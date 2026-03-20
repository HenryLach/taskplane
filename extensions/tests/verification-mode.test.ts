/**
 * Verification Mode Behavior Tests — TP-032 Step 3 (R008)
 *
 * Verifies the TP-032 contract for verification baseline fingerprinting:
 *   - Feature flag (`verification.enabled`) gates all baseline logic
 *   - Strict mode: missing commands → merge failure
 *   - Permissive mode: missing commands → warning, continue
 *   - flakyReruns=0 disables re-runs (new failures block immediately)
 *   - flakyReruns is wired from config through to runPostMergeVerification
 *
 * Since the verification gating logic is embedded in merge.ts functions
 * (not extractable pure functions), these tests verify the contract by
 * examining source patterns and testing exported pure functions.
 *
 * Run: npx vitest run extensions/tests/verification-mode.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
	diffFingerprints,
	deduplicateFingerprints,
	type TestFingerprint,
	type VerificationBaseline,
} from "../taskplane/verification.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load merge.ts source for pattern verification */
function getMergeSource(): string {
	return readFileSync(
		join(__dirname, "..", "taskplane", "merge.ts"),
		"utf-8",
	);
}

// ── 1. Feature Flag Gating (verification.enabled) ───────────────────

describe("verification.enabled feature flag gating (TP-032)", () => {
	it("1.1: merge.ts reads verification.enabled from config to gate baseline capture", () => {
		const source = getMergeSource();
		// The feature flag must be checked before baseline capture
		expect(source).toContain("config.verification.enabled");
		expect(source).toContain("verificationEnabled");
	});

	it("1.2: baseline capture only runs when verificationEnabled AND hasTestingCommands", () => {
		const source = getMergeSource();
		// The baseline capture block must require BOTH conditions
		expect(source).toContain("if (verificationEnabled && hasTestingCommands)");
	});

	it("1.3: post-merge verification requires verificationEnabled in its guard", () => {
		const source = getMergeSource();
		// The post-merge verification block must check all conditions
		// including verificationEnabled
		expect(source).toContain("baseline !== null");
		expect(source).toContain("hasTestingCommands");
		expect(source).toContain("verificationEnabled");
	});

	it("1.4: hasTestingCommands alone does NOT trigger baseline when enabled=false", () => {
		const source = getMergeSource();
		// Verify that testing commands presence is checked SEPARATELY from enabled flag
		const hasTestingLine = source.match(
			/const hasTestingCommands\s*=\s*testingCommands\s*&&\s*Object\.keys\(testingCommands\)\.length\s*>\s*0/,
		);
		expect(hasTestingLine).not.toBeNull();

		// And that verificationEnabled is a SEPARATE variable read from config
		const enabledLine = source.match(
			/const verificationEnabled\s*=\s*config\.verification\.enabled/,
		);
		expect(enabledLine).not.toBeNull();
	});
});

// ── 2. Strict Mode: No Commands → Merge Failure ─────────────────────

describe("strict mode: enabled + no commands → merge failure (TP-032)", () => {
	it("2.1: strict mode with no commands returns failed MergeWaveResult", () => {
		const source = getMergeSource();
		// When verification is enabled but no commands configured, strict mode
		// must short-circuit with a failure return
		expect(source).toContain('verificationMode === "strict"');
		expect(source).toContain("no testing commands configured");
		expect(source).toContain("strict mode: failing merge");
	});

	it("2.2: strict mode failure includes diagnostic reason", () => {
		const source = getMergeSource();
		// The failure reason must include clear context about why it failed
		expect(source).toContain(
			"Verification enabled (strict mode) but no testing commands configured",
		);
	});

	it("2.3: strict mode cleans up worktree before returning failure", () => {
		const source = getMergeSource();
		// Before returning failure, must clean up the merge worktree
		// Find the strict-mode no-commands block and verify cleanup precedes return
		const strictNoCommandsBlock = source.indexOf(
			"verification enabled but no testing commands configured — strict mode: failing merge",
		);
		expect(strictNoCommandsBlock).toBeGreaterThan(-1);

		// forceRemoveMergeWorktree must appear between the log and the return
		const cleanupAfterStrict = source.indexOf("forceRemoveMergeWorktree", strictNoCommandsBlock);
		const returnAfterStrict = source.indexOf("return {", strictNoCommandsBlock);
		expect(cleanupAfterStrict).toBeGreaterThan(strictNoCommandsBlock);
		expect(returnAfterStrict).toBeGreaterThan(cleanupAfterStrict);
	});

	it("2.4: strict mode failure result includes status: 'failed'", () => {
		const source = getMergeSource();
		// Find the strict no-commands return block
		const strictBlock = source.indexOf(
			"Verification enabled (strict mode) but no testing commands configured",
		);
		expect(strictBlock).toBeGreaterThan(-1);

		// The return statement before this reason should include status: "failed"
		const returnBefore = source.lastIndexOf("status:", strictBlock + 100);
		const statusLine = source.slice(returnBefore, returnBefore + 30);
		expect(statusLine).toContain('"failed"');
	});
});

// ── 3. Permissive Mode: No Commands → Continue ──────────────────────

describe("permissive mode: enabled + no commands → continue (TP-032)", () => {
	it("3.1: permissive mode with no commands logs warning and continues", () => {
		const source = getMergeSource();
		expect(source).toContain(
			"permissive mode: continuing without verification",
		);
	});

	it("3.2: permissive mode does NOT return failure when no commands configured", () => {
		const source = getMergeSource();
		// Find the permissive no-commands path
		const permissiveNoCommands = source.indexOf(
			"permissive mode: continuing without verification",
		);
		expect(permissiveNoCommands).toBeGreaterThan(-1);

		// After this log message, there should NOT be an immediate return statement
		// (the function continues to the merge loop)
		const nextLines = source.slice(permissiveNoCommands, permissiveNoCommands + 200);
		// Should not contain "return {" immediately (only closing brace of else block)
		expect(nextLines).not.toContain("return {");
	});

	it("3.3: strict and permissive are the only two code paths for no-commands check", () => {
		const source = getMergeSource();
		// The no-commands check should have exactly strict/permissive branches
		const noCommandsBlock = source.indexOf("verificationEnabled && !hasTestingCommands");
		expect(noCommandsBlock).toBeGreaterThan(-1);

		// After this condition, both strict and permissive are handled
		// Need a wider window because the strict block includes cleanup + return
		const afterBlock = source.slice(noCommandsBlock, noCommandsBlock + 1500);
		expect(afterBlock).toContain('verificationMode === "strict"');
		expect(afterBlock).toContain("permissive mode: continuing without verification");
	});
});

// ── 4. Baseline Capture Failure: Strict vs Permissive ────────────────

describe("baseline capture failure: strict vs permissive (TP-032)", () => {
	it("4.1: baseline capture is wrapped in try/catch", () => {
		const source = getMergeSource();
		// The captureBaseline call must be inside a try block
		const captureCall = source.indexOf("baseline = captureBaseline(");
		expect(captureCall).toBeGreaterThan(-1);

		// Find the enclosing try
		const tryBefore = source.lastIndexOf("try {", captureCall);
		expect(tryBefore).toBeGreaterThan(-1);
		expect(captureCall - tryBefore).toBeLessThan(500); // try should be relatively close
	});

	it("4.2: strict mode on capture failure returns merge failure", () => {
		const source = getMergeSource();
		expect(source).toContain("baseline capture failed — strict mode: failing merge");
		expect(source).toContain("Verification baseline capture failed (strict mode):");
	});

	it("4.3: permissive mode on capture failure sets baseline to null and continues", () => {
		const source = getMergeSource();
		expect(source).toContain(
			"baseline capture failed — permissive mode: continuing without baseline verification",
		);
		// Permissive path must set baseline = null (so post-merge verification is skipped)
		const permissiveCaptureFail = source.indexOf(
			"permissive mode: continuing without baseline verification",
		);
		expect(permissiveCaptureFail).toBeGreaterThan(-1);
		// Wider window to include the code after the log line and comment
		const afterPermissive = source.slice(permissiveCaptureFail, permissiveCaptureFail + 500);
		expect(afterPermissive).toContain("baseline = null");
	});
});

// ── 5. Flaky Re-runs Configuration ──────────────────────────────────

describe("flakyReruns configuration wiring (TP-032)", () => {
	it("5.1: flakyReruns is read from config.verification.flaky_reruns", () => {
		const source = getMergeSource();
		expect(source).toContain("config.verification.flaky_reruns");
		// And stored in a local variable
		const flakyLine = source.match(
			/const flakyReruns\s*=\s*config\.verification\.flaky_reruns/,
		);
		expect(flakyLine).not.toBeNull();
	});

	it("5.2: flakyReruns is passed through to runPostMergeVerification", () => {
		const source = getMergeSource();
		// The call to runPostMergeVerification must include flakyReruns
		const callSite = source.indexOf("runPostMergeVerification(");
		expect(callSite).toBeGreaterThan(-1);

		// Extract the full call (up to the closing paren with semicolon)
		const callEnd = source.indexOf(");", callSite);
		const callBlock = source.slice(callSite, callEnd + 2);
		expect(callBlock).toContain("flakyReruns");
	});

	it("5.3: runPostMergeVerification skips re-run when flakyReruns === 0", () => {
		const source = getMergeSource();
		// The flaky re-run block must be gated by flakyReruns > 0
		expect(source).toContain("if (flakyReruns > 0)");
		// Comment documents the 0 = disabled behavior
		expect(source).toContain("0 = disabled");
	});

	it("5.4: runPostMergeVerification loops up to flakyReruns times", () => {
		const source = getMergeSource();
		// The re-run loop must iterate using flakyReruns as the upper bound
		const loopPattern = source.match(
			/for\s*\(\s*let\s+attempt\s*=\s*0;\s*attempt\s*<\s*flakyReruns;\s*attempt\+\+\)/,
		);
		expect(loopPattern).not.toBeNull();
	});

	it("5.5: when flakyReruns=0 and new failures exist, classification is verification_new_failure", () => {
		const source = getMergeSource();
		// After the flakyReruns > 0 block, there's a fallthrough for flakyReruns === 0
		// that returns verification_new_failure
		const fallthrough = source.indexOf("flakyReruns === 0 or fallthrough");
		expect(fallthrough).toBeGreaterThan(-1);

		// The return after fallthrough must include classification: "verification_new_failure"
		const returnAfter = source.indexOf("classification:", fallthrough);
		const classLine = source.slice(returnAfter, returnAfter + 60);
		expect(classLine).toContain('"verification_new_failure"');
	});

	it("5.6: runPostMergeVerification function docs describe configurable flaky reruns", () => {
		const source = getMergeSource();
		// R008 review item 3: docs should mention configurability, not "re-run once"
		expect(source).toContain("flakyReruns > 0");
		expect(source).toContain("flakyReruns times");
		// Should NOT say "re-run once" in the function docs anymore
		const funcDocStart = source.indexOf("Run post-merge verification and compare against baseline");
		expect(funcDocStart).toBeGreaterThan(-1);
		const funcDocEnd = source.indexOf("function runPostMergeVerification", funcDocStart);
		const funcDocs = source.slice(funcDocStart, funcDocEnd);
		expect(funcDocs).not.toContain("re-run once");
	});
});

// ── 6. Engine/Resume Verification Gating ─────────────────────────────

describe("engine.ts and resume.ts verification_new_failure handling (TP-032)", () => {
	it("6.1: engine.ts excludes verification_new_failure lanes from success counts", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);
		// TP-032 R006-3 comment
		expect(engineSource).toContain("TP-032 R006-3");
		expect(engineSource).toContain("verification_new_failure");
		// Merged count excludes lanes with errors
		expect(engineSource).toContain("!lr.error");
	});

	it("6.2: engine.ts excludes verification_new_failure lanes from branch cleanup", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);
		// Branch cleanup must check !lr.error before deleting branches
		const branchCleanupComment = engineSource.indexOf("Exclude verification_new_failure lanes from branch cleanup");
		expect(branchCleanupComment).toBeGreaterThan(-1);
	});

	it("6.3: resume.ts handles verification_new_failure lanes consistently", () => {
		const resumeSource = readFileSync(
			join(__dirname, "..", "taskplane", "resume.ts"),
			"utf-8",
		);
		// Resume path must also handle verification failures
		expect(resumeSource).toContain("!lr.error");
	});
});

// ── 7. Pure Function Verification: diffFingerprints ──────────────────

describe("diffFingerprints correctly classifies new vs pre-existing (TP-032)", () => {
	function fp(commandId: string, file: string, caseName: string, msg: string): TestFingerprint {
		return {
			commandId,
			file,
			case: caseName,
			kind: "assertion_error",
			messageNorm: msg,
		};
	}

	it("7.1: pre-existing failures appear in preExisting, not newFailures", () => {
		const baseline = [fp("test", "a.ts", "test1", "Expected true to be false")];
		const postMerge = [fp("test", "a.ts", "test1", "Expected true to be false")];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(1);
		expect(diff.fixed).toHaveLength(0);
	});

	it("7.2: genuinely new failures appear only in newFailures", () => {
		const baseline = [fp("test", "a.ts", "test1", "old failure")];
		const postMerge = [
			fp("test", "a.ts", "test1", "old failure"),
			fp("test", "b.ts", "test2", "new failure"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.newFailures[0].file).toBe("b.ts");
		expect(diff.preExisting).toHaveLength(1);
		expect(diff.fixed).toHaveLength(0);
	});

	it("7.3: fixed failures (in baseline, not in postMerge) appear in fixed", () => {
		const baseline = [
			fp("test", "a.ts", "test1", "was broken"),
			fp("test", "b.ts", "test2", "also broken"),
		];
		const postMerge = [fp("test", "a.ts", "test1", "was broken")];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(1);
		expect(diff.fixed).toHaveLength(1);
		expect(diff.fixed[0].file).toBe("b.ts");
	});

	it("7.4: empty baseline with post-merge failures → all are new failures", () => {
		const baseline: TestFingerprint[] = [];
		const postMerge = [fp("test", "a.ts", "test1", "failure msg")];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.preExisting).toHaveLength(0);
		expect(diff.fixed).toHaveLength(0);
	});

	it("7.5: both empty → no failures of any kind", () => {
		const diff = diffFingerprints([], []);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(0);
		expect(diff.fixed).toHaveLength(0);
	});
});
