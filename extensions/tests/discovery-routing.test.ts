/**
 * Discovery Routing Tests — TP-002 Step 0 + Step 1
 *
 * Tests for execution target (repo ID) parsing from PROMPT.md metadata
 * and routing precedence chain resolution.
 *
 * Test categories:
 *   1.x — Prompt with no execution target (backward compat)
 *   2.x — Section-based `## Execution Target` with `Repo:` line
 *   3.x — Inline `**Repo:** <id>` declaration
 *   4.x — Whitespace/case/markdown decoration variants
 *   5.x — Both section + inline present (section wins)
 *   6.x — Invalid repo ID format (non-matching = undefined)
 *   7.x — Existing dependency/file-scope parsing unchanged
 *   8.x — Routing precedence: repo mode (no routing)
 *   9.x — Routing precedence: prompt repo wins
 *  10.x — Routing precedence: area repo fallback
 *  11.x — Routing precedence: default repo fallback
 *  12.x — Routing errors: TASK_REPO_UNKNOWN
 *  13.x — Routing errors: TASK_REPO_UNRESOLVED
 *  14.x — Routing: multiple tasks with mixed sources
 *
 * Run: npx vitest run tests/discovery-routing.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { parsePromptForOrchestrator, resolveTaskRouting } from "../taskplane/discovery.ts";
import type { DiscoveryResult, ParsedTask, TaskArea, WorkspaceConfig, WorkspaceRepoConfig } from "../taskplane/types.ts";

// ── Test Fixtures ────────────────────────────────────────────────────

let testRoot: string;
let counter = 0;

function makeTestDir(suffix?: string): string {
	counter++;
	const dir = join(testRoot, `test-${counter}${suffix ? `-${suffix}` : ""}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writePrompt(dir: string, content: string): string {
	const promptPath = join(dir, "PROMPT.md");
	writeFileSync(promptPath, content, "utf-8");
	return promptPath;
}

/** Minimal valid PROMPT.md with just a task ID heading */
function minimalPrompt(extra: string = ""): string {
	return `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M

## Dependencies

**None**

${extra}

## Steps

### Step 0: Do something

- [ ] Something

---
`;
}

beforeEach(() => {
	testRoot = join(tmpdir(), `tp002-discovery-${Date.now()}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

// ── 1.x: No execution target (backward compat) ──────────────────────

describe("1.x: No execution target", () => {
	it("1.1: prompt without any repo metadata returns undefined promptRepoId", () => {
		const dir = makeTestDir("no-repo");
		const promptPath = writePrompt(dir, minimalPrompt());
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task).not.toBeNull();
		expect(result.task!.taskId).toBe("TP-100");
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("1.2: prompt with unrelated sections does not produce promptRepoId", () => {
		const dir = makeTestDir("unrelated-sections");
		const content = minimalPrompt(`
## Environment

- **Workspace:** Test workspace
- **Services required:** None

## File Scope

- src/main.ts
- src/utils.ts
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task).not.toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("1.3: existing fields (taskId, size, reviewLevel) are unchanged", () => {
		const dir = makeTestDir("fields-intact");
		const content = `# Task: TP-200 - Important Task

**Created:** 2026-03-15
**Size:** L

## Review Level: 3 (Full Review)

## Dependencies

**None**

## Steps

### Step 0: Do it

- [ ] Do the thing

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "test-area");

		expect(result.error).toBeNull();
		expect(result.task!.taskId).toBe("TP-200");
		expect(result.task!.taskName).toBe("Important Task");
		expect(result.task!.size).toBe("L");
		expect(result.task!.reviewLevel).toBe(3);
		expect(result.task!.areaName).toBe("test-area");
		expect(result.task!.promptRepoId).toBeUndefined();
	});
});

// ── 2.x: Section-based `## Execution Target` ────────────────────────

describe("2.x: Section-based execution target", () => {
	it("2.1: parses repo from ## Execution Target section with Repo: line", () => {
		const dir = makeTestDir("section-repo");
		const content = minimalPrompt(`
## Execution Target

Repo: api
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("2.2: parses multi-word section with description", () => {
		const dir = makeTestDir("section-with-desc");
		const content = minimalPrompt(`
## Execution Target

This task targets the frontend repository.

Repo: frontend
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("frontend");
	});

	it("2.3: handles bold Repo key in section", () => {
		const dir = makeTestDir("section-bold-repo");
		const content = minimalPrompt(`
## Execution Target

**Repo:** backend-service
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("backend-service");
	});

	it("2.4: handles hyphenated repo IDs", () => {
		const dir = makeTestDir("section-hyphens");
		const content = minimalPrompt(`
## Execution Target

Repo: my-cool-service-2
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("my-cool-service-2");
	});
});

// ── 3.x: Inline `**Repo:** <id>` declaration ────────────────────────

describe("3.x: Inline repo declaration", () => {
	it("3.1: parses inline **Repo:** field", () => {
		const dir = makeTestDir("inline-repo");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M
**Repo:** api

## Dependencies

**None**

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("3.2: parses inline repo with trailing whitespace", () => {
		const dir = makeTestDir("inline-trailing");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Repo:** frontend   

## Dependencies

**None**

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("frontend");
	});
});

// ── 4.x: Whitespace/case/markdown variants ──────────────────────────

describe("4.x: Whitespace/case/markdown variants", () => {
	it("4.1: uppercase Repo value is lowercased", () => {
		const dir = makeTestDir("case-upper");
		const content = minimalPrompt(`
## Execution Target

Repo: API
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("4.2: mixed-case Repo value is lowercased", () => {
		const dir = makeTestDir("case-mixed");
		const content = minimalPrompt(`
## Execution Target

Repo: Frontend-App
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("frontend-app");
	});

	it("4.3: leading spaces on Repo line are tolerated", () => {
		const dir = makeTestDir("leading-spaces");
		const content = minimalPrompt(`
## Execution Target

  Repo: api
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("4.4: Repo: with colon and extra spaces", () => {
		const dir = makeTestDir("extra-spaces");
		const content = minimalPrompt(`
## Execution Target

Repo:   backend
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("backend");
	});

	it("4.5: section header with trailing whitespace", () => {
		const dir = makeTestDir("header-trailing-ws");
		// Note: the regex in the impl uses \s* after "Execution Target"
		const content = `# Task: TP-100 - Test Task

**Size:** M

## Dependencies

**None**

## Execution Target   

Repo: api

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("api");
	});
});

// ── 5.x: Both section + inline present (section wins) ───────────────

describe("5.x: Precedence (section > inline)", () => {
	it("5.1: section-based repo takes precedence over inline", () => {
		const dir = makeTestDir("precedence");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M
**Repo:** inline-repo

## Dependencies

**None**

## Execution Target

Repo: section-repo

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("section-repo");
	});

	it("5.2: inline repo is used when section has no Repo: line", () => {
		const dir = makeTestDir("section-empty-fallback");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M
**Repo:** inline-repo

## Dependencies

**None**

## Execution Target

This section exists but has no Repo: line.

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBe("inline-repo");
	});
});

// ── 6.x: Invalid repo ID format ─────────────────────────────────────

describe("6.x: Invalid repo ID format", () => {
	it("6.1: repo ID with underscores is rejected (undefined)", () => {
		const dir = makeTestDir("invalid-underscore");
		const content = minimalPrompt(`
## Execution Target

Repo: my_repo
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.2: repo ID starting with hyphen is rejected", () => {
		const dir = makeTestDir("invalid-leading-hyphen");
		const content = minimalPrompt(`
## Execution Target

Repo: -invalid
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.3: repo ID with special characters is rejected", () => {
		const dir = makeTestDir("invalid-special");
		const content = minimalPrompt(`
## Execution Target

Repo: my.repo/v2
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		// The regex captures first \S+ which would be "my.repo/v2", which fails validation
		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.4: empty Repo: value results in undefined", () => {
		const dir = makeTestDir("invalid-empty");
		const content = minimalPrompt(`
## Execution Target

Repo:
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});

	it("6.5: no parse errors produced for invalid repo IDs", () => {
		const dir = makeTestDir("invalid-no-error");
		const content = minimalPrompt(`
## Execution Target

Repo: INVALID_REPO!!
`);
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		// Must be non-fatal: no error, task is valid, just no repo parsed
		expect(result.error).toBeNull();
		expect(result.task).not.toBeNull();
		expect(result.task!.promptRepoId).toBeUndefined();
	});
});

// ── 7.x: Existing parsing unchanged ─────────────────────────────────

describe("7.x: Existing parsing unchanged with repo metadata", () => {
	it("7.1: dependencies still parsed correctly when repo is present", () => {
		const dir = makeTestDir("deps-with-repo");
		const content = `# Task: TP-100 - Test Task

**Created:** 2026-03-15
**Size:** M

## Review Level: 2

## Dependencies

- **Requires:** TP-050 (workspace context)
- TP-051 (routing foundation)

## Execution Target

Repo: api

## File Scope

- extensions/taskplane/discovery.ts
- extensions/tests/discovery-routing.test.ts

## Steps

### Step 0: Do something

- [ ] Something

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "test-area");

		expect(result.error).toBeNull();
		expect(result.task!.taskId).toBe("TP-100");
		expect(result.task!.dependencies).toContain("TP-050");
		expect(result.task!.dependencies).toContain("TP-051");
		expect(result.task!.fileScope).toContain("extensions/taskplane/discovery.ts");
		expect(result.task!.fileScope).toContain("extensions/tests/discovery-routing.test.ts");
		expect(result.task!.reviewLevel).toBe(2);
		expect(result.task!.size).toBe("M");
		expect(result.task!.promptRepoId).toBe("api");
	});

	it("7.2: file scope parsing unaffected by repo metadata", () => {
		const dir = makeTestDir("scope-with-repo");
		const content = `# Task: TP-100 - Test Task

**Size:** S
**Repo:** frontend

## Dependencies

**None**

## File Scope

- src/App.tsx
- src/components/Header.tsx

## Steps

### Step 0: Build it

- [ ] Build

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.fileScope).toEqual(["src/App.tsx", "src/components/Header.tsx"]);
		expect(result.task!.promptRepoId).toBe("frontend");
		expect(result.task!.size).toBe("S");
	});

	it("7.3: cross-area dependency refs still parsed with repo", () => {
		const dir = makeTestDir("cross-area-deps");
		const content = `# Task: TP-100 - Test Task

**Size:** M

## Dependencies

- **Requires:** other-area/OA-001 (cross-area dep)

## Execution Target

Repo: api

## Steps

### Step 0: Implement

- [ ] Do it

---
`;
		const promptPath = writePrompt(dir, content);
		const result = parsePromptForOrchestrator(promptPath, dir, "default");

		expect(result.error).toBeNull();
		expect(result.task!.dependencies).toContain("other-area/OA-001");
		expect(result.task!.promptRepoId).toBe("api");
	});
});


// ── Routing Precedence Tests (Step 1) ────────────────────────────────

/**
 * Helper to build a minimal WorkspaceConfig for routing tests.
 */
function makeWorkspaceConfig(
	repos: Record<string, { path: string; defaultBranch?: string }>,
	defaultRepo: string,
): WorkspaceConfig {
	const repoMap = new Map<string, WorkspaceRepoConfig>();
	for (const [id, cfg] of Object.entries(repos)) {
		repoMap.set(id, { id, path: cfg.path, defaultBranch: cfg.defaultBranch });
	}
	return {
		mode: "workspace",
		repos: repoMap,
		routing: {
			tasksRoot: "/workspace/tasks",
			defaultRepo,
		},
		configPath: "/workspace/.pi/taskplane-workspace.yaml",
	};
}

/**
 * Helper to build a minimal DiscoveryResult with given tasks.
 */
function makeDiscoveryResult(tasks: ParsedTask[]): DiscoveryResult {
	const pending = new Map<string, ParsedTask>();
	for (const task of tasks) {
		pending.set(task.taskId, task);
	}
	return {
		pending,
		completed: new Set<string>(),
		errors: [],
	};
}

/**
 * Helper to build a minimal ParsedTask.
 */
function makeTask(overrides: Partial<ParsedTask> & { taskId: string; areaName: string }): ParsedTask {
	return {
		taskName: overrides.taskName ?? "Test Task",
		reviewLevel: overrides.reviewLevel ?? 2,
		size: overrides.size ?? "M",
		dependencies: overrides.dependencies ?? [],
		fileScope: overrides.fileScope ?? [],
		taskFolder: overrides.taskFolder ?? `/workspace/tasks/${overrides.taskId}`,
		promptPath: overrides.promptPath ?? `/workspace/tasks/${overrides.taskId}/PROMPT.md`,
		status: overrides.status ?? "pending",
		...overrides,
	};
}

// ── 8.x: Repo mode (no routing) ─────────────────────────────────────

describe("8.x: Repo mode — no routing applied", () => {
	it("8.1: resolveTaskRouting is not called in repo mode (no workspace config)", () => {
		// In repo mode, runDiscovery never calls resolveTaskRouting.
		// This test verifies that tasks remain without resolvedRepoId
		// when there's no workspace config.
		const task = makeTask({ taskId: "TP-100", areaName: "default" });
		expect(task.resolvedRepoId).toBeUndefined();
		// No resolveTaskRouting call needed — repo mode skips routing
	});
});

// ── 9.x: Prompt repo wins ───────────────────────────────────────────

describe("9.x: Prompt repo wins over area and default", () => {
	it("9.1: promptRepoId is used even when area and default are available", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
				frontend: { path: "/repos/frontend" },
				shared: { path: "/repos/shared" },
			},
			"shared",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "", repoId: "frontend" },
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default", promptRepoId: "api" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("api");
	});

	it("9.2: promptRepoId overrides area repoId", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
				frontend: { path: "/repos/frontend" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			"ui-area": { path: "/workspace/ui-tasks", prefix: "UI", context: "", repoId: "frontend" },
		};
		const task = makeTask({ taskId: "UI-001", areaName: "ui-area", promptRepoId: "api" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("api");
	});
});

// ── 10.x: Area repo fallback ─────────────────────────────────────────

describe("10.x: Area repo fallback when prompt has no repo", () => {
	it("10.1: area repoId used when no promptRepoId", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
				frontend: { path: "/repos/frontend" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			"ui-area": { path: "/workspace/ui-tasks", prefix: "UI", context: "", repoId: "frontend" },
		};
		const task = makeTask({ taskId: "UI-001", areaName: "ui-area" }); // no promptRepoId
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("frontend");
	});

	it("10.2: area repoId is case-normalized", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				frontend: { path: "/repos/frontend" },
			},
			"frontend",
		);
		const taskAreas: Record<string, TaskArea> = {
			"ui-area": { path: "/workspace/ui-tasks", prefix: "UI", context: "", repoId: "Frontend" },
		};
		const task = makeTask({ taskId: "UI-001", areaName: "ui-area" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("frontend");
	});

	it("10.3: area with invalid repoId format falls through to default", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "", repoId: "INVALID_ID!" },
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("api"); // falls through to default
	});
});

// ── 11.x: Default repo fallback ──────────────────────────────────────

describe("11.x: Default repo fallback when prompt + area have no repo", () => {
	it("11.1: workspace default repo used when prompt and area are empty", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
				frontend: { path: "/repos/frontend" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "" }, // no repoId
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default" }); // no promptRepoId
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("api");
	});

	it("11.2: area without repoId and no promptRepoId falls to default", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				backend: { path: "/repos/backend" },
			},
			"backend",
		);
		const taskAreas: Record<string, TaskArea> = {
			services: { path: "/workspace/services-tasks", prefix: "SVC", context: "" },
		};
		const task = makeTask({ taskId: "SVC-001", areaName: "services" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task.resolvedRepoId).toBe("backend");
	});
});

// ── 12.x: TASK_REPO_UNKNOWN ─────────────────────────────────────────

describe("12.x: TASK_REPO_UNKNOWN when resolved ID not in workspace repos", () => {
	it("12.1: prompt repo ID not in workspace repos", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "" },
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default", promptRepoId: "nonexistent" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("TASK_REPO_UNKNOWN");
		expect(errors[0].taskId).toBe("TP-100");
		expect(errors[0].message).toContain("nonexistent");
		expect(errors[0].message).toContain("api"); // lists known repos
		expect(task.resolvedRepoId).toBeUndefined(); // not set on failure
	});

	it("12.2: area repo ID not in workspace repos", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "", repoId: "missing-repo" },
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("TASK_REPO_UNKNOWN");
		expect(errors[0].taskId).toBe("TP-100");
		expect(errors[0].message).toContain("missing-repo");
	});

	it("12.3: error message includes via source", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "" },
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default", promptRepoId: "ghost" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain("via prompt");
	});
});

// ── 13.x: TASK_REPO_UNRESOLVED ──────────────────────────────────────

describe("13.x: TASK_REPO_UNRESOLVED when all sources are undefined", () => {
	it("13.1: no prompt repo, no area repo, no default repo → unresolved", () => {
		// Create a workspace config with empty defaultRepo
		const repoMap = new Map<string, WorkspaceRepoConfig>();
		repoMap.set("api", { id: "api", path: "/repos/api" });
		const workspaceConfig: WorkspaceConfig = {
			mode: "workspace",
			repos: repoMap,
			routing: {
				tasksRoot: "/workspace/tasks",
				defaultRepo: "", // empty default
			},
			configPath: "/workspace/.pi/taskplane-workspace.yaml",
		};
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "" },
		};
		const task = makeTask({ taskId: "TP-100", areaName: "default" });
		const discovery = makeDiscoveryResult([task]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("TASK_REPO_UNRESOLVED");
		expect(errors[0].taskId).toBe("TP-100");
		expect(errors[0].message).toContain("no resolved repo");
		expect(task.resolvedRepoId).toBeUndefined();
	});
});

// ── 14.x: Multiple tasks with mixed routing sources ─────────────────

describe("14.x: Multiple tasks with mixed routing sources", () => {
	it("14.1: each task resolves independently via its own source", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
				frontend: { path: "/repos/frontend" },
				shared: { path: "/repos/shared" },
			},
			"shared",
		);
		const taskAreas: Record<string, TaskArea> = {
			"api-area": { path: "/workspace/api-tasks", prefix: "AP", context: "", repoId: "api" },
			"ui-area": { path: "/workspace/ui-tasks", prefix: "UI", context: "" }, // no repoId
		};

		// Task 1: prompt repo
		const task1 = makeTask({ taskId: "AP-001", areaName: "api-area", promptRepoId: "frontend" });
		// Task 2: area repo (no prompt)
		const task2 = makeTask({ taskId: "AP-002", areaName: "api-area" });
		// Task 3: default repo (no prompt, no area)
		const task3 = makeTask({ taskId: "UI-001", areaName: "ui-area" });

		const discovery = makeDiscoveryResult([task1, task2, task3]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(0);
		expect(task1.resolvedRepoId).toBe("frontend"); // prompt wins over area
		expect(task2.resolvedRepoId).toBe("api"); // area fallback
		expect(task3.resolvedRepoId).toBe("shared"); // default fallback
	});

	it("14.2: mix of successful and failing routing", () => {
		const workspaceConfig = makeWorkspaceConfig(
			{
				api: { path: "/repos/api" },
			},
			"api",
		);
		const taskAreas: Record<string, TaskArea> = {
			default: { path: "/workspace/tasks", prefix: "TP", context: "" },
		};

		// Task 1: valid prompt repo
		const task1 = makeTask({ taskId: "TP-001", areaName: "default", promptRepoId: "api" });
		// Task 2: unknown prompt repo
		const task2 = makeTask({ taskId: "TP-002", areaName: "default", promptRepoId: "ghost" });

		const discovery = makeDiscoveryResult([task1, task2]);

		const errors = resolveTaskRouting(discovery, taskAreas, workspaceConfig);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe("TASK_REPO_UNKNOWN");
		expect(errors[0].taskId).toBe("TP-002");
		expect(task1.resolvedRepoId).toBe("api"); // success
		expect(task2.resolvedRepoId).toBeUndefined(); // failure
	});
});
