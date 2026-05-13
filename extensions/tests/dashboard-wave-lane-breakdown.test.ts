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

	// ── Sentinel laneNumber=0 ("unallocated") must NOT be treated as a real lane ──
	// Background: persistence.ts assigns `laneNumber: 0` to tasks that haven't
	// been allocated to a lane yet (sentinel value, see persistence.ts:1378 +
	// 2538). Real lane numbers start at 1. The wave-chip renderer must treat
	// 0 as "unassigned" — otherwise all pending/future-wave tasks get grouped
	// under a fake "lane 0" and render as serial (→) when they're actually
	// going to run in parallel once their wave starts.

	it("REGRESSION: laneNumber=0 sentinel does NOT count as a real lane", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		// Simulates a future wave where tasks have the sentinel laneNumber=0
		// because their wave hasn't started and no lanes have been allocated.
		const result = formatWaveLaneBreakdown(
			["TP-004", "TP-005"],
			[],
			[
				{ taskId: "TP-004", laneNumber: 0 },
				{ taskId: "TP-005", laneNumber: 0 },
			],
			2,
		);
		// Both tasks have sentinel 0 — should fall back to comma display
		// ("don't know yet"), NOT serial ("→") which would be misleading.
		expect(result.compact).toBe("TP-004, TP-005");
		expect(result.compact).not.toContain(" → ");
		expect(result.compact).not.toContain(" | ");
	});

	it("REGRESSION: mixed sentinel-0 and real laneNumbers — only real ones count", () => {
		const { formatWaveLaneBreakdown } = loadHelper();
		const result = formatWaveLaneBreakdown(
			["TP-A", "TP-B", "TP-C"],
			[],
			[
				{ taskId: "TP-A", laneNumber: 1 }, // real lane
				{ taskId: "TP-B", laneNumber: 0 }, // sentinel — unassigned
				{ taskId: "TP-C", laneNumber: 2 }, // real lane
			],
			1,
		);
		// TP-A and TP-C have real lanes — separate. TP-B is unassigned and
		// becomes part of the "unassigned" trailing group.
		expect(result.compact).toBe("TP-A | TP-C | TP-B");
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

	// ── Merge-agents table cleanup (TP-197 post-merge fold) ─────────────
	// User observed: SESSION ID and DETAILS columns were always '—' (dead
	// weight). SESSION ID was hardcoded to '—' in every row. DETAILS was
	// only populated for mr.failureReason (rare). Both columns removed.
	// Merge-table header color was also bumped --text-faint → --text-muted
	// to match other section headers and improve readability.

	it("source: merge-agents table header has 4 columns; Session ID + Details removed", () => {
		const src = readFileSync(resolve(__dirname, "../../dashboard/public/app.js"), "utf-8");
		// The current 4-column header.
		expect(src).toContain("<th>Wave</th><th>Status</th><th>Session</th><th>Telemetry</th>");
		// Removed columns must not appear in any header row.
		expect(src).not.toMatch(/<th>Session ID<\/th>/);
		expect(src).not.toMatch(/<th>Details<\/th>/);
		// merge-detail-cell rendering in the merge-result row is gone
		// (per-repo sub-rows previously had a 6th cell rendering rrDetail).
		expect(src).not.toMatch(/merge-detail-cell.*rrDetail/);
	});

	it("source: .merge-table th uses --text-muted (post-fold contrast bump)", () => {
		const css = readFileSync(resolve(__dirname, "../../dashboard/public/style.css"), "utf-8");
		const ruleStart = css.indexOf(".merge-table th {");
		expect(ruleStart).toBeGreaterThan(-1);
		const ruleEnd = css.indexOf("}", ruleStart);
		const rule = css.slice(ruleStart, ruleEnd);
		expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
		expect(rule).not.toMatch(/color:\s*var\(--text-faint\)/);
	});
});
