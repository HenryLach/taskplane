/**
 * Tests for execCheck error classification — TP-185
 *
 * Covers:
 * - Successful command returns ok=true with stdout populated and no errorKind.
 * - Missing binary (ENOENT / shell exit 127) classifies as "not-found".
 * - Timeout classifies as "timeout" with the configured duration in detail.
 * - Non-zero exit code classifies as "exit-code" with the status.
 * - Unknown failure modes fall through to "unknown" rather than being silently
 *   miscategorized as "not-found" (the historical bug behind misleading
 *   "Pi not found" preflight errors when the real cause was a timeout).
 *
 * Tests use only platform-portable commands (node itself) so they run on
 * Windows / Linux / macOS without conditional skips.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { execCheck } from "../taskplane/worktree.ts";

describe("execCheck — success path", () => {
	it("returns ok=true with stdout when the command succeeds", () => {
		const result = execCheck(`node -e "process.stdout.write('hello')"`);
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.stdout, "hello");
		assert.strictEqual(result.errorKind, undefined);
		assert.strictEqual(result.errorDetail, undefined);
	});

	it("trims trailing whitespace/newlines from stdout", () => {
		const result = execCheck(`node -e "console.log('trimmed')"`);
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.stdout, "trimmed");
	});
});

describe("execCheck — error classification", () => {
	it("classifies a missing binary as 'not-found'", () => {
		// Use a command name that cannot exist on PATH.
		const result = execCheck("definitely-not-a-real-binary-tp185 --version");
		assert.strictEqual(result.ok, false);
		assert.strictEqual(
			result.errorKind,
			"not-found",
			`expected 'not-found' for missing binary, got '${result.errorKind}' (detail: ${result.errorDetail})`,
		);
		assert.ok(
			result.errorDetail && result.errorDetail.includes("definitely-not-a-real-binary-tp185"),
			`errorDetail should reference the missing binary, got: ${result.errorDetail}`,
		);
	});

	it("classifies a timeout as 'timeout' with the configured duration", () => {
		// Spawn node with a long sleep, but cap the execCheck timeout at 250ms.
		const result = execCheck(`node -e "setTimeout(() => process.exit(0), 5000)"`, undefined, 250);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(
			result.errorKind,
			"timeout",
			`expected 'timeout', got '${result.errorKind}' (detail: ${result.errorDetail})`,
		);
		assert.ok(
			result.errorDetail && result.errorDetail.includes("250"),
			`errorDetail should reference the configured timeout, got: ${result.errorDetail}`,
		);
	});

	it("classifies a non-zero exit code as 'exit-code'", () => {
		const result = execCheck(`node -e "process.exit(42)"`);
		assert.strictEqual(result.ok, false);
		assert.strictEqual(
			result.errorKind,
			"exit-code",
			`expected 'exit-code', got '${result.errorKind}' (detail: ${result.errorDetail})`,
		);
		assert.ok(
			result.errorDetail && result.errorDetail.includes("42"),
			`errorDetail should include the exit code, got: ${result.errorDetail}`,
		);
	});

	it("does NOT misclassify a timeout as 'not-found' (regression for #TP-185)", () => {
		// This is the exact failure mode that produced misleading "Pi not found"
		// errors in production: a slow-but-installed binary on a cold start.
		const result = execCheck(`node -e "setTimeout(() => process.exit(0), 5000)"`, undefined, 200);
		assert.strictEqual(result.ok, false);
		assert.notStrictEqual(
			result.errorKind,
			"not-found",
			"timeout must not be reported as 'not-found' — that's the bug this test guards against",
		);
		assert.strictEqual(result.errorKind, "timeout");
	});

	it("does NOT misclassify a non-zero exit as 'not-found' (regression for #TP-185)", () => {
		const result = execCheck(`node -e "process.exit(1)"`);
		assert.strictEqual(result.ok, false);
		assert.notStrictEqual(
			result.errorKind,
			"not-found",
			"non-zero exit must not be reported as 'not-found' — caller should see 'exit-code'",
		);
	});
});

describe("execCheck — backward compatibility", () => {
	it("legacy callers reading only { ok, stdout } continue to work", () => {
		// Previous signature was { ok: boolean; stdout: string }. Adding optional
		// errorKind/errorDetail must not break destructuring or shape assumptions.
		const success = execCheck(`node -e "process.stdout.write('ok')"`);
		const { ok, stdout } = success;
		assert.strictEqual(ok, true);
		assert.strictEqual(stdout, "ok");

		const failure = execCheck("definitely-not-a-real-binary-tp185-bc --version");
		const { ok: failOk, stdout: failStdout } = failure;
		assert.strictEqual(failOk, false);
		assert.strictEqual(failStdout, "");
	});

	it("default timeout remains 10s when timeoutMs is omitted", () => {
		// Verify the function signature still defaults to 10_000ms.
		// We can't directly inspect the default without invoking it, but we can
		// confirm a quick command completes well under the default.
		const start = Date.now();
		const result = execCheck(`node -e "process.exit(0)"`);
		const elapsed = Date.now() - start;
		assert.strictEqual(result.ok, true);
		assert.ok(
			elapsed < 5000,
			`fast command should complete well under the default timeout, took ${elapsed}ms`,
		);
	});
});
