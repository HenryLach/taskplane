/**
 * Verification Baseline & Fingerprinting Tests — TP-032 Step 3 (R008)
 *
 * Tests verification mode behavior, feature-flag gating, and flaky-rerun
 * control paths. Covers:
 *
 *   1.x — Source verification: merge.ts gating patterns for enabled/strict/permissive
 *   2.x — Source verification: flakyReruns control path (0 = disabled)
 *   3.x — Config integration: verification fields in schema defaults
 *
 * The merge flow (mergeWave) requires git worktrees and tmux and cannot be
 * unit-tested in isolation. Instead, tests verify source code patterns
 * (consistent with TP-031 merge-failure-phase testing approach) to ensure
 * the gating logic is structurally correct.
 *
 * Run: npx vitest run tests/verification-baseline.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	diffFingerprints,
	deduplicateFingerprints,
	captureBaseline,
	runVerificationCommands,
	parseTestOutput,
	type TestFingerprint,
	type CommandResult,
	type VerificationBaseline,
} from "../taskplane/verification.ts";

import {
	DEFAULT_ORCHESTRATOR_SECTION,
} from "../taskplane/config-schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────

function readMergeTs(): string {
	return readFileSync(
		join(__dirname, "..", "taskplane", "merge.ts"),
		"utf-8",
	);
}

function readEngineTs(): string {
	return readFileSync(
		join(__dirname, "..", "taskplane", "engine.ts"),
		"utf-8",
	);
}

function readResumeTs(): string {
	return readFileSync(
		join(__dirname, "..", "taskplane", "resume.ts"),
		"utf-8",
	);
}

/** Build a test fingerprint */
function fp(
	commandId: string,
	file: string,
	caseName: string,
	kind: TestFingerprint["kind"] = "assertion_error",
	messageNorm: string = "expected true to be false",
): TestFingerprint {
	return { commandId, file, case: caseName, kind, messageNorm };
}

// ── 1.x: Source Verification — enabled/strict/permissive gating ──────

describe("merge.ts verification gating patterns (source verification)", () => {
	it("1.1: verification.enabled is read as explicit feature flag", () => {
		const source = readMergeTs();
		// The code must read config.verification.enabled as a separate check
		expect(source).toContain("config.verification.enabled");
		// Must gate baseline capture on the enabled flag
		expect(source).toContain("verificationEnabled");
	});

	it("1.2: enabled=true + no testing commands → strict mode returns failure", () => {
		const source = readMergeTs();
		// When enabled but no commands: strict mode should fail
		expect(source).toContain("verificationEnabled && !hasTestingCommands");
		expect(source).toContain('verificationMode === "strict"');
		expect(source).toContain("strict mode: failing merge");
	});

	it("1.3: enabled=true + no testing commands → permissive mode continues", () => {
		const source = readMergeTs();
		// Permissive mode should continue without verification
		expect(source).toContain("permissive mode: continuing without verification");
	});

	it("1.4: enabled=false → no baseline capture regardless of testing commands", () => {
		const source = readMergeTs();
		// Baseline capture is gated on BOTH verificationEnabled AND hasTestingCommands
		// The condition for capture must require both
		expect(source).toContain("verificationEnabled && hasTestingCommands");
		// Post-merge verification also gated
		expect(source).toMatch(/baseline !== null\s*&&\s*hasTestingCommands\s*&&\s*verificationEnabled/s);
	});

	it("1.5: baseline capture failure → strict mode returns merge failure", () => {
		const source = readMergeTs();
		// Strict mode on capture exception should return failure
		expect(source).toContain('baseline capture failed — strict mode: failing merge');
		expect(source).toContain("Verification baseline capture failed (strict mode)");
	});

	it("1.6: baseline capture failure → permissive mode continues with null baseline", () => {
		const source = readMergeTs();
		expect(source).toContain("permissive mode: continuing without baseline verification");
		expect(source).toContain("baseline = null");
	});

	it("1.7: strict/permissive mode is read from config.verification.mode", () => {
		const source = readMergeTs();
		expect(source).toContain("config.verification.mode");
		// Must be used for both no-commands and capture-failure cases
		const strictChecks = source.match(/verificationMode === "strict"/g);
		expect(strictChecks).not.toBeNull();
		// At least 2 strict checks: one for no-commands, one for capture failure
		expect(strictChecks!.length).toBeGreaterThanOrEqual(2);
	});

	it("1.8: verification failure propagates as failedLane/failureReason (not special case)", () => {
		const source = readMergeTs();
		// verification_new_failure sets failedLane and failureReason, same as BUILD_FAILURE
		expect(source).toContain('"verification_new_failure"');
		expect(source).toContain("failedLane = lane.laneNumber");
		expect(source).toContain("Verification baseline comparison detected");
	});
});

// ── 2.x: Source Verification — flakyReruns control path ──────────────

describe("merge.ts flakyReruns control path (source verification)", () => {
	it("2.1: flakyReruns is read from config.verification.flaky_reruns", () => {
		const source = readMergeTs();
		expect(source).toContain("config.verification.flaky_reruns");
	});

	it("2.2: flakyReruns is passed to runPostMergeVerification", () => {
		const source = readMergeTs();
		// The flakyReruns variable is passed to the post-merge verification function
		expect(source).toContain("flakyReruns,");
		// The function signature accepts flakyReruns parameter
		expect(source).toContain("flakyReruns: number");
	});

	it("2.3: flakyReruns=0 skips re-run (immediate block)", () => {
		const source = readMergeTs();
		// The code must check flakyReruns > 0 before performing re-runs
		expect(source).toContain("flakyReruns > 0");
		// When flakyReruns === 0, new failures block immediately
		expect(source).toContain("flakyReruns === 0");
	});

	it("2.4: flaky re-run loop iterates up to flakyReruns times", () => {
		const source = readMergeTs();
		// Loop structure: attempt < flakyReruns
		expect(source).toContain("attempt < flakyReruns");
		// Break early when failures clear
		expect(source).toContain("clearedOnRerun = true");
		expect(source).toContain("break");
	});

	it("2.5: flaky_suspected classification on cleared re-run", () => {
		const source = readMergeTs();
		expect(source).toContain('"flaky_suspected"');
		expect(source).toContain("Flaky:");
	});
});

// ── 3.x: Engine/Resume parity — verification gating ─────────────────

describe("engine.ts and resume.ts verification threading (source verification)", () => {
	it("3.1: engine.ts passes testing_commands to mergeWave", () => {
		const source = readEngineTs();
		// testing_commands or testingCommands must be threaded from config to merge call
		expect(source).toContain("testing_commands");
	});

	it("3.2: resume.ts passes testing_commands to mergeWave (parity)", () => {
		const source = readResumeTs();
		expect(source).toContain("testing_commands");
	});
});

// ── 4.x: Config schema defaults ─────────────────────────────────────

describe("verification config defaults", () => {
	it("4.1: DEFAULT_ORCHESTRATOR_SECTION has verification with correct defaults", () => {
		expect(DEFAULT_ORCHESTRATOR_SECTION.verification).toBeDefined();
		expect(DEFAULT_ORCHESTRATOR_SECTION.verification.enabled).toBe(false);
		expect(DEFAULT_ORCHESTRATOR_SECTION.verification.mode).toBe("permissive");
		expect(DEFAULT_ORCHESTRATOR_SECTION.verification.flakyReruns).toBe(1);
	});

	it("4.2: verification.enabled defaults to false (opt-in feature)", () => {
		// This is a critical safety property — verification is opt-in
		expect(DEFAULT_ORCHESTRATOR_SECTION.verification.enabled).toBe(false);
	});
});

// ── 5.x: Functional tests — diffFingerprints with flaky patterns ─────

describe("diffFingerprints with verification mode patterns", () => {
	it("5.1: pre-existing failures do not appear as new failures", () => {
		const baseline = [
			fp("test", "src/a.test.ts", "should work", "assertion_error", "expected 1 to be 2"),
		];
		const postMerge = [
			fp("test", "src/a.test.ts", "should work", "assertion_error", "expected 1 to be 2"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(1);
		expect(diff.fixed).toHaveLength(0);
	});

	it("5.2: genuinely new failure is detected", () => {
		const baseline = [
			fp("test", "src/a.test.ts", "old test", "assertion_error", "old failure"),
		];
		const postMerge = [
			fp("test", "src/a.test.ts", "old test", "assertion_error", "old failure"),
			fp("test", "src/b.test.ts", "new test", "assertion_error", "new failure"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.newFailures[0].file).toBe("src/b.test.ts");
		expect(diff.preExisting).toHaveLength(1);
		expect(diff.fixed).toHaveLength(0);
	});

	it("5.3: fixed failures detected when baseline failure disappears", () => {
		const baseline = [
			fp("test", "src/a.test.ts", "was broken", "assertion_error", "old failure"),
		];
		const postMerge: TestFingerprint[] = [];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(0);
		expect(diff.fixed).toHaveLength(1);
		expect(diff.fixed[0].case).toBe("was broken");
	});

	it("5.4: empty baseline + new failures = all flagged as new", () => {
		const baseline: TestFingerprint[] = [];
		const postMerge = [
			fp("test", "src/a.test.ts", "test 1", "assertion_error", "fail 1"),
			fp("test", "src/b.test.ts", "test 2", "runtime_error", "fail 2"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(2);
		expect(diff.preExisting).toHaveLength(0);
		expect(diff.fixed).toHaveLength(0);
	});

	it("5.5: empty baseline + empty postMerge = clean diff", () => {
		const diff = diffFingerprints([], []);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(0);
		expect(diff.fixed).toHaveLength(0);
	});

	it("5.6: duplicates in postMerge are deduplicated before comparison", () => {
		const baseline = [
			fp("test", "src/a.test.ts", "test", "assertion_error", "fail"),
		];
		const postMerge = [
			fp("test", "src/a.test.ts", "test", "assertion_error", "fail"),
			fp("test", "src/a.test.ts", "test", "assertion_error", "fail"), // duplicate
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(1);
	});

	it("5.7: different commandIds make otherwise identical fingerprints distinct", () => {
		const baseline = [
			fp("test-unit", "src/a.test.ts", "test", "assertion_error", "fail"),
		];
		const postMerge = [
			fp("test-e2e", "src/a.test.ts", "test", "assertion_error", "fail"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.fixed).toHaveLength(1);
	});
});

// ── 6.x: parseTestOutput — flakyReruns=0 scenario (no rerun) ────────

describe("parseTestOutput for flaky rerun scenarios", () => {
	it("6.1: exit code 0 produces no fingerprints (pass → no flaky concern)", () => {
		const result: CommandResult = {
			commandId: "test",
			exitCode: 0,
			stdout: '{"testResults":[]}',
			stderr: "",
			durationMs: 100,
			error: null,
		};

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(0);
	});

	it("6.2: non-zero exit with failures produces fingerprints for diff", () => {
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/math.test.ts",
				assertionResults: [{
					fullName: "math > should add",
					status: "failed",
					failureMessages: ["AssertionError: expected 2 to be 3"],
				}],
			}],
		});

		const result: CommandResult = {
			commandId: "test",
			exitCode: 1,
			stdout: vitestOutput,
			stderr: "",
			durationMs: 500,
			error: null,
		};

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].commandId).toBe("test");
		expect(fps[0].file).toBe("src/math.test.ts");
		expect(fps[0].case).toBe("math > should add");
		expect(fps[0].kind).toBe("assertion_error");
	});

	it("6.3: spawn error produces command_error fingerprint", () => {
		const result: CommandResult = {
			commandId: "test",
			exitCode: -1,
			stdout: "",
			stderr: "",
			durationMs: 0,
			error: "Spawn error: command not found",
		};

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
	});

	it("6.4: timeout produces command_error fingerprint", () => {
		const result: CommandResult = {
			commandId: "test",
			exitCode: -1,
			stdout: "",
			stderr: "",
			durationMs: 300000,
			error: "Command timed out after 300000ms",
		};

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
	});
});
