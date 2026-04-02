/**
 * User Preferences (Layer 2) Tests — TP-017 Step 2
 *
 * Tests for the user preferences layer: path resolution, auto-creation,
 * malformed JSON fallback, unknown-key dropping, empty-string "not set"
 * semantics, allowlist guardrails, and merge integration with Layer 1.
 *
 * Test categories:
 *   5.x — Path resolution (default + PI_CODING_AGENT_DIR override)
 *   6.x — loadUserPreferences: auto-creation, malformed fallback, unknown keys, empty-string
 *   7.x — Layer 2 guardrails: allowlist enforcement, dashboardPort preferences-only
 *   8.x — applyUserPreferences merge integration + loadProjectConfig e2e with prefs
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/user-preferences.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
} from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

import {
	resolveUserPreferencesPath,
	loadUserPreferences,
	applyUserPreferences,
	loadProjectConfig,
} from "../taskplane/config-loader.ts";
import {
	DEFAULT_USER_PREFERENCES,
	DEFAULT_PROJECT_CONFIG,
	DEFAULT_TASK_RUNNER_SECTION,
	DEFAULT_ORCHESTRATOR_SECTION,
	USER_PREFERENCES_FILENAME,
	USER_PREFERENCES_SUBDIR,
} from "../taskplane/config-schema.ts";
import type {
	TaskplaneConfig,
	UserPreferences,
} from "../taskplane/config-schema.ts";

// ── Fixture Helpers ──────────────────────────────────────────────────

let testRoot: string;
let counter = 0;
let savedAgentDir: string | undefined;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `up-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePrefsFile(agentDir: string, content: string): void {
	const prefsDir = join(agentDir, USER_PREFERENCES_SUBDIR);
	mkdirSync(prefsDir, { recursive: true });
	writeFileSync(join(prefsDir, USER_PREFERENCES_FILENAME), content, "utf-8");
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

/** Deep clone helper for creating test config objects. */
function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

// ── Setup / Teardown ─────────────────────────────────────────────────

beforeEach(() => {
	testRoot = join(tmpdir(), `tp-up-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
	// Save and isolate env vars
	savedAgentDir = process.env.PI_CODING_AGENT_DIR;
	delete process.env.TASKPLANE_WORKSPACE_ROOT;
});

afterEach(() => {
	// Restore env vars
	if (savedAgentDir !== undefined) {
		process.env.PI_CODING_AGENT_DIR = savedAgentDir;
	} else {
		delete process.env.PI_CODING_AGENT_DIR;
	}
	delete process.env.TASKPLANE_WORKSPACE_ROOT;
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch {
		// Best effort cleanup on Windows
	}
});

// ── 5.x: Path resolution ────────────────────────────────────────────

describe("resolveUserPreferencesPath", () => {
	it("5.1: default path uses homedir/.pi/agent/taskplane/preferences.json", () => {
		delete process.env.PI_CODING_AGENT_DIR;

		const result = resolveUserPreferencesPath();
		const expected = join(homedir(), ".pi", "agent", USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
		expect(result).toBe(expected);
	});

	it("5.2: PI_CODING_AGENT_DIR override uses <envDir>/taskplane/preferences.json", () => {
		const customDir = join(testRoot, "custom-agent-dir");
		process.env.PI_CODING_AGENT_DIR = customDir;

		const result = resolveUserPreferencesPath();
		const expected = join(customDir, USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
		expect(result).toBe(expected);
	});

	it("5.3: PI_CODING_AGENT_DIR with trailing separator still resolves correctly", () => {
		// path.join normalizes trailing separators
		const customDir = join(testRoot, "agent-dir-trailing") + "/";
		process.env.PI_CODING_AGENT_DIR = customDir;

		const result = resolveUserPreferencesPath();
		// path.join normalizes the double separator
		expect(result).toContain(USER_PREFERENCES_SUBDIR);
		expect(result).toContain(USER_PREFERENCES_FILENAME);
	});
});

// ── 6.x: loadUserPreferences ─────────────────────────────────────────

describe("loadUserPreferences", () => {
	it("6.1: auto-creates preferences file when it doesn't exist", () => {
		const agentDir = makeTestDir("auto-create");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const prefsPath = join(agentDir, USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
		expect(existsSync(prefsPath)).toBe(false);

		const prefs = loadUserPreferences();

		// File should now exist
		expect(existsSync(prefsPath)).toBe(true);

		// Contents should be the default empty preferences
		const contents = JSON.parse(readFileSync(prefsPath, "utf-8"));
		expect(contents).toEqual(DEFAULT_USER_PREFERENCES);

		// Returned prefs should be defaults (empty object)
		expect(prefs).toEqual(DEFAULT_USER_PREFERENCES);
	});

	it("6.2: malformed JSON returns defaults without overwriting the file", () => {
		const agentDir = makeTestDir("malformed");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const malformedContent = "{ this is not valid JSON !!!";
		writePrefsFile(agentDir, malformedContent);

		const prefs = loadUserPreferences();

		// Should return defaults
		expect(prefs).toEqual(DEFAULT_USER_PREFERENCES);

		// File should NOT be overwritten (non-destructive)
		const prefsPath = join(agentDir, USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
		const contents = readFileSync(prefsPath, "utf-8");
		expect(contents).toBe(malformedContent);
	});

	it("6.3: unknown keys are silently dropped", () => {
		const agentDir = makeTestDir("unknown-keys");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			operatorId: "alice",
			unknownField: "should-be-dropped",
			anotherUnknown: 42,
			nested: { deep: true },
		}));

		const prefs = loadUserPreferences();

		expect(prefs.operatorId).toBe("alice");
		expect((prefs as any).unknownField).toBeUndefined();
		expect((prefs as any).anotherUnknown).toBeUndefined();
		expect((prefs as any).nested).toBeUndefined();
	});

	it("6.4: valid preferences file returns all recognized fields", () => {
		const agentDir = makeTestDir("valid-full");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			operatorId: "bob",
			sessionPrefix: "myprefix",
			spawnMode: "tmux",
			workerModel: "openai/gpt-4",
			reviewerModel: "anthropic/claude-3",
			mergeModel: "openai/gpt-4",
			dashboardPort: 9090,
		}));

		const prefs = loadUserPreferences();

		expect(prefs.operatorId).toBe("bob");
		expect(prefs.sessionPrefix).toBe("myprefix");
		expect(prefs.spawnMode).toBe("tmux");
		expect(prefs.workerModel).toBe("openai/gpt-4");
		expect(prefs.reviewerModel).toBe("anthropic/claude-3");
		expect(prefs.mergeModel).toBe("openai/gpt-4");
		expect(prefs.dashboardPort).toBe(9090);
	});

	it("6.4b: legacy tmuxPrefix key is accepted as sessionPrefix alias", () => {
		const agentDir = makeTestDir("legacy-prefix-alias");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			tmuxPrefix: "legacy-prefix",
		}));

		const prefs = loadUserPreferences();
		expect(prefs.sessionPrefix).toBe("legacy-prefix");
	});

	it("6.4c: sessionPrefix takes precedence when both keys are present", () => {
		const agentDir = makeTestDir("prefix-precedence");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			sessionPrefix: "new-prefix",
			tmuxPrefix: "old-prefix",
		}));

		const prefs = loadUserPreferences();
		expect(prefs.sessionPrefix).toBe("new-prefix");
	});

	it("6.5: empty JSON object returns defaults (all fields undefined)", () => {
		const agentDir = makeTestDir("empty-obj");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, "{}");

		const prefs = loadUserPreferences();
		expect(prefs).toEqual({});
	});

	it("6.6: JSON array returns defaults (not a valid preferences object)", () => {
		const agentDir = makeTestDir("array-json");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, "[]");

		const prefs = loadUserPreferences();
		expect(prefs).toEqual(DEFAULT_USER_PREFERENCES);
	});

	it("6.7: spawnMode with invalid enum value is dropped", () => {
		const agentDir = makeTestDir("bad-spawn");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			operatorId: "valid",
			spawnMode: "invalid-mode",
		}));

		const prefs = loadUserPreferences();
		expect(prefs.operatorId).toBe("valid");
		expect(prefs.spawnMode).toBeUndefined();
	});

	it("6.8: dashboardPort with non-number value is dropped", () => {
		const agentDir = makeTestDir("bad-port");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			dashboardPort: "not-a-number",
		}));

		const prefs = loadUserPreferences();
		expect(prefs.dashboardPort).toBeUndefined();
	});

	it("6.9: dashboardPort with Infinity or NaN is dropped", () => {
		const agentDir = makeTestDir("inf-port");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		// JSON.stringify drops Infinity/NaN → null, so test numeric edge case:
		// NaN can't appear in valid JSON, but Infinity can't either. Test with null:
		writePrefsFile(agentDir, JSON.stringify({
			dashboardPort: null,
		}));

		const prefs = loadUserPreferences();
		expect(prefs.dashboardPort).toBeUndefined();
	});

	it("6.10: fields with wrong types are dropped (operatorId as number, etc.)", () => {
		const agentDir = makeTestDir("wrong-types");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			operatorId: 123,
			sessionPrefix: true,
			workerModel: { nested: "obj" },
			reviewerModel: ["array"],
			mergeModel: null,
		}));

		const prefs = loadUserPreferences();
		expect(prefs.operatorId).toBeUndefined();
		expect(prefs.sessionPrefix).toBeUndefined();
		expect(prefs.workerModel).toBeUndefined();
		expect(prefs.reviewerModel).toBeUndefined();
		expect(prefs.mergeModel).toBeUndefined();
	});
});

// ── 7.x: Layer 2 guardrails ─────────────────────────────────────────

describe("Layer 2 guardrails — applyUserPreferences", () => {
	it("7.1: non-allowlisted keys in preferences are ignored during merge", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		const originalMaxLanes = config.orchestrator.orchestrator.maxLanes;
		const originalStallTimeout = config.orchestrator.failure.stallTimeout;

		// Simulate prefs with extra keys that shouldn't be in UserPreferences
		const prefs: UserPreferences = {
			operatorId: "alice",
		};
		// Force-add non-allowlisted properties (simulating what would happen if
		// someone manually added them)
		(prefs as any).maxLanes = 99;
		(prefs as any).stallTimeout = 999;

		applyUserPreferences(config, prefs);

		// Allowlisted field should be applied
		expect(config.orchestrator.orchestrator.operatorId).toBe("alice");

		// Non-allowlisted fields should NOT have changed
		expect(config.orchestrator.orchestrator.maxLanes).toBe(originalMaxLanes);
		expect(config.orchestrator.failure.stallTimeout).toBe(originalStallTimeout);
	});

	it("7.2: allowlisted fields are applied correctly", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);

		const prefs: UserPreferences = {
			operatorId: "bob",
			sessionPrefix: "myprefix",
			spawnMode: "tmux",
			workerModel: "openai/gpt-4",
			reviewerModel: "anthropic/claude-3",
			mergeModel: "openai/gpt-5",
		};

		applyUserPreferences(config, prefs);

		expect(config.orchestrator.orchestrator.operatorId).toBe("bob");
		expect(config.orchestrator.orchestrator.sessionPrefix).toBe("myprefix");
		expect(config.orchestrator.orchestrator.spawnMode).toBe("tmux");
		expect(config.taskRunner.worker.model).toBe("openai/gpt-4");
		expect(config.taskRunner.reviewer.model).toBe("anthropic/claude-3");
		expect(config.orchestrator.merge.model).toBe("openai/gpt-5");
	});

	it("7.3: dashboardPort is stored in preferences but NOT applied to config", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);

		const prefs: UserPreferences = {
			dashboardPort: 9090,
		};

		applyUserPreferences(config, prefs);

		// dashboardPort should not exist anywhere in the config
		expect((config as any).dashboardPort).toBeUndefined();
		expect((config.orchestrator as any).dashboardPort).toBeUndefined();
		expect((config.taskRunner as any).dashboardPort).toBeUndefined();

		// But it should still be available in the preferences object
		expect(prefs.dashboardPort).toBe(9090);
	});

	it("7.4: empty-string preference values are treated as 'not set' — do NOT override", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		config.orchestrator.orchestrator.operatorId = "project-default";
		config.taskRunner.worker.model = "project-model";
		config.orchestrator.merge.model = "project-merge-model";

		const prefs: UserPreferences = {
			operatorId: "",
			workerModel: "",
			mergeModel: "",
		};

		applyUserPreferences(config, prefs);

		// Empty strings should NOT override — original values preserved
		expect(config.orchestrator.orchestrator.operatorId).toBe("project-default");
		expect(config.taskRunner.worker.model).toBe("project-model");
		expect(config.orchestrator.merge.model).toBe("project-merge-model");
	});

	it("7.5: undefined preference fields leave config untouched", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		const originalConfig = deepClone(config);

		const prefs: UserPreferences = {};

		applyUserPreferences(config, prefs);

		expect(config).toEqual(originalConfig);
	});

	it("7.6: applyUserPreferences mutates and returns the same object", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		const prefs: UserPreferences = { operatorId: "test" };

		const result = applyUserPreferences(config, prefs);

		expect(result).toBe(config); // Same reference
		expect(result.orchestrator.orchestrator.operatorId).toBe("test");
	});

	it("7.7: spawnMode is applied even if not a string-empty check (enum field)", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		expect(config.orchestrator.orchestrator.spawnMode).toBe("subprocess"); // default

		const prefs: UserPreferences = {
			spawnMode: "tmux",
		};

		applyUserPreferences(config, prefs);

		expect(config.orchestrator.orchestrator.spawnMode).toBe("tmux");
	});
});

// ── 8.x: Integration — applyUserPreferences with Layer 1 inputs ─────

describe("Layer 2 merge integration", () => {
	it("8.1: merge on JSON-backed Layer 1 input — preferences override allowlisted fields", () => {
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		config.taskRunner.project.name = "JsonProject";
		config.taskRunner.worker.model = "json-worker-model";
		config.orchestrator.orchestrator.operatorId = "json-operator";
		config.orchestrator.orchestrator.maxLanes = 5;

		const prefs: UserPreferences = {
			workerModel: "user-worker-model",
			operatorId: "user-operator",
		};

		applyUserPreferences(config, prefs);

		// Allowlisted fields overridden by preferences
		expect(config.taskRunner.worker.model).toBe("user-worker-model");
		expect(config.orchestrator.orchestrator.operatorId).toBe("user-operator");

		// Non-allowlisted fields untouched
		expect(config.taskRunner.project.name).toBe("JsonProject");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(5);
	});

	it("8.2: merge on YAML-backed Layer 1 input — preferences override allowlisted fields", () => {
		// Simulate YAML-loaded config
		const config = deepClone(DEFAULT_PROJECT_CONFIG);
		config.taskRunner.project.name = "YamlProject";
		config.taskRunner.reviewer.model = "yaml-reviewer";
		config.orchestrator.merge.model = "yaml-merge-model";
		config.orchestrator.orchestrator.sessionPrefix = "yaml-prefix";

		const prefs: UserPreferences = {
			reviewerModel: "user-reviewer",
			mergeModel: "user-merge-model",
			sessionPrefix: "user-prefix",
		};

		applyUserPreferences(config, prefs);

		// Allowlisted overrides
		expect(config.taskRunner.reviewer.model).toBe("user-reviewer");
		expect(config.orchestrator.merge.model).toBe("user-merge-model");
		expect(config.orchestrator.orchestrator.sessionPrefix).toBe("user-prefix");

		// Non-allowlisted untouched
		expect(config.taskRunner.project.name).toBe("YamlProject");
	});

	it("8.3: loadProjectConfig e2e — integrates user preferences with JSON config", () => {
		// Set up temp agent dir for preferences isolation
		const agentDir = makeTestDir("e2e-json-agent");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		// Write user preferences
		writePrefsFile(agentDir, JSON.stringify({
			operatorId: "e2e-user",
			workerModel: "e2e-worker-model",
			dashboardPort: 8888,
		}));

		// Write JSON project config
		const projectDir = makeTestDir("e2e-json-project");
		writePiFile(projectDir, "taskplane-config.json", JSON.stringify({
			configVersion: 1,
			taskRunner: {
				project: { name: "E2EProject" },
				worker: { model: "project-worker-model" },
			},
			orchestrator: {
				orchestrator: { operatorId: "project-operator", maxLanes: 7 },
			},
		}));

		const config = loadProjectConfig(projectDir);

		// User prefs should win for allowlisted fields
		expect(config.orchestrator.orchestrator.operatorId).toBe("e2e-user");
		expect(config.taskRunner.worker.model).toBe("e2e-worker-model");

		// Non-allowlisted Layer 1 fields preserved
		expect(config.taskRunner.project.name).toBe("E2EProject");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(7);

		// dashboardPort NOT in config (preferences-only)
		expect((config as any).dashboardPort).toBeUndefined();
	});

	it("8.4: loadProjectConfig e2e — integrates user preferences with YAML config", () => {
		// Set up temp agent dir for preferences isolation
		const agentDir = makeTestDir("e2e-yaml-agent");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		// Write user preferences
		writePrefsFile(agentDir, JSON.stringify({
			reviewerModel: "e2e-reviewer",
			sessionPrefix: "e2e-prefix",
			spawnMode: "tmux",
		}));

		// Write YAML project config
		const projectDir = makeTestDir("e2e-yaml-project");
		writeTaskRunnerYaml(projectDir, [
			"project:",
			"  name: YamlE2EProject",
			"reviewer:",
			"  model: yaml-reviewer-model",
			"  tools: read,write",
			"  thinking: on",
		].join("\n"));
		writeOrchestratorYaml(projectDir, [
			"orchestrator:",
			"  max_lanes: 4",
			"  session_prefix: yaml-prefix",
			"  spawn_mode: subprocess",
		].join("\n"));

		const config = loadProjectConfig(projectDir);

		// User prefs should win for allowlisted fields
		expect(config.taskRunner.reviewer.model).toBe("e2e-reviewer");
		expect(config.orchestrator.orchestrator.sessionPrefix).toBe("e2e-prefix");
		expect(config.orchestrator.orchestrator.spawnMode).toBe("tmux");

		// Non-allowlisted Layer 1 fields preserved
		expect(config.taskRunner.project.name).toBe("YamlE2EProject");
		expect(config.orchestrator.orchestrator.maxLanes).toBe(4);
		expect(config.taskRunner.reviewer.tools).toBe("read,write");
	});

	it("8.5: loadProjectConfig e2e — malformed preferences falls back silently, Layer 1 intact", () => {
		const agentDir = makeTestDir("e2e-malformed-prefs");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		// Write malformed preferences
		writePrefsFile(agentDir, "{ broken: json ]]");

		// Write valid project config
		const projectDir = makeTestDir("e2e-malformed-project");
		writePiFile(projectDir, "taskplane-config.json", JSON.stringify({
			configVersion: 1,
			taskRunner: {
				project: { name: "StillWorks" },
				worker: { model: "project-model" },
			},
		}));

		const config = loadProjectConfig(projectDir);

		// Layer 1 values should be intact since prefs fell back to defaults
		expect(config.taskRunner.project.name).toBe("StillWorks");
		expect(config.taskRunner.worker.model).toBe("project-model");
	});

	it("8.6: loadProjectConfig e2e — no preferences file auto-creates and returns Layer 1 as-is", () => {
		const agentDir = makeTestDir("e2e-no-prefs");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		// No preferences file — should auto-create
		const prefsPath = join(agentDir, USER_PREFERENCES_SUBDIR, USER_PREFERENCES_FILENAME);
		expect(existsSync(prefsPath)).toBe(false);

		const projectDir = makeTestDir("e2e-no-prefs-project");
		writeTaskRunnerYaml(projectDir, "project:\n  name: NoPrefsProject\n");

		const config = loadProjectConfig(projectDir);

		// Preferences file auto-created
		expect(existsSync(prefsPath)).toBe(true);

		// Config should be pure Layer 1 values (empty prefs = no override)
		expect(config.taskRunner.project.name).toBe("NoPrefsProject");
	});

	it("8.7: loadProjectConfig e2e — empty-string prefs don't override Layer 1 values", () => {
		const agentDir = makeTestDir("e2e-empty-str");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		writePrefsFile(agentDir, JSON.stringify({
			operatorId: "",
			workerModel: "",
			reviewerModel: "non-empty-reviewer",
		}));

		const projectDir = makeTestDir("e2e-empty-str-project");
		writePiFile(projectDir, "taskplane-config.json", JSON.stringify({
			configVersion: 1,
			taskRunner: {
				worker: { model: "layer1-worker" },
			},
			orchestrator: {
				orchestrator: { operatorId: "layer1-operator" },
			},
		}));

		const config = loadProjectConfig(projectDir);

		// Empty-string prefs should NOT override Layer 1
		expect(config.orchestrator.orchestrator.operatorId).toBe("layer1-operator");
		expect(config.taskRunner.worker.model).toBe("layer1-worker");

		// Non-empty pref SHOULD override
		expect(config.taskRunner.reviewer.model).toBe("non-empty-reviewer");
	});
});
