/**
 * Regression guard for the TP-197 post-merge fold: the wave-chip lane
 * parallelization indicator must work for ALL waves (past, current,
 * future), not just the actively-executing wave.
 *
 * Background: an earlier version of `formatWaveLaneBreakdown` read the
 * task→lane map only from `batch.lanes` (Runtime V2 live state, populated
 * only for the active wave). This caused inactive wave chips to fall back
 * to comma-separated display while the active wave used `|` (parallel) and
 * `→` (serial) separators. The display visibly "flickered" between
 * separators as waves transitioned active.
 *
 * Fix: derive task→lane map from `batch.tasks[].laneNumber` (persisted for
 * the entire batch lifecycle), with `batch.lanes` as a fallback. This makes
 * the parallelization indicator stable across all wave states.
 *
 * Strategy: extract the helper from `dashboard/public/app.js` (vanilla JS
 * browser script, no exports) and evaluate in a sandbox. Matches the
 * approach in `dashboard-segment-pill-row.test.ts`.
 */

import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "./expect.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(__dirname, "../../dashboard/public/app.js");

function extractFn(source: string, name: string): string {
	const needle = `function ${name}`;
	const start = source.indexOf(needle);
	if (start < 0) throw new Error(`fn ${name} not found in app.js`);
	const braceStart = source.indexOf("{", start);
	if (braceStart < 0) throw new Error(`no opening brace for ${name}`);
	let depth = 1;
	let i = braceStart + 1;
	while (i < source.length && depth > 0) {
		const ch = source[i];
		if (ch === "{") depth++;
		else if (ch === "}") depth--;
		i++;
	}
	if (depth !== 0) throw new Error(`unbalanced braces for ${name}`);
	return source.slice(start, i);
}

function loadHelper(): {
	formatWaveLaneBreakdown: (
		taskIds: string[],
		lanes: Array<{ laneNumber: number; taskIds: string[] }>,
		tasks: Array<{ taskId: string; laneNumber: number | null }>,
		waveNumber: number,
	) => { compact: string; tooltip: string };
} {
	const src = readFileSync(APP_JS, "utf-8");
	const fnSrc = extractFn(src, "formatWaveLaneBreakdown");
	const ctx: Record<string, unknown> = {};
	// biome-ignore lint/security/noGlobalEval: trusted test fixture loading our own source.
	new Function("ctx", `${fnSrc}; ctx.formatWaveLaneBreakdown = formatWaveLaneBreakdown;`)(ctx);
	// biome-ignore lint/suspicious/noExplicitAny: dynamic loader.
	return ctx as any;
}

describe("TP-197 fold: formatWaveLaneBreakdown lane parallelization indicator", () => {
	it("multi-lane wave: uses ` | ` separator when tasks span multiple lanes (parallel)", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(
			["TP-001", "TP-002", "TP-003"],
			[],
			[
				{ taskId: "TP-001", laneNumber: 1 },
				{ taskId: "TP-002", laneNumber: 2 },
				{ taskId: "TP-003", laneNumber: 3 },
			],
			1,
		);
		expect(result.compact).toContain(" | ");
		expect(result.compact).toBe("TP-001 | TP-002 | TP-003");
	});

	it("single-lane wave: uses ` → ` separator when tasks share a lane (serial)", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(
			["TP-005", "TP-006"],
			[{ laneNumber: 1, taskIds: ["TP-005", "TP-006"] }],
			[
				{ taskId: "TP-005", laneNumber: 1 },
				{ taskId: "TP-006", laneNumber: 1 },
			],
			2,
		);
		expect(result.compact).toContain(" → ");
		expect(result.compact).toBe("TP-005 → TP-006");
	});

	// ── The core regression these tests guard ────────────────────────────
	// Before the TP-197 fold, the `lanes` arg was the only source for the
	// task→lane map. When `lanes` was empty (past/future waves where
	// Runtime V2 live state had moved on), the function fell back to
	// comma-separated display even though the parallelization information
	// was available via `tasks[].laneNumber`. These tests prove the fix.

	it("REGRESSION: derives task→lane from `tasks` when `lanes` is empty (past/future wave)", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(
			["TP-001", "TP-002", "TP-003"],
			[], // simulates inactive wave: no live lane state
			[
				{ taskId: "TP-001", laneNumber: 1 },
				{ taskId: "TP-002", laneNumber: 2 },
				{ taskId: "TP-003", laneNumber: 3 },
			],
			1,
		);
		// Without the fix this would be "TP-001, TP-002, TP-003" (comma fallback).
		expect(result.compact).toBe("TP-001 | TP-002 | TP-003");
		expect(result.compact).not.toContain(", ");
	});

	it("REGRESSION: derives task→lane from `tasks` when `lanes` only contains other waves' data", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		// `lanes` has data for a DIFFERENT wave's tasks (e.g., currently
		// active wave's lanes carry W3 tasks, but we're rendering W1).
		const result = formatWaveLaneBreakdown(
			["TP-001", "TP-002"], // W1 tasks
			[
				// Live lane state for the currently active W3 wave (unrelated):
				{ laneNumber: 1, taskIds: ["TP-007"] },
				{ laneNumber: 2, taskIds: ["TP-008"] },
			],
			[
				{ taskId: "TP-001", laneNumber: 1 },
				{ taskId: "TP-002", laneNumber: 2 },
				{ taskId: "TP-007", laneNumber: 1 },
				{ taskId: "TP-008", laneNumber: 2 },
			],
			1,
		);
		expect(result.compact).toBe("TP-001 | TP-002");
	});

	it("backward-compat: when `tasks` is empty, falls back to `lanes` (live state path)", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(
			["TP-001", "TP-002"],
			[
				{ laneNumber: 1, taskIds: ["TP-001"] },
				{ laneNumber: 2, taskIds: ["TP-002"] },
			],
			[], // simulates state where tasks data isn't yet populated
			1,
		);
		expect(result.compact).toBe("TP-001 | TP-002");
	});

	it("no lane data at all: falls back to comma-separated (legacy)", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(["TP-A", "TP-B", "TP-C"], [], [], 1);
		expect(result.compact).toBe("TP-A, TP-B, TP-C");
		expect(result.compact).not.toContain(" | ");
		expect(result.compact).not.toContain(" → ");
	});

	it("mixed: same lane gets `→`, different lanes get ` | ` (3 tasks → 2 lanes scenario)", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(
			["TP-A", "TP-B", "TP-C"],
			[
				{ laneNumber: 1, taskIds: ["TP-A", "TP-B"] },
				{ laneNumber: 2, taskIds: ["TP-C"] },
			],
			[
				{ taskId: "TP-A", laneNumber: 1 },
				{ taskId: "TP-B", laneNumber: 1 },
				{ taskId: "TP-C", laneNumber: 2 },
			],
			2,
		);
		expect(result.compact).toContain("TP-A → TP-B");
		expect(result.compact).toContain(" | TP-C");
	});

	it("source: pending pill CSS uses --text-muted (post-fold contrast bump)", () => {
		// Lock down the contrast fix: pending pill must use --text-muted,
		// not --text-faint. text-faint (#484f58) gave ~3.7:1 contrast on
		// dark theme, below WCAG AA. text-muted (#8b949e) gives ~6.5:1.
		const css = readFileSync(resolve(__dirname, "../../dashboard/public/style.css"), "utf-8");
		const pendingLine = css.split("\n").find((line) => line.includes(".seg-pill.seg-pending"));
		expect(pendingLine).toBeDefined();
		expect(pendingLine!).toContain("var(--text-muted)");
		expect(pendingLine!).not.toContain("var(--text-faint)");
	});
});
