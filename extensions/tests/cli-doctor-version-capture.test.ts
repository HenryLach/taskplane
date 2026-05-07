/**
 * Behavioral test for `bin/get-version.mjs`'s `getVersion()` capture
 * fix — TP-189-C / TP-185 follow-up.
 *
 * Original bug: `taskplane doctor` displayed `✅ pi installed ()` with
 * empty parens because pi prints its `--version` output to stderr but
 * the prior `execSync(... { stdio: 'pipe' })` only captured stdout.
 *
 * Fix: `getVersion()` now uses `spawnSync` with stdio:['ignore','pipe','pipe']
 * and applies stdout-precedence with stderr fallback. Critically, it
 * also preserves the prior fail-safe contract: non-zero subprocess exit
 * (or `result.error`) returns `null` instead of leaking shell error text
 * as a fake version string (R008 follow-up).
 *
 * The function lives in its own module so we can exercise it with real
 * subprocesses (Node's own `node` invocation as a stand-in for arbitrary
 * CLIs) instead of source-pattern checks.
 *
 * Run:
 *   cd extensions && node --experimental-strip-types --experimental-test-module-mocks \\
 *     --no-warnings --import ./tests/loader.mjs \\
 *     --test tests/cli-doctor-version-capture.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// `bin/get-version.mjs` is plain ESM JavaScript (no .ts) so we import
// it directly. Path is relative to extensions/tests/.
// @ts-expect-error -- .mjs sibling without types; runtime import is fine.
import { getVersion } from "../../bin/get-version.mjs";

const NODE = process.execPath;

describe("TP-189-C — getVersion() behavioral capture (success cases)", () => {
	it("returns trimmed stdout when the command writes its version to stdout", () => {
		const result = getVersion(
			`"${NODE}" -e "process.stdout.write('1.2.3')"`,
			"",
		);
		assert.strictEqual(result, "1.2.3");
	});

	it("falls back to stderr when stdout is empty (the pi --version case)", () => {
		const result = getVersion(
			`"${NODE}" -e "process.stderr.write('0.73.0')"`,
			"",
		);
		assert.strictEqual(result, "0.73.0");
	});

	it("prefers stdout over stderr when both are non-empty", () => {
		const result = getVersion(
			`"${NODE}" -e "process.stdout.write('STDOUT'); process.stderr.write('STDERR')"`,
			"",
		);
		assert.strictEqual(result, "STDOUT");
	});

	it("trims surrounding whitespace from the captured stream", () => {
		const result = getVersion(
			`"${NODE}" -e "process.stdout.write('  v9.9.9  \\n')"`,
			"",
		);
		assert.strictEqual(result, "v9.9.9");
	});
});

describe("TP-189-C — getVersion() fail-safe contract (R008 follow-up)", () => {
	it("returns null when the subprocess exits non-zero, even if stderr has text (does not leak shell error as fake version)", () => {
		// Pre-fix regression: spawnSync does NOT throw on non-zero exit,
		// so without an explicit status guard the function would return
		// `command not found`-style error prose as a fake version. The
		// guard `if (result.error || result.status !== 0) return null;`
		// preserves the prior execSync-throws-on-failure contract.
		const result = getVersion(
			`"${NODE}" -e "process.stderr.write('boom'); process.exit(1)"`,
			"",
		);
		assert.strictEqual(
			result,
			null,
			"non-zero exit must return null, not the stderr error text",
		);
	});

	it("returns null for a guaranteed-nonexistent command", () => {
		// Even if the shell prints "command not found"-style text, our
		// fail-safe rules treat the nonzero exit as failure → null.
		const result = getVersion("__taskplane_definitely_no_such_cmd_zz12__");
		assert.strictEqual(result, null);
	});

	it("returns null when both stdout and stderr are empty on a successful exit", () => {
		const result = getVersion(`"${NODE}" -e ""`, "");
		assert.strictEqual(result, null);
	});
});
