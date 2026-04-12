import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import {
	collectInitAgentConfig,
	generateProjectConfig,
} from "../../bin/taskplane.mjs";

const AVAILABLE_MODELS = [
	{ provider: "anthropic", id: "claude-sonnet-4-6", displayName: "anthropic/claude-sonnet-4-6" },
	{ provider: "openai", id: "gpt-5.3-codex", displayName: "openai/gpt-5.3-codex" },
];

const EMPTY_SAVED_DEFAULTS = {
	defaults: {
		workerModel: "",
		reviewerModel: "",
		mergeModel: "",
		workerThinking: "",
		reviewerThinking: "",
		mergeThinking: "",
	},
	hasDefaults: false,
	prefsPath: "/tmp/preferences.json",
	wasBootstrapped: true,
};

const CONFIGURED_SAVED_DEFAULTS = {
	defaults: {
		workerModel: "openai/gpt-5.3-codex",
		reviewerModel: "anthropic/claude-sonnet-4-6",
		mergeModel: "anthropic/claude-sonnet-4-6",
		workerThinking: "high",
		reviewerThinking: "off",
		mergeThinking: "off",
	},
	hasDefaults: true,
	prefsPath: "/tmp/preferences.json",
	wasBootstrapped: false,
};

describe("init model picker flow", () => {
	it("supports 'same model for all' selection with thinking prompt", async () => {
		const askAnswers = ["3", "2", "6"]; // provider=openai, model=gpt-5.3-codex, thinking=high
		let askIdx = 0;
		let confirmCalls = 0;
		const logs: string[] = [];

		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: AVAILABLE_MODELS, error: null }),
			loadInitDefaultsImpl: async () => CONFIGURED_SAVED_DEFAULTS,
			confirmImpl: async () => {
				confirmCalls++;
				return true;
			},
			askImpl: async (_question: string, defaultValue: string) => askAnswers[askIdx++] ?? defaultValue,
			logImpl: (msg: string) => logs.push(msg),
		});

		expect(config).toEqual({
			workerModel: "openai/gpt-5.3-codex",
			reviewerModel: "openai/gpt-5.3-codex",
			mergeModel: "openai/gpt-5.3-codex",
			workerThinking: "high",
			reviewerThinking: "high",
			mergeThinking: "high",
		});

		expect(logs.some((line) => line.includes("1. inherit (use current session model)"))).toBe(true);
		expect(confirmCalls).toBe(1);
	});

	it("first init with multiple providers guides cross-provider reviewer/merger and persists defaults", async () => {
		const askAnswers = ["3", "2", "6"]; // worker=openai/gpt-5.3-codex, worker thinking=high, then defaults
		let askIdx = 0;
		const prompts: Array<{ question: string; defaultValue: string }> = [];
		const logs: string[] = [];
		let savedConfig: any = null;

		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: AVAILABLE_MODELS, error: null }),
			loadInitDefaultsImpl: async () => EMPTY_SAVED_DEFAULTS,
			confirmImpl: async () => {
				throw new Error("confirm should be skipped during cross-provider first-init guidance");
			},
			askImpl: async (question: string, defaultValue: string) => {
				prompts.push({ question, defaultValue });
				return askAnswers[askIdx++] ?? defaultValue;
			},
			saveInitDefaultsImpl: (nextConfig: any) => {
				savedConfig = nextConfig;
				return { prefsPath: "/tmp/preferences.json", saved: nextConfig };
			},
			logImpl: (msg: string) => logs.push(msg),
		});

		expect(config.workerModel).toBe("openai/gpt-5.3-codex");
		expect(config.reviewerModel).toBe("anthropic/claude-sonnet-4-6");
		expect(config.mergeModel).toBe("anthropic/claude-sonnet-4-6");
		expect(savedConfig).toEqual(config);
		expect(logs.some((line) => line.includes("First-run recommendation"))).toBe(true);

		const workerThinkingPrompt = prompts.find((entry) => entry.question.includes("Worker thinking"));
		const reviewerProviderPrompt = prompts.find((entry) => entry.question.includes("Reviewer provider"));
		const mergerProviderPrompt = prompts.find((entry) => entry.question.includes("Merger provider"));
		expect(workerThinkingPrompt?.defaultValue).toBe("6");
		expect(reviewerProviderPrompt?.defaultValue).toBe("2");
		expect(mergerProviderPrompt?.defaultValue).toBe("2");
	});

	it("shows unsupported-thinking note but still allows selecting a thinking level", async () => {
		const modelsWithoutThinking = [
			{ provider: "openai", id: "gpt-5.3-codex", displayName: "openai/gpt-5.3-codex", supportsThinking: false },
		];
		const logs: string[] = [];
		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: modelsWithoutThinking, error: null }),
			loadInitDefaultsImpl: async () => CONFIGURED_SAVED_DEFAULTS,
			confirmImpl: async () => true,
			askImpl: async (_question: string, defaultValue: string) => {
				if (defaultValue === "6") return "7"; // xhigh
				if (defaultValue === "1") return "2"; // select provider/model instead of inherit
				return defaultValue;
			},
			logImpl: (msg: string) => logs.push(msg),
		});

		expect(config.workerThinking).toBe("xhigh");
		expect(config.reviewerThinking).toBe("xhigh");
		expect(config.mergeThinking).toBe("xhigh");
		expect(logs.some((line) => line.includes("does not advertise thinking support"))).toBe(true);
		expect(logs.some((line) => line.includes("ignore it at runtime"))).toBe(true);
	});

	it("single-provider first init skips cross-provider guidance with an info message", async () => {
		const singleProviderModels = [
			{ provider: "openai", id: "gpt-5.3-codex", displayName: "openai/gpt-5.3-codex" },
		];
		const logs: string[] = [];
		let saveCalls = 0;

		await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: singleProviderModels, error: null }),
			loadInitDefaultsImpl: async () => EMPTY_SAVED_DEFAULTS,
			confirmImpl: async () => true,
			askImpl: async (_question: string, defaultValue: string) => defaultValue,
			saveInitDefaultsImpl: () => {
				saveCalls++;
				return { prefsPath: "/tmp/preferences.json", saved: {} };
			},
			logImpl: (msg: string) => logs.push(msg),
		});

		expect(logs.some((line) => line.includes("Cross-provider guidance skipped"))).toBe(true);
		expect(saveCalls).toBe(1);
	});

	it("subsequent init skips first-run guidance and does not re-save defaults", async () => {
		let confirmCalls = 0;
		let saveCalls = 0;
		const logs: string[] = [];

		await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: AVAILABLE_MODELS, error: null }),
			loadInitDefaultsImpl: async () => CONFIGURED_SAVED_DEFAULTS,
			confirmImpl: async () => {
				confirmCalls++;
				return true;
			},
			askImpl: async (_question: string, defaultValue: string) => defaultValue,
			saveInitDefaultsImpl: () => {
				saveCalls++;
				return { prefsPath: "/tmp/preferences.json", saved: {} };
			},
			logImpl: (msg: string) => logs.push(msg),
		});

		expect(confirmCalls).toBe(1);
		expect(saveCalls).toBe(0);
		expect(logs.some((line) => line.includes("First-run recommendation"))).toBe(false);
		expect(logs.some((line) => line.includes("Cross-provider guidance skipped"))).toBe(false);
	});

	it("supports per-agent model + thinking selections", async () => {
		const askAnswers = [
			"1", // worker provider -> inherit
			"1", // worker thinking -> inherit
			"2", // reviewer provider -> anthropic
			"2", // reviewer model -> claude-sonnet-4-6
			"6", // reviewer thinking -> high
			"3", // merger provider -> openai
			"2", // merger model -> gpt-5.3-codex
			"2", // merger thinking -> off
		];
		let askIdx = 0;

		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: AVAILABLE_MODELS, error: null }),
			loadInitDefaultsImpl: async () => EMPTY_SAVED_DEFAULTS,
			confirmImpl: async () => false,
			askImpl: async (_question: string, defaultValue: string) => askAnswers[askIdx++] ?? defaultValue,
			logImpl: () => {},
		});

		expect(config).toEqual({
			workerModel: "",
			reviewerModel: "anthropic/claude-sonnet-4-6",
			mergeModel: "openai/gpt-5.3-codex",
			workerThinking: "",
			reviewerThinking: "high",
			mergeThinking: "off",
		});
	});

	it("gracefully falls back to inherit defaults when model list is unavailable", async () => {
		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: false, models: [], error: "pi unavailable" }),
			loadInitDefaultsImpl: async () => EMPTY_SAVED_DEFAULTS,
			confirmImpl: async () => {
				throw new Error("confirm should not be called when model list is unavailable");
			},
			askImpl: async () => {
				throw new Error("ask should not be called when model list is unavailable");
			},
			logImpl: () => {},
		});

		expect(config).toEqual({
			workerModel: "",
			reviewerModel: "",
			mergeModel: "",
			workerThinking: "",
			reviewerThinking: "",
			mergeThinking: "",
		});
	});

	it("pre-populates prompts from saved defaults", async () => {
		const savedDefaults = {
			defaults: {
				workerModel: "openai/gpt-5.3-codex",
				reviewerModel: "openai/gpt-5.3-codex",
				mergeModel: "openai/gpt-5.3-codex",
				workerThinking: "off",
				reviewerThinking: "off",
				mergeThinking: "off",
			},
			hasDefaults: true,
			prefsPath: "/tmp/preferences.json",
		};

		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: AVAILABLE_MODELS, error: null }),
			loadInitDefaultsImpl: async () => savedDefaults,
			confirmImpl: async (_question: string, defaultYes: boolean) => defaultYes,
			askImpl: async (_question: string, defaultValue: string) => defaultValue,
			logImpl: () => {},
		});

		expect(config).toEqual(savedDefaults.defaults);
	});

	it("does not persist model + thinking selections into project config (global-only)", () => {
		const vars = {
			project_name: "demo",
			max_lanes: 3,
			worktree_prefix: "demo-wt",
			session_prefix: "demo-orch",
			tasks_root: "taskplane-tasks",
			default_area: "general",
			default_prefix: "TP",
			test_cmd: "",
			build_cmd: "",
			spawn_mode: "subprocess",
		};

		const projectConfig = generateProjectConfig(vars, {
			workerModel: "openai/gpt-5.3-codex",
			reviewerModel: "anthropic/claude-sonnet-4-6",
			mergeModel: "openai/gpt-5.3-codex",
			workerThinking: "on",
			reviewerThinking: "off",
			mergeThinking: "on",
		});

		expect(projectConfig.taskRunner.worker).toBeUndefined();
		expect(projectConfig.taskRunner.reviewer).toBeUndefined();
		expect(projectConfig.orchestrator).toBeUndefined();
	});

	it("writes no orchestrator block when init uses default orchestrator values", () => {
		const vars = {
			project_name: "demo",
			max_lanes: 3,
			worktree_prefix: "demo-wt",
			session_prefix: "demo-orch",
			tasks_root: "taskplane-tasks",
			default_area: "general",
			default_prefix: "TP",
			test_cmd: "",
			build_cmd: "",
			spawn_mode: "subprocess",
			explicit_orchestrator_overrides: {},
		};

		const projectConfig = generateProjectConfig(vars, null);
		expect(projectConfig.orchestrator).toBeUndefined();
	});

	it("writes only explicitly chosen orchestrator overrides", () => {
		const vars = {
			project_name: "demo",
			max_lanes: 6,
			worktree_prefix: "demo-wt",
			session_prefix: "demo-orch",
			tasks_root: "taskplane-tasks",
			default_area: "general",
			default_prefix: "TP",
			test_cmd: "",
			build_cmd: "",
			spawn_mode: "subprocess",
			explicit_orchestrator_overrides: { maxLanes: true },
		};

		const projectConfig = generateProjectConfig(vars, null);
		expect(projectConfig.orchestrator.orchestrator.maxLanes).toBe(6);
		expect(projectConfig.orchestrator.orchestrator.worktreePrefix).toBeUndefined();
		expect(projectConfig.orchestrator.orchestrator.sessionPrefix).toBeUndefined();
		expect(projectConfig.orchestrator.orchestrator.spawnMode).toBeUndefined();
	});

	it("normalizes backslash paths in tasks_root to forward slashes (#446)", () => {
		const vars = {
			project_name: "demo",
			max_lanes: 3,
			worktree_prefix: "demo-wt",
			session_prefix: "demo-orch",
			tasks_root: "shared-libs\\task-management\\platform\\general",
			default_area: "general",
			default_prefix: "TP",
			test_cmd: "",
			build_cmd: "",
			spawn_mode: "subprocess",
			explicit_orchestrator_overrides: {},
		};

		const projectConfig = generateProjectConfig(vars, null);
		const expected = "shared-libs/task-management/platform/general";

		// paths.tasks
		expect(projectConfig.taskRunner.paths.tasks).toBe(expected);
		// taskAreas path
		expect(projectConfig.taskRunner.taskAreas.general.path).toBe(expected);
		// taskAreas context
		expect(projectConfig.taskRunner.taskAreas.general.context).toBe(`${expected}/CONTEXT.md`);

		// Verify no backslashes anywhere in the serialized config
		const json = JSON.stringify(projectConfig);
		expect(json.includes("\\")).toBe(false);
	});
});
