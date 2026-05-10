/**
 * Context Window Auto-Detect Tests — TP-047 Step 3
 *
 * Tests for:
 *   1.x — resolveContextWindow resolution order (explicit > auto-detect > fallback)
 *   2.x — New warn_percent and kill_percent defaults (85/95)
 *   3.x — Config defaults for workerContextWindow (0 = auto-detect)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/context-window-autodetect.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { resolveContextWindow, FALLBACK_CONTEXT_WINDOW } from "../taskplane/context-window.ts";
import { loadConfig as taskRunnerLoadConfig } from "../taskplane/config-loader.ts";
import { loadProjectConfig, toTaskConfig } from "../taskplane/config-loader.ts";
import { DEFAULT_TASK_RUNNER_SECTION } from "../taskplane/config-schema.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Fixture Helpers ──────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-cw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {
		// Best effort cleanup on Windows
	}
});

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `cw-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeTaskRunnerYaml(root: string, content: string): void {
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "task-runner.yaml"), content, "utf-8");
}

function writeJsonConfig(root: string, obj: any): void {
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "taskplane-config.json"), JSON.stringify(obj, null, 2), "utf-8");
}

/** Create a minimal TaskConfig with overridable context values. */
function makeConfig(
	overrides?: Partial<{
		worker_context_window: number;
		warn_percent: number;
		kill_percent: number;
	}>,
): any {
	return {
		project: { name: "Test", description: "" },
		paths: { tasks: "tasks" },
		testing: { commands: {} },
		standards: { docs: [], rules: [] },
		standards_overrides: {},
		task_areas: {},
		worker: { model: "", tools: "", thinking: "off" },
		reviewer: { model: "", tools: "", thinking: "off" },
		context: {
			worker_context_window: overrides?.worker_context_window ?? 0,
			warn_percent: overrides?.warn_percent ?? 85,
			kill_percent: overrides?.kill_percent ?? 95,
			max_worker_iterations: 20,
			max_review_cycles: 2,
			no_progress_limit: 3,
		},
		quality_gate: {
			enabled: false,
			review_model: "",
			max_review_cycles: 2,
			max_fix_cycles: 1,
			pass_threshold: "no_critical",
		},
	};
}

/** Create a mock ExtensionContext with optional model info. */
function makeCtx(model?: { contextWindow?: number; provider?: string; id?: string }): any {
	if (!model) {
		return { model: undefined };
	}
	return {
		model: {
			contextWindow: model.contextWindow,
			provider: model.provider ?? "anthropic",
			id: model.id ?? "claude-opus-4-6",
		},
	};
}

// ── 1.x: resolveContextWindow resolution order ──────────────────────

describe("resolveContextWindow — resolution order", () => {
	it("1.1: explicit config value (non-zero) takes precedence over model and fallback", () => {
		const config = makeConfig({ worker_context_window: 500_000 });
		const ctx = makeCtx({ contextWindow: 1_000_000 });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(500_000);
		expect(result.source).toBe("explicit config");
	});

	it("1.2: auto-detect from model when config is 0 (default/auto-detect)", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: 1_000_000, provider: "anthropic", id: "claude-opus-4-6" });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(1_000_000);
		expect(result.source).toContain("auto-detected");
		expect(result.source).toContain("anthropic/claude-opus-4-6");
	});

	it("1.3: fallback to 200K when config is 0 and model has no contextWindow", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx(); // model is undefined

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(200_000);
		expect(result.source).toContain("fallback");
	});

	it("1.4: fallback when model contextWindow is 0", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: 0 });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(200_000);
		expect(result.source).toContain("fallback");
	});

	it("1.5: fallback when model contextWindow is undefined", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: undefined });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(200_000);
		expect(result.source).toContain("fallback");
	});

	it("1.6: fallback when ctx.model is null", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = { model: null };

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(200_000);
		expect(result.source).toContain("fallback");
	});

	it("1.7: FALLBACK_CONTEXT_WINDOW constant is 200000", () => {
		expect(FALLBACK_CONTEXT_WINDOW).toBe(200_000);
	});

	it("1.8: auto-detect includes model provider/id in source label", () => {
		const config = makeConfig({ worker_context_window: 0 });
		const ctx = makeCtx({ contextWindow: 500_000, provider: "openai", id: "gpt-5" });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(500_000);
		expect(result.source).toBe("auto-detected from openai/gpt-5");
	});

	it("1.9: explicit config value of 1 is treated as explicit (not auto-detect)", () => {
		const config = makeConfig({ worker_context_window: 1 });
		const ctx = makeCtx({ contextWindow: 1_000_000 });

		const result = resolveContextWindow(config.context.worker_context_window, ctx);
		expect(result.contextWindow).toBe(1);
		expect(result.source).toBe("explicit config");
	});
});

// ── 2.x: New warn_percent and kill_percent defaults ──────────────────

describe("warn_percent and kill_percent defaults", () => {
	it("2.1: config-schema default warnPercent is 85", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.context.warnPercent).toBe(85);
	});

	it("2.2: config-schema default killPercent is 95", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.context.killPercent).toBe(95);
	});

	it("2.3: task-runner DEFAULT_CONFIG has warn_percent=85 and kill_percent=95", () => {
		// Load config with no config files → returns defaults
		const dir = makeTestDir("defaults-no-config");
		const config = taskRunnerLoadConfig(dir);
		expect(config.context.warn_percent).toBe(85);
		expect(config.context.kill_percent).toBe(95);
	});

	it("2.4: loadProjectConfig returns correct defaults when no config present", () => {
		const dir = makeTestDir("defaults-project");
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.context.warnPercent).toBe(85);
		expect(config.taskRunner.context.killPercent).toBe(95);
	});

	it("2.5: toTaskConfig adapter maps defaults correctly", () => {
		const dir = makeTestDir("defaults-adapter");
		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);
		expect(taskConfig.context.warn_percent).toBe(85);
		expect(taskConfig.context.kill_percent).toBe(95);
	});

	it("2.6: explicit YAML overrides for warn/kill are still respected", () => {
		const dir = makeTestDir("explicit-warn-kill");
		writeTaskRunnerYaml(dir, ["context:", "  warn_percent: 60", "  kill_percent: 80"].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.context.warnPercent).toBe(60);
		expect(config.taskRunner.context.killPercent).toBe(80);
	});

	it("2.7: explicit JSON overrides for warn/kill are still respected", () => {
		const dir = makeTestDir("explicit-json-warn-kill");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				context: {
					warnPercent: 70,
					killPercent: 90,
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.context.warnPercent).toBe(70);
		expect(config.taskRunner.context.killPercent).toBe(90);
	});
});

// ── 3.x: workerContextWindow default (0 = auto-detect) ──────────────

describe("workerContextWindow default signals auto-detect", () => {
	it("3.1: config-schema default workerContextWindow is 0 (auto-detect)", () => {
		expect(DEFAULT_TASK_RUNNER_SECTION.context.workerContextWindow).toBe(0);
	});

	it("3.2: task-runner DEFAULT_CONFIG has worker_context_window=0", () => {
		const dir = makeTestDir("cw-default");
		const config = taskRunnerLoadConfig(dir);
		expect(config.context.worker_context_window).toBe(0);
	});

	it("3.3: loadProjectConfig returns 0 for workerContextWindow when no config", () => {
		const dir = makeTestDir("cw-project-default");
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.context.workerContextWindow).toBe(0);
	});

	it("3.4: explicit workerContextWindow in JSON config is preserved", () => {
		const dir = makeTestDir("cw-explicit-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				context: { workerContextWindow: 300_000 },
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.context.workerContextWindow).toBe(300_000);

		const taskConfig = toTaskConfig(config);
		expect(taskConfig.context.worker_context_window).toBe(300_000);
	});

	it("3.5: explicit worker_context_window in YAML config is preserved", () => {
		const dir = makeTestDir("cw-explicit-yaml");
		writeTaskRunnerYaml(dir, ["context:", "  worker_context_window: 400000"].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.context.workerContextWindow).toBe(400_000);
	});

	it("3.6: toTaskConfig adapter maps workerContextWindow=0 through correctly", () => {
		const dir = makeTestDir("cw-adapter-zero");
		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);
		expect(taskConfig.context.worker_context_window).toBe(0);
	});
});
