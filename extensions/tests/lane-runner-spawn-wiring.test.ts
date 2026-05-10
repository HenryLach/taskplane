/**
 * Static-assertion test for `lane-runner.ts` worker spawn-site wiring — TP-189-A1.
 *
 * Architectural regression guard for TP-184 (#530). The fix in TP-184 wired
 * `buildWorkerToolsAllowlist(config.workerTools)` into the lane-runner's
 * worker spawn site so that engine bridge tools (review_step,
 * notify_supervisor, escalate_to_supervisor, request_segment_expansion) are
 * always appended to the worker's `--tools` allowlist regardless of what
 * the user configured for `taskRunner.worker.tools`.
 *
 * If a future edit accidentally bypasses the helper at this spawn site —
 * for example by passing `config.workerTools` directly, or by hand-rolling
 * a `tools.split(",")` augmentation — workers would silently regain the
 * original gap (review_step missing → reviews never fire at Level >= 1).
 *
 * This file's purpose is purely to detect that regression at PR-review
 * time via a source-pattern check. It does NOT validate the helper's
 * behavior — that is covered by `worker-tools-allowlist.test.ts`.
 *
 * Patterned on `lane-runner-v2.test.ts` test 3.6 but with a wider
 * tolerance window so harmless surrounding-line edits don't break it.
 *
 * Run:
 *   cd extensions && node --experimental-strip-types --experimental-test-module-mocks \\
 *     --no-warnings --import ./tests/loader.mjs \\
 *     --test tests/lane-runner-spawn-wiring.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Normalize CRLF -> LF so source-pattern regexes are line-ending agnostic
// (Windows checkouts via Git autocrlf rewrite line endings on disk).
const laneRunnerSrc = readFileSync(
	join(__dirname, "..", "taskplane", "lane-runner.ts"),
	"utf-8",
).replace(/\r\n/g, "\n");

describe("TP-189-A1 — lane-runner.ts worker spawn-site wires buildWorkerToolsAllowlist", () => {
	it("imports buildWorkerToolsAllowlist from agent-host", () => {
		// The helper must be imported (not redefined locally). Use a
		// forgiving regex that tolerates multi-line import blocks and
		// trailing punctuation/whitespace.
		assert.match(
			laneRunnerSrc,
			/import\s*\{[^}]*\bbuildWorkerToolsAllowlist\b[^}]*\}\s*from\s*["']\.\/agent-host(?:\.ts|\.js|\.\w+)?["']/s,
			"lane-runner.ts must import buildWorkerToolsAllowlist from ./agent-host",
		);
	});

	it("calls buildWorkerToolsAllowlist(config.workerTools) at the worker spawn site (AgentHostOptions assembly)", () => {
		// The wiring point: somewhere inside the AgentHostOptions object
		// literal (the worker spawn payload), the `tools:` field must be
		// set to `buildWorkerToolsAllowlist(config.workerTools)`. Tolerate
		// trailing comma/whitespace; tolerate optional `as const` casts.
		const expected = /\btools\s*:\s*buildWorkerToolsAllowlist\(\s*config\.workerTools\s*\)/;
		assert.match(
			laneRunnerSrc,
			expected,
			"lane-runner.ts must wire `tools: buildWorkerToolsAllowlist(config.workerTools)` " +
				"in the worker spawn options. If a refactor moved this site, update both this " +
				"test and the surrounding TP-184 NOTE comment.",
		);
	});

	it("does NOT pass config.workerTools directly as the spawn `tools:` value (regression guard)", () => {
		// A common future-foot-gun: someone refactors the helper out and
		// passes config.workerTools straight through. That would silently
		// drop ENGINE_BRIDGE_TOOLS (review_step etc.) from the worker's
		// allowlist, re-introducing issue #530.
		assert.doesNotMatch(
			laneRunnerSrc,
			/\btools\s*:\s*config\.workerTools\b/,
			"lane-runner.ts must NOT pass config.workerTools directly as the worker `tools:` " +
				"option. Use buildWorkerToolsAllowlist(config.workerTools) so engine bridge tools " +
				"(review_step, notify_supervisor, escalate_to_supervisor, request_segment_expansion) " +
				"are always present. See TP-184 / issue #530.",
		);
	});

	it("the spawn-site call appears within ~80 lines of an `agentId:` field (sanity check the call is in an AgentHostOptions object)", () => {
		// Defense-in-depth: ensure the buildWorkerToolsAllowlist call
		// isn't accidentally orphaned in some unrelated helper. The
		// AgentHostOptions object literal in lane-runner.ts has an
		// `agentId:` field, and the `tools:` line should be near it.
		const helperCallIdx = laneRunnerSrc.search(
			/\btools\s*:\s*buildWorkerToolsAllowlist\(\s*config\.workerTools\s*\)/,
		);
		assert.ok(
			helperCallIdx > -1,
			"buildWorkerToolsAllowlist call site not found (covered by previous test)",
		);
		// Find the nearest `agentId:` field BEFORE the helper call.
		const before = laneRunnerSrc.slice(0, helperCallIdx);
		const lastAgentIdIdx = before.lastIndexOf("agentId:");
		assert.ok(
			lastAgentIdIdx > -1,
			"no `agentId:` field found before the buildWorkerToolsAllowlist call site",
		);
		const linesBetween = laneRunnerSrc.slice(lastAgentIdIdx, helperCallIdx).split("\n").length;
		assert.ok(
			linesBetween < 80,
			`buildWorkerToolsAllowlist call site is ${linesBetween} lines from the nearest \`agentId:\` field; ` +
				`expected < 80 (call should be inside the AgentHostOptions object literal). ` +
				`If the spawn site has been refactored, widen this tolerance or update the test.`,
		);
	});
});
