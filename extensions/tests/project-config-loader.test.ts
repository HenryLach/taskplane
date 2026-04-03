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
 *   5.x — Pointer-threaded config resolution (standard + flat layout)
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/project-config-loader.test.ts
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { expect } from "./expect.ts";
import assert from "node:assert";
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
} from "fs";
import { execSync } from "child_process";
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
			assert.fail("should have thrown");
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
			assert.fail("should have thrown");
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
			assert.fail("should have thrown");
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
			assert.fail("should have thrown");
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
			"  spawn_mode: subprocess",
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
		expect(taskConfig.worker.spawn_mode).toBe("subprocess");
		// Note: reviewer.model may be overridden by user preferences (~/.pi/agent/taskplane/preferences.json)
		// so we check tools and thinking explicitly rather than toEqual on the full object.
		expect(taskConfig.reviewer.tools).toBe("read");
		expect(taskConfig.reviewer.thinking).toBe("on");
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

	it("3.12: toOrchestratorConfig adapter produces correct full runtime shape", () => {
		const dir = makeTestDir("orch-adapter-full");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 5",
			"  worktree_location: sibling",
			"  worktree_prefix: my-wt",
			"  batch_id_format: sequential",
			"  spawn_mode: subprocess",
			"  session_prefix: myorch",
			"  operator_id: testuser",
			"  integration: auto",
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
		expect(legacy.orchestrator.spawn_mode).toBe("subprocess");
		expect(legacy.orchestrator.sessionPrefix).toBe("myorch");
		expect(legacy.orchestrator.operator_id).toBe("testuser");
		expect(legacy.orchestrator.integration).toBe("auto");
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

	it("3.13: integration defaults to 'manual' when omitted from YAML", () => {
		const dir = makeTestDir("integration-default");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		// Unified config should have the default
		expect(config.orchestrator.orchestrator.integration).toBe("manual");
		// Adapter should carry it through
		const legacy = toOrchestratorConfig(config);
		expect(legacy.orchestrator.integration).toBe("manual");
	});

	it("3.14: auto-migrates orchestrator spawn_mode tmux → subprocess", () => {
		const dir = makeTestDir("spawn-mode-tmux-orch-migrate");
		writeOrchestratorYaml(dir, "orchestrator:\n  spawn_mode: tmux\n");
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.orchestrator.spawnMode).toBe("subprocess");
	});

	it("3.15: auto-migrates worker spawn_mode tmux → subprocess", () => {
		const dir = makeTestDir("spawn-mode-tmux-worker-migrate");
		writeTaskRunnerYaml(dir, "worker:\n  spawn_mode: tmux\n");
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.worker.spawnMode).toBe("subprocess");
	});

	it("3.16: auto-migrates tmux_prefix → sessionPrefix", () => {
		const dir = makeTestDir("tmux-prefix-alias-migrate");
		writeOrchestratorYaml(dir, "orchestrator:\n  tmux_prefix: orch-legacy\n");
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.orchestrator.sessionPrefix).toBe("orch-legacy");
	});

	it("3.17: when both sessionPrefix and tmuxPrefix exist, sessionPrefix wins", () => {
		const dir = makeTestDir("both-prefix-keys");
		// JSON config with both keys — sessionPrefix should take priority
		mkdirSync(join(dir, ".pi"), { recursive: true });
		writeFileSync(join(dir, ".pi", "taskplane-config.json"), JSON.stringify({
			configVersion: 1,
			orchestrator: { orchestrator: { sessionPrefix: "new-prefix", tmuxPrefix: "old-prefix" } },
		}, null, 2));
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.orchestrator.sessionPrefix).toBe("new-prefix");
		// tmuxPrefix should be removed from disk
		const updated = JSON.parse(readFileSync(join(dir, ".pi", "taskplane-config.json"), "utf-8"));
		expect(updated.orchestrator.orchestrator.tmuxPrefix).toBeUndefined();
		expect(updated.orchestrator.orchestrator.sessionPrefix).toBe("new-prefix");
	});

	it("3.18: migration write failure logs warning but does not crash", () => {
		const dir = makeTestDir("migration-write-fail");
		writeOrchestratorYaml(dir, "orchestrator:\n  tmux_prefix: test-prefix\n");
		// YAML-only project — no JSON file to write back to, but should not crash
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.orchestrator.sessionPrefix).toBe("test-prefix");
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
		expect(DEFAULT_PROJECT_CONFIG.taskRunner.context.workerContextWindow).toBe(0);
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
		expect(result.context.worker_context_window).toBe(0);
		expect(result.context.warn_percent).toBe(85);
		expect(result.context.kill_percent).toBe(95);
		expect(result.context.max_worker_iterations).toBe(20);
		expect(result.context.max_review_cycles).toBe(2);
		expect(result.context.no_progress_limit).toBe(3);
		expect(result.paths.tasks).toBe("docs/task-management");
		expect(result.testing.commands).toEqual({});
		expect(result.standards).toEqual({ docs: [], rules: [] });
		expect(result.task_areas).toEqual({});
	});

	it("4.5b: task-runner loadConfig does not crash on worker spawn_mode tmux", () => {
		const dir = makeTestDir("loadconfig-legacy-worker-spawn");
		writeTaskRunnerYaml(dir, "worker:\n  spawn_mode: tmux\n");
		// Should not throw — auto-migration handles legacy field
		const config = taskRunnerLoadConfig(dir);
		expect(config).toBeDefined();
	});

	it("4.5c: task-runner loadConfig does not crash on legacy user prefs", () => {
		const dir = makeTestDir("loadconfig-legacy-prefs");
		const agentDir = makeTestDir("loadconfig-legacy-prefs-agent");
		const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		mkdirSync(join(agentDir, "taskplane"), { recursive: true });
		writeFileSync(join(agentDir, "taskplane", "preferences.json"), JSON.stringify({ tmuxPrefix: "legacy-pref" }), "utf-8");

		try {
			// Should not throw — auto-migration handles legacy field
			const config = taskRunnerLoadConfig(dir);
			expect(config).toBeDefined();
		} finally {
			if (prevAgentDir === undefined) {
				delete process.env.PI_CODING_AGENT_DIR;
			} else {
				process.env.PI_CODING_AGENT_DIR = prevAgentDir;
			}
		}
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
		expect(config.orchestrator.failure.maxWorkerMinutes).toBe(120); // default (increased from 30 for persistent worker sessions)
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

// ── 4.9x: Quality gate config defaults and adapter mapping (TP-034) ─

describe("quality gate config defaults and adapter mapping (TP-034)", () => {
	it("4.9: quality gate defaults are correct when not specified in config", () => {
		const dir = makeTestDir("qg-defaults");
		writeTaskRunnerYaml(dir, [
			"project:",
			"  name: QGTest",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.qualityGate).toEqual({
			enabled: false,
			reviewModel: "",
			maxReviewCycles: 2,
			maxFixCycles: 1,
			passThreshold: "no_critical",
		});
	});

	it("4.10: quality gate config from YAML maps correctly to TaskConfig snake_case", () => {
		const dir = makeTestDir("qg-yaml-adapter");
		writeTaskRunnerYaml(dir, [
			"project:",
			"  name: QGYaml",
			"quality_gate:",
			"  enabled: true",
			"  review_model: openai/gpt-5",
			"  max_review_cycles: 3",
			"  max_fix_cycles: 2",
			"  pass_threshold: no_important",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);

		expect(taskConfig.quality_gate).toEqual({
			enabled: true,
			review_model: "openai/gpt-5",
			max_review_cycles: 3,
			max_fix_cycles: 2,
			pass_threshold: "no_important",
		});
	});

	it("4.11: quality gate config from JSON maps correctly to TaskConfig snake_case", () => {
		const dir = makeTestDir("qg-json-adapter");
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			taskRunner: {
				qualityGate: {
					enabled: true,
					reviewModel: "anthropic/claude-4",
					maxReviewCycles: 1,
					maxFixCycles: 0,
					passThreshold: "all_clear",
				},
			},
		});

		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);

		expect(taskConfig.quality_gate).toEqual({
			enabled: true,
			review_model: "anthropic/claude-4",
			max_review_cycles: 1,
			max_fix_cycles: 0,
			pass_threshold: "all_clear",
		});
	});

	it("4.12: quality gate defaults propagate through toTaskConfig when not configured", () => {
		const dir = makeTestDir("qg-defaults-adapter");
		writeTaskRunnerYaml(dir, [
			"project:",
			"  name: DefaultQG",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const taskConfig = toTaskConfig(config);

		expect(taskConfig.quality_gate).toEqual({
			enabled: false,
			review_model: "",
			max_review_cycles: 2,
			max_fix_cycles: 1,
			pass_threshold: "no_critical",
		});
	});

	it("4.13: task-runner loadConfig includes quality_gate defaults", () => {
		const dir = makeTestDir("qg-task-runner-defaults");
		writeTaskRunnerYaml(dir, [
			"project:",
			"  name: TaskRunnerQG",
		].join("\n"));

		const result = taskRunnerLoadConfig(dir);
		expect(result.quality_gate).toEqual({
			enabled: false,
			review_model: "",
			max_review_cycles: 2,
			max_fix_cycles: 1,
			pass_threshold: "no_critical",
		});
	});
});

// ── 4.14x: Verification config defaults and adapter mapping (TP-032) ─

describe("verification config defaults and adapter mapping (TP-032)", () => {
	it("4.14: verification defaults are correct when not specified in config", () => {
		const dir = makeTestDir("verify-defaults");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification).toEqual({
			enabled: false,
			mode: "permissive",
			flakyReruns: 1,
		});
	});

	it("4.15: verification config from YAML (snake_case) maps to camelCase", () => {
		const dir = makeTestDir("verify-yaml");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
			"verification:",
			"  enabled: true",
			"  mode: strict",
			"  flaky_reruns: 3",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification).toEqual({
			enabled: true,
			mode: "strict",
			flakyReruns: 3,
		});
	});

	it("4.16: verification config from JSON (camelCase) loads correctly", () => {
		const dir = makeTestDir("verify-json");
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			orchestrator: {
				verification: {
					enabled: true,
					mode: "strict",
					flakyReruns: 0,
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification).toEqual({
			enabled: true,
			mode: "strict",
			flakyReruns: 0,
		});
	});

	it("4.17: toOrchestratorConfig adapter maps verification to snake_case", () => {
		const dir = makeTestDir("verify-adapter");
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			orchestrator: {
				verification: {
					enabled: true,
					mode: "strict",
					flakyReruns: 2,
				},
			},
		});

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);

		expect(legacy.verification).toEqual({
			enabled: true,
			mode: "strict",
			flaky_reruns: 2,
		});
	});

	it("4.18: verification defaults propagate through toOrchestratorConfig when not configured", () => {
		const dir = makeTestDir("verify-defaults-adapter");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);

		expect(legacy.verification).toEqual({
			enabled: false,
			mode: "permissive",
			flaky_reruns: 1,
		});
	});

	it("4.19: partial verification YAML config merges with defaults", () => {
		const dir = makeTestDir("verify-partial");
		writeOrchestratorYaml(dir, [
			"verification:",
			"  enabled: true",
		].join("\n"));

		const config = loadProjectConfig(dir);
		// enabled is overridden, mode and flakyReruns should come from defaults
		expect(config.orchestrator.verification.enabled).toBe(true);
		expect(config.orchestrator.verification.mode).toBe("permissive");
		expect(config.orchestrator.verification.flakyReruns).toBe(1);
	});

	it("4.20: verification flaky_reruns=0 round-trips through YAML→adapter", () => {
		const dir = makeTestDir("verify-zero-reruns");
		writeOrchestratorYaml(dir, [
			"verification:",
			"  enabled: true",
			"  flaky_reruns: 0",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification.flakyReruns).toBe(0);

		const legacy = toOrchestratorConfig(config);
		expect(legacy.verification.flaky_reruns).toBe(0);
	});

	it("4.21: existing 3.12 full adapter test includes verification", () => {
		// Verify that the full adapter test (3.12) would include verification
		// if present — this test explicitly checks that verification fields
		// appear alongside other orchestrator adapter output
		const dir = makeTestDir("verify-full-adapter");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 5",
			"verification:",
			"  enabled: true",
			"  mode: strict",
			"  flaky_reruns: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);

		// Core orchestrator fields
		expect(legacy.orchestrator.max_lanes).toBe(5);
		// Verification fields
		expect(legacy.verification.enabled).toBe(true);
		expect(legacy.verification.mode).toBe("strict");
		expect(legacy.verification.flaky_reruns).toBe(2);
	});
});

// ── 5.x: Pointer-threaded config resolution (TP-016) ────────────────

describe("pointer-threaded config resolution (TP-016)", () => {
	/**
	 * Tests verify loadProjectConfig and task-runner's loadConfig
	 * correctly thread pointer configRoot through the precedence chain:
	 *   1. cwd has config files → use cwd (local override)
	 *   2. pointerConfigRoot has config files → use it (standard or flat layout)
	 *   3. TASKPLANE_WORKSPACE_ROOT has config files → use it (legacy fallback)
	 *   4. Fall back to cwd (loaders return defaults)
	 *
	 * Two config layouts are supported:
	 *   - Standard: <root>/.pi/taskplane-config.json (repo mode, workspace root)
	 *   - Flat: <root>/taskplane-config.json (pointer-resolved .taskplane/ dir)
	 */

	// ── Helper: write config in flat layout (no .pi/ subdirectory) ───
	function writeFlatJsonConfig(root: string, obj: any): void {
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "taskplane-config.json"), JSON.stringify(obj, null, 2), "utf-8");
	}

	function writeFlatTaskRunnerYaml(root: string, content: string): void {
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "task-runner.yaml"), content, "utf-8");
	}

	function writeFlatOrchestratorYaml(root: string, content: string): void {
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "task-orchestrator.yaml"), content, "utf-8");
	}

	// ── Standard layout (pointer root with .pi/ subdirectory) ────────

	it("5.1: pointerConfigRoot with standard-layout config is used when cwd has no config", () => {
		const cwdDir = makeTestDir("ptr-cwd-empty");
		const pointerRoot = makeTestDir("ptr-config-repo");

		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointer" } },
		});

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FromPointer");
	});

	it("5.2: cwd config takes precedence over pointerConfigRoot", () => {
		const cwdDir = makeTestDir("ptr-cwd-wins");
		const pointerRoot = makeTestDir("ptr-config-repo-2");

		writeJsonConfig(cwdDir, {
			configVersion: 1,
			taskRunner: { project: { name: "FromCwd" } },
		});
		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointer" } },
		});

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FromCwd");
	});

	it("5.3: pointerConfigRoot takes precedence over TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("ptr-over-ws");
		const wsRoot = makeTestDir("ptr-ws-root");
		const pointerRoot = makeTestDir("ptr-config-repo-3");

		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRoot\n");
		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FromPointer" } },
		});

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FromPointer");
	});

	it("5.4: pointerConfigRoot without config files falls through to TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("ptr-no-config");
		const wsRoot = makeTestDir("ptr-ws-root-fb");
		const pointerRoot = makeTestDir("ptr-config-repo-empty");

		mkdirSync(pointerRoot, { recursive: true });
		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRootFallback\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FromWsRootFallback");
	});

	it("5.5: null/undefined pointerConfigRoot is same as pre-pointer behavior", () => {
		const cwdDir = makeTestDir("ptr-null");
		const wsRoot = makeTestDir("ptr-ws-root-null");

		writeTaskRunnerYaml(wsRoot, "project:\n  name: FromWsRootNoPointer\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config1 = loadProjectConfig(cwdDir, undefined);
		expect(config1.taskRunner.project.name).toBe("FromWsRootNoPointer");

		const config2 = loadProjectConfig(cwdDir);
		expect(config2.taskRunner.project.name).toBe("FromWsRootNoPointer");
	});

	it("5.6: repo mode — no TASKPLANE_WORKSPACE_ROOT, no pointer → uses cwd or defaults", () => {
		const cwdDir = makeTestDir("ptr-repo-mode");

		delete process.env.TASKPLANE_WORKSPACE_ROOT;

		const config = loadProjectConfig(cwdDir);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);
	});

	it("5.7: task-runner loadConfig repo mode parity — returns config without pointer interference", () => {
		const cwdDir = makeTestDir("ptr-loadconfig-repo");

		delete process.env.TASKPLANE_WORKSPACE_ROOT;

		writeJsonConfig(cwdDir, {
			configVersion: 1,
			taskRunner: { project: { name: "RepoModeProject" } },
		});

		const config = taskRunnerLoadConfig(cwdDir);
		expect(config.project.name).toBe("RepoModeProject");
	});

	it("5.8: task-runner loadConfig workspace mode — resolves pointer for config", () => {
		const cwdDir = makeTestDir("ptr-loadconfig-ws");
		const wsRoot = makeTestDir("ptr-ws-for-loadconfig");

		// No valid workspace YAML → pointer resolution fails → wsRoot fallback
		writeTaskRunnerYaml(wsRoot, "project:\n  name: WsConfigFallback\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = taskRunnerLoadConfig(cwdDir);
		expect(config.project.name).toBe("WsConfigFallback");
	});

	it("5.9: pointerConfigRoot with YAML config is resolved correctly", () => {
		const cwdDir = makeTestDir("ptr-yaml");
		const pointerRoot = makeTestDir("ptr-yaml-config");

		writeTaskRunnerYaml(pointerRoot, "project:\n  name: PointerYaml\n");

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("PointerYaml");
	});

	// ── Flat layout (real .taskplane/ pointer directory) ─────────────

	it("5.10: flat-layout JSON config at pointer root is found (no .pi/ subdirectory)", () => {
		const cwdDir = makeTestDir("flat-json-cwd");
		// Simulate <configRepo>/.taskplane/ with files directly in root
		const pointerRoot = makeTestDir("flat-json-taskplane");

		writeFlatJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FlatJsonPointer" } },
		});

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FlatJsonPointer");
	});

	it("5.11: flat-layout YAML config at pointer root is found", () => {
		const cwdDir = makeTestDir("flat-yaml-cwd");
		const pointerRoot = makeTestDir("flat-yaml-taskplane");

		writeFlatTaskRunnerYaml(pointerRoot, "project:\n  name: FlatYamlPointer\n");

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FlatYamlPointer");
	});

	it("5.12: flat-layout orchestrator YAML at pointer root is found", () => {
		const cwdDir = makeTestDir("flat-orch-cwd");
		const pointerRoot = makeTestDir("flat-orch-taskplane");

		writeFlatOrchestratorYaml(pointerRoot, "orchestrator:\n  max_lanes: 8\n");

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(8);
	});

	it("5.13: flat-layout pointer takes precedence over TASKPLANE_WORKSPACE_ROOT", () => {
		const cwdDir = makeTestDir("flat-vs-ws-cwd");
		const pointerRoot = makeTestDir("flat-vs-ws-ptr");
		const wsRoot = makeTestDir("flat-vs-ws-root");

		writeFlatJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FlatPointerWins" } },
		});
		writeTaskRunnerYaml(wsRoot, "project:\n  name: WsRootLoses\n");

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("FlatPointerWins");
	});

	it("5.14: standard layout (.pi/) is preferred over flat layout when both exist", () => {
		const cwdDir = makeTestDir("dual-layout-cwd");
		const pointerRoot = makeTestDir("dual-layout-ptr");

		// Both layouts present — standard should win
		writeJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "StandardWins" } },
		});
		writeFlatJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "FlatLoses" } },
		});

		const config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("StandardWins");
	});

	it("5.15: full precedence chain — cwd > pointer (flat) > wsRoot > defaults", () => {
		const cwdDir = makeTestDir("full-chain-cwd");
		const pointerRoot = makeTestDir("full-chain-ptr");
		const wsRoot = makeTestDir("full-chain-ws");

		// Level 4: defaults
		let config = loadProjectConfig(cwdDir, undefined);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);

		// Level 3: wsRoot
		writeTaskRunnerYaml(wsRoot, "project:\n  name: Level3WsRoot\n");
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;
		config = loadProjectConfig(cwdDir, undefined);
		expect(config.taskRunner.project.name).toBe("Level3WsRoot");

		// Level 2: flat pointer config
		writeFlatJsonConfig(pointerRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "Level2FlatPointer" } },
		});
		config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("Level2FlatPointer");

		// Level 1: cwd overrides
		writeJsonConfig(cwdDir, {
			configVersion: 1,
			taskRunner: { project: { name: "Level1Cwd" } },
		});
		config = loadProjectConfig(cwdDir, pointerRoot);
		expect(config.taskRunner.project.name).toBe("Level1Cwd");
	});
});

// ── 6.x: Agent resolution with pointer + warning surfacing ──────────

import {
	_loadAgentDef,
	_resetPointerWarning,
} from "../task-runner.ts";

describe("agent resolution precedence with pointer (TP-016)", () => {
	/** Helper: write a minimal agent markdown file. */
	function writeAgentFile(dir: string, name: string, content: string): void {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${name}.md`), content, "utf-8");
	}

	/** Create a valid agent file with frontmatter. */
	function agentContent(label: string, opts?: { standalone?: boolean; tools?: string; model?: string }): string {
		const lines = ["---", `name: test-agent`];
		if (opts?.tools) lines.push(`tools: ${opts.tools}`);
		if (opts?.model) lines.push(`model: ${opts.model}`);
		if (opts?.standalone) lines.push("standalone: true");
		lines.push("---", `Agent prompt from ${label}`);
		return lines.join("\n");
	}

	it("6.1: cwd/.pi/agents/ override takes precedence over pointer agent root", () => {
		const cwdDir = makeTestDir("agent-cwd-wins");
		const pointerAgentDir = makeTestDir("agent-ptr-root");

		// cwd has local agent
		writeAgentFile(join(cwdDir, ".pi", "agents"), "test-agent", agentContent("cwd-local"));
		// pointer also has agent
		writeAgentFile(pointerAgentDir, "test-agent", agentContent("pointer-agent"));

		// loadAgentDef checks cwd first, so cwd should win even without pointer env
		const result = _loadAgentDef(cwdDir, "test-agent");
		expect(result).not.toBeNull();
		expect(result!.systemPrompt).toContain("cwd-local");
	});

	it("6.2: cwd/agents/ (legacy) takes precedence over pointer agent root", () => {
		const cwdDir = makeTestDir("agent-legacy-wins");
		const pointerAgentDir = makeTestDir("agent-ptr-root-2");

		// cwd has legacy agent location
		writeAgentFile(join(cwdDir, "agents"), "test-agent", agentContent("cwd-legacy"));
		// pointer also has agent
		writeAgentFile(pointerAgentDir, "test-agent", agentContent("pointer-agent"));

		const result = _loadAgentDef(cwdDir, "test-agent");
		expect(result).not.toBeNull();
		expect(result!.systemPrompt).toContain("cwd-legacy");
	});

	it("6.3: repo mode — pointer is not consulted (TASKPLANE_WORKSPACE_ROOT absent)", () => {
		const cwdDir = makeTestDir("agent-repo-mode");
		delete process.env.TASKPLANE_WORKSPACE_ROOT;

		// No local agents, no pointer → should still work (returns base agent or null)
		const result = _loadAgentDef(cwdDir, "task-worker");
		// task-worker exists in base package templates
		expect(result).not.toBeNull();
		expect(result!.systemPrompt).toBeTruthy();
	});
});

describe("pointer warning surfacing (TP-016)", () => {
	let consoleErrorSpy: ReturnType<typeof mock.method>;

	beforeEach(() => {
		_resetPointerWarning();
		consoleErrorSpy = mock.method(console, "error", () => {});
	});

	afterEach(() => {
		consoleErrorSpy.mock.restore();
		_resetPointerWarning();
	});

	it("6.4: no pointer warning when workspace config fails to load (catch returns null)", () => {
		const cwdDir = makeTestDir("warn-missing");
		const wsRoot = makeTestDir("warn-ws-root");

		// Set up workspace mode without a workspace YAML
		// resolveTaskRunnerPointer catches loadWorkspaceConfig errors → returns null
		// No pointer warning is emitted (the catch path doesn't produce one)
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		taskRunnerLoadConfig(cwdDir);

		const pointerWarnings = consoleErrorSpy.mock.calls.filter(
			(call: any) => typeof call.arguments[0] === "string" && call.arguments[0].includes("[task-runner] pointer:"),
		);
		expect(pointerWarnings.length).toBe(0);
	});

	it("6.5: pointer warning is logged when workspace config exists but pointer is missing", () => {
		const cwdDir = makeTestDir("warn-dedup");
		const wsRoot = makeTestDir("warn-ws-dedup");

		// Create a real git repo for the workspace YAML to reference
		const gitRepoPath = join(testRoot, "warn-fake-repo");
		mkdirSync(gitRepoPath, { recursive: true });
		try {
			execSync("git init", { cwd: gitRepoPath, stdio: "pipe" });
		} catch {
			// Skip test if git init fails (CI environment without git)
			return;
		}

		// Create tasks_root directory inside the packet-home repo
		const tasksRoot = join(gitRepoPath, "taskplane-tasks");
		mkdirSync(tasksRoot, { recursive: true });

		mkdirSync(join(wsRoot, ".pi"), { recursive: true });
		writeFileSync(
			join(wsRoot, ".pi", "taskplane-workspace.yaml"),
			[
				"repos:",
				"  main:",
				`    path: ${gitRepoPath.replace(/\\/g, "/")}`,
				"    default_branch: main",
				"routing:",
				`  tasks_root: ${tasksRoot.replace(/\\/g, "/")}`,
				"  default_repo: main",
			].join("\n"),
			"utf-8",
		);

		// No pointer file at wsRoot/.pi/taskplane-pointer.json
		// → resolvePointer returns { used: false, warning: "Pointer file not found..." }

		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;
		_resetPointerWarning();

		// Call loadConfig multiple times — warning should appear once
		taskRunnerLoadConfig(cwdDir);
		taskRunnerLoadConfig(cwdDir);
		taskRunnerLoadConfig(cwdDir);

		// Warning should be logged exactly once (dedup via _pointerWarningLogged)
		const pointerWarnings = consoleErrorSpy.mock.calls.filter(
			(call: any) => typeof call.arguments[0] === "string" && call.arguments[0].includes("[task-runner] pointer:"),
		);
		expect(pointerWarnings.length).toBe(1);
		expect(pointerWarnings[0].arguments[0]).toContain("Pointer file not found");
	});

	it("6.6: no pointer warning in repo mode", () => {
		const cwdDir = makeTestDir("warn-repo-mode");
		delete process.env.TASKPLANE_WORKSPACE_ROOT;
		_resetPointerWarning();

		taskRunnerLoadConfig(cwdDir);

		const pointerWarnings = consoleErrorSpy.mock.calls.filter(
			(call: any) => typeof call.arguments[0] === "string" && call.arguments[0].includes("[task-runner] pointer:"),
		);
		expect(pointerWarnings.length).toBe(0);
	});
});

// ── 7.x: Verification config defaults, mapping, and adapter (TP-032) ─

describe("verification config defaults, mapping, and adapter (TP-032)", () => {
	it("7.1: verification defaults are correct when not specified in config", () => {
		const dir = makeTestDir("verify-defaults");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification).toEqual({
			enabled: false,
			mode: "permissive",
			flakyReruns: 1,
		});
	});

	it("7.2: verification YAML snake_case maps to camelCase in unified config", () => {
		const dir = makeTestDir("verify-yaml-map");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
			"verification:",
			"  enabled: true",
			"  mode: strict",
			"  flaky_reruns: 3",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification.enabled).toBe(true);
		expect(config.orchestrator.verification.mode).toBe("strict");
		expect(config.orchestrator.verification.flakyReruns).toBe(3);
	});

	it("7.3: verification JSON camelCase is loaded directly", () => {
		const dir = makeTestDir("verify-json");
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			orchestrator: {
				verification: {
					enabled: true,
					mode: "strict",
					flakyReruns: 0,
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification.enabled).toBe(true);
		expect(config.orchestrator.verification.mode).toBe("strict");
		expect(config.orchestrator.verification.flakyReruns).toBe(0);
	});

	it("7.4: toOrchestratorConfig round-trips verification to snake_case", () => {
		const dir = makeTestDir("verify-adapter");
		writeOrchestratorYaml(dir, [
			"verification:",
			"  enabled: true",
			"  mode: strict",
			"  flaky_reruns: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);

		expect(legacy.verification).toEqual({
			enabled: true,
			mode: "strict",
			flaky_reruns: 2,
		});
	});

	it("7.5: toOrchestratorConfig defaults produce correct snake_case verification", () => {
		const dir = makeTestDir("verify-adapter-defaults");
		// No verification section at all
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 2",
		].join("\n"));

		const config = loadProjectConfig(dir);
		const legacy = toOrchestratorConfig(config);

		expect(legacy.verification).toEqual({
			enabled: false,
			mode: "permissive",
			flaky_reruns: 1,
		});
	});

	it("7.6: partial verification YAML merges with defaults", () => {
		const dir = makeTestDir("verify-partial");
		writeOrchestratorYaml(dir, [
			"verification:",
			"  enabled: true",
			// mode and flaky_reruns omitted — should use defaults
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification.enabled).toBe(true);
		expect(config.orchestrator.verification.mode).toBe("permissive"); // default
		expect(config.orchestrator.verification.flakyReruns).toBe(1);     // default
	});

	it("7.7: flakyReruns: 0 disables flaky re-runs and round-trips correctly", () => {
		const dir = makeTestDir("verify-no-reruns");
		writeOrchestratorYaml(dir, [
			"verification:",
			"  enabled: true",
			"  flaky_reruns: 0",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.orchestrator.verification.flakyReruns).toBe(0);

		const legacy = toOrchestratorConfig(config);
		expect(legacy.verification.flaky_reruns).toBe(0);
	});

	it("7.8: loadOrchestratorConfig wrapper includes verification defaults", () => {
		const dir = makeTestDir("verify-orch-wrapper");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 3",
		].join("\n"));

		const legacy = loadOrchestratorConfig(dir);
		expect(legacy.verification).toEqual({
			enabled: false,
			mode: "permissive",
			flaky_reruns: 1,
		});
	});
});

// ── 8.x: Workspace section threading (TP-079) ──────────────────────

describe("workspace section threading (TP-079)", () => {
	it("8.1: JSON workspace section loads with explicit taskPacketRepo", () => {
		const dir = makeTestDir("workspace-json-explicit");
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			workspace: {
				repos: {
					api: { path: "../api-repo", defaultBranch: "main" },
				},
				routing: {
					tasksRoot: "api-repo/taskplane-tasks",
					defaultRepo: "api",
					taskPacketRepo: "api",
					strict: true,
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.workspace).toBeDefined();
		expect(config.workspace!.routing.taskPacketRepo).toBe("api");
		expect(config.workspace!.routing.strict).toBe(true);
	});

	it("8.2: JSON workspace section missing taskPacketRepo falls back to defaultRepo", () => {
		const dir = makeTestDir("workspace-json-fallback");
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			workspace: {
				repos: {
					docs: { path: "../docs-repo" },
				},
				routing: {
					tasksRoot: "docs-repo/taskplane-tasks",
					defaultRepo: "docs",
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.workspace).toBeDefined();
		expect(config.workspace!.routing.taskPacketRepo).toBe("docs");
	});

	it("8.3: legacy taskplane-workspace.yaml maps snake_case fields to workspace section", () => {
		const dir = makeTestDir("workspace-yaml-explicit");
		writePiFile(dir, "taskplane-workspace.yaml", [
			"repos:",
			"  api:",
			"    path: ../api-repo",
			"    default_branch: develop",
			"routing:",
			"  tasks_root: api-repo/taskplane-tasks",
			"  default_repo: api",
			"  task_packet_repo: api",
			"  strict: true",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.workspace).toBeDefined();
		expect(config.workspace!.repos.api.defaultBranch).toBe("develop");
		expect(config.workspace!.routing.tasksRoot).toBe("api-repo/taskplane-tasks");
		expect(config.workspace!.routing.defaultRepo).toBe("api");
		expect(config.workspace!.routing.taskPacketRepo).toBe("api");
		expect(config.workspace!.routing.strict).toBe(true);
	});

	it("8.4: legacy workspace YAML missing task_packet_repo falls back to default_repo", () => {
		const dir = makeTestDir("workspace-yaml-fallback");
		writePiFile(dir, "taskplane-workspace.yaml", [
			"repos:",
			"  infra:",
			"    path: ../infra-repo",
			"routing:",
			"  tasks_root: infra-repo/taskplane-tasks",
			"  default_repo: infra",
		].join("\n"));

		const config = loadProjectConfig(dir);
		expect(config.workspace).toBeDefined();
		expect(config.workspace!.routing.defaultRepo).toBe("infra");
		expect(config.workspace!.routing.taskPacketRepo).toBe("infra");
	});

	it("8.5: JSON workspace section takes precedence over legacy workspace YAML", () => {
		const dir = makeTestDir("workspace-json-precedence");
		writePiFile(dir, "taskplane-workspace.yaml", [
			"repos:",
			"  yamlrepo:",
			"    path: ../yaml-repo",
			"routing:",
			"  tasks_root: yaml-repo/taskplane-tasks",
			"  default_repo: yamlrepo",
			"  task_packet_repo: yamlrepo",
		].join("\n"));
		writeJsonConfig(dir, {
			configVersion: CONFIG_VERSION,
			workspace: {
				repos: {
					jsonrepo: { path: "../json-repo" },
				},
				routing: {
					tasksRoot: "json-repo/taskplane-tasks",
					defaultRepo: "jsonrepo",
					taskPacketRepo: "jsonrepo",
				},
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.workspace).toBeDefined();
		expect(config.workspace!.routing.defaultRepo).toBe("jsonrepo");
		expect(config.workspace!.repos).toHaveProperty("jsonrepo");
		expect(config.workspace!.repos).not.toHaveProperty("yamlrepo");
	});
});
