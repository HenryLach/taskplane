/**
 * Context Pressure Cache-Inclusive Tests — TP-066
 *
 * Verifies that the context pressure safety net (85% warn → wrap-up, 95% → kill)
 * correctly includes cache read tokens in its calculation.
 *
 * Root cause: `latestTotalTokens` was computed from `usage.totalTokens || (input + output)`,
 * neither of which includes cacheRead tokens. With prompt caching, a worker can have
 * 50K input + 20K output but 800K cacheRead — the safety net saw ~7% instead of ~87%.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/context-pressure-cache.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { tailSidecarJsonl, createSidecarTailState } from "../taskplane/sidecar-telemetry.ts";
import type { SidecarTailState, SidecarTelemetryDelta } from "../taskplane/sidecar-telemetry.ts";

// ── Helpers ──────────────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-ctx-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {}
});

function sidecarPath(): string {
	counter++;
	return join(testRoot, `sidecar-${counter}.jsonl`);
}

/** Write one or more JSONL events to a file. */
function writeSidecarEvents(path: string, events: object[]): void {
	const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
	writeFileSync(path, content, "utf-8");
}

/** Build a message_end event with configurable usage fields. */
function messageEnd(usage: {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: number | { total: number };
}): object {
	return {
		type: "message_end",
		message: { usage },
	};
}

// ── 1. latestTotalTokens includes cacheRead ──────────────────────────

describe("tailSidecarJsonl — cache-inclusive latestTotalTokens", () => {
	it("1.1 — cacheRead is added to latestTotalTokens (fallback branch: input+output)", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [messageEnd({ input: 10_000, output: 5_000, cacheRead: 180_000 })]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		// Without fix: latestTotalTokens would be 15,000 (input+output only)
		// With fix: 15,000 + 180,000 = 195,000
		expect(delta.latestTotalTokens).toBe(195_000);
	});

	it("1.2 — cacheRead is added to latestTotalTokens (totalTokens branch)", () => {
		const path = sidecarPath();
		// When totalTokens is provided by pi (input+output cumulative), cacheRead still needs adding
		writeSidecarEvents(path, [
			messageEnd({ input: 10_000, output: 5_000, cacheRead: 180_000, totalTokens: 15_000 }),
		]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		// totalTokens (15K) + cacheRead (180K) = 195K
		expect(delta.latestTotalTokens).toBe(195_000);
	});

	it("1.3 — zero cacheRead does not affect calculation", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [messageEnd({ input: 50_000, output: 30_000, cacheRead: 0 })]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		expect(delta.latestTotalTokens).toBe(80_000);
	});

	it("1.4 — missing cacheRead does not affect calculation", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [messageEnd({ input: 50_000, output: 30_000 })]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		expect(delta.latestTotalTokens).toBe(80_000);
	});

	it("1.5 — multiple events use latest (highest) cumulative value", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [
			// Turn 1: small context
			messageEnd({ input: 5_000, output: 2_000, cacheRead: 100_000, totalTokens: 7_000 }),
			// Turn 2: context grew (cumulative totalTokens)
			messageEnd({ input: 8_000, output: 5_000, cacheRead: 150_000, totalTokens: 13_000 }),
		]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		// Latest: totalTokens(13K) + cacheRead(150K) = 163K
		expect(delta.latestTotalTokens).toBe(163_000);
	});
});

// ── 2. Context pressure thresholds with cache-heavy workloads ────────

describe("context pressure thresholds — cache-heavy workloads", () => {
	const contextWindow = 200_000;
	const warnPct = 85;
	const killPct = 95;

	it("2.1 — cache-heavy workload triggers 85% threshold", () => {
		const path = sidecarPath();
		// 170K total = 85% of 200K context window
		writeSidecarEvents(path, [messageEnd({ input: 5_000, output: 5_000, cacheRead: 160_000 })]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);
		const pct = (delta.latestTotalTokens / contextWindow) * 100;

		expect(delta.latestTotalTokens).toBe(170_000);
		expect(pct).toBe(85);
		expect(pct >= warnPct).toBe(true);
	});

	it("2.2 — cache-heavy workload triggers 95% threshold", () => {
		const path = sidecarPath();
		// 190K total = 95% of 200K context window
		writeSidecarEvents(path, [messageEnd({ input: 5_000, output: 5_000, cacheRead: 180_000 })]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);
		const pct = (delta.latestTotalTokens / contextWindow) * 100;

		expect(delta.latestTotalTokens).toBe(190_000);
		expect(pct).toBe(95);
		expect(pct >= killPct).toBe(true);
	});

	it("2.3 — TP-065 scenario: would have triggered without fix", () => {
		// Real scenario from TP-065: 874K tokens, but only 50K input + 20K output.
		// Without fix: pct = (70K / 200K) * 100 = 35% — no trigger
		// With fix: pct = (874K / 200K) * 100 = 437% — immediate kill
		const contextWindow_1M = 1_000_000; // Typical Anthropic window
		const path = sidecarPath();
		writeSidecarEvents(path, [
			messageEnd({ input: 50_000, output: 20_000, cacheRead: 804_000, totalTokens: 70_000 }),
		]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		// With fix: 70K + 804K = 874K
		expect(delta.latestTotalTokens).toBe(874_000);

		const pctFixed = (delta.latestTotalTokens / contextWindow_1M) * 100;
		expect(pctFixed).toBeCloseTo(87.4, 1);
		expect(pctFixed >= warnPct).toBe(true);
	});

	it("2.4 — small workload (no cache) stays under threshold", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [messageEnd({ input: 20_000, output: 10_000 })]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);
		const pct = (delta.latestTotalTokens / contextWindow) * 100;

		expect(delta.latestTotalTokens).toBe(30_000);
		expect(pct).toBe(15);
		expect(pct < warnPct).toBe(true);
	});
});

// ── 3. Individual token fields are still accumulated correctly ───────

describe("token field accumulation (regression)", () => {
	it("3.1 — cacheReadTokens and cacheWriteTokens accumulate independently", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [
			messageEnd({ input: 1_000, output: 500, cacheRead: 50_000, cacheWrite: 10_000 }),
			messageEnd({ input: 2_000, output: 800, cacheRead: 50_000, cacheWrite: 0 }),
		]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		expect(delta.inputTokens).toBe(3_000);
		expect(delta.outputTokens).toBe(1_300);
		expect(delta.cacheReadTokens).toBe(100_000);
		expect(delta.cacheWriteTokens).toBe(10_000);
	});

	it("3.2 — cost still accumulates correctly with cache tokens", () => {
		const path = sidecarPath();
		writeSidecarEvents(path, [
			messageEnd({ input: 1_000, output: 500, cacheRead: 50_000, cost: { total: 0.05 } }),
			messageEnd({ input: 2_000, output: 800, cacheRead: 50_000, cost: { total: 0.03 } }),
		]);

		const state = createSidecarTailState();
		const delta = tailSidecarJsonl(path, state);

		expect(delta.cost).toBeCloseTo(0.08, 4);
	});
});
