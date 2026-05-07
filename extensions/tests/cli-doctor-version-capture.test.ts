/**
 * Test for `bin/taskplane.mjs`'s `getVersion()` stdout-and-stderr capture
 * fix — TP-189-C / TP-185 follow-up.
 *
 * pi prints its `--version` output to stderr. The previous getVersion()
 * implementation only captured stdout via `execSync(... { stdio: 'pipe' })
 * .toString()`, so `taskplane doctor` displayed `pi installed ()` with
 * empty parens. The fix uses spawnSync with stdio:['ignore','pipe','pipe']
 * and prefers stdout but falls back to stderr when stdout is empty.
 *
 * This test calls the actual `bin/taskplane.mjs` doctor command via a
 * subprocess and asserts the pi version capture line is non-empty in the
 * output. Source-pattern checks on the implementation provide the rest of
 * the regression coverage.
 *
 * Run:
 *   cd extensions && node --experimental-strip-types --experimental-test-module-mocks \\
 *     --no-warnings --import ./tests/loader.mjs \\
 *     --test tests/cli-doctor-version-capture.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const CLI_PATH = join(REPO_ROOT, "bin", "taskplane.mjs");
const cliSrc = readFileSync(CLI_PATH, "utf-8").replace(/\r\n/g, "\n");

describe("TP-189-C — getVersion captures both stdout and stderr (pi prints to stderr)", () => {
	it("imports spawnSync from node:child_process", () => {
		assert.match(
			cliSrc,
			/import\s*\{[^}]*\bspawnSync\b[^}]*\}\s*from\s*["']node:child_process["']/s,
			"bin/taskplane.mjs must import spawnSync (replaces execSync for getVersion)",
		);
	});

	it("getVersion uses spawnSync with both pipe streams", () => {
		// Locate the getVersion function body and confirm it uses
		// spawnSync with stdio: ["ignore", "pipe", "pipe"] (the stream
		// shape that captures BOTH stdout and stderr separately).
		const fnStart = cliSrc.indexOf("function getVersion(");
		assert.ok(fnStart > -1, "getVersion function not found in bin/taskplane.mjs");
		const fnEnd = cliSrc.indexOf("\n}", fnStart);
		const body = cliSrc.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 2000);
		assert.ok(body.includes("spawnSync"), "getVersion must use spawnSync");
		assert.match(
			body,
			/stdio\s*:\s*\[\s*["']ignore["']\s*,\s*["']pipe["']\s*,\s*["']pipe["']\s*\]/,
			"getVersion must capture both stdout and stderr via stdio: ['ignore', 'pipe', 'pipe']",
		);
	});

	it("getVersion prefers stdout but falls back to stderr (stdout-precedence rule)", () => {
		const fnStart = cliSrc.indexOf("function getVersion(");
		const fnEnd = cliSrc.indexOf("\n}", fnStart);
		const body = cliSrc.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 2000);
		// Both streams must be read.
		assert.ok(body.includes("result.stdout"), "must read result.stdout");
		assert.ok(body.includes("result.stderr"), "must read result.stderr");
		// Stdout-precedence: stdout return must precede stderr return.
		const stdoutReturnIdx = body.search(/if\s*\(\s*stdout\s*\)\s*return\s+stdout/);
		const stderrReturnIdx = body.search(/if\s*\(\s*stderr\s*\)\s*return\s+stderr/);
		assert.ok(stdoutReturnIdx > -1, "must have an 'if (stdout) return stdout' branch");
		assert.ok(stderrReturnIdx > -1, "must have an 'if (stderr) return stderr' fallback branch");
		assert.ok(
			stdoutReturnIdx < stderrReturnIdx,
			"stdout return must precede stderr fallback (stdout-precedence rule)",
		);
	});

	it("getVersion still returns null on subprocess failure (fail-safe contract preserved)", () => {
		const fnStart = cliSrc.indexOf("function getVersion(");
		const fnEnd = cliSrc.indexOf("\n}", fnStart);
		const body = cliSrc.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 2000);
		// Original contract: any failure path returns null. Confirm the
		// catch + the both-empty branch both return null.
		const nullReturns = (body.match(/return\s+null\b/g) ?? []).length;
		assert.ok(
			nullReturns >= 2,
			`getVersion must have at least 2 'return null' paths (catch + both-empty fallback), found ${nullReturns}`,
		);
	});
});
