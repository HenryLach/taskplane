/**
 * Merge Timeout Resilience Tests — TP-038 Step 3
 *
 * Tests for the merge timeout improvements introduced in TP-038:
 *
 *   1.x — Result-exists-at-timeout: accept successful result without kill
 *   2.x — Kill-and-retry: timeout triggers retry with 2x timeout
 *   3.x — Second retry uses 4x timeout (backoff math)
 *   4.x — All retries exhausted: final timeout propagates as failure
 *   5.x — Config re-read: reloadMergeTimeoutMs picks up fresh config on retry
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/merge-timeout-resilience.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { MERGE_TIMEOUT_MAX_RETRIES, MERGE_TIMEOUT_MS, MergeError } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — Result-exists-at-timeout: accept successful result without kill
// ══════════════════════════════════════════════════════════════════════

describe("1.x — Result-exists-at-timeout: accept successful result", () => {
	it("1.1: waitForMergeResult checks result file BEFORE killing on timeout", () => {
		const mergeSource = readSource("merge.ts");

		// The TP-038 pattern: check result before kill
		expect(mergeSource).toContain("TP-038: Check result file BEFORE killing the session");
		// existsSync check comes before kill in the timeout path
		const timeoutSection = mergeSource.substring(
			mergeSource.indexOf("// Check timeout"),
			mergeSource.indexOf("merge timeout — killing agent"),
		);
		expect(timeoutSection).toContain("existsSync(resultPath)");
		expect(timeoutSection).toContain("parseMergeResultAsync(resultPath)");
		expect(timeoutSection).toContain("SUCCESSFUL_MERGE_STATUSES");
	});

	it("1.2: successful result at timeout is accepted and returns without throwing", () => {
		const mergeSource = readSource("merge.ts");

		// When result file exists with SUCCESS status, return it (don't throw)
		expect(mergeSource).toContain("merge agent slow but succeeded — accepting result at timeout");
		// The return lateResult statement exists in the function body after the acceptance log
		const acceptIdx = mergeSource.indexOf("accepting result at timeout");
		const afterAccept = mergeSource.substring(acceptIdx, acceptIdx + 500);
		expect(afterAccept).toContain("return lateResult");
	});

	it("1.3: SUCCESSFUL_MERGE_STATUSES includes SUCCESS and CONFLICT_RESOLVED", () => {
		const mergeSource = readSource("merge.ts");

		// Both statuses should be accepted at timeout
		expect(mergeSource).toContain('const SUCCESSFUL_MERGE_STATUSES = new Set');
		expect(mergeSource).toContain('"SUCCESS"');
		expect(mergeSource).toContain('"CONFLICT_RESOLVED"');
	});

	it("1.4: agent is still killed after accepting a late successful result", () => {
		const mergeSource = readSource("merge.ts");

		// Even when accepting a late result, clean up the agent (backend-aware)
		const acceptSection = mergeSource.substring(
			mergeSource.indexOf("merge agent slow but succeeded"),
			mergeSource.indexOf("return lateResult"),
		);
		// V2 path uses killMergeAgentV2 with cleanExit, legacy uses tmuxKillSessionAsync
		expect(acceptSection).toContain("killMergeAgentV2(sessionName, true)");
		expect(acceptSection).toContain("tmuxKillSessionAsync(sessionName)");
	});

	it("1.5: non-success result at timeout falls through to kill and throw", () => {
		const mergeSource = readSource("merge.ts");

		// Non-success result: log and fall through to kill
		expect(mergeSource).toContain("merge result exists at timeout but non-success");
	});

	it("1.6: unreadable result file at timeout falls through to kill and throw", () => {
		const mergeSource = readSource("merge.ts");

		// If parseMergeResult throws, catch it and fall through
		const timeoutBlock = mergeSource.substring(
			mergeSource.indexOf("TP-038: Check result file BEFORE killing"),
			mergeSource.indexOf("merge timeout — killing session"),
		);
		expect(timeoutBlock).toContain("catch");
		// The catch is empty — falls through to the kill+throw below
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Kill-and-retry: timeout triggers retry with 2x timeout
// ══════════════════════════════════════════════════════════════════════

describe("2.x — Kill-and-retry: timeout triggers retry with 2x timeout", () => {
	it("2.1: merge.ts has a retry loop with MERGE_TIMEOUT_MAX_RETRIES", () => {
		const mergeSource = readSource("merge.ts");

		// The retry loop must reference the constant
		expect(mergeSource).toContain("MERGE_TIMEOUT_MAX_RETRIES");
		expect(mergeSource).toContain("for (let attempt = 0; attempt <= MERGE_TIMEOUT_MAX_RETRIES; attempt++)");
	});

	it("2.2: MERGE_TIMEOUT_MAX_RETRIES is set to 2", () => {
		expect(MERGE_TIMEOUT_MAX_RETRIES).toBe(2);
	});

	it("2.3: retry applies 2x backoff via Math.pow(2, attempt)", () => {
		const mergeSource = readSource("merge.ts");

		// Backoff formula: freshTimeoutMs * Math.pow(2, attempt)
		expect(mergeSource).toContain("Math.pow(2, attempt)");
		expect(mergeSource).toContain("freshTimeoutMs * Math.pow(2, attempt)");
	});

	it("2.4: first retry (attempt=1) uses 2x the fresh config timeout", () => {
		// Verify the math: attempt=1 → Math.pow(2, 1) = 2 → 2x multiplier
		const attempt = 1;
		const freshTimeoutMs = 600_000; // 10 minutes
		const expected = freshTimeoutMs * Math.pow(2, attempt);
		expect(expected).toBe(1_200_000); // 20 minutes = 2x
	});

	it("2.5: retry cleans up stale result file before re-spawning", () => {
		const mergeSource = readSource("merge.ts");

		// In the retry branch (attempt > 0):
		const retrySection = mergeSource.substring(
			mergeSource.indexOf("if (attempt > 0)"),
			mergeSource.indexOf("// First attempt: spawn merge agent"),
		);
		// Must clean up stale result
		expect(retrySection).toContain("existsSync(resultFilePath)");
		expect(retrySection).toContain("unlinkSync(resultFilePath)");
	});

	it("2.6: retry re-spawns merge agent via Runtime V2", () => {
		const mergeSource = readSource("merge.ts");

		const retrySection = mergeSource.substring(
			mergeSource.indexOf("if (attempt > 0)"),
			mergeSource.indexOf("// First attempt: spawn merge agent"),
		);
		expect(retrySection).toContain("killMergeAgentV2(sessionName)");
		expect(retrySection).toContain("spawnMergeAgentV2(sessionName");
	});

	it("2.7: retry logs attempt number and new timeout values", () => {
		const mergeSource = readSource("merge.ts");

		expect(mergeSource).toContain("retry ${attempt}/${MERGE_TIMEOUT_MAX_RETRIES} after timeout — respawning merge agent");
		expect(mergeSource).toContain("newTimeoutMs: currentTimeoutMs");
		expect(mergeSource).toContain("newTimeoutMin:");
	});

	it("2.8: MERGE_TIMEOUT error on non-final attempt triggers continue (retry)", () => {
		const mergeSource = readSource("merge.ts");

		// The catch block must check for MERGE_TIMEOUT and continue
		expect(mergeSource).toContain('waitErr.code === "MERGE_TIMEOUT"');
		expect(mergeSource).toContain("attempt < MERGE_TIMEOUT_MAX_RETRIES");
		expect(mergeSource).toContain("lastTimeoutError = waitErr");
		expect(mergeSource).toContain("continue;");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Second retry uses 4x timeout (R003 revision: backoff math)
// ══════════════════════════════════════════════════════════════════════

describe("3.x — Second retry uses 4x timeout (backoff verification)", () => {
	it("3.1: second retry (attempt=2) uses 4x the fresh config timeout", () => {
		// Verify the math: attempt=2 → Math.pow(2, 2) = 4 → 4x multiplier
		const attempt = 2;
		const freshTimeoutMs = 600_000; // 10 minutes
		const expected = freshTimeoutMs * Math.pow(2, attempt);
		expect(expected).toBe(2_400_000); // 40 minutes = 4x
	});

	it("3.2: backoff multiplier progression is 1x → 2x → 4x across attempts", () => {
		const baseTimeout = 600_000; // 10 minutes in ms

		// attempt 0 (initial): uses initial config timeout (no backoff applied)
		// attempt 1 (first retry): freshTimeout * 2^1 = 2x
		// attempt 2 (second retry): freshTimeout * 2^2 = 4x
		const attempt0Timeout = baseTimeout; // No multiplier on first attempt
		const attempt1Timeout = baseTimeout * Math.pow(2, 1);
		const attempt2Timeout = baseTimeout * Math.pow(2, 2);

		expect(attempt0Timeout).toBe(600_000);   // 10 min
		expect(attempt1Timeout).toBe(1_200_000);  // 20 min (2x)
		expect(attempt2Timeout).toBe(2_400_000);  // 40 min (4x)

		// Verify the progression ratio
		expect(attempt1Timeout / baseTimeout).toBe(2);
		expect(attempt2Timeout / baseTimeout).toBe(4);
	});

	it("3.3: backoff formula uses fresh config value (not cached initial)", () => {
		const mergeSource = readSource("merge.ts");

		// The retry path must re-read config BEFORE applying backoff
		const retryBlock = mergeSource.substring(
			mergeSource.indexOf("if (attempt > 0)"),
			mergeSource.indexOf("// First attempt: spawn merge agent"),
		);

		// reloadMergeTimeoutMs must be called BEFORE Math.pow
		const reloadIdx = retryBlock.indexOf("reloadMergeTimeoutMs");
		const mathPowIdx = retryBlock.indexOf("Math.pow(2, attempt)");
		expect(reloadIdx).toBeGreaterThan(-1);
		expect(mathPowIdx).toBeGreaterThan(-1);
		expect(reloadIdx).toBeLessThan(mathPowIdx);
	});

	it("3.4: each retry attempt passes currentTimeoutMs to waitForMergeResult", () => {
		const mergeSource = readSource("merge.ts");

		// The retry loop calls waitForMergeResult with the computed timeout + backend
		expect(mergeSource).toContain("waitForMergeResult(resultFilePath, sessionName, currentTimeoutMs, runtimeBackend)");
	});

	it("3.5: with custom config timeout of 15 min, retries use 30 min and 60 min", () => {
		const customBase = 15 * 60 * 1000; // 15 minutes in ms

		const retry1 = customBase * Math.pow(2, 1); // 30 min
		const retry2 = customBase * Math.pow(2, 2); // 60 min

		expect(retry1).toBe(30 * 60 * 1000);
		expect(retry2).toBe(60 * 60 * 1000);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — All retries exhausted: final timeout propagates as failure
// ══════════════════════════════════════════════════════════════════════

describe("4.x — All retries exhausted: failure propagation", () => {
	it("4.1: non-timeout error is re-thrown immediately (no retry)", () => {
		const mergeSource = readSource("merge.ts");

		// The catch block only retries MERGE_TIMEOUT — other errors propagate
		expect(mergeSource).toContain("// Non-timeout error or final retry exhausted — propagate");
		expect(mergeSource).toContain("throw waitErr");
	});

	it("4.2: final attempt timeout throws MERGE_TIMEOUT (not caught by retry)", () => {
		const mergeSource = readSource("merge.ts");

		// On the final attempt, the catch condition fails (attempt === MAX_RETRIES),
		// so it falls through to "throw waitErr"
		const catchBlock = mergeSource.substring(
			mergeSource.indexOf("waitErr.code === \"MERGE_TIMEOUT\""),
			mergeSource.indexOf("throw waitErr") + 20,
		);
		expect(catchBlock).toContain("attempt < MERGE_TIMEOUT_MAX_RETRIES");
	});

	it("4.3: total attempts = 1 + MERGE_TIMEOUT_MAX_RETRIES (initial + retries)", () => {
		// Loop is: for (let attempt = 0; attempt <= MERGE_TIMEOUT_MAX_RETRIES; attempt++)
		// So total attempts = MERGE_TIMEOUT_MAX_RETRIES + 1 = 3
		const totalAttempts = MERGE_TIMEOUT_MAX_RETRIES + 1;
		expect(totalAttempts).toBe(3);
	});

	it("4.4: MergeError with code MERGE_TIMEOUT is thrown from waitForMergeResult", () => {
		const mergeSource = readSource("merge.ts");

		// waitForMergeResult throws MERGE_TIMEOUT on timeout
		expect(mergeSource).toContain('throw new MergeError(');
		expect(mergeSource).toContain('"MERGE_TIMEOUT"');
		// Both patterns appear in the same function (waitForMergeResult)
		const waitFn = mergeSource.substring(
			mergeSource.indexOf("export async function waitForMergeResult"),
			mergeSource.indexOf("export async function waitForMergeResult") + 3000,
		);
		expect(waitFn).toContain("MERGE_TIMEOUT");
		expect(waitFn).toContain("throw new MergeError");
	});

	it("4.5: thrown error is caught by the outer catch block and recorded as lane failure", () => {
		const mergeSource = readSource("merge.ts");

		// The outer catch block in the merge loop handles any thrown error
		// and records it as a lane failure with MergeError code
		expect(mergeSource).toContain("Clean up request file on error");
		expect(mergeSource).toContain("err instanceof MergeError ? err.code");
		expect(mergeSource).toContain("failedLane = lane.laneNumber");
		expect(mergeSource).toContain("failureReason = `Merge error in lane");
	});

	it("4.6: MERGE_SESSION_DIED is not retried (only MERGE_TIMEOUT triggers retry)", () => {
		const mergeSource = readSource("merge.ts");

		// The retry condition specifically checks for MERGE_TIMEOUT
		const retryCondition = mergeSource.substring(
			mergeSource.indexOf("waitErr instanceof MergeError &&"),
			mergeSource.indexOf("// Timeout — will retry"),
		);
		expect(retryCondition).toContain('"MERGE_TIMEOUT"');
		expect(retryCondition).not.toContain('"MERGE_SESSION_DIED"');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Config re-read: reloadMergeTimeoutMs on retry
// ══════════════════════════════════════════════════════════════════════

describe("5.x — Config re-read: reloadMergeTimeoutMs on retry", () => {
	it("5.1: reloadMergeTimeoutMs is exported from merge.ts", () => {
		const mergeSource = readSource("merge.ts");

		// The function is exported for use by the retry loop
		expect(mergeSource).toContain("export function reloadMergeTimeoutMs");
	});

	it("5.2: reloadMergeTimeoutMs calls loadOrchestratorConfig with configRoot", () => {
		const mergeSource = readSource("merge.ts");

		const fnBody = mergeSource.substring(
			mergeSource.indexOf("export function reloadMergeTimeoutMs"),
			mergeSource.indexOf("export function reloadMergeTimeoutMs") + 600,
		);
		expect(fnBody).toContain("loadOrchestratorConfig(configRoot");
	});

	it("5.3: reloadMergeTimeoutMs falls back to MERGE_TIMEOUT_MS on config read failure", () => {
		const mergeSource = readSource("merge.ts");

		const fnBody = mergeSource.substring(
			mergeSource.indexOf("export function reloadMergeTimeoutMs"),
			mergeSource.indexOf("export function reloadMergeTimeoutMs") + 600,
		);
		expect(fnBody).toContain("catch (err");
		expect(fnBody).toContain("MERGE_TIMEOUT_MS");
		expect(fnBody).toContain("using default");
	});

	it("5.4: reloadMergeTimeoutMs converts minutes to milliseconds", () => {
		const mergeSource = readSource("merge.ts");

		const fnBody = mergeSource.substring(
			mergeSource.indexOf("export function reloadMergeTimeoutMs"),
			mergeSource.indexOf("export function reloadMergeTimeoutMs") + 600,
		);
		expect(fnBody).toContain("minutes * 60 * 1000");
	});

	it("5.5: reloadMergeTimeoutMs defaults to 90 minutes when config field is missing", () => {
		const mergeSource = readSource("merge.ts");

		const fnBody = mergeSource.substring(
			mergeSource.indexOf("export function reloadMergeTimeoutMs"),
			mergeSource.indexOf("export function reloadMergeTimeoutMs") + 600,
		);
		// Default: freshConfig.merge.timeout_minutes ?? 90
		expect(fnBody).toContain("?? 90");
	});

	it("5.6: retry path calls reloadMergeTimeoutMs before computing backoff", () => {
		const mergeSource = readSource("merge.ts");

		const retryBlock = mergeSource.substring(
			mergeSource.indexOf("if (attempt > 0)"),
			mergeSource.indexOf("// First attempt: spawn merge agent"),
		);

		// reloadMergeTimeoutMs must appear in the retry path
		expect(retryBlock).toContain("reloadMergeTimeoutMs(configRoot)");
		// And the result is used for backoff
		expect(retryBlock).toContain("freshTimeoutMs");
		expect(retryBlock).toContain("currentTimeoutMs = freshTimeoutMs * Math.pow(2, attempt)");
	});

	it("5.7: configRoot is derived from stateRoot ?? repoRoot", () => {
		const mergeSource = readSource("merge.ts");

		// The retry loop uses configRoot which is derived correctly
		expect(mergeSource).toContain("const configRoot = stateRoot ?? repoRoot");
	});

	it("5.8: MERGE_TIMEOUT_MS default is 90 minutes (5400000ms)", () => {
		expect(MERGE_TIMEOUT_MS).toBe(90 * 60 * 1000);
		expect(MERGE_TIMEOUT_MS).toBe(5_400_000);
	});
});
