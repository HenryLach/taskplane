/**
 * TP-197 (#464) — Dashboard segment-level progress indicators
 *
 * Verifies the `taskSegmentPillRow` renderer helper in `dashboard/public/app.js`.
 *
 * The dashboard frontend is a vanilla-JS browser script (no ESM exports), so
 * we test the helper by extracting its source from `app.js` and evaluating it
 * in an isolated sandbox with a minimal `escapeHtml` polyfill. This catches
 * regressions in the segment pill rendering without spinning up a browser.
 *
 * Background: TP-145 introduced `.DONE` suppression for non-final segments,
 * which left a visibility gap on the dashboard during multi-segment task
 * execution. TP-197 closes that gap by rendering a per-segment status pill
 * row. The helper MUST return an empty string for single-segment tasks so
 * the rendered DOM for non-segmented tasks is byte-identical to today.
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

// Minimal escapeHtml polyfill matching app.js's DOM-based version semantically.
function escapeHtml(s: unknown): string {
	const map: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};
	return String(s ?? "").replace(/[&<>"']/g, (c) => map[c] || c);
}

interface Helpers {
	taskSegmentPillRow: (
		task:
			| { taskId?: string; segmentIds?: string[]; activeSegmentId?: string | null }
			| null
			| undefined,
		segmentStatusMap: Map<string, string>,
		activeSegmentId: string | null,
	) => string;
	parseSegmentId: (id: string) => { taskId: string; repoId: string } | null;
}

function loadHelpers(): Helpers {
	const src = readFileSync(APP_JS, "utf8");
	const sandbox = [
		extractFn(src, "parseSegmentId"),
		extractFn(src, "segmentProgressText"),
		extractFn(src, "taskSegmentPillRow"),
		"return { parseSegmentId, segmentProgressText, taskSegmentPillRow };",
	].join("\n");
	// biome-ignore lint/security/noGlobalEval: Test-only sandbox for browser-script extraction.
	return new Function("escapeHtml", sandbox)(escapeHtml) as Helpers;
}

describe("TP-197: taskSegmentPillRow renderer", () => {
	it("renders a pill row for a 3-segment task with the running segment marked current", () => {
		const helpers = loadHelpers();
		const segMap = new Map([
			["TP-X::shared-libs", "succeeded"],
			["TP-X::web-client", "running"],
			["TP-X::admin", "pending"],
		]);
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-X", segmentIds: ["TP-X::shared-libs", "TP-X::web-client", "TP-X::admin"] },
			segMap,
			"TP-X::web-client",
		);
		expect(out.startsWith('<div class="task-segment-row">')).toBe(true);
		expect(out.endsWith("</div>")).toBe(true);
		expect((out.match(/class="seg-pill /g) || []).length).toBe(3);
		expect((out.match(/seg-pill-current/g) || []).length).toBe(1);
		expect(out).toContain("seg-succeeded");
		expect(out).toContain("seg-running seg-pill-current");
		expect(out).toContain("seg-pending");
		expect(out).toContain(">shared-libs<");
		expect(out).toContain(">web-client<");
		expect(out).toContain(">admin<");
	});

	it("returns empty string for single-segment tasks (no regression for non-segmented tasks)", () => {
		const helpers = loadHelpers();
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-Y", segmentIds: ["TP-Y::default"] },
			new Map([["TP-Y::default", "running"]]),
			"TP-Y::default",
		);
		expect(out).toBe("");
	});

	it("returns empty string for tasks with no segmentIds", () => {
		const helpers = loadHelpers();
		expect(helpers.taskSegmentPillRow({ taskId: "TP-Z" }, new Map(), null)).toBe("");
		expect(helpers.taskSegmentPillRow({ taskId: "TP-Z", segmentIds: [] }, new Map(), null)).toBe("");
	});

	it("returns empty string for null/undefined task input", () => {
		const helpers = loadHelpers();
		expect(helpers.taskSegmentPillRow(null, new Map(), null)).toBe("");
		expect(helpers.taskSegmentPillRow(undefined, new Map(), null)).toBe("");
	});

	it("emits no current-segment emphasis when activeSegmentId is null", () => {
		const helpers = loadHelpers();
		const segMap = new Map([
			["TP-W::a", "succeeded"],
			["TP-W::b", "pending"],
		]);
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-W", segmentIds: ["TP-W::a", "TP-W::b"] },
			segMap,
			null,
		);
		expect(out.includes("seg-pill-current")).toBe(false);
		expect((out.match(/class="seg-pill /g) || []).length).toBe(2);
	});

	it("renders failed / skipped / stalled status pills with correct classes", () => {
		const helpers = loadHelpers();
		const segMap = new Map([
			["TP-Q::a", "failed"],
			["TP-Q::b", "skipped"],
			["TP-Q::c", "stalled"],
		]);
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-Q", segmentIds: ["TP-Q::a", "TP-Q::b", "TP-Q::c"] },
			segMap,
			null,
		);
		expect(out).toContain("seg-failed");
		expect(out).toContain("seg-skipped");
		expect(out).toContain("seg-stalled");
	});

	it("falls back to pending styling for unknown or missing statuses", () => {
		const helpers = loadHelpers();
		const unknownMap = new Map([["TP-U::a", "weird-status"]]);
		const out1 = helpers.taskSegmentPillRow(
			{ taskId: "TP-U", segmentIds: ["TP-U::a", "TP-U::b"] },
			unknownMap,
			null,
		);
		// Both 'weird-status' (unknown) and missing TP-U::b fall back to pending styling.
		expect((out1.match(/seg-pending/g) || []).length).toBe(2);
	});

	it("includes a status-bearing tooltip on each pill", () => {
		const helpers = loadHelpers();
		const segMap = new Map([
			["TP-T::a", "succeeded"],
			["TP-T::b", "running"],
		]);
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-T", segmentIds: ["TP-T::a", "TP-T::b"] },
			segMap,
			null,
		);
		expect(out).toContain('title="TP-T::a · succeeded"');
		expect(out).toContain('title="TP-T::b · running"');
	});

	it("falls back to the raw segmentId as the label when the id is unparseable", () => {
		const helpers = loadHelpers();
		const segMap = new Map([
			["malformed-id", "running"],
			["TP-M::ok", "pending"],
		]);
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-M", segmentIds: ["malformed-id", "TP-M::ok"] },
			segMap,
			null,
		);
		// malformed-id has no `::` separator → parseSegmentId returns null;
		// renderer falls back to the raw id as the displayed label.
		expect(out).toContain(">malformed-id<");
		expect(out).toContain(">ok<");
	});

	it("escapes HTML in repoIds and segmentIds (XSS guard)", () => {
		const helpers = loadHelpers();
		const evilId = "TP-E::<script>alert(1)</script>";
		const segMap = new Map([
			[evilId, "running"],
			["TP-E::safe", "pending"],
		]);
		const out = helpers.taskSegmentPillRow(
			{ taskId: "TP-E", segmentIds: [evilId, "TP-E::safe"] },
			segMap,
			null,
		);
		expect(out.includes("<script>")).toBe(false);
		expect(out).toContain("&lt;script&gt;");
	});

	it("ignores non-string entries in segmentIds (resilience)", () => {
		const helpers = loadHelpers();
		// biome-ignore lint/suspicious/noExplicitAny: Negative test for runtime garbage values.
		const malformed: any = {
			taskId: "TP-N",
			segmentIds: ["TP-N::a", null, undefined, 42, "TP-N::b"],
		};
		const out = helpers.taskSegmentPillRow(malformed, new Map(), null);
		// Only the two valid string segments should render.
		expect((out.match(/class="seg-pill /g) || []).length).toBe(2);
	});

	// ── TP-197 sage post-merge fold: task-row grid-layout parity guard ────
	// Background: an earlier draft of TP-197 changed .task-row from a 2-row
	// grid to an unconditional 3-row grid, which added an 8px row-gap for
	// single-segment tasks (because 'auto' rows don't fully collapse when
	// row-gap is set). The fix is to opt the .task-row into a 3-row template
	// only when the pill row is non-empty, via a .has-segments class added
	// in JS conditioned on `hasSegmentPillRow`. These two tests lock down
	// the source-pattern intent so future edits don't re-introduce the
	// unconditional 3-row template or drop the conditional class.

	it("source: .task-row's default grid keeps 2 rows; .has-segments opts into 3", () => {
		const css = readFileSync(resolve(__dirname, "../../dashboard/public/style.css"), "utf-8");

		// Default .task-row block: must declare 'grid-template-rows: auto auto'
		// (2 rows), NOT 'auto auto auto'. We extract the .task-row block by
		// finding its opening brace and reading up to the next closing brace.
		const defaultBlockStart = css.indexOf(".task-row {");
		expect(defaultBlockStart).toBeGreaterThan(-1);
		const defaultBlockEnd = css.indexOf("}", defaultBlockStart);
		const defaultBlock = css.slice(defaultBlockStart, defaultBlockEnd);
		expect(defaultBlock).toMatch(/grid-template-rows:\s*auto\s+auto\s*;/);
		expect(defaultBlock).not.toMatch(/grid-template-rows:\s*auto\s+auto\s+auto\s*;/);

		// .task-row.has-segments block: must declare 3-row template.
		const optInBlockStart = css.indexOf(".task-row.has-segments {");
		expect(optInBlockStart).toBeGreaterThan(-1);
		const optInBlockEnd = css.indexOf("}", optInBlockStart);
		const optInBlock = css.slice(optInBlockStart, optInBlockEnd);
		expect(optInBlock).toMatch(/grid-template-rows:\s*auto\s+auto\s+auto\s*;/);
	});

	it("source: app.js conditionally adds 'has-segments' class only when pill row is non-empty", () => {
		const src = readFileSync(resolve(__dirname, "../../dashboard/public/app.js"), "utf-8");

		// Must contain the conditional class assignment based on hasSegmentPillRow.
		// We allow some whitespace variation but require the ternary pattern.
		expect(src).toMatch(
			/hasSegmentPillRow\s*\?\s*["']task-row has-segments["']\s*:\s*["']task-row["']/,
		);
		// And the rendered template must use the computed class (not a literal).
		expect(src).toContain('<div class="${taskRowClass}">');
	});
});
