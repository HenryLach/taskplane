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
};

describe("init model picker flow", () => {
	it("supports 'same model for all' selection with thinking prompt", async () => {
		const askAnswers = ["3", "2", "2"]; // provider=openai, model=gpt-5.3-codex, thinking=on
		let askIdx = 0;
		const logs: string[] = [];

		const config = await collectInitAgentConfig({
			interactive: true,
			queryModelsImpl: () => ({ available: true, models: AVAILABLE_MODELS, error: null }),
			loadInitDefaultsImpl: async () => EMPTY_SAVED_DEFAULTS,
			confirmImpl: async () => true,
			askImpl: async (_question: string, defaultValue: string) => askAnswers[askIdx++] ?? defaultValue,
			logImpl: (msg: string) => logs.push(msg),
		});

		expect(config).toEqual({
			workerModel: "openai/gpt-5.3-codex",
			reviewerModel: "openai/gpt-5.3-codex",
			mergeModel: "openai/gpt-5.3-codex",
			workerThinking: "on",
			reviewerThinking: "on",
			mergeThinking: "on",
		});

		expect(logs.some((line) => line.includes("1. inherit (use current session model)"))).toBe(true);
	});

	it("supports per-agent model + thinking selections", async () => {
		const askAnswers = [
			"1", // worker provider -> inherit
			"1", // worker thinking -> inherit
			"2", // reviewer provider -> anthropic
			"2", // reviewer model -> claude-sonnet-4-6
			"2", // reviewer thinking -> on
			"3", // merger provider -> openai
			"2", // merger model -> gpt-5.3-codex
			"3", // merger thinking -> off
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
			reviewerThinking: "on",
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
});
