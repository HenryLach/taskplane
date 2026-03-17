/**
 * Project Config Loader Tests — TP-014 Step 3
 *
 * Comprehensive tests for the unified config loader (`loadProjectConfig`)
 * and backward-compatible adapter functions.
 *
 * Test categories:
 *   1.x — Loader precedence & error matrix (JSON/YAML/defaults)
 *   2.x — Workspace root resolution (TASKPLANE_WORKSPACE_ROOT)
 *   3.x — Key preservation & adapter regression (record keys, snake_case output)
 *   4.x — Defaults cloning / non-mutation across calls
 *   5.x — Backward-compatible wrapper functions
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
import { loadOrchestratorConfig, loadTaskRunnerConfig } from "../taskplane/config.ts";
import {
	CONFIG_VERSION,
	DEFAULT_PROJECT_CONFIG,
	DEFAULT_TASK_RUNNER_SECTION,
	DEFAULT_ORCHESTRATOR_SECTION,
} from "../taskplane/config-schema.ts";

// ── Test Fixtures ────────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `test-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePiFile(root: string, filename: string, content: string): void {
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, filename), content, "utf-8");
}

function writeJsonConfig(root: string, config: any): void {
	writePiFile(root, "taskplane-config.json", JSON.stringify(config, null, 2));
}

function writeTaskRunnerYaml(root: string, content: string): void {
	writePiFile(root, "task-runner.yaml", content);
}

function writeOrchestratorYaml(root: string, content: string): void {
	writePiFile(root, "task-orchestrator.yaml", content);
}

// ── Setup / Teardown ─────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
	// Save env
	savedEnv.TASKPLANE_WORKSPACE_ROOT = process.env.TASKPLANE_WORKSPACE_ROOT;
	delete process.env.TASKPLANE_WORKSPACE_ROOT;
});

afterEach(() => {
	// Restore env
	if (savedEnv.TASKPLANE_WORKSPACE_ROOT !== undefined) {
		process.env.TASKPLANE_WORKSPACE_ROOT = savedEnv.TASKPLANE_WORKSPACE_ROOT;
	} else {
		delete process.env.TASKPLANE_WORKSPACE_ROOT;
	}
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {
		// Best effort cleanup on Windows
	}
});

// ── 1.x: Loader precedence & error matrix ───────────────────────────

describe("loadProjectConfig — precedence & error matrix", () => {
	it("1.1: valid JSON config is loaded and merged with defaults", () => {
		const dir = makeTestDir("valid-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				project: { name: "TestProject", description: "A test" },
			},
		});
		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(1);
		expect(config.taskRunner.project.name).toBe("TestProject");
		expect(config.taskRunner.project.description).toBe("A test");
		// Non-overridden fields should have defaults
		expect(config.taskRunner.worker.tools).toBe("read,write,edit,bash,grep,find,ls");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(3);
	});

	it("1.2: malformed JSON throws CONFIG_JSON_MALFORMED", () => {
		const dir = makeTestDir("malformed-json");
		writePiFile(dir, "taskplane-config.json", "{ not valid json }}}");
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

	it("1.5: JSON present + YAML present → uses JSON (JSON takes precedence)", () => {
		const dir = makeTestDir("json-wins");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				project: { name: "FromJSON" },
			},
		});
		writeTaskRunnerYaml(dir, `project:\n  name: FromYAML\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.project.name).toBe("FromJSON");
	});

	it("1.6: JSON absent + task-runner YAML present → reads YAML", () => {
		const dir = makeTestDir("yaml-fallback-tr");
		writeTaskRunnerYaml(dir, `project:\n  name: YAMLProject\n  description: From YAML\n`);
		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(CONFIG_VERSION);
		expect(config.taskRunner.project.name).toBe("YAMLProject");
		expect(config.taskRunner.project.description).toBe("From YAML");
	});

	it("1.7: JSON absent + orchestrator YAML present → reads YAML", () => {
		const dir = makeTestDir("yaml-fallback-orch");
		writeOrchestratorYaml(dir, `orchestrator:\n  max_lanes: 5\n`);
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(5);
	});

	it("1.8: JSON absent + both YAMLs present → reads both", () => {
		const dir = makeTestDir("yaml-fallback-both");
		writeTaskRunnerYaml(dir, `project:\n  name: BothYAML\n`);
		writeOrchestratorYaml(dir, `orchestrator:\n  max_lanes: 7\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.project.name).toBe("BothYAML");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(7);
	});

	it("1.9: no config files present → returns cloned defaults", () => {
		const dir = makeTestDir("no-config");
		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(CONFIG_VERSION);
		expect(config.taskRunner.project.name).toBe(DEFAULT_TASK_RUNNER_SECTION.project.name);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(DEFAULT_ORCHESTRATOR_SECTION.orchestrator.maxLanes);
	});

	it("1.10: configVersion: null throws CONFIG_VERSION_MISSING", () => {
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

	it("1.11: JSON with only configVersion returns defaults for sections", () => {
		const dir = makeTestDir("minimal-json");
		writeJsonConfig(dir, { configVersion: 1 });
		const config = loadProjectConfig(dir);
		expect(config.configVersion).toBe(1);
		expect(config.taskRunner).toEqual(DEFAULT_TASK_RUNNER_SECTION);
		expect(config.orchestrator).toEqual(DEFAULT_ORCHESTRATOR_SECTION);
	});

	it("1.12: JSON with deep partial overrides merges correctly", () => {
		const dir = makeTestDir("deep-merge");
		writeJsonConfig(dir, {
			configVersion: 1,
			orchestrator: {
				failure: {
					stallTimeout: 60,
				},
			},
		});
		const config = loadProjectConfig(dir);
		// Overridden
		expect(config.orchestrator.failure.stallTimeout).toBe(60);
		// Non-overridden siblings
		expect(config.orchestrator.failure.onTaskFailure).toBe("skip-dependents");
		expect(config.orchestrator.failure.maxWorkerMinutes).toBe(30);
	});
});

// ── 2.x: Workspace root resolution ──────────────────────────────────

describe("loadProjectConfig — workspace root resolution", () => {
	it("2.1: cwd has config files → uses cwd (ignores TASKPLANE_WORKSPACE_ROOT)", () => {
		const cwd = makeTestDir("cwd-has-config");
		const wsRoot = makeTestDir("ws-root");
		writeTaskRunnerYaml(cwd, `project:\n  name: FromCWD\n`);
		writeTaskRunnerYaml(wsRoot, `project:\n  name: FromWSRoot\n`);
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwd);
		expect(config.taskRunner.project.name).toBe("FromCWD");
	});

	it("2.2: cwd has .pi/ dir but NO config files → falls back to TASKPLANE_WORKSPACE_ROOT", () => {
		const cwd = makeTestDir("cwd-no-config");
		const piDir = join(cwd, ".pi");
		mkdirSync(piDir, { recursive: true });
		// Write something non-config to .pi/ to simulate sidecar .pi
		writeFileSync(join(piDir, "some-other-file.txt"), "not a config", "utf-8");

		const wsRoot = makeTestDir("ws-root");
		writeTaskRunnerYaml(wsRoot, `project:\n  name: FromWSRoot\n`);
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwd);
		expect(config.taskRunner.project.name).toBe("FromWSRoot");
	});

	it("2.3: cwd has no .pi/ at all → falls back to TASKPLANE_WORKSPACE_ROOT", () => {
		const cwd = makeTestDir("cwd-bare");
		const wsRoot = makeTestDir("ws-root");
		writeOrchestratorYaml(wsRoot, `orchestrator:\n  max_lanes: 10\n`);
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwd);
		expect(config.orchestrator.orchestrator.maxLanes).toBe(10);
	});

	it("2.4: neither cwd nor TASKPLANE_WORKSPACE_ROOT has config → returns defaults", () => {
		const cwd = makeTestDir("cwd-empty");
		const wsRoot = makeTestDir("ws-root-empty");
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwd);
		expect(config.taskRunner.project.name).toBe("Project");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(3);
	});

	it("2.5: TASKPLANE_WORKSPACE_ROOT not set, cwd has no config → returns defaults", () => {
		const cwd = makeTestDir("cwd-no-wsroot");
		delete process.env.TASKPLANE_WORKSPACE_ROOT;
		const config = loadProjectConfig(cwd);
		expect(config.configVersion).toBe(CONFIG_VERSION);
	});

	it("2.6: TASKPLANE_WORKSPACE_ROOT with JSON config takes precedence over YAML in same root", () => {
		const cwd = makeTestDir("cwd-bare2");
		const wsRoot = makeTestDir("ws-root-json");
		writeJsonConfig(wsRoot, {
			configVersion: 1,
			taskRunner: { project: { name: "WSRootJSON" } },
		});
		writeTaskRunnerYaml(wsRoot, `project:\n  name: WSRootYAML\n`);
		process.env.TASKPLANE_WORKSPACE_ROOT = wsRoot;

		const config = loadProjectConfig(cwd);
		expect(config.taskRunner.project.name).toBe("WSRootJSON");
	});
});

// ── 3.x: Key preservation & adapter regression ──────────────────────

describe("key preservation — YAML mapping", () => {
	it("3.1: sizeWeights record keys (S, M, L) preserved verbatim from YAML", () => {
		const dir = makeTestDir("size-weights");
		writeOrchestratorYaml(dir, `assignment:\n  strategy: round-robin\n  size_weights:\n    S: 1\n    M: 3\n    L: 5\n    XL: 8\n`);
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.assignment.sizeWeights).toEqual({ S: 1, M: 3, L: 5, XL: 8 });
	});

	it("3.2: preWarm.commands record keys preserved from YAML", () => {
		const dir = makeTestDir("prewarm-cmds");
		writeOrchestratorYaml(dir, `pre_warm:\n  auto_detect: true\n  commands:\n    install_deps: npm install\n    build_all: npm run build\n`);
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.preWarm.autoDetect).toBe(true);
		expect(config.orchestrator.preWarm.commands).toEqual({
			install_deps: "npm install",
			build_all: "npm run build",
		});
	});

	it("3.3: taskAreas record keys preserved from YAML", () => {
		const dir = makeTestDir("task-areas");
		writeTaskRunnerYaml(dir, `task_areas:\n  backend-api:\n    path: tasks/backend\n    prefix: BE\n    context: docs/backend-context.md\n  frontend-web:\n    path: tasks/frontend\n    prefix: FE\n    context: docs/frontend-context.md\n`);
		const config = loadProjectConfig(dir);
		expect(Object.keys(config.taskRunner.taskAreas)).toEqual(["backend-api", "frontend-web"]);
		expect(config.taskRunner.taskAreas["backend-api"].path).toBe("tasks/backend");
		expect(config.taskRunner.taskAreas["frontend-web"].prefix).toBe("FE");
	});

	it("3.4: referenceDocs keys preserved from YAML", () => {
		const dir = makeTestDir("ref-docs");
		writeTaskRunnerYaml(dir, `reference_docs:\n  api_spec: docs/api.md\n  design_system: docs/design.md\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.referenceDocs).toEqual({
			api_spec: "docs/api.md",
			design_system: "docs/design.md",
		});
	});

	it("3.5: selfDocTargets keys preserved from YAML", () => {
		const dir = makeTestDir("self-doc");
		writeTaskRunnerYaml(dir, `self_doc_targets:\n  tech_debt: CONTEXT.md\n  patterns: PATTERNS.md\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.selfDocTargets).toEqual({
			tech_debt: "CONTEXT.md",
			patterns: "PATTERNS.md",
		});
	});

	it("3.6: standardsOverrides record keys preserved from YAML", () => {
		const dir = makeTestDir("std-overrides");
		writeTaskRunnerYaml(dir, `standards_overrides:\n  frontend:\n    docs:\n      - docs/frontend-standards.md\n    rules:\n      - Use TypeScript\n`);
		const config = loadProjectConfig(dir);
		expect(Object.keys(config.taskRunner.standardsOverrides)).toEqual(["frontend"]);
		expect(config.taskRunner.standardsOverrides["frontend"].docs).toEqual(["docs/frontend-standards.md"]);
	});

	it("3.7: testing.commands keys preserved from YAML", () => {
		const dir = makeTestDir("testing-cmds");
		writeTaskRunnerYaml(dir, `testing:\n  commands:\n    unit_test: npm test\n    lint_check: npm run lint\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.testing.commands).toEqual({
			unit_test: "npm test",
			lint_check: "npm run lint",
		});
	});

	it("3.8: snake_case structural keys converted to camelCase from YAML", () => {
		const dir = makeTestDir("camel-conversion");
		writeOrchestratorYaml(dir, `failure:\n  on_task_failure: stop-all\n  on_merge_failure: abort\n  stall_timeout: 45\n  max_worker_minutes: 60\n  abort_grace_period: 120\n`);
		const config = loadProjectConfig(dir);
		expect(config.orchestrator.failure.onTaskFailure).toBe("stop-all");
		expect(config.orchestrator.failure.onMergeFailure).toBe("abort");
		expect(config.orchestrator.failure.stallTimeout).toBe(45);
		expect(config.orchestrator.failure.maxWorkerMinutes).toBe(60);
		expect(config.orchestrator.failure.abortGracePeriod).toBe(120);
	});

	it("3.9: array sections preserved from YAML", () => {
		const dir = makeTestDir("arrays");
		writeTaskRunnerYaml(dir, `never_load:\n  - node_modules\n  - .git\nprotected_docs:\n  - README.md\n  - CHANGELOG.md\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.neverLoad).toEqual(["node_modules", ".git"]);
		expect(config.taskRunner.protectedDocs).toEqual(["README.md", "CHANGELOG.md"]);
	});
});

describe("repoId trim/drop behavior", () => {
	it("3.10: repoId with whitespace-only value is dropped from taskAreas", () => {
		const dir = makeTestDir("repoid-whitespace");
		writeTaskRunnerYaml(dir, `task_areas:\n  main:\n    path: tasks\n    prefix: TP\n    context: CONTEXT.md\n    repo_id: "   "\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.taskAreas["main"].repoId).toBeUndefined();
	});

	it("3.11: repoId with surrounding whitespace is trimmed", () => {
		const dir = makeTestDir("repoid-trim");
		writeTaskRunnerYaml(dir, `task_areas:\n  main:\n    path: tasks\n    prefix: TP\n    context: CONTEXT.md\n    repo_id: "  api  "\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.taskAreas["main"].repoId).toBe("api");
	});

	it("3.12: repoId with valid value kept as-is", () => {
		const dir = makeTestDir("repoid-valid");
		writeTaskRunnerYaml(dir, `task_areas:\n  main:\n    path: tasks\n    prefix: TP\n    context: CONTEXT.md\n    repo_id: frontend\n`);
		const config = loadProjectConfig(dir);
		expect(config.taskRunner.taskAreas["main"].repoId).toBe("frontend");
	});
});

describe("adapter — toOrchestratorConfig (snake_case output)", () => {
	it("3.13: preserves sizeWeights keys in snake_case output", () => {
		const dir = makeTestDir("orch-adapter-sizes");
		writeOrchestratorYaml(dir, `assignment:\n  strategy: load-balanced\n  size_weights:\n    S: 2\n    M: 4\n    L: 8\n`);
		const config = loadProjectConfig(dir);
		const orchConfig = toOrchestratorConfig(config);
		expect(orchConfig.assignment.size_weights).toEqual({ S: 2, M: 4, L: 8 });
		expect(orchConfig.assignment.strategy).toBe("load-balanced");
	});

	it("3.14: preserves preWarm.commands keys in snake_case output", () => {
		const dir = makeTestDir("orch-adapter-prewarm");
		writeOrchestratorYaml(dir, `pre_warm:\n  commands:\n    install: npm ci\n  always:\n    - echo hello\n`);
		const config = loadProjectConfig(dir);
		const orchConfig = toOrchestratorConfig(config);
		expect(orchConfig.pre_warm.commands).toEqual({ install: "npm ci" });
		expect(orchConfig.pre_warm.always).toEqual(["echo hello"]);
	});

	it("3.15: all orchestrator fields mapped to snake_case correctly", () => {
		const dir = makeTestDir("orch-adapter-full");
		writeOrchestratorYaml(dir, [
			"orchestrator:",
			"  max_lanes: 4",
			"  worktree_location: sibling",
			"  worktree_prefix: tp-wt",
			"  batch_id_format: sequential",
			"  spawn_mode: tmux",
			"  tmux_prefix: myorch",
			"  operator_id: testuser",
			"dependencies:",
			"  source: agent",
			"  cache: false",
			"merge:",
			"  model: gpt-4",
			"  tools: read,write",
			"  verify:",
			"    - npm test",
			"  order: sequential",
			"monitoring:",
			"  poll_interval: 10",
		].join("\n"));
		const config = loadProjectConfig(dir);
		const oc = toOrchestratorConfig(config);
		expect(oc.orchestrator.max_lanes).toBe(4);
		expect(oc.orchestrator.worktree_location).toBe("sibling");
		expect(oc.orchestrator.worktree_prefix).toBe("tp-wt");
		expect(oc.orchestrator.batch_id_format).toBe("sequential");
		expect(oc.orchestrator.spawn_mode).toBe("tmux");
		expect(oc.orchestrator.tmux_prefix).toBe("myorch");
		expect(oc.orchestrator.operator_id).toBe("testuser");
		expect(oc.dependencies.source).toBe("agent");
		expect(oc.dependencies.cache).toBe(false);
		expect(oc.merge.model).toBe("gpt-4");
		expect(oc.merge.verify).toEqual(["npm test"]);
		expect(oc.merge.order).toBe("sequential");
		expect(oc.monitoring.poll_interval).toBe(10);
	});
});

describe("adapter — toTaskRunnerConfig (orchestrator subset)", () => {
	it("3.16: task_areas keys preserved, repoId mapped to camelCase repoId", () => {
		const dir = makeTestDir("tr-adapter-areas");
		writeTaskRunnerYaml(dir, `task_areas:\n  backend-api:\n    path: tasks/backend\n    prefix: BE\n    context: ctx.md\n    repo_id: api\n`);
		const config = loadProjectConfig(dir);
		const trConfig = toTaskRunnerConfig(config);
		expect(Object.keys(trConfig.task_areas)).toEqual(["backend-api"]);
		expect(trConfig.task_areas["backend-api"].path).toBe("tasks/backend");
		expect(trConfig.task_areas["backend-api"].repoId).toBe("api");
	});

	it("3.17: whitespace-only repoId dropped in adapter output", () => {
		const dir = makeTestDir("tr-adapter-repoid-drop");
		writeTaskRunnerYaml(dir, `task_areas:\n  main:\n    path: tasks\n    prefix: TP\n    context: ctx.md\n    repo_id: "  "\n`);
		const config = loadProjectConfig(dir);
		const trConfig = toTaskRunnerConfig(config);
		expect(trConfig.task_areas["main"].repoId).toBeUndefined();
	});

	it("3.18: reference_docs keys preserved", () => {
		const dir = makeTestDir("tr-adapter-refdocs");
		writeTaskRunnerYaml(dir, `reference_docs:\n  arch_doc: docs/architecture.md\n`);
		const config = loadProjectConfig(dir);
		const trConfig = toTaskRunnerConfig(config);
		expect(trConfig.reference_docs).toEqual({ arch_doc: "docs/architecture.md" });
	});
});

describe("adapter — toTaskConfig (task-runner snake_case)", () => {
	it("3.19: context fields mapped to snake_case correctly", () => {
		const dir = makeTestDir("tc-adapter-context");
		writeTaskRunnerYaml(dir, [
			"context:",
			"  worker_context_window: 300000",
			"  warn_percent: 80",
			"  kill_percent: 90",
			"  max_worker_iterations: 30",
			"  max_review_cycles: 4",
			"  no_progress_limit: 5",
			"  max_worker_minutes: 60",
		].join("\n"));
		const config = loadProjectConfig(dir);
		const tc = toTaskConfig(config);
		expect(tc.context.worker_context_window).toBe(300000);
		expect(tc.context.warn_percent).toBe(80);
		expect(tc.context.kill_percent).toBe(90);
		expect(tc.context.max_worker_iterations).toBe(30);
		expect(tc.context.max_review_cycles).toBe(4);
		expect(tc.context.no_progress_limit).toBe(5);
		expect(tc.context.max_worker_minutes).toBe(60);
	});

	it("3.20: worker.spawn_mode mapped correctly", () => {
		const dir = makeTestDir("tc-adapter-worker");
		writeTaskRunnerYaml(dir, `worker:\n  model: gpt-4\n  tools: read,write\n  thinking: off\n  spawn_mode: tmux\n`);
		const config = loadProjectConfig(dir);
		const tc = toTaskConfig(config);
		expect(tc.worker.spawn_mode).toBe("tmux");
		expect(tc.worker.model).toBe("gpt-4");
	});

	it("3.21: standards_overrides keys preserved, inner structure correct", () => {
		const dir = makeTestDir("tc-adapter-std");
		writeTaskRunnerYaml(dir, `standards_overrides:\n  frontend:\n    docs:\n      - fe.md\n    rules:\n      - Use React\n`);
		const config = loadProjectConfig(dir);
		const tc = toTaskConfig(config);
		expect(Object.keys(tc.standards_overrides)).toEqual(["frontend"]);
		expect(tc.standards_overrides["frontend"].docs).toEqual(["fe.md"]);
		expect(tc.standards_overrides["frontend"].rules).toEqual(["Use React"]);
	});

	it("3.22: task_areas repoId mapped to repo_id in toTaskConfig", () => {
		const dir = makeTestDir("tc-adapter-repoid");
		writeTaskRunnerYaml(dir, `task_areas:\n  main:\n    path: tasks\n    prefix: TP\n    context: ctx.md\n    repo_id: backend\n`);
		const config = loadProjectConfig(dir);
		const tc = toTaskConfig(config);
		expect((tc.task_areas["main"] as any).repo_id).toBe("backend");
	});
});

// ── 4.x: Defaults cloning / non-mutation ─────────────────────────────

describe("loadProjectConfig — defaults non-mutation", () => {
	it("4.1: multiple calls return independent objects (no cross-call mutation)", () => {
		const dir = makeTestDir("no-mutation");
		const config1 = loadProjectConfig(dir);
		const config2 = loadProjectConfig(dir);

		// Mutate config1
		config1.taskRunner.project.name = "MUTATED";
		config1.orchestrator.orchestrator.maxLanes = 999;
		config1.taskRunner.neverLoad.push("mutated-file");

		// config2 should not be affected
		expect(config2.taskRunner.project.name).toBe("Project");
		expect(config2.orchestrator.orchestrator.maxLanes).toBe(3);
		expect(config2.taskRunner.neverLoad).toEqual([]);
	});

	it("4.2: defaults not mutated after JSON loading", () => {
		const dir = makeTestDir("defaults-safe-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				project: { name: "CustomName" },
				neverLoad: ["custom-file"],
			},
		});

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.project.name).toBe("CustomName");
		expect(config.taskRunner.neverLoad).toEqual(["custom-file"]);

		// Original defaults should be unchanged
		expect(DEFAULT_TASK_RUNNER_SECTION.project.name).toBe("Project");
		expect(DEFAULT_TASK_RUNNER_SECTION.neverLoad).toEqual([]);
	});

	it("4.3: defaults not mutated after YAML loading", () => {
		const dir = makeTestDir("defaults-safe-yaml");
		writeTaskRunnerYaml(dir, `project:\n  name: YAMLCustom\nnever_load:\n  - secret.md\n`);

		const config = loadProjectConfig(dir);
		expect(config.taskRunner.project.name).toBe("YAMLCustom");

		// Original defaults should be unchanged
		expect(DEFAULT_TASK_RUNNER_SECTION.project.name).toBe("Project");
		expect(DEFAULT_TASK_RUNNER_SECTION.neverLoad).toEqual([]);
	});

	it("4.4: returned config from defaults path is deeply independent", () => {
		const dir = makeTestDir("deep-independence");
		const c1 = loadProjectConfig(dir);
		const c2 = loadProjectConfig(dir);

		// Deeply mutate c1
		c1.orchestrator.assignment.sizeWeights["XL"] = 16;
		c1.taskRunner.testing.commands["mutated"] = "true";

		// c2 should be unaffected
		expect(c2.orchestrator.assignment.sizeWeights["XL"]).toBeUndefined();
		expect(c2.taskRunner.testing.commands["mutated"]).toBeUndefined();
	});
});

// ── 5.x: Backward-compatible wrapper functions ──────────────────────

describe("backward-compatible wrappers", () => {
	it("5.1: loadOrchestratorConfig returns snake_case shape with defaults", () => {
		const dir = makeTestDir("orch-wrapper-defaults");
		const oc = loadOrchestratorConfig(dir);
		expect(oc.orchestrator.max_lanes).toBe(3);
		expect(oc.orchestrator.spawn_mode).toBe("subprocess");
		expect(oc.assignment.strategy).toBe("affinity-first");
		expect(oc.failure.on_task_failure).toBe("skip-dependents");
		expect(oc.monitoring.poll_interval).toBe(5);
	});

	it("5.2: loadOrchestratorConfig reads from JSON when present", () => {
		const dir = makeTestDir("orch-wrapper-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			orchestrator: {
				orchestrator: { maxLanes: 8 },
			},
		});
		const oc = loadOrchestratorConfig(dir);
		expect(oc.orchestrator.max_lanes).toBe(8);
	});

	it("5.3: loadOrchestratorConfig reads from YAML when JSON absent", () => {
		const dir = makeTestDir("orch-wrapper-yaml");
		writeOrchestratorYaml(dir, `orchestrator:\n  max_lanes: 6\n`);
		const oc = loadOrchestratorConfig(dir);
		expect(oc.orchestrator.max_lanes).toBe(6);
	});

	it("5.4: loadTaskRunnerConfig returns snake_case subset shape", () => {
		const dir = makeTestDir("tr-wrapper-defaults");
		const trc = loadTaskRunnerConfig(dir);
		expect(trc.task_areas).toEqual({});
		expect(trc.reference_docs).toEqual({});
	});

	it("5.5: loadTaskRunnerConfig reads from JSON when present", () => {
		const dir = makeTestDir("tr-wrapper-json");
		writeJsonConfig(dir, {
			configVersion: 1,
			taskRunner: {
				taskAreas: {
					main: { path: "tasks", prefix: "TP", context: "ctx.md" },
				},
				referenceDocs: { arch: "docs/arch.md" },
			},
		});
		const trc = loadTaskRunnerConfig(dir);
		expect(Object.keys(trc.task_areas)).toEqual(["main"]);
		expect(trc.reference_docs).toEqual({ arch: "docs/arch.md" });
	});

	it("5.6: loadTaskRunnerConfig reads from YAML when JSON absent", () => {
		const dir = makeTestDir("tr-wrapper-yaml");
		writeTaskRunnerYaml(dir, `task_areas:\n  main:\n    path: tasks\n    prefix: TP\n    context: ctx.md\nreference_docs:\n  spec: docs/spec.md\n`);
		const trc = loadTaskRunnerConfig(dir);
		expect(Object.keys(trc.task_areas)).toEqual(["main"]);
		expect(trc.reference_docs).toEqual({ spec: "docs/spec.md" });
	});
});
