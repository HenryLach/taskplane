/**
 * Context Window Auto-Detection Tests — TP-047 Step 3
 *
 * Tests for:
 *   1. resolveContextWindow() resolution order (explicit > auto-detect > fallback)
 *   2. New default values for warn_percent (85) and kill_percent (95)
 *   3. Default worker_context_window = 0 (signals auto-detect)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/context-window-resolution.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { resolveContextWindow, FALLBACK_CONTEXT_WINDOW } from "../taskplane/context-window.ts";
import { loadConfig } from "../taskplane/config-loader.ts";

import { DEFAULT_TASK_RUNNER_SECTION } from "../taskplane/config-schema.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal TaskConfig-like object with the context fields we need. */
function makeConfig(overrides: { worker_context_window?: number } = {}) {
	return {
		context: {
			worker_context_window: overrides.worker_context_window ?? 0,
			warn_percent: 85,
			kill_percent: 95,
			max_worker_iterations: 20,
			max_review_cycles: 2,
			no_progress_limit: 3,
		},
	} as any;
}

/** Build a minimal ExtensionContext-like object with model info. */
function makeCtx(model?: { contextWindow?: number; provider?: string; id?: string }) {
	if (!model) return {} as any;
	return {
		model: {
			contextWindow: model.contextWindow,
			provider: model.provider ?? "anthropic",
			id: model.id ?? "claude-opus-4-6",
		},
	} as any;
}

// ── 1. resolveContextWindow resolution order ─────────────────────────

describe("resolveContextWindow", () => {
	it("1.1 — explicit config value takes precedence over everything", () => {
		const config = makeConfig({ worker_context_window: 500_000 });
		const ctx = makeCtx({ contextWindow: 1_000_000 });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(500_000);
		expect(result.source).toBe("explicit config");
	});

	it("1.2 — auto-detects from model registry when config is 0 (default)", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: 1_000_000, provider: "anthropic", id: "claude-opus-4-6" });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(1_000_000);
		expect(result.source).toContain("auto-detected");
		expect(result.source).toContain("anthropic/claude-opus-4-6");
	});

	it("1.3 — falls back to FALLBACK_CONTEXT_WINDOW when config is 0 and model has no contextWindow", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx(); // no model

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
		expect(result.contextWindow).toBe(200_000);
		expect(result.source).toContain("fallback");
	});

	it("1.4 — falls back when model contextWindow is 0", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: 0 });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
		expect(result.source).toContain("fallback");
	});

	it("1.5 — falls back when model contextWindow is undefined", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: undefined });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
	});

	it("1.6 — falls back when ctx.model is undefined", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = { model: undefined } as any;

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
	});

	it("1.7 — falls back when ctx is empty object (no model property)", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = {} as any;

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
	});

	it("1.8 — explicit config value of 1 (edge case small value) still takes precedence", () => {
		const config = makeConfig({ worker_context_window: 1 });
		const ctx = makeCtx({ contextWindow: 1_000_000 });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(1);
		expect(result.source).toBe("explicit config");
	});

	it("1.9 — auto-detect works with different model providers", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: 128_000, provider: "openai", id: "gpt-5.3-codex" });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);

		expect(result.contextWindow).toBe(128_000);
		expect(result.source).toContain("openai/gpt-5.3-codex");
	});
});

// ── 2. Default values in config-schema ───────────────────────────────

describe("config-schema defaults (TP-047)", () => {
	it("2.1 — workerContextWindow defaults to 0 (auto-detect signal)", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.context.workerContextWindow).toBe(0);
	});

	it("2.2 — warnPercent defaults to 85", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.context.warnPercent).toBe(85);
	});

	it("2.3 — killPercent defaults to 95", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.context.killPercent).toBe(95);
	});
});

// ── 3. task-runner.ts hardcoded defaults ─────────────────────────────

describe("task-runner loadConfig defaults (TP-047)", () => {
	// loadConfig reads from cwd — when no config exists, it uses hardcoded defaults.
	// We use a non-existent path to trigger pure defaults.
	it("3.1 — loadConfig defaults: worker_context_window = 0, warn_percent = 85, kill_percent = 95", () => {
		const config = loadConfig("/nonexistent-path-for-testing");
		expect(config.context.worker_context_window).toBe(0);
		expect(config.context.warn_percent).toBe(85);
		expect(config.context.kill_percent).toBe(95);
	});
});

// ── 4. FALLBACK_CONTEXT_WINDOW constant ──────────────────────────────

describe("FALLBACK_CONTEXT_WINDOW constant", () => {
	it("4.1 — is 200_000", () => {
		expect(FALLBACK_CONTEXT_WINDOW).toBe(200_000);
	});
});
