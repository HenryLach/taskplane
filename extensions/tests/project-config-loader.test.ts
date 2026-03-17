/**
 * Project Config Loader Tests — TP-014 Step 3, TP-016 Step 2
 *
 * Tests for the unified config loader (`loadProjectConfig`), its
 * precedence/error matrix, YAML fallback, adapter compatibility,
 * workspace root resolution, and non-mutation guarantees.
 *
 * Test categories:
 *   1.x — Loader precedence/error matrix
 *   2.x — Workspace root resolution
 *   3.x — Key preservation and adapter regression
 *   4.x — Defaults, cloning, non-mutation, backward-compat wrappers
 *   5.x — Pointer-aware config resolution (TP-016)
 *
 * Run: npx vitest run tests/project-config-loader.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
	mkdirSync,
	writeFileSync,
	rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
	loadProjectConfig,
	toOrchestratorConfig,
	toTaskRunnerConfig,
	toTaskConfig,
	ConfigLoadError,
} from "../taskplane/config-loader.ts";
import {
	CONFIG_VERSION,
	DEFAULT_PROJECT_CONFIG,
	DEFAULT_TASK_RUNNER_SECTION,
	DEFAULT_ORCHESTRATOR_SECTION,
} from "../taskplane/config-schema.ts";
import {
	loadOrchestratorConfig,
	loadTaskRunnerConfig,
} from "../taskplane/config.ts";
import { loadConfig as taskRunnerLoadConfig } from "../task-runner.ts";

// ── Fixture Helpers ──────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `pcl-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePiFile(root: string, filename: string, content: string): void {
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, filename), content, "utf-8");
}

function writeJsonConfig(root: string, obj: any): void {
	writePiFile(root, "taskplane-config.json", JSON.stringify(obj, null, 2));
}

function writeTaskRunnerYaml(root: string, content: string): void {
	writePiFile(root, "task-runner.yaml", content);
}

function writeOrchestratorYaml(root: string, content: string): void {
	writePiFile(root, "task-orchestrator.yaml", content);
}

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-pcl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
	// Clear workspace root env var to avoid cross-test contamination
	delete process.env.TASKPLANE_WORKSPACE_ROOT;
});

afterEach(() => {
	delete process.env.TASKPLANE_WORKSPACE_ROOT;
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {
		// Best effort cleanup on Windows
	}
});

// ── 1.x: Loader precedence/error matrix ─────────────────────────────

describe("loadProjectConfig precedence/error matrix", () => {
	it("1.1: valid JSON config is loaded and merged with defaults", () => {
		const dir = makeTestDir("valid-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				project: { name: "TestProject", description: "A test" },
			},
			orchestrator: {
				orchestrator: { maxLanes: 5 },
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(1);
		expect(config.taskRunner.project.name).toBe("TestProject");
		expect(config.taskRunner.project.description).toBe("A test");
		// Unset fields should have defaults
		expect(config.taskRunner.worker.tools).toBe(DEFAULT_TASK_RUNNER_SECTION.worker.tools);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(5);
		// Other orchestrator defaults preserved
		expect(config.orchestrator.failure.stallTimeout).toBe(DEFAULT_ORCHESTRATOR_SECTION.failure.stallTimeout);
	});

	it("1.2: malformed JSON throws CONFIG_JSON_MALFORMED", () => {
		const dir = makeTestDir("malformed-json");
		writePiFile(dir, "taskplane-config.json", "{ not valid json ]");

		try {
			loadProjectConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigLoadError);
			expect((err as ConfigLoadError).code).toBe("CONFIG_JSON_MALFORMED");
		}
	});

	it("1.3: missing configVersion throws CONFIG_VERSION_MISSING", () => {
		const dir = makeTestDir("no-version");
		writeJsonConfig(dir, {
			taskRunner: { project: { name: "Test" } },
		});

		try {
			loadProjectConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigLoadError);
			expect((err as ConfigLoadError).code).toBe("CONFIG_VERSION_MISSING");
		}
	});

	it("1.4: unsupported configVersion throws CONFIG_VERSION_UNSUPPORTED", () => {
		const dir = makeTestDir("bad-version");
		writeJsonConfig(dir, {
			configVersion: 999,
			taskRunner: {},
		});

		try {
			loadProjectConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigLoadError);
			expect((err as ConfigLoadError).code).toBe("CONFIG_VERSION_UNSUPPORTED");
			expect((err as ConfigLoadError).message).toContain("999");
		}
	});

	it("1.5: JSON present takes precedence over YAML files", () => {
		const dir = makeTestDir("json-over-yaml");

		// Write YAML files with distinctive values
		writeTaskRunnerYaml(dir, "project:\n  name: YamlProject\n");
		writeOrchestratorYaml(dir, "orchestrator:\n  max_lanes: 7\n");

		// Write JSON with different values
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				project: { name: "JsonProject" },
			},
			orchestrator: {
				orchestrator: { maxLanes: 11 },
			},
		});

		const config = loadProjectConfig(dir);
		// JSON values should win
		expect(config.taskRunner.project.name).toBe("JsonProject");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(11);
	});

	it("1.6: YAML-only fallback works when JSON is absent", () => {
		const dir = makeTestDir("yaml-only");

		writeTaskRunnerYaml(dir, "project:\n  name: YamlOnlyProject\n  description: from yaml\n");
		writeOrchestratorYaml(dir, "orchestrator:\n  max_lanes: 9\n");

		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(CONFIG_VERSION);
		expect(config.taskRunner.project.name).toBe("YamlOnlyProject");
		expect(config.taskRunner.project.description).toBe("from yaml");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(9);
	});

	it("1.7: neither JSON nor YAML returns full defaults", () => {
		const dir = makeTestDir("no-config");
		// No .pi dir at all

		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(CONFIG_VERSION);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(DEFAULT_ORCHESTRATOR_SECTION.orchestrator.maxLanes);
	});

	it("1.8: JSON with null configVersion throws CONFIG_VERSION_MISSING", () => {
		const dir = makeTestDir("null-version");
		writeJsonConfig(dir, {
			configVersion: null,
			taskRunner: {},
		});

		try {
			loadProjectConfig(dir);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigLoadError);
			expect((err as ConfigLoadError).code).toBe("CONFIG_VERSION_MISSING");
		}
	});

	it("1.9: JSON with only configVersion returns defaults for all sections", () => {
		const dir = makeTestDir("version-only");
		writeJsonConfig(dir, { configVersion: 1 });

		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(1);
		// All sections should be defaults
		expect(config.taskRunner).toEqual(DEFAULT_TASK_RUNNER_SECTION);
		expect(config.orchestrator).toEqual(DEFAULT_ORCHESTRATOR_SECTION);
	});

	it("1.10: single YAML file present (task-runner only) works", () => {
		const dir = makeTestDir("task-runner-yaml-only");
		writeTaskRunnerYaml(dir, "project:\n  name: TaskRunnerOnly\n");

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.project.name).toBe("TaskRunnerOnly");
		// Orchestrator should be defaults
		expect(config.orchestrator).toEqual(DEFAULT_ORCHESTRATOR_SECTION);
	});

	it("1.11: single YAML file present (orchestrator only) works", () => {
		const dir = makeTestDir("orch-yaml-only");
		writeOrchestratorYaml(dir, "orchestrator:\n  max_lanes: 6\n");

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(6);
		// Task runner should be defaults
		expect(config.taskRunner).toEqual(DEFAULT_TASK_RUNNER_SECTION);
	});
});

// ── 2.x: Workspace root resolution ──────────────────────────────────

describe("workspace root resolution", () => {
	it("2.1: cwd has .pi but no config files → falls back to TASKPLANE_WORKSPACE_ROOT with config files", () => {
		const cwdDir = makeTestDir("cwd-empty-pi");
		const wsRoot = makeTestDir("ws-root");

		// cwd has .pi dir but no config files
		mkdirSync(join(cwdDir, ".pi"), { recursive: true });

		// workspace root has actual config
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWorkspaceRoot\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir);
		expect(config.taskRunner.project.name).toBe("FromWorkspaceRoot");
	});

	it("2.2: cwd has config files → uses cwd even when TASKPLANE_WORKSPACE_ROOT is set", () => {
		const cwdDir = makeTestDir("cwd-has-config");
		const wsRoot = makeTestDir("ws-root");

		writeTaskRunnerYaml(cwdDir, "project:\n  name: FromCwd\n");
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRoot\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir);
		expect(config.taskRunner.project.name).toBe("FromCwd");
	});

	it("2.3: TASKPLANE_WORKSPACE_ROOT set but has no config files → returns defaults", () => {
		const cwdDir = makeTestDir("cwd-no-config");
		const wsRoot = makeTestDir("ws-no-config");

		// Neither location has config files
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);
	});

	it("2.4: TASKPLANE_WORKSPACE_ROOT not set and cwd has no config → returns defaults", () => {
		const cwdDir = makeTestDir("cwd-alone");

		const config = loadProjectConfig(cwdDir);
		expect(config).toEqual({
			configVersion: CONFIG_VERSION,
			taskRunner: DEFAULT_TASK_RUNNER_SECTION,
			orchestrator: DEFAULT_ORCHESTRATOR_SECTION,
		});
	});

	it("2.5: cwd has JSON config → TASKPLANE_WORKSPACE_ROOT YAML is ignored", () => {
		const cwdDir = makeTestDir("cwd-json");
		const wsRoot = makeTestDir("ws-yaml");

		writeJsonConfig(cwdDir, {
			configVersion: 1,
			taskRunner: { project: { name: "CwdJson" } },
		});
		writeTaskRunnerYaml(wsRoot, "project:\n  name: WsYaml\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir);
		expect(config.taskRunner.project.name).toBe("CwdJson");
	});
});

// ── 3.x: Key preservation and adapter regression ─────────────────────

describe("key preservation and adapter regression", () => {
	it("3.1: sizeWeights preserves user-defined keys (S, M, L, XL)", () => {
		const dir = makeTestDir("size-weights");
		writeOrchestratorYaml(dir, [
			"assignment:",
			"  strategy: round-robin",
			"  size_weights:",
			"    S: 1",
			"    M: 2",
			"    L: 4",
			"    XL: 8",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.assignment.sizeWeights).toEqual({
			S: 1, M: 2, L: 4, XL: 8,
		});
		expect(config.orchestrator.assignment.sizeWeights).not.toHaveProperty("s");
		expect(config.orchestrator.assignment.sizeWeights).not.toHaveProperty("xl");
	});

	it("3.2: sizeWeights round-trips correctly through toOrchestratorConfig adapter", () => {
		const dir = makeTestDir("size-weights-adapter");
		writeOrchestratorYaml(dir, [
			"assignment:",
			"  size_weights:",
			"    S: 1",
			"    M: 2",
			"    L: 4",
			"    XL: 8",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);
		expect(legacy.assignment.size_weights).toEqual({
			S: 1, M: 2, L: 4, XL: 8,
		});
	});

	it("3.3: preWarm.commands preserves user-defined command keys", () => {
		const dir = makeTestDir("prewarm-cmds");
		writeOrchestratorYaml(dir, [
			"pre_warm:",
			"  auto_detect: true",
			"  commands:",
			"    install_deps: npm ci",
			"    build_project: npm run build",
			"  always:",
			"    - npm ci",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.preWarm.commands).toEqual({
			install_deps: "npm ci",
			build_project: "npm run build",
		});
		expect(config.orchestrator.preWarm.autoDetect).toBe(true);
		expect(config.orchestrator.preWarm.always).toEqual(["npm ci"]);
	});

	it("3.4: preWarm.commands round-trips through toOrchestratorConfig adapter", () => {
		const dir = makeTestDir("prewarm-adapter");
		writeOrchestratorYaml(dir, [
			"pre_warm:",
			"  commands:",
			"    my_cmd: echo hello",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);
		expect(legacy.pre_warm.commands).toEqual({ my_cmd: "echo hello" });
	});

	it("3.5: taskAreas preserves user-defined area IDs and inner fields", () => {
		const dir = makeTestDir("task-areas");
		writeTaskRunnerYaml(dir, [
			"task_areas:",
			"  backend-api:",
			"    path: taskplane-tasks",
			"    prefix: TP",
			"    context: taskplane-tasks/CONTEXT.md",
			"    repo_id: api-service",
			"  frontend-web:",
			"    path: frontend-tasks",
			"    prefix: FE",
			"    context: frontend-tasks/CONTEXT.md",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(Object.keys(config.taskRunner.taskAreas)).toEqual(["backend-api", "frontend-web"]);
		expect(config.taskRunner.taskAreas["backend-api"].path).toBe("taskplane-tasks");
		expect(config.taskRunner.taskAreas["backend-api"].prefix).toBe("TP");
		expect(config.taskRunner.taskAreas["backend-api"].repoId).toBe("api-service");
		expect(config.taskRunner.taskAreas["frontend-web"].path).toBe("frontend-tasks");
		expect(config.taskRunner.taskAreas["frontend-web"].repoId).toBeUndefined();
	});

	it("3.6: taskAreas repoId: whitespace-only is dropped, non-empty is trimmed", () => {
		const dir = makeTestDir("repo-id-trim");
		writeTaskRunnerYaml(dir, [
			"task_areas:",
			"  area1:",
			"    path: tasks",
			"    prefix: A",
			"    context: tasks/CONTEXT.md",
			"    repo_id: \"  api  \"",
			"  area2:",
			"    path: tasks2",
			"    prefix: B",
			"    context: tasks2/CONTEXT.md",
			"    repo_id: \"   \"",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.taskAreas.area1.repoId).toBe("api");
		expect(config.taskRunner.taskAreas.area2.repoId).toBeUndefined();
	});

	it("3.7: toTaskRunnerConfig adapter preserves task area IDs and repoId behavior", () => {
		const dir = makeTestDir("task-runner-adapter");
		writeTaskRunnerYaml(dir, [
			"task_areas:",
			"  myArea:",
			"    path: tasks",
			"    prefix: MY",
			"    context: tasks/CONTEXT.md",
			"    repo_id: myrepo",
			"reference_docs:",
			"  arch: docs/arch.md",
			"  design: docs/design.md",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toTaskRunnerConfig(config);
		// Area IDs preserved
		expect(Object.keys(legacy.task_areas)).toEqual(["myArea"]);
		expect(legacy.task_areas.myArea.path).toBe("tasks");
		expect(legacy.task_areas.myArea.prefix).toBe("MY");
		expect(legacy.task_areas.myArea.repoId).toBe("myrepo");
		// Reference doc keys preserved
		expect(legacy.reference_docs).toEqual({ arch: "docs/arch.md", design: "docs/design.md" });
	});

	it("3.8: standardsOverrides preserves user-defined area keys", () => {
		const dir = makeTestDir("standards-overrides");
		writeTaskRunnerYaml(dir, [
			"standards_overrides:",
			"  backend-api:",
			"    docs:",
			"      - docs/backend-standards.md",
			"    rules:",
			"      - Always use async/await",
			"  frontend-web:",
			"    docs:",
			"      - docs/frontend-standards.md",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(Object.keys(config.taskRunner.standardsOverrides)).toEqual(["backend-api", "frontend-web"]);
		expect(config.taskRunner.standardsOverrides["backend-api"].docs).toEqual(["docs/backend-standards.md"]);
		expect(config.taskRunner.standardsOverrides["backend-api"].rules).toEqual(["Always use async/await"]);
		expect(config.taskRunner.standardsOverrides["frontend-web"].docs).toEqual(["docs/frontend-standards.md"]);
	});

	it("3.9: referenceDocs preserves user-defined keys", () => {
		const dir = makeTestDir("ref-docs");
		writeTaskRunnerYaml(dir, [
			"reference_docs:",
			"  architecture: docs/architecture.md",
			"  api_spec: docs/api-spec.yaml",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.referenceDocs).toEqual({
			architecture: "docs/architecture.md",
			api_spec: "docs/api-spec.yaml",
		});
	});

	it("3.10: selfDocTargets preserves user-defined keys", () => {
		const dir = makeTestDir("self-doc");
		writeTaskRunnerYaml(dir, [
			"self_doc_targets:",
			"  context_file: taskplane-tasks/CONTEXT.md",
			"  tech_debt: docs/TECH-DEBT.md",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.selfDocTargets).toEqual({
			context_file: "taskplane-tasks/CONTEXT.md",
			tech_debt: "docs/TECH-DEBT.md",
		});
	});

	it("3.11: toTaskConfig adapter produces correct snake_case shape", () => {
		const dir = makeTestDir("task-config-adapter");
		writeTaskRunnerYaml(dir, [
			"project:",
			"  name: MyProject",
			"  description: My project desc",
			"paths:",
			"  tasks: my-tasks",
			"  architecture: docs/arch.md",
			"testing:",
			"  commands:",
			"    test: npm test",
			"    lint: npm run lint",
			"standards:",
			"  docs:",
			"    - STANDARDS.md",
			"  rules:",
			"    - Use TypeScript",
			"worker:",
			"  model: openai/gpt-4",
			"  tools: read,write",
			"  thinking: on",
			"  spawn_mode: tmux",
			"reviewer:",
			"  model: openai/gpt-4",
			"  tools: read",
			"  thinking: on",
			"context:",
			"  worker_context_window: 100000",
			"  warn_percent: 60",
			"  kill_percent: 80",
			"  max_worker_iterations: 10",
			"  max_review_cycles: 3",
			"  no_progress_limit: 5",
			"  max_worker_minutes: 45",
			"task_areas:",
			"  main:",
			"    path: tasks",
			"    prefix: T",
			"    context: tasks/CONTEXT.md",
			"    repo_id: main-repo",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);

		expect(taskConfig.project).toEqual({ name: "MyProject", description: "My project desc" });
		expect(taskConfig.paths).toEqual({ tasks: "my-tasks", architecture: "docs/arch.md" });
		expect(taskConfig.testing.commands).toEqual({ test: "npm test", lint: "npm run lint" });
		expect(taskConfig.standards).toEqual({ docs: ["STANDARDS.md"], rules: ["Use TypeScript"] });
		expect(taskConfig.worker.model).toBe("openai/gpt-4");
		expect(taskConfig.worker.tools).toBe("read,write");
		expect(taskConfig.worker.thinking).toBe("on");
		expect(taskConfig.worker.spawn_mode).toBe("tmux");
		expect(taskConfig.reviewer).toEqual({ model: "openai/gpt-4", tools: "read", thinking: "on" });
		expect(taskConfig.context.worker_context_window).toBe(100000);
		expect(taskConfig.context.warn_percent).toBe(60);
		expect(taskConfig.context.kill_percent).toBe(80);
		expect(taskConfig.context.max_worker_iterations).toBe(10);
		expect(taskConfig.context.max_review_cycles).toBe(3);
		expect(taskConfig.context.no_progress_limit).toBe(5);
		expect(taskConfig.context.max_worker_minutes).toBe(45);
		expect(taskConfig.task_areas.main.path).toBe("tasks");
		expect((taskConfig.task_areas.main as any).repo_id).toBe("main-repo");
	});

	it("3.12: toOrchestratorConfig adapter produces correct full snake_case shape", () => {
		const dir = makeTestDir("orch-adapter-full");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 5",
			"  worktree_location: sibling",
			"  worktree_prefix: my-wt",
			"  batch_id_format: sequential",
			"  spawn_mode: tmux",
			"  tmux_prefix: myorch",
			"  operator_id: testuser",
			"dependencies:",
			"  source: agent",
			"  cache: false",
			"assignment:",
			"  strategy: round-robin",
			"  size_weights:",
			"    S: 2",
			"    M: 4",
			"    L: 8",
			"merge:",
			"  model: openai/gpt-4",
			"  tools: read,write",
			"  verify:",
			"    - npm test",
			"  order: sequential",
			"failure:",
			"  on_task_failure: stop-all",
			"  on_merge_failure: abort",
			"  stall_timeout: 60",
			"  max_worker_minutes: 45",
			"  abort_grace_period: 120",
			"monitoring:",
			"  poll_interval: 10",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);

		expect(legacy.orchestrator.max_lanes).toBe(5);
		expect(legacy.orchestrator.worktree_location).toBe("sibling");
		expect(legacy.orchestrator.worktree_prefix).toBe("my-wt");
		expect(legacy.orchestrator.batch_id_format).toBe("sequential");
		expect(legacy.orchestrator.spawn_mode).toBe("tmux");
		expect(legacy.orchestrator.tmux_prefix).toBe("myorch");
		expect(legacy.orchestrator.operator_id).toBe("testuser");
		expect(legacy.dependencies.source).toBe("agent");
		expect(legacy.dependencies.cache).toBe(false);
		expect(legacy.assignment.strategy).toBe("round-robin");
		expect(legacy.assignment.size_weights).toEqual({ S: 2, M: 4, L: 8 });
		expect(legacy.merge.model).toBe("openai/gpt-4");
		expect(legacy.merge.tools).toBe("read,write");
		expect(legacy.merge.verify).toEqual(["npm test"]);
		expect(legacy.merge.order).toBe("sequential");
		expect(legacy.failure.on_task_failure).toBe("stop-all");
		expect(legacy.failure.on_merge_failure).toBe("abort");
		expect(legacy.failure.stall_timeout).toBe(60);
		expect(legacy.failure.max_worker_minutes).toBe(45);
		expect(legacy.failure.abort_grace_period).toBe(120);
		expect(legacy.monitoring.poll_interval).toBe(10);
	});
});

// ── 4.x: Defaults, cloning, non-mutation, backward-compat wrappers ──

describe("defaults, cloning, non-mutation, and backward-compat wrappers", () => {
	it("4.1: multiple loadProjectConfig calls return independent objects (no cross-call mutation)", () => {
		const dir = makeTestDir("cloning");
		writeTaskRunnerYaml(dir, "project:\n  name: CloneTest\n");

		const config1 = loadProjectConfig(dir);
		const config2 = loadProjectConfig(dir);

		// Should be equal but not the same reference
		expect(config1).toEqual(config2);
		expect(config1).not.toBe(config2);
		expect(config1.taskRunner).not.toBe(config2.taskRunner);
		expect(config1.orchestrator).not.toBe(config2.orchestrator);

		// Mutating config1 should not affect config2
		config1.taskRunner.project.name = "MUTATED";
		expect(config2.taskRunner.project.name).toBe("CloneTest");
	});

	it("4.2: defaults are not mutated by loading config", () => {
		const dir = makeTestDir("defaults-safe");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				project: { name: "Override" },
				context: { workerContextWindow: 500000 },
			},
		});

		loadProjectConfig(dir);

		// DEFAULT_PROJECT_CONFIG should be unchanged
		expect(DEFAULT_PROJECT_CONFIG.taskRunner.project.name).toBe("Project");
		expect(DEFAULT_PROJECT_CONFIG.taskRunner.context.workerContextWindow).toBe(200000);
	});

	it("4.3: loadOrchestratorConfig wrapper returns correct snake_case shape", () => {
		const dir = makeTestDir("orch-wrapper");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 4",
			"assignment:",
			"  size_weights:",
			"    S: 1",
			"    M: 3",
		].join("\n"));

		const legacy = loadOrchestratorConfig(dir);
		expect(legacy.orchestrator.max_lanes).toBe(4);
		expect(legacy.assignment.size_weights).toEqual({ S: 1, M: 3, L: 4 }); // L from default
	});

	it("4.4: loadTaskRunnerConfig wrapper returns correct snake_case shape", () => {
		const dir = makeTestDir("runner-wrapper");
		writeTaskRunnerYaml(dir, [
			"task_areas:",
			"  main:",
			"    path: my-tasks",
			"    prefix: MT",
			"    context: my-tasks/CONTEXT.md",
			"reference_docs:",
			"  readme: README.md",
		].join("\n"));

		const legacy = loadTaskRunnerConfig(dir);
		expect(legacy.task_areas.main.path).toBe("my-tasks");
		expect(legacy.task_areas.main.prefix).toBe("MT");
		expect(legacy.reference_docs).toEqual({ readme: "README.md" });
	});

	it("4.5: task-runner loadConfig catches malformed JSON and returns defaults", () => {
		// task-runner.ts exports loadConfig() which does:
		//   try { return toTaskConfig(loadProjectConfig(cwd)); }
		//   catch { return { ...DEFAULT_CONFIG }; }
		//
		// We call the actual loadConfig with malformed JSON to verify:
		// (a) loadProjectConfig would throw ConfigLoadError,
		// (b) loadConfig catches it and returns the default TaskConfig shape.

		const dir = makeTestDir("loadconfig-malformed");
		writePiFile(dir, "taskplane-config.json", "{ broken json }}}");

		// (a) loadProjectConfig must throw on malformed JSON
		expect(() => loadProjectConfig(dir)).toThrow(ConfigLoadError);

		// (b) task-runner's loadConfig catches and returns defaults
		const result = taskRunnerLoadConfig(dir);

		expect(result.project.name).toBe("Project");
		expect(result.project.description).toBe("");
		expect(result.worker.model).toBe("");
		expect(result.worker.tools).toBe("read,write,edit,bash,grep,find,ls");
		expect(result.context.worker_context_window).toBe(200000);
		expect(result.context.warn_percent).toBe(70);
		expect(result.context.kill_percent).toBe(85);
		expect(result.context.max_worker_iterations).toBe(20);
		expect(result.context.max_review_cycles).toBe(2);
		expect(result.context.no_progress_limit).toBe(3);
		expect(result.paths.tasks).toBe("docs/task-management");
		expect(result.testing.commands).toEqual({});
		expect(result.standards).toEqual({ docs: [], rules: [] });
		expect(result.task_areas).toEqual({});
	});

	it("4.6: JSON config deep merges nested fields (partial section override)", () => {
		const dir = makeTestDir("deep-merge");
		writeJsonConfig(dir, {
			configVersion: 1,
			orchestrator: {
				failure: {
					stallTimeout: 99,
					// Other failure fields should come from defaults
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.failure.stallTimeout).toBe(99);
		expect(config.orchestrator.failure.onTaskFailure).toBe("skip-dependents"); // default
		expect(config.orchestrator.failure.maxWorkerMinutes).toBe(30); // default
	});

	it("4.7: YAML array sections are preserved verbatim (neverLoad, protectedDocs)", () => {
		const dir = makeTestDir("arrays");
		writeTaskRunnerYaml(dir, [
			"never_load:",
			"  - node_modules/",
			"  - dist/",
			"  - .git/",
			"protected_docs:",
			"  - AGENTS.md",
			"  - docs/arch.md",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.neverLoad).toEqual(["node_modules/", "dist/", ".git/"]);
		expect(config.taskRunner.protectedDocs).toEqual(["AGENTS.md", "docs/arch.md"]);
	});

	it("4.8: testing.commands preserves user-defined command keys from YAML", () => {
		const dir = makeTestDir("testing-cmds");
		writeTaskRunnerYaml(dir, [
			"testing:",
			"  commands:",
			"    unit_test: npm test",
			"    e2e_test: npm run e2e",
			"    type_check: npx tsc --noEmit",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.testing.commands).toEqual({
			unit_test: "npm test",
			e2e_test: "npm run e2e",
			type_check: "npx tsc --noEmit",
		});
	});
});

// ── 5.x: Pointer-aware config resolution (TP-016) ───────────────────

describe("loadProjectConfig with pointerConfigRoot", () => {
	it("5.1: pointerConfigRoot with config files is used when cwd has no config", () => {
		const cwdDir = makeTestDir("ptr-cwd-empty");
		const pointerDir = makeTestDir("ptr-config-repo");
		writeTaskRunnerYaml(pointerDir, "project:\n  name: FromPointerRepo\n");

		const config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("FromPointerRepo");
	});

	it("5.2: cwd config takes precedence over pointerConfigRoot", () => {
		const cwdDir = makeTestDir("ptr-cwd-has-config");
		const pointerDir = makeTestDir("ptr-config-repo-override");
		writeTaskRunnerYaml(cwdDir, "project:\n  name: FromCwd\n");
		writeTaskRunnerYaml(pointerDir, "project:\n  name: FromPointer\n");

		const config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("FromCwd");
	});

	it("5.3: pointerConfigRoot takes precedence over TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("ptr-cwd-no-config");
		const pointerDir = makeTestDir("ptr-config-repo-priority");
		const wsRoot = makeTestDir("ptr-ws-root");
		writeTaskRunnerYaml(pointerDir, "project:\n  name: FromPointer\n");
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRoot\n");
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("FromPointer");
	});

	it("5.4: pointerConfigRoot without config files falls through to TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("ptr-cwd-no-config2");
		const pointerDir = makeTestDir("ptr-empty-pointer");
		const wsRoot = makeTestDir("ptr-ws-fallback");
		// pointerDir has no config files
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRootFallback\n");
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("FromWsRootFallback");
	});

	it("5.5: undefined pointerConfigRoot preserves existing behavior", () => {
		const cwdDir = makeTestDir("ptr-undefined");
		const wsRoot = makeTestDir("ptr-ws-existing");
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsExisting\n");
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, undefined);
		expect(config.taskRunner.project.name).toBe("FromWsExisting");
	});

	it("5.6: repo mode — no pointerConfigRoot, no TASKPLANE_WORKSPACE_ROOT → defaults", () => {
		const cwdDir = makeTestDir("ptr-repo-mode");
		// No config files anywhere, no env var, no pointer
		const config = loadProjectConfig(cwdDir);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);
	});

	it("5.7: pointerConfigRoot with JSON config is used (JSON-first precedence preserved)", () => {
		const cwdDir = makeTestDir("ptr-json");
		const pointerDir = makeTestDir("ptr-json-config-repo");
		writeJsonConfig(pointerDir, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointerJson" } },
		});

		const config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("FromPointerJson");
	});

	it("5.8: full precedence chain — cwd > pointer > TASKPLANE_WORKSPACE_ROOT > defaults", () => {
		// Verify the complete 4-level precedence chain
		const cwdDir = makeTestDir("ptr-chain-cwd");
		const pointerDir = makeTestDir("ptr-chain-pointer");
		const wsRoot = makeTestDir("ptr-chain-ws");

		// Level 4: No config anywhere → defaults
		let config = loadProjectConfig(cwdDir, undefined);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);

		// Level 3: Only TASKPLANE_WORKSPACE_ROOT has config
		writeTaskRunnerYaml(wsRoot, "project:\n  name: Level3WsRoot\n");
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;
		config = loadProjectConfig(cwdDir, undefined);
		expect(config.taskRunner.project.name).toBe("Level3WsRoot");

		// Level 2: Pointer has config (beats TASKPLANE_WORKSPACE_ROOT)
		writeTaskRunnerYaml(pointerDir, "project:\n  name: Level2Pointer\n");
		config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("Level2Pointer");

		// Level 1: cwd has config (beats pointer)
		writeTaskRunnerYaml(cwdDir, "project:\n  name: Level1Cwd\n");
		config = loadProjectConfig(cwdDir, pointerDir);
		expect(config.taskRunner.project.name).toBe("Level1Cwd");
	});
});

// ── 5.x: Pointer-threaded config resolution (TP-016 Step 2) ─────────

describe("pointer-threaded config resolution (TP-016)", () => {
	/**
	 * These tests verify that loadProjectConfig and task-runner's loadConfig
	 * correctly thread pointer configRoot through the precedence chain:
	 *   1. cwd has config files → use cwd (local override)
	 *   2. pointerConfigRoot has config files → use it
	 *   3. TASKPLANE_WORKSPACE_ROOT has config files → use it (legacy fallback)
	 *   4. Fall back to cwd (loaders return defaults)
	 */

	it("5.1: loadProjectConfig uses pointerConfigRoot when cwd has no config files", () => {
		const cwdDir = makeTestDir("ptr-cwd-empty");
		const pointerRoot = makeTestDir("ptr-config-repo");

		// Pointer config root has config
		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointer" } },
		});

		const config = loadProjectConfig(cwdDir, join(pointerRoot));
		expect(config.taskRunner.project.name).toBe("FromPointer");
	});

	it("5.2: cwd config takes precedence over pointerConfigRoot", () => {
		const cwdDir = makeTestDir("ptr-cwd-wins");
		const pointerRoot = makeTestDir("ptr-config-repo-2");

		// cwd has config
		writeJsonConfig(cwdDir, {
			configVersion: 1,
			taskRunner: { project: { name: "FromCwd" } },
		});
		// Pointer also has config
		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointer" } },
		});

		const config = loadProjectConfig(cwdDir, join(pointerRoot));
		expect(config.taskRunner.project.name).toBe("FromCwd");
	});

	it("5.3: pointerConfigRoot takes precedence over TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("ptr-over-ws");
		const wsRoot = makeTestDir("ptr-ws-root");
		const pointerRoot = makeTestDir("ptr-config-repo-3");

		// Workspace root has config
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRoot\n");
		// Pointer config root has config
		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointer" } },
		});

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, join(pointerRoot));
		expect(config.taskRunner.project.name).toBe("FromPointer");
	});

	it("5.4: pointerConfigRoot without config files falls through to TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("ptr-no-config");
		const wsRoot = makeTestDir("ptr-ws-root-fb");
		const pointerRoot = makeTestDir("ptr-config-repo-empty");

		// Pointer root exists but has no config files
		mkdirSync(join(pointerRoot, ".pi"), { recursive: true });

		// Workspace root has config
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRootFallback\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, join(pointerRoot));
		expect(config.taskRunner.project.name).toBe("FromWsRootFallback");
	});

	it("5.5: null/undefined pointerConfigRoot is same as pre-pointer behavior", () => {
		const cwdDir = makeTestDir("ptr-null");
		const wsRoot = makeTestDir("ptr-ws-root-null");

		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRootNoPointer\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		// Explicit undefined
		const config1 = loadProjectConfig(cwdDir, undefined);
		expect(config1.taskRunner.project.name).toBe("FromWsRootNoPointer");

		// No second arg at all
		const config2 = loadProjectConfig(cwdDir);
		expect(config2.taskRunner.project.name).toBe("FromWsRootNoPointer");
	});

	it("5.6: repo mode — no TASKPLANE_WORKSPACE_ROOT, no pointer → uses cwd or defaults", () => {
		const cwdDir = makeTestDir("ptr-repo-mode");

		// No TASKPLANE_WORKSPACE_ROOT, no pointer
		delete process.env.TASKPLANE_WORKSPACE_ROOT;

		const config = loadProjectConfig(cwdDir);
		// Should get defaults since cwd has no config files
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);
	});

	it("5.7: task-runner loadConfig repo mode parity — returns config without pointer interference", () => {
		const cwdDir = makeTestDir("ptr-loadconfig-repo");

		// No TASKPLANE_WORKSPACE_ROOT
		delete process.env.TASKPLANE_WORKSPACE_ROOT;

		writeJsonConfig(cwdDir, {
			configVersion: 1,
			taskRunner: { project: { name: "RepoModeProject" } },
		});

		const config = taskRunnerLoadConfig(cwdDir);
		expect(config.project.name).toBe("RepoModeProject");
	});

	it("5.8: task-runner loadConfig workspace mode — resolves pointer for config", () => {
		// This tests the full chain: loadConfig → resolveTaskRunnerPointer → loadProjectConfig
		// We simulate workspace mode by setting TASKPLANE_WORKSPACE_ROOT, but since
		// the workspace config YAML would need a full git repo setup, we verify that
		// loadConfig gracefully handles workspace config failures (returns defaults or
		// falls through to TASKPLANE_WORKSPACE_ROOT).
		const cwdDir = makeTestDir("ptr-loadconfig-ws");
		const wsRoot = makeTestDir("ptr-ws-for-loadconfig");

		// Workspace root has config but no valid workspace YAML → pointer resolution
		// will fail (workspace config load throws), but loadConfig should still work
		// by falling through to TASKPLANE_WORKSPACE_ROOT
		writeTaskRunnerYaml(wsRoot, "project:\n  name: WsConfigFallback\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = taskRunnerLoadConfig(cwdDir);
		// Should fall through: pointer fails (no workspace yaml) → wsRoot fallback
		expect(config.project.name).toBe("WsConfigFallback");
	});

	it("5.9: pointerConfigRoot with YAML config is resolved correctly", () => {
		const cwdDir = makeTestDir("ptr-yaml");
		const pointerRoot = makeTestDir("ptr-yaml-config");

		// Pointer root has YAML config (no JSON)
		writeTaskRunnerYaml(pointerRoot, "project:\n  name: PointerYaml\n");

		const config = loadProjectConfig(cwdDir, join(pointerRoot));
		expect(config.taskRunner.project.name).toBe("PointerYaml");
	});
});
