/**
 * Verification Baseline & Fingerprinting — Step 4 Tests (TP-032)
 *
 * This test file covers the R009 review items and remaining Step 4 checkboxes:
 *
 *   1.x — R009-1: Parser edge cases (suite-level failures, command_error fallback)
 *   2.x — R009-2: Rollback/advancement safety (source verification)
 *   3.x — R009-3: Workspace mode artifact naming (repoId suffix)
 *   4.x — Diff algorithm: pre-existing vs new failures, deduplication, fixed detection
 *   5.x — Flaky handling: flakyReruns=0 immediate block, cleared re-run → flaky_suspected
 *   6.x — Mode behavior: strict/permissive on missing baseline and no-commands
 *
 * Run: npx vitest run tests/verification-step4.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	parseVitestOutput,
	parseTestOutput,
	diffFingerprints,
	deduplicateFingerprints,
	normalizeMessage,
	fingerprintKey,
	type TestFingerprint,
	type CommandResult,
} from "../taskplane/verification.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8");
}

/** Shorthand fingerprint builder */
function fp(
	commandId: string,
	file: string,
	caseName: string,
	kind: TestFingerprint["kind"] = "assertion_error",
	messageNorm: string = "expected true to be false",
): TestFingerprint {
	return { commandId, file, case: caseName, kind, messageNorm };
}

/** Build a CommandResult for testing */
function cmdResult(overrides: Partial<CommandResult> & { commandId: string }): CommandResult {
	return {
		exitCode: 1,
		stdout: "",
		stderr: "",
		durationMs: 100,
		error: null,
		...overrides,
	};
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — R009-1: Parser edge cases
// ══════════════════════════════════════════════════════════════════════

describe("R009-1: Parser edge cases — suite-level vitest failures", () => {
	it("1.1: suite-level failure with no assertionResults emits runtime_error fingerprint", () => {
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/broken.test.ts",
				status: "failed",
				message: "Cannot find module './missing'",
				assertionResults: [],
			}],
		});

		const fps = parseVitestOutput("test", vitestOutput);
		expect(fps).not.toBeNull();
		expect(fps).toHaveLength(1);
		expect(fps![0].commandId).toBe("test");
		expect(fps![0].file).toBe("src/broken.test.ts");
		expect(fps![0].case).toBe("<suite>");
		expect(fps![0].kind).toBe("runtime_error");
		expect(fps![0].messageNorm).toContain("Cannot find module");
	});

	it("1.2: suite-level failure with undefined assertionResults emits runtime_error", () => {
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/setup-crash.test.ts",
				status: "failed",
				message: "SyntaxError: Unexpected token",
			}],
		});

		const fps = parseVitestOutput("test", vitestOutput);
		expect(fps).not.toBeNull();
		expect(fps).toHaveLength(1);
		expect(fps![0].case).toBe("<suite>");
		expect(fps![0].kind).toBe("runtime_error");
	});

	it("1.3: suite-level failure with only passing assertionResults still emits suite fingerprint", () => {
		// Edge case: file-level status = "failed" but all assertions passed
		// (e.g., afterAll hook failure)
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/hook-crash.test.ts",
				status: "failed",
				message: "afterAll hook failed",
				assertionResults: [{
					fullName: "should pass",
					status: "passed",
					failureMessages: [],
				}],
			}],
		});

		const fps = parseVitestOutput("test", vitestOutput);
		expect(fps).not.toBeNull();
		expect(fps).toHaveLength(1);
		expect(fps![0].case).toBe("<suite>");
		expect(fps![0].kind).toBe("runtime_error"); // suite-level failures are always classified as runtime_error
	});

	it("1.4: suite-level failure with failed assertionResults does NOT emit extra suite fingerprint", () => {
		// When we already have assertion-level failures, don't add a redundant suite fingerprint
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/mixed.test.ts",
				status: "failed",
				message: "Some tests failed",
				assertionResults: [{
					fullName: "should add",
					status: "failed",
					failureMessages: ["AssertionError: expected 2 to be 3"],
				}],
			}],
		});

		const fps = parseVitestOutput("test", vitestOutput);
		expect(fps).not.toBeNull();
		expect(fps).toHaveLength(1); // Only the assertion-level fingerprint
		expect(fps![0].case).toBe("should add");
		expect(fps![0].kind).toBe("assertion_error");
	});

	it("1.5: suite-level failure with no message uses fallback message", () => {
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/mystery.test.ts",
				status: "failed",
				// No message field at all
				assertionResults: [],
			}],
		});

		const fps = parseVitestOutput("test", vitestOutput);
		expect(fps).not.toBeNull();
		expect(fps).toHaveLength(1);
		expect(fps![0].messageNorm).toBe("Suite failed with no message");
	});

	it("1.6: multiple suite-level failures produce one fingerprint each", () => {
		const vitestOutput = JSON.stringify({
			testResults: [
				{
					name: "src/a.test.ts",
					status: "failed",
					message: "Cannot find module 'a'",
					assertionResults: [],
				},
				{
					name: "src/b.test.ts",
					status: "failed",
					message: "Cannot find module 'b'",
					assertionResults: [],
				},
			],
		});

		const fps = parseVitestOutput("test", vitestOutput);
		expect(fps).not.toBeNull();
		expect(fps).toHaveLength(2);
		expect(fps![0].file).toBe("src/a.test.ts");
		expect(fps![1].file).toBe("src/b.test.ts");
	});
});

describe("R009-1: Parser edge cases — non-zero exit with empty parsed output → command_error fallback", () => {
	it("1.7: non-zero exit with valid JSON but no failures falls back to command_error", () => {
		// Vitest JSON is valid but testResults has no failed entries
		const vitestOutput = JSON.stringify({
			testResults: [{
				name: "src/ok.test.ts",
				status: "passed",
				assertionResults: [{
					fullName: "should work",
					status: "passed",
					failureMessages: [],
				}],
			}],
		});

		const result = cmdResult({
			commandId: "test",
			exitCode: 1,
			stdout: vitestOutput,
			stderr: "Process exited with code 1",
		});

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
		expect(fps[0].messageNorm).toContain("Process exited with code 1");
	});

	it("1.8: non-zero exit with non-JSON stdout falls back to command_error", () => {
		const result = cmdResult({
			commandId: "build",
			exitCode: 2,
			stdout: "FATAL ERROR: JavaScript heap out of memory",
			stderr: "",
		});

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
		expect(fps[0].messageNorm).toContain("JavaScript heap out of memory");
	});

	it("1.9: non-zero exit with empty stdout and empty stderr uses fallback message", () => {
		const result = cmdResult({
			commandId: "test",
			exitCode: 137,
			stdout: "",
			stderr: "",
		});

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
		expect(fps[0].messageNorm).toBe("Command failed with no output");
	});

	it("1.10: non-zero exit with truncated/malformed JSON falls back to command_error", () => {
		const result = cmdResult({
			commandId: "test",
			exitCode: 1,
			stdout: '{"testResults":[{"name":"src/a.test.ts","status":"fail',
			stderr: "vitest crashed",
		});

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
		expect(fps[0].messageNorm).toContain("vitest crashed");
	});

	it("1.11: exit code 0 always returns empty fingerprints (no fallback)", () => {
		const result = cmdResult({
			commandId: "test",
			exitCode: 0,
			stdout: "some output",
			stderr: "some warning",
		});

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(0);
	});

	it("1.12: spawn error takes precedence over any output parsing", () => {
		const result = cmdResult({
			commandId: "test",
			exitCode: -1,
			stdout: JSON.stringify({ testResults: [{ name: "a.ts", status: "failed", assertionResults: [{ fullName: "x", status: "failed", failureMessages: ["fail"] }] }] }),
			stderr: "",
			error: "Spawn error: ENOENT",
		});

		const fps = parseTestOutput(result);
		expect(fps).toHaveLength(1);
		expect(fps[0].kind).toBe("command_error");
		expect(fps[0].messageNorm).toContain("Spawn error: ENOENT");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — R009-2: Rollback/advancement safety (source verification)
// ══════════════════════════════════════════════════════════════════════

describe("R009-2: Rollback/advancement safety — merge.ts (source verification)", () => {
	const mergeSource = readSource("merge.ts");

	it("2.1: successful rollback on verification_new_failure resets to preLaneHead", () => {
		// The code must use git reset --hard preLaneHead for rollback
		expect(mergeSource).toContain('["reset", "--hard", preLaneHead]');
		// Must check resetResult.status === 0 for success
		expect(mergeSource).toContain("resetResult.status === 0");
	});

	it("2.2: baseHEAD is always captured before each lane merge (TP-033 transactional envelope)", () => {
		// TP-033: baseHEAD (formerly preLaneHead) is always captured unconditionally
		// for the transaction record — not gated on baseline availability.
		expect(mergeSource).toContain('["rev-parse", "HEAD"]');
		// preLaneHead is derived from baseHEAD for backward compatibility
		expect(mergeSource).toContain("const preLaneHead = baseHEAD");
	});

	it("2.3: rollback failure sets blockAdvancement = true", () => {
		// When git reset fails, blockAdvancement must be set
		const rollbackFailureIdx = mergeSource.indexOf("rollback reset failed");
		expect(rollbackFailureIdx).toBeGreaterThan(-1);
		// blockAdvancement = true must appear near the rollback failure handling
		const afterRollbackFail = mergeSource.slice(rollbackFailureIdx, rollbackFailureIdx + 300);
		expect(afterRollbackFail).toContain("blockAdvancement = true");
	});

	it("2.4: no preLaneHead (capture failed) sets blockAdvancement = true", () => {
		// When preLaneHead is empty/falsy, cannot roll back → block advancement
		const noPreLaneIdx = mergeSource.indexOf("no pre-lane HEAD available for rollback");
		expect(noPreLaneIdx).toBeGreaterThan(-1);
		const afterNoPreLane = mergeSource.slice(noPreLaneIdx, noPreLaneIdx + 300);
		expect(afterNoPreLane).toContain("blockAdvancement = true");
	});

	it("2.5: blockAdvancement prevents anySuccess determination", () => {
		// anySuccess must check !blockAdvancement first
		expect(mergeSource).toContain("const anySuccess = !blockAdvancement &&");
	});

	it("2.6: blockAdvancement true logs branch advancement BLOCKED message", () => {
		expect(mergeSource).toContain("branch advancement BLOCKED due to verification rollback failure");
	});

	it("2.7: verification_new_failure sets laneResult.error", () => {
		// The lane error must be set so engine.ts/resume.ts can filter it
		expect(mergeSource).toContain('laneResult.error = `verification_new_failure:');
	});

	it("2.8: verification_new_failure sets failedLane and failureReason", () => {
		// After rollback logic, failedLane and failureReason must be set
		expect(mergeSource).toContain("failedLane = lane.laneNumber");
		expect(mergeSource).toContain("Verification baseline comparison detected");
	});

	it("2.9: successful rollback does NOT set blockAdvancement", () => {
		// After successful reset (status === 0), only log success, no blockAdvancement
		const successRollbackIdx = mergeSource.indexOf("temp branch rolled back successfully");
		expect(successRollbackIdx).toBeGreaterThan(-1);
		// The line between "rolled back successfully" and the else branch should NOT
		// contain blockAdvancement = true
		const rollbackElse = mergeSource.indexOf("} else {", successRollbackIdx);
		const successBlock = mergeSource.slice(successRollbackIdx, rollbackElse);
		expect(successBlock).not.toContain("blockAdvancement = true");
	});
});

describe("R009-2: Engine.ts counting + cleanup parity (source verification)", () => {
	const engineSource = readSource("engine.ts");

	it("2.10: engine.ts excludes lr.error lanes from merged count", () => {
		// The merged count / anySuccess must filter out errored lanes
		expect(engineSource).toContain("!r.error");
		// TP-032 R006-3 comment present
		expect(engineSource).toContain("TP-032 R006-3");
	});

	it("2.11: engine.ts excludes lr.error lanes from branch cleanup", () => {
		expect(engineSource).toContain("Exclude verification_new_failure lanes from branch cleanup");
		expect(engineSource).toContain("!lr.error");
	});

	it("2.12: engine.ts anySuccess check pattern matches merge.ts pattern", () => {
		// Both engine.ts and merge.ts should use the same success determination pattern
		const mergeSource = readSource("merge.ts");
		// Both should have: !r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")
		expect(engineSource).toContain('!r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")');
		expect(mergeSource).toContain('!r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")');
	});
});

describe("R009-2: Resume.ts counting + cleanup parity (source verification)", () => {
	const resumeSource = readSource("resume.ts");

	it("2.13: resume.ts excludes lr.error lanes from success count", () => {
		// Must have the same !r.error guard as engine.ts
		expect(resumeSource).toContain("!r.error");
		expect(resumeSource).toContain("TP-032 R006-3");
	});

	it("2.14: resume.ts excludes lr.error lanes from branch cleanup", () => {
		expect(resumeSource).toContain("!lr.error");
		expect(resumeSource).toContain("Exclude verification_new_failure lanes from branch cleanup");
	});

	it("2.15: resume.ts anySuccess pattern matches engine.ts pattern", () => {
		const engineSource = readSource("engine.ts");
		// Both should use the same success determination pattern
		expect(resumeSource).toContain('!r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")');
		expect(engineSource).toContain('!r.error && (r.result?.status === "SUCCESS" || r.result?.status === "CONFLICT_RESOLVED")');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — R009-3: Workspace mode artifact naming
// ══════════════════════════════════════════════════════════════════════

describe("R009-3: Workspace mode artifact naming — per-repo repoId suffix", () => {
	const mergeSource = readSource("merge.ts");

	it("3.1: baseline filename includes repoId suffix when repoId is provided", () => {
		// Must construct repoSuffix from repoId
		expect(mergeSource).toContain('repoId ? `-repo-${repoId.replace(/[^a-zA-Z0-9_-]/g, "_")}` : ""');
	});

	it("3.2: baseline filename excludes suffix when repoId is undefined", () => {
		// The ternary must default to empty string when no repoId
		const repoSuffixLines = mergeSource.match(/const repoSuffix = repoId \? .* : ""/g);
		expect(repoSuffixLines).not.toBeNull();
		// Should appear at least twice: once in baseline capture, once in post-merge
		expect(repoSuffixLines!.length).toBeGreaterThanOrEqual(2);
	});

	it("3.3: baseline file naming pattern: baseline-b{batchId}-w{waveIndex}{repoSuffix}.json", () => {
		expect(mergeSource).toContain("`baseline-b${batchId}-w${waveIndex}${repoSuffix}.json`");
	});

	it("3.4: post-merge file naming pattern includes repoSuffix and laneNumber", () => {
		expect(mergeSource).toContain("`post-b${batchId}-w${waveIndex}${repoSuffix}-lane${laneNumber}.json`");
	});

	it("3.5: repoId parameter is threaded to mergeWave from mergeWaveByRepo", () => {
		// mergeWave must accept repoId parameter
		expect(mergeSource).toContain("repoId?: string");
		// mergeWaveByRepo must pass group.repoId
		expect(mergeSource).toContain("group.repoId");
	});

	it("3.6: repoId sanitization removes special characters", () => {
		// The regex replaces anything that isn't alphanumeric, underscore, or hyphen
		expect(mergeSource).toContain("[^a-zA-Z0-9_-]");
	});

	it("3.7: mergeWaveByRepo excludes verification_new_failure from success counting (TP-032 R006-3)", () => {
		// mergeWaveByRepo must also use the !r.error guard
		const byRepoSection = mergeSource.indexOf("mergeWaveByRepo");
		expect(byRepoSection).toBeGreaterThan(-1);
		const afterByRepo = mergeSource.slice(byRepoSection);
		expect(afterByRepo).toContain("Exclude verification_new_failure lanes from success determination");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Diff algorithm: pre-existing vs new failure, deduplication, fixed
// ══════════════════════════════════════════════════════════════════════

describe("Diff algorithm comprehensive tests", () => {
	it("4.1: pre-existing failures do not block merge (appear in preExisting, not newFailures)", () => {
		const baseline = [
			fp("test", "src/a.test.ts", "flaky test", "assertion_error", "sometimes fails"),
			fp("test", "src/b.test.ts", "known bug", "runtime_error", "TypeError: undefined"),
		];
		const postMerge = [
			fp("test", "src/a.test.ts", "flaky test", "assertion_error", "sometimes fails"),
			fp("test", "src/b.test.ts", "known bug", "runtime_error", "TypeError: undefined"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(2);
		expect(diff.fixed).toHaveLength(0);
	});

	it("4.2: new failures correctly detected when mixed with pre-existing", () => {
		const baseline = [
			fp("test", "src/old.test.ts", "old failure", "assertion_error", "old msg"),
		];
		const postMerge = [
			fp("test", "src/old.test.ts", "old failure", "assertion_error", "old msg"),
			fp("test", "src/new.test.ts", "new regression", "assertion_error", "new msg"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.newFailures[0].case).toBe("new regression");
		expect(diff.preExisting).toHaveLength(1);
	});

	it("4.3: fixed failures detected correctly", () => {
		const baseline = [
			fp("test", "src/a.test.ts", "was broken", "assertion_error", "fixed now"),
			fp("test", "src/b.test.ts", "still broken", "assertion_error", "still bad"),
		];
		const postMerge = [
			fp("test", "src/b.test.ts", "still broken", "assertion_error", "still bad"),
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(1);
		expect(diff.fixed).toHaveLength(1);
		expect(diff.fixed[0].case).toBe("was broken");
	});

	it("4.4: deduplication before diffing prevents false positives", () => {
		const baseline = [
			fp("test", "a.ts", "t1", "assertion_error", "msg"),
			fp("test", "a.ts", "t1", "assertion_error", "msg"), // dup
		];
		const postMerge = [
			fp("test", "a.ts", "t1", "assertion_error", "msg"),
			fp("test", "a.ts", "t1", "assertion_error", "msg"), // dup
			fp("test", "a.ts", "t1", "assertion_error", "msg"), // dup
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(1); // deduplicated
	});

	it("4.5: composite key uses all five fields — same file/case but different kind is new", () => {
		const baseline = [
			fp("test", "a.ts", "test1", "assertion_error", "msg"),
		];
		const postMerge = [
			fp("test", "a.ts", "test1", "runtime_error", "msg"), // different kind
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.fixed).toHaveLength(1);
	});

	it("4.6: composite key uses all five fields — same file/case but different commandId is new", () => {
		const baseline = [
			fp("unit", "a.ts", "test1", "assertion_error", "msg"),
		];
		const postMerge = [
			fp("e2e", "a.ts", "test1", "assertion_error", "msg"), // different commandId
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.fixed).toHaveLength(1);
	});

	it("4.7: composite key uses all five fields — same except messageNorm is new", () => {
		const baseline = [
			fp("test", "a.ts", "test1", "assertion_error", "expected 1 to be 2"),
		];
		const postMerge = [
			fp("test", "a.ts", "test1", "assertion_error", "expected 1 to be 3"), // different msg
		];

		const diff = diffFingerprints(baseline, postMerge);
		expect(diff.newFailures).toHaveLength(1);
		expect(diff.fixed).toHaveLength(1);
	});

	it("4.8: empty baseline + empty postMerge = clean diff", () => {
		const diff = diffFingerprints([], []);
		expect(diff.newFailures).toHaveLength(0);
		expect(diff.preExisting).toHaveLength(0);
		expect(diff.fixed).toHaveLength(0);
	});

	it("4.9: deduplicateFingerprints preserves first occurrence", () => {
		const fps = [
			fp("test", "a.ts", "t1", "assertion_error", "msg1"),
			fp("test", "b.ts", "t2", "assertion_error", "msg2"),
			fp("test", "a.ts", "t1", "assertion_error", "msg1"), // dup of first
		];

		const deduped = deduplicateFingerprints(fps);
		expect(deduped).toHaveLength(2);
		expect(deduped[0].file).toBe("a.ts");
		expect(deduped[1].file).toBe("b.ts");
	});

	it("4.10: fingerprintKey uses null byte separator", () => {
		const key = fingerprintKey(fp("test", "a.ts", "case1", "assertion_error", "msg"));
		expect(key).toBe("test\0a.ts\0case1\0assertion_error\0msg");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Flaky handling tests
// ══════════════════════════════════════════════════════════════════════

describe("Flaky handling: flakyReruns control paths (source verification)", () => {
	const mergeSource = readSource("merge.ts");

	it("5.1: flakyReruns=0 → no re-run loop executed", () => {
		// The code must guard re-runs with flakyReruns > 0
		expect(mergeSource).toContain("if (flakyReruns > 0)");
		// When flakyReruns is 0, must fall through to immediate block
		expect(mergeSource).toContain("flakyReruns === 0 or fallthrough");
	});

	it("5.2: flakyReruns=0 → classification is verification_new_failure (not flaky_suspected)", () => {
		// After the flakyReruns === 0 fallthrough, classification must be verification_new_failure
		const fallIdx = mergeSource.indexOf("flakyReruns === 0 or fallthrough");
		expect(fallIdx).toBeGreaterThan(-1);
		const afterFall = mergeSource.slice(fallIdx, fallIdx + 700);
		expect(afterFall).toContain('"verification_new_failure"');
	});

	it("5.3: cleared re-run → flaky_suspected classification", () => {
		expect(mergeSource).toContain('"flaky_suspected"');
		expect(mergeSource).toContain("clearedOnRerun = true");
	});

	it("5.4: flaky re-run only re-runs commands that produced new failures", () => {
		// Must extract failed commandIds from diff.newFailures
		expect(mergeSource).toContain("failedCommandIds");
		expect(mergeSource).toContain("diff.newFailures.map(fp => fp.commandId)");
	});

	it("5.5: flaky re-run re-diffs against baseline (not full post-merge)", () => {
		// The re-run diff should compare baseline against re-run, not against original post-merge
		expect(mergeSource).toContain("baselineForRerun");
		expect(mergeSource).toContain("baseline.fingerprints.filter(fp => failedCommandIds.has(fp.commandId))");
	});

	it("5.6: flakyReruns > 1 iterates up to N times with early break", () => {
		expect(mergeSource).toContain("attempt < flakyReruns");
		expect(mergeSource).toContain("break");
	});

	it("5.7: if all flakyReruns fail, classification is verification_new_failure (not flaky_suspected)", () => {
		// On last attempt with persisting failures, return verification_new_failure
		expect(mergeSource).toContain("attempt === flakyReruns - 1");
		// After this check, must return verification_new_failure
		const lastAttemptIdx = mergeSource.indexOf("attempt === flakyReruns - 1");
		const afterLastAttempt = mergeSource.slice(lastAttemptIdx, lastAttemptIdx + 600);
		expect(afterLastAttempt).toContain('"verification_new_failure"');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Mode behavior: strict/permissive
// ══════════════════════════════════════════════════════════════════════

describe("Mode behavior: strict/permissive (source verification)", () => {
	const mergeSource = readSource("merge.ts");

	it("6.1: strict mode on missing commands → status: 'failed' in return", () => {
		const strictBlock = mergeSource.indexOf("strict mode: failing merge");
		expect(strictBlock).toBeGreaterThan(-1);
		const afterStrict = mergeSource.slice(strictBlock, strictBlock + 500);
		expect(afterStrict).toContain('status: "failed"');
	});

	it("6.2: permissive mode on missing commands → does not return failure", () => {
		const permBlock = mergeSource.indexOf("permissive mode: continuing without verification");
		expect(permBlock).toBeGreaterThan(-1);
		// Should NOT have a return in the next ~200 chars
		const afterPerm = mergeSource.slice(permBlock, permBlock + 200);
		expect(afterPerm).not.toContain("return {");
	});

	it("6.3: strict mode on baseline capture failure → returns merge failure", () => {
		expect(mergeSource).toContain("Verification baseline capture failed (strict mode):");
		const captureFailStrict = mergeSource.indexOf("baseline capture failed — strict mode: failing merge");
		expect(captureFailStrict).toBeGreaterThan(-1);
		const afterCaptureFail = mergeSource.slice(captureFailStrict, captureFailStrict + 500);
		expect(afterCaptureFail).toContain('status: "failed"');
	});

	it("6.4: permissive mode on baseline capture failure → sets baseline = null, continues", () => {
		const permCaptureFail = mergeSource.indexOf("permissive mode: continuing without baseline verification");
		expect(permCaptureFail).toBeGreaterThan(-1);
		const afterPermCapture = mergeSource.slice(permCaptureFail, permCaptureFail + 500);
		expect(afterPermCapture).toContain("baseline = null");
	});

	it("6.5: strict mode cleans up worktree and temp branch before returning", () => {
		// For both no-commands and capture-failure strict paths
		const strictBlocks = [...mergeSource.matchAll(/strict mode: failing merge/g)];
		expect(strictBlocks.length).toBeGreaterThanOrEqual(1);

		// Check that forceRemoveMergeWorktree appears near each strict mode path
		// (cleanup happens after the log message, before the return)
		for (const match of strictBlocks) {
			const idx = match.index!;
			const blockAfter = mergeSource.slice(idx, idx + 500);
			// forceRemoveMergeWorktree should appear between the log and the return
			expect(blockAfter).toContain("forceRemoveMergeWorktree");
		}
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Normalization correctness
// ══════════════════════════════════════════════════════════════════════

describe("normalizeMessage correctness", () => {
	it("7.1: strips ANSI escape sequences", () => {
		expect(normalizeMessage("\x1B[31mError\x1B[0m")).toBe("Error");
	});

	it("7.2: normalizes backslashes to forward slashes", () => {
		expect(normalizeMessage("src\\utils\\math.ts")).toBe("src/utils/math.ts");
	});

	it("7.3: removes duration strings", () => {
		expect(normalizeMessage("test passed (42ms)")).toBe("test passed");
		expect(normalizeMessage("test passed (1.2s)")).toBe("test passed");
	});

	it("7.4: removes ISO-8601 timestamps", () => {
		expect(normalizeMessage("Error at 2026-03-20T12:34:56.789Z")).toBe("Error at");
	});

	it("7.5: collapses whitespace", () => {
		expect(normalizeMessage("  too   much   space  ")).toBe("too much space");
	});

	it("7.6: truncates to 512 chars", () => {
		const long = "a".repeat(600);
		expect(normalizeMessage(long).length).toBe(512);
	});

	it("7.7: combined normalization produces stable fingerprint", () => {
		const msg1 = "\x1B[31mError in src\\test.ts (42ms) at 2026-03-20T12:34:56Z\x1B[0m";
		const msg2 = "Error in src/test.ts at";
		// After normalization, both should produce the same stable output
		const norm1 = normalizeMessage(msg1);
		expect(norm1).toBe("Error in src/test.ts at");
		expect(norm1).toBe(msg2);
	});
});
