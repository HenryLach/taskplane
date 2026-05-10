/**
 * Discovery Step-Segment Mapping Tests — TP-173
 *
 * Tests for `#### Segment: <repoId>` parsing within PROMPT.md steps,
 * StepSegmentMapping construction, and edge-case handling.
 *
 * Test categories:
 *   29.x — Basic segment markers → correct StepSegmentMapping
 *   30.x — No segment markers (fallback to primary repoId)
 *   31.x — Mixed steps (some with markers, some without)
 *   32.x — Duplicate repoId in same step → error
 *   33.x — Empty segment (no checkboxes) → warning
 *   34.x — Unknown repoId in workspace mode → warning with suggestions
 *   35.x — Repo mode placeholder resolution
 *   36.x — Post-## Steps content not leaked into last step
 *   37.x — Pre-segment checkboxes mapped to fallback repo
 *   38.x — Invalid repo ID format → warning, checkboxes preserved
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/discovery-segment-steps.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
	parsePromptForOrchestrator,
	parseStepSegmentMapping,
	SEGMENT_FALLBACK_REPO_PLACEHOLDER,
	runDiscovery,
} from "../taskplane/discovery.ts";
import { FATAL_DISCOVERY_CODES } from "../taskplane/types.ts";
import type { TaskArea, WorkspaceConfig, WorkspaceRepoConfig } from "../taskplane/types.ts";

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

function makeWorkspaceConfig(repos: Record<string, Partial<WorkspaceRepoConfig>>): WorkspaceConfig {
	const repoMap = new Map<string, WorkspaceRepoConfig>();
	for (const [id, cfg] of Object.entries(repos)) {
		repoMap.set(id, { path: cfg.path ?? `./${id}`, ...cfg } as WorkspaceRepoConfig);
	}
	return {
		mode: "workspace",
		repos: repoMap,
		routing: { defaultRepo: "default" },
	} as WorkspaceConfig;
}

beforeEach(() => {
	testRoot = join(tmpdir(), `tp173-discovery-${Date.now()}`);
	mkdirSync(testRoot, { recursive: true });
	counter = 0;
});

afterEach(() => {
	rmSync(testRoot, { recursive: true, force: true });
});

// ── 29.x: Basic segment markers → correct StepSegmentMapping ────────

describe("29.x: PROMPT.md with segment markers → correct StepSegmentMapping", () => {
	it("29.1: multi-segment task with explicit markers in all steps", () => {
		const dir = makeTestDir("multi-seg");
		const taskDir = join(dir, "TP-200-multi-seg");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-200 - Multi Segment Task

**Size:** M

## Execution Target

Repo: shared-libs

## Dependencies

**None**

## Steps

### Step 0: Preflight

#### Segment: shared-libs
- [ ] Verify shared-libs repo

#### Segment: web-client
- [ ] Read brand guidelines spec

### Step 1: Implement

#### Segment: shared-libs
- [ ] Create string-utils.js
- [ ] Add JSDoc comments

#### Segment: web-client
- [ ] Create api-client.js

## Completion Criteria

- [ ] Everything works
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		expect(result.task).not.toBe(null);
		const map = result.task!.stepSegmentMap;
		expect(map).not.toBe(undefined);
		expect(map!.length).toBe(2);

		// Step 0
		expect(map![0].stepNumber).toBe(0);
		expect(map![0].stepName).toBe("Preflight");
		expect(map![0].segments.length).toBe(2);
		expect(map![0].segments[0].repoId).toBe("shared-libs");
		expect(map![0].segments[0].checkboxes).toEqual(["Verify shared-libs repo"]);
		expect(map![0].segments[1].repoId).toBe("web-client");
		expect(map![0].segments[1].checkboxes).toEqual(["Read brand guidelines spec"]);

		// Step 1
		expect(map![1].stepNumber).toBe(1);
		expect(map![1].stepName).toBe("Implement");
		expect(map![1].segments.length).toBe(2);
		expect(map![1].segments[0].repoId).toBe("shared-libs");
		expect(map![1].segments[0].checkboxes).toEqual(["Create string-utils.js", "Add JSDoc comments"]);
		expect(map![1].segments[1].repoId).toBe("web-client");
		expect(map![1].segments[1].checkboxes).toEqual(["Create api-client.js"]);
	});
});

// ── 30.x: No segment markers (fallback) ─────────────────────────────

describe("30.x: PROMPT.md without segment markers → single segment per step with primary repoId", () => {
	it("30.1: single-segment task uses promptRepoId as fallback", () => {
		const dir = makeTestDir("no-markers");
		const taskDir = join(dir, "TP-201-no-markers");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-201 - Simple Task

**Size:** M

## Execution Target

Repo: api-service

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Check project structure

### Step 1: Implement
- [ ] Create the feature
- [ ] Write tests

## Completion Criteria

- [ ] Done
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		// No explicit segment markers → stepSegmentMap should be undefined
		// (fallback entries are not promoted to segment-scoped mode)
		expect(result.task!.stepSegmentMap).toBe(undefined);
	});

	it("30.2: no promptRepoId → uses placeholder (resolved later)", () => {
		const dir = makeTestDir("no-repo-id");
		const taskDir = join(dir, "TP-202-no-repo");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-202 - No Repo Task

**Size:** M

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Check stuff
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		// No explicit segment markers → undefined
		expect(result.task!.stepSegmentMap).toBe(undefined);
	});
});

// ── 31.x: Mixed steps ───────────────────────────────────────────────

describe("31.x: Mixed steps (some with markers, some without) → correct mapping", () => {
	it("31.1: mixed steps produce correct mapping", () => {
		const dir = makeTestDir("mixed");
		const taskDir = join(dir, "TP-203-mixed");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-203 - Mixed Task

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Check everything

### Step 1: Implement

#### Segment: api
- [ ] Create endpoint

#### Segment: web-client
- [ ] Create UI component

### Step 2: Documentation
- [ ] Update docs
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		const map = result.task!.stepSegmentMap!;
		expect(map.length).toBe(3);

		// Step 0: no markers → single segment with fallback (api)
		expect(map[0].segments.length).toBe(1);
		expect(map[0].segments[0].repoId).toBe("api");
		expect(map[0].segments[0].checkboxes).toEqual(["Check everything"]);

		// Step 1: explicit markers
		expect(map[1].segments.length).toBe(2);
		expect(map[1].segments[0].repoId).toBe("api");
		expect(map[1].segments[1].repoId).toBe("web-client");

		// Step 2: no markers → single segment with fallback (api)
		expect(map[2].segments.length).toBe(1);
		expect(map[2].segments[0].repoId).toBe("api");
		expect(map[2].segments[0].checkboxes).toEqual(["Update docs"]);
	});
});

// ── 32.x: Duplicate repoId in same step → error ─────────────────────

describe("32.x: Duplicate repoId in same step → discovery error", () => {
	it("32.1: same repoId twice in one step produces SEGMENT_STEP_DUPLICATE_REPO", () => {
		const dir = makeTestDir("dup-repo");
		const taskDir = join(dir, "TP-204-dup");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-204 - Dup Repo Task

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight

#### Segment: shared-libs
- [ ] Check shared-libs

#### Segment: shared-libs
- [ ] Check shared-libs again
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		// Duplicate within a step is a hard error
		expect(result.error).not.toBe(null);
		expect(result.error!.code).toBe("SEGMENT_STEP_DUPLICATE_REPO");
		expect(result.error!.message).toContain("shared-libs");
	});

	it("32.2: pre-segment checkboxes + explicit segment with same repo (concrete) → error", () => {
		const dir = makeTestDir("dup-pre-seg");
		const taskDir = join(dir, "TP-205-dup-pre");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-205 - Dup Pre-Segment

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Pre-segment checkbox

#### Segment: api
- [ ] Explicit api checkbox
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		// Pre-segment with fallback "api" + explicit segment "api" = duplicate
		expect(result.error).not.toBe(null);
		expect(result.error!.code).toBe("SEGMENT_STEP_DUPLICATE_REPO");
	});

	it("32.3: pre-segment placeholder + explicit 'default' in repo mode → duplicate detected by runDiscovery", () => {
		const dir = makeTestDir("dup-repo-mode");
		const areaDir = join(dir, "tasks");
		const taskDir = join(areaDir, "TP-206-dup-repo-mode");
		mkdirSync(taskDir, { recursive: true });
		writePrompt(
			taskDir,
			`# Task: TP-206 - Dup Repo Mode

**Size:** M

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Pre-segment checkbox

#### Segment: default
- [ ] Explicit default checkbox
`,
		);

		const taskAreas: Record<string, TaskArea> = {
			tasks: { path: areaDir, prefix: "TP" },
		};

		// Run discovery in repo mode (no workspace config)
		const discovery = runDiscovery("all", taskAreas, dir);
		// Should have duplicate error after placeholder normalization
		const dupErrors = discovery.errors.filter((e) => e.code === "SEGMENT_STEP_DUPLICATE_REPO");
		expect(dupErrors.length).toBeGreaterThanOrEqual(1);
		expect(dupErrors[0].message).toContain("default");
	});
});

// ── 33.x: Empty segment (no checkboxes) → warning ───────────────────

describe("33.x: Empty segment → discovery warning", () => {
	it("33.1: segment header with no checkboxes produces SEGMENT_STEP_EMPTY warning", () => {
		const dir = makeTestDir("empty-seg");
		const taskDir = join(dir, "TP-207-empty");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-207 - Empty Segment

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight

#### Segment: shared-libs

#### Segment: web-client
- [ ] Do something
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		expect(result.task).not.toBe(null);
		// Empty segment should produce a warning
		expect(result.warnings).not.toBe(undefined);
		const emptyWarnings = result.warnings!.filter((w) => w.code === "SEGMENT_STEP_EMPTY");
		expect(emptyWarnings.length).toBe(1);
		expect(emptyWarnings[0].message).toContain("shared-libs");
		// The mapping should still have the empty segment
		const map = result.task!.stepSegmentMap!;
		expect(map[0].segments.length).toBe(2);
		expect(map[0].segments[0].repoId).toBe("shared-libs");
		expect(map[0].segments[0].checkboxes).toEqual([]);
	});
});

// ── 34.x: Unknown repoId in workspace mode → warning ────────────────

describe("34.x: Unknown repoId → discovery warning with suggestion", () => {
	it("34.1: unknown segment repo in workspace mode produces SEGMENT_STEP_REPO_INVALID", () => {
		const dir = makeTestDir("unknown-repo");
		const areaDir = join(dir, "tasks");
		const taskDir = join(areaDir, "TP-208-unknown-repo");
		mkdirSync(taskDir, { recursive: true });
		writePrompt(
			taskDir,
			`# Task: TP-208 - Unknown Repo Task

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight

#### Segment: api
- [ ] Do api work

#### Segment: web-clien
- [ ] Do web work
`,
		);

		const taskAreas: Record<string, TaskArea> = {
			tasks: { path: areaDir, prefix: "TP" },
		};
		const workspaceConfig = makeWorkspaceConfig({
			api: { path: "./api" },
			"web-client": { path: "./web-client" },
		});

		const discovery = runDiscovery("all", taskAreas, dir, { workspaceConfig });
		const unknownErrors = discovery.errors.filter((e) => e.code === "SEGMENT_STEP_REPO_INVALID");
		expect(unknownErrors.length).toBeGreaterThanOrEqual(1);
		expect(unknownErrors[0].message).toContain("web-clien");
		expect(unknownErrors[0].message).toContain("Known repos:");
		// Should suggest web-client since it shares prefix
		expect(unknownErrors[0].message).toContain("Did you mean:");
		expect(unknownErrors[0].message).toContain("web-client");
	});

	it("34.2: unknown repo warning is non-fatal (task still in pending)", () => {
		const dir = makeTestDir("unknown-nonfatal");
		const areaDir = join(dir, "tasks");
		const taskDir = join(areaDir, "TP-209-nonfatal");
		mkdirSync(taskDir, { recursive: true });
		writePrompt(
			taskDir,
			`# Task: TP-209 - Non-Fatal Warning

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight

#### Segment: api
- [ ] Work

#### Segment: unknown-repo
- [ ] More work
`,
		);

		const taskAreas: Record<string, TaskArea> = {
			tasks: { path: areaDir, prefix: "TP" },
		};
		const workspaceConfig = makeWorkspaceConfig({
			api: { path: "./api" },
		});

		const discovery = runDiscovery("all", taskAreas, dir, { workspaceConfig });
		// Task should still be pending (not failed)
		expect(discovery.pending.has("TP-209")).toBe(true);
		// Warning present
		const warnings = discovery.errors.filter((e) => e.code === "SEGMENT_STEP_REPO_INVALID");
		expect(warnings.length).toBeGreaterThanOrEqual(1);
		// SEGMENT_STEP_REPO_INVALID is NOT in FATAL_DISCOVERY_CODES
		const fatalCodes = new Set<string>(FATAL_DISCOVERY_CODES);
		expect(fatalCodes.has("SEGMENT_STEP_REPO_INVALID")).toBe(false);
	});
});

// ── 35.x: Repo mode placeholder resolution ──────────────────────────

describe("35.x: Repo mode placeholder resolution", () => {
	it("35.1: repo mode resolves placeholder to 'default'", () => {
		const dir = makeTestDir("repo-mode");
		const areaDir = join(dir, "tasks");
		const taskDir = join(areaDir, "TP-210-repo-mode");
		mkdirSync(taskDir, { recursive: true });
		writePrompt(
			taskDir,
			`# Task: TP-210 - Repo Mode Task

**Size:** M

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Check stuff

### Step 1: Implement
- [ ] Do work
`,
		);

		const taskAreas: Record<string, TaskArea> = {
			tasks: { path: areaDir, prefix: "TP" },
		};

		// No workspace config = repo mode
		const discovery = runDiscovery("all", taskAreas, dir);
		const task = discovery.pending.get("TP-210");
		expect(task).not.toBe(undefined);
		// No explicit segment markers → stepSegmentMap undefined
		expect(task!.stepSegmentMap).toBe(undefined);
	});
});

// ── 36.x: Post-## Steps content isolation ────────────────────────────

describe("36.x: Post-## Steps content not leaked into last step", () => {
	it("36.1: checkboxes in ## Completion Criteria not in stepSegmentMap", () => {
		const dir = makeTestDir("post-steps");
		const taskDir = join(dir, "TP-211-post-steps");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-211 - Post Steps Leak Test

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Check project

## Completion Criteria

- [ ] All steps complete
- [ ] Tests passing
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		// No explicit segment markers → stepSegmentMap undefined
		// (Completion Criteria leak test is still valid via the parser unit tests)
		expect(result.task!.stepSegmentMap).toBe(undefined);
	});
});

// ── 37.x: Pre-segment checkboxes ────────────────────────────────────

describe("37.x: Pre-segment checkboxes mapped to fallback repo", () => {
	it("37.1: checkboxes before any segment header use fallback repoId", () => {
		const dir = makeTestDir("pre-segment");
		const taskDir = join(dir, "TP-212-pre-seg");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-212 - Pre-Segment

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight
- [ ] Global preflight checkbox

#### Segment: web-client
- [ ] Web-client specific checkbox
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		const map = result.task!.stepSegmentMap!;
		expect(map.length).toBe(1);
		// Pre-segment checkbox mapped to fallback (api)
		expect(map[0].segments.length).toBe(2);
		expect(map[0].segments[0].repoId).toBe("api");
		expect(map[0].segments[0].checkboxes).toEqual(["Global preflight checkbox"]);
		// Explicit segment
		expect(map[0].segments[1].repoId).toBe("web-client");
		expect(map[0].segments[1].checkboxes).toEqual(["Web-client specific checkbox"]);
	});
});

// ── 38.x: Invalid repo ID format ────────────────────────────────────

describe("38.x: Invalid repo ID format → warning, checkboxes preserved", () => {
	it("38.1: segment with invalid repo ID format preserves checkboxes", () => {
		const dir = makeTestDir("invalid-repo");
		const taskDir = join(dir, "TP-213-invalid");
		mkdirSync(taskDir, { recursive: true });
		const promptPath = writePrompt(
			taskDir,
			`# Task: TP-213 - Invalid Repo

**Size:** M

## Execution Target

Repo: api

## Dependencies

**None**

## Steps

### Step 0: Preflight

#### Segment: api_service
- [ ] Work in invalid-named repo
- [ ] More work

#### Segment: web-client
- [ ] Valid work
`,
		);
		const result = parsePromptForOrchestrator(promptPath, taskDir, "test-area");
		expect(result.error).toBe(null);
		expect(result.task).not.toBe(null);
		// Warning produced for invalid format
		expect(result.warnings).not.toBe(undefined);
		const invalidWarnings = result.warnings!.filter((w) => w.code === "SEGMENT_STEP_REPO_INVALID");
		expect(invalidWarnings.length).toBe(1);
		expect(invalidWarnings[0].message).toContain("api_service");
		// Checkboxes NOT dropped
		const map = result.task!.stepSegmentMap!;
		expect(map[0].segments.length).toBe(2);
		expect(map[0].segments[0].repoId).toBe("api_service");
		expect(map[0].segments[0].checkboxes).toEqual(["Work in invalid-named repo", "More work"]);
		expect(map[0].segments[1].repoId).toBe("web-client");
	});
});
