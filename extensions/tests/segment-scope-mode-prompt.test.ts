/**
 * TP-196 / #503 — SegmentScopeMode prompt-injection regression tests.
 *
 * The SegmentScopeMode worker-prompt contract (introduced by TP-501,
 * unified by TP-196 / #502) determines whether the worker sees the entire
 * task (FULL_TASK) or only one segment's checkboxes (SEGMENT_SCOPED).
 * After the TP-196 / #502 unification, the segment-scope decision flows
 * through the authoritative `SegmentScopeMode` type and the
 * `computeSegmentScopeMode(...)` helper.
 *
 * These tests guard the four behavioural cases enumerated in issue #503:
 *
 *   1. **FULL_TASK** — prompt does NOT include `Active segment ID`,
 *      does NOT include the segment-scoped checkbox block
 *      (`Your checkboxes for this step:`), and does NOT include
 *      `Other segments in this step (NOT yours)`.
 *   2. **SEGMENT_SCOPED** — prompt INCLUDES `Active segment ID`, the
 *      segment-scoped checkbox block, and `Other segments in this step
 *      (NOT yours)`.
 *   3. **Polyrepo single-segment** — when a task has segment markers for
 *      only one repo, the worker proceeds beyond Step 0 (does not
 *      silently scope itself to one step).
 *   4. **Legacy / partial-marker fallback** — a task with markers on
 *      some steps but not others does NOT silently one-step scope.
 *
 * Test architecture:
 *   - `mock.module("../taskplane/agent-host.ts", ...)` intercepts
 *     `spawnAgent` so we capture each spawned worker's `prompt` and
 *     `env` without actually running a child process.
 *   - The mocked `spawnAgent` returns a SpawnedAgent stub whose `result`
 *     promise resolves to a successful AgentHostResult, allowing the
 *     iteration loop to make forward progress. After capturing the
 *     prompt for iteration 1 we artificially complete all checkboxes so
 *     the loop exits cleanly.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/segment-scope-mode-prompt.test.ts
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect } from "./expect.ts";

// ── Mock spawnAgent BEFORE importing lane-runner ────────────────────

type CapturedSpawn = {
	prompt: string;
	env: Record<string, string>;
	systemPrompt: string;
};

let capturedSpawns: CapturedSpawn[] = [];
let spawnSucceedsImmediately = true;
/**
 * Controls how the mocked worker advances STATUS.md per spawn:
 *  - `"all"`  : check off every unchecked box (fast — collapses to 1 spawn).
 *  - `"first"`: check off only the FIRST unchecked box (forces iteration-by-
 *               iteration progress so the lane-runner spawns multiple times).
 */
let workerAdvanceMode: "all" | "first" = "all";

const realAgentHost = await import("../taskplane/agent-host.ts");

const mockSpawnAgent = mock.fn((hostOpts: Parameters<typeof realAgentHost.spawnAgent>[0]) => {
	capturedSpawns.push({
		prompt: hostOpts.prompt,
		env: (hostOpts.env ?? {}) as Record<string, string>,
		systemPrompt: hostOpts.systemPrompt ?? "",
	});

	if (spawnSucceedsImmediately) {
		// Simulate a worker by mutating the on-disk STATUS.md so the
		// iteration-loop's post-spawn read sees real progress.
		const statusPath = hostOpts.env?.TASKPLANE_STATUS_PATH;
		if (statusPath) {
			try {
				const content = readFileSync(statusPath, "utf-8");
				let advanced: string;
				if (workerAdvanceMode === "all") {
					advanced = content.replace(/- \[ \]/g, "- [x]");
				} else {
					// "first" — replace exactly one unchecked box per spawn.
					advanced = content.replace(/- \[ \]/, "- [x]");
				}
				writeFileSync(statusPath, advanced);
			} catch {
				/* best effort */
			}
		}
	}

	return {
		kill: () => {},
		promise: Promise.resolve({
			exitCode: 0,
			signal: null,
			durationMs: 1,
			killed: false,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUsd: 0,
			toolCalls: 0,
			lastTool: "",
			retries: 0,
			compactions: 0,
			contextUsage: null,
			error: null,
			agentEnded: true,
			stderrTail: "",
		}),
	} as unknown as ReturnType<typeof realAgentHost.spawnAgent>;
});

mock.module("../taskplane/agent-host.ts", {
	namedExports: {
		...realAgentHost,
		spawnAgent: mockSpawnAgent,
	},
});

const { executeTaskV2 } = await import("../taskplane/lane-runner.ts");
const { resolvePacketPaths } = await import("../taskplane/types.ts");

// ── Helpers ─────────────────────────────────────────────────────────

function buildBaseConfig(stateRoot: string, worktreePath: string, repoId: string) {
	return {
		batchId: "tp196-503-test",
		agentIdPrefix: "orch-test",
		laneNumber: 1,
		worktreePath,
		branch: "test-branch",
		repoId,
		stateRoot,
		workerModel: "",
		workerTools: "",
		workerThinking: "",
		workerSystemPrompt: "BASE_WORKER_PROMPT",
		workerSegmentPrompt: "SEGMENT_OVERLAY_PROMPT",
		reviewerModel: "",
		reviewerThinking: "",
		reviewerTools: "",
		maxIterations: 5,
		noProgressLimit: 3,
		maxWorkerMinutes: 5,
		warnPercent: 80,
		killPercent: 95,
	};
}

function writeFixture(
	tmpRoot: string,
	promptMd: string,
	statusMd: string,
): {
	worktreePath: string;
	taskFolder: string;
} {
	const worktreePath = join(tmpRoot, "worktree");
	mkdirSync(worktreePath, { recursive: true });
	const taskFolder = join(worktreePath, "taskplane-tasks", "TP-X");
	mkdirSync(taskFolder, { recursive: true });
	writeFileSync(join(taskFolder, "PROMPT.md"), promptMd);
	writeFileSync(join(taskFolder, "STATUS.md"), statusMd);
	mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
	return { worktreePath, taskFolder };
}

const FULL_TASK_PROMPT_MD = `# TP-X: Full-task fixture

**Created:** 2026-05-10
**Size:** S

## Review Level: 0

## Mission

Single-repo full-task fixture for #503.

## Steps

### Step 0: Preflight

- [ ] Verify project structure

### Step 1: Implement

- [ ] Create utility

---
`;

const FULL_TASK_STATUS_MD = `# TP-X — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 0
**Review Counter:** 0

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Verify project structure

---

### Step 1: Implement
**Status:** ⬜ Not Started
- [ ] Create utility

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---

## Blockers

*None*

---

## Notes

Fixture.
`;

const SEGMENT_SCOPED_PROMPT_MD = `# TP-X: Multi-repo segment fixture

**Created:** 2026-05-10
**Size:** S

## Review Level: 0

## Mission

Multi-segment fixture for #503.

## Steps

### Step 0: Preflight

#### Segment: api
- [ ] Verify api repo

#### Segment: web
- [ ] Verify web repo

### Step 1: Implement

#### Segment: api
- [ ] Create endpoint

#### Segment: web
- [ ] Create UI

---
`;

const SEGMENT_SCOPED_STATUS_MD = `# TP-X — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 0
**Review Counter:** 0

---

### Step 0: Preflight
**Status:** 🟨 In Progress

#### Segment: api
- [ ] Verify api repo

#### Segment: web
- [ ] Verify web repo

---

### Step 1: Implement
**Status:** ⬜ Not Started

#### Segment: api
- [ ] Create endpoint

#### Segment: web
- [ ] Create UI

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---

## Blockers

*None*

---

## Notes

Fixture.
`;

// ── 1. FULL_TASK prompt contract ────────────────────────────────────

describe("1.x: FULL_TASK prompt content (TP-196 / #503)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		capturedSpawns = [];
		spawnSucceedsImmediately = true;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp196-503-full-"));
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("1.1: FULL_TASK prompt does NOT include 'Active segment ID', segment-scoped checkbox block, or 'Other segments'", async () => {
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			FULL_TASK_PROMPT_MD,
			FULL_TASK_STATUS_MD,
		);
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-X",
			taskId: "TP-X",
			segmentId: null, // FULL_TASK: no segment ID
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Full-task fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
				// No stepSegmentMap → FULL_TASK.
			},
		};
		const config = buildBaseConfig(tmpRoot, worktreePath, "default");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns.length).toBeGreaterThan(0);
		const firstPrompt = capturedSpawns[0].prompt;
		expect(firstPrompt).not.toContain("Active segment ID");
		expect(firstPrompt).not.toContain("Your checkboxes for this step:");
		expect(firstPrompt).not.toContain("Other segments in this step (NOT yours");
		expect(firstPrompt).not.toContain("Segment-scoped context");
	});

	it("1.2: FULL_TASK env hard-clears TASKPLANE_ACTIVE_SEGMENT_ID and TASKPLANE_SEGMENT_ID", async () => {
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			FULL_TASK_PROMPT_MD,
			FULL_TASK_STATUS_MD,
		);
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-X",
			taskId: "TP-X",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Full-task fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
			},
		};
		const config = buildBaseConfig(tmpRoot, worktreePath, "default");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns.length).toBeGreaterThan(0);
		expect(capturedSpawns[0].env.TASKPLANE_ACTIVE_SEGMENT_ID).toBe("");
		expect(capturedSpawns[0].env.TASKPLANE_SEGMENT_ID).toBe("");
	});

	it("1.3: FULL_TASK system prompt does NOT include the segment overlay", async () => {
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			FULL_TASK_PROMPT_MD,
			FULL_TASK_STATUS_MD,
		);
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-X",
			taskId: "TP-X",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Full-task fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
			},
		};
		const config = buildBaseConfig(tmpRoot, worktreePath, "default");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns[0].systemPrompt).toBe("BASE_WORKER_PROMPT");
		expect(capturedSpawns[0].systemPrompt).not.toContain("SEGMENT_OVERLAY_PROMPT");
	});
});

// ── 2. SEGMENT_SCOPED prompt contract ───────────────────────────────

describe("2.x: SEGMENT_SCOPED prompt content (TP-196 / #503)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		capturedSpawns = [];
		spawnSucceedsImmediately = true;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp196-503-seg-"));
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	function makeSegmentUnit(taskFolder: string, worktreePath: string) {
		const packet = resolvePacketPaths(taskFolder);
		return {
			id: "TP-X::api",
			taskId: "TP-X",
			segmentId: "TP-X::api",
			executionRepoId: "api",
			packetHomeRepoId: "api",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Multi-repo segment fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
				stepSegmentMap: [
					{
						stepNumber: 0,
						stepName: "Preflight",
						segments: [
							{ repoId: "api", checkboxes: ["- [ ] Verify api repo"] },
							{ repoId: "web", checkboxes: ["- [ ] Verify web repo"] },
						],
					},
					{
						stepNumber: 1,
						stepName: "Implement",
						segments: [
							{ repoId: "api", checkboxes: ["- [ ] Create endpoint"] },
							{ repoId: "web", checkboxes: ["- [ ] Create UI"] },
						],
					},
				],
			},
		};
	}

	it("2.1: SEGMENT_SCOPED prompt INCLUDES 'Active segment ID', segment checkbox block, and 'Other segments (NOT yours)'", async () => {
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			SEGMENT_SCOPED_PROMPT_MD,
			SEGMENT_SCOPED_STATUS_MD,
		);
		const unit = makeSegmentUnit(taskFolder, worktreePath);
		const config = buildBaseConfig(tmpRoot, worktreePath, "api");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns.length).toBeGreaterThan(0);
		const firstPrompt = capturedSpawns[0].prompt;
		expect(firstPrompt).toContain("Active segment ID: TP-X::api");
		expect(firstPrompt).toContain("Your checkboxes for this step:");
		expect(firstPrompt).toContain("Other segments in this step (NOT yours");
		expect(firstPrompt).toContain("Segment-scoped context");
	});

	it("2.2: SEGMENT_SCOPED env carries the active segment ID", async () => {
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			SEGMENT_SCOPED_PROMPT_MD,
			SEGMENT_SCOPED_STATUS_MD,
		);
		const unit = makeSegmentUnit(taskFolder, worktreePath);
		const config = buildBaseConfig(tmpRoot, worktreePath, "api");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns[0].env.TASKPLANE_ACTIVE_SEGMENT_ID).toBe("TP-X::api");
		expect(capturedSpawns[0].env.TASKPLANE_SEGMENT_ID).toBe("TP-X::api");
	});

	it("2.3: SEGMENT_SCOPED system prompt appends the segment overlay after the base", async () => {
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			SEGMENT_SCOPED_PROMPT_MD,
			SEGMENT_SCOPED_STATUS_MD,
		);
		const unit = makeSegmentUnit(taskFolder, worktreePath);
		const config = buildBaseConfig(tmpRoot, worktreePath, "api");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns[0].systemPrompt).toContain("BASE_WORKER_PROMPT");
		expect(capturedSpawns[0].systemPrompt).toContain("SEGMENT_OVERLAY_PROMPT");
		// Overlay appended AFTER base.
		const baseIdx = capturedSpawns[0].systemPrompt.indexOf("BASE_WORKER_PROMPT");
		const overlayIdx = capturedSpawns[0].systemPrompt.indexOf("SEGMENT_OVERLAY_PROMPT");
		expect(overlayIdx).toBeGreaterThan(baseIdx);
	});
});

// ── 3. Polyrepo single-segment regression ───────────────────────────

describe("3.x: Polyrepo single-segment — worker proceeds beyond Step 0 (TP-196 / #503)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		capturedSpawns = [];
		spawnSucceedsImmediately = true;
		// Force iteration-by-iteration progress so we can verify the worker
		// advances past Step 0 (one unchecked box per spawn).
		workerAdvanceMode = "first";
		tmpRoot = mkdtempSync(join(tmpdir(), "tp196-503-poly-"));
	});

	afterEach(() => {
		workerAdvanceMode = "all";
	});

	afterEach(() => {
		workerAdvanceMode = "all";
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("3.1: single-segment task (segmentMap with one repo) drives the loop beyond iteration 1", async () => {
		// Polyrepo regression: when a multi-segment workspace runs a task that
		// only happens to have ONE segment, the worker must still see ALL
		// steps for its repo (not silently scope itself to step 0).
		const promptMd = SEGMENT_SCOPED_PROMPT_MD.replace(
			/#### Segment: web\n- \[ \] Verify web repo\n\n/,
			"",
		).replace(/#### Segment: web\n- \[ \] Create UI\n\n/, "");
		const statusMd = SEGMENT_SCOPED_STATUS_MD.replace(
			/#### Segment: web\n- \[ \] Verify web repo\n\n/,
			"",
		).replace(/#### Segment: web\n- \[ \] Create UI\n\n/, "");

		const { worktreePath, taskFolder } = writeFixture(tmpRoot, promptMd, statusMd);
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-X::api",
			taskId: "TP-X",
			segmentId: "TP-X::api",
			executionRepoId: "api",
			packetHomeRepoId: "api",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Single-segment polyrepo fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
				stepSegmentMap: [
					{
						stepNumber: 0,
						stepName: "Preflight",
						segments: [{ repoId: "api", checkboxes: ["- [ ] Verify api repo"] }],
					},
					{
						stepNumber: 1,
						stepName: "Implement",
						segments: [{ repoId: "api", checkboxes: ["- [ ] Create endpoint"] }],
					},
				],
			},
		};
		const config = buildBaseConfig(tmpRoot, worktreePath, "api");

		// The mocked spawnAgent checks off all unchecked boxes per iteration.
		// In TP-501-buggy behaviour, the worker would treat Step 0 as the whole
		// task and exit early. With TP-196 / #502 in place, the iteration loop
		// advances through ALL repo steps and the mocked worker sees both Step 0
		// and Step 1's prompt scope.
		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		// The fixture has 2 steps (Step 0 Preflight + Step 1 Implement), each
		// with one segment checkbox for the active repo. The mocked worker
		// checks off ONE box per spawn. To complete both steps, the lane-runner
		// MUST iterate at least twice. If the engine were silently scoping the
		// worker to Step 0 only (the regression #503 is guarding against),
		// `capturedSpawns.length` would stop at 1.
		expect(capturedSpawns.length).toBeGreaterThanOrEqual(2);

		// First iteration is scoped to Step 0.
		const firstPrompt = capturedSpawns[0].prompt;
		expect(firstPrompt).toContain("Active segment ID: TP-X::api");
		expect(firstPrompt).toContain("Step 0");

		// Second iteration MUST advance to Step 1 (proves no silent scoping).
		const secondPrompt = capturedSpawns[1].prompt;
		expect(secondPrompt).toContain("Active segment ID: TP-X::api");
		expect(secondPrompt).toContain("Step 1");
		// And the Step 1 segment's checkbox is visible in the prompt:
		expect(secondPrompt).toContain("Create endpoint");
	});
});

// ── 4. Legacy / partial-marker fallback ─────────────────────────────

describe("4.x: Legacy / partial-marker fallback (TP-196 / #503)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		capturedSpawns = [];
		spawnSucceedsImmediately = true;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp196-503-legacy-"));
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("4.1: task with no segment markers (legacy) does NOT silently scope to one step", async () => {
		// Legacy task: no stepSegmentMap at all, segmentId set on the unit.
		// The lane-runner's `rawRepoStepNumbers && rawRepoStepNumbers.size > 0`
		// fallback should yield `repoStepNumbers === null`, which makes
		// `computeSegmentScopeMode` return FULL_TASK. The worker should NOT
		// see any segment-scoped block.
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			FULL_TASK_PROMPT_MD,
			FULL_TASK_STATUS_MD,
		);
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-X::default",
			taskId: "TP-X",
			segmentId: "TP-X::default", // segmentId set, but no stepSegmentMap
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Legacy fallback fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
				// No stepSegmentMap → legacy fallback path → FULL_TASK.
			},
		};
		const config = buildBaseConfig(tmpRoot, worktreePath, "default");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns.length).toBeGreaterThanOrEqual(1);
		const firstPrompt = capturedSpawns[0].prompt;
		// Legacy fallback: NO segment-scoped block, NO "Active segment ID" line.
		expect(firstPrompt).not.toContain("Active segment ID");
		expect(firstPrompt).not.toContain("Your checkboxes for this step:");
		// Env vars hard-cleared (FULL_TASK mode).
		expect(capturedSpawns[0].env.TASKPLANE_ACTIVE_SEGMENT_ID).toBe("");
		expect(capturedSpawns[0].env.TASKPLANE_SEGMENT_ID).toBe("");
	});

	it("4.2: partial-marker task (markers on some steps but not others) drives FULL_TASK when repoStepNumbers is empty for active repo", async () => {
		// `stepSegmentMap` has entries, but NONE of them mention the active
		// repo. `getStepsForRepoId` returns an empty set, `repoStepNumbers`
		// becomes null after the size-> null normalization, and the mode
		// resolves to FULL_TASK.
		const { worktreePath, taskFolder } = writeFixture(
			tmpRoot,
			FULL_TASK_PROMPT_MD,
			FULL_TASK_STATUS_MD,
		);
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-X::unknown",
			taskId: "TP-X",
			segmentId: "TP-X::unknown",
			executionRepoId: "unknown",
			packetHomeRepoId: "unknown",
			worktreePath,
			packet,
			task: {
				taskId: "TP-X",
				taskName: "Partial-marker fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
				stepSegmentMap: [
					{
						stepNumber: 0,
						stepName: "Preflight",
						segments: [{ repoId: "api", checkboxes: ["- [ ] Verify api"] }],
					},
				],
			},
		};
		const config = buildBaseConfig(tmpRoot, worktreePath, "unknown");

		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(capturedSpawns.length).toBeGreaterThanOrEqual(1);
		const firstPrompt = capturedSpawns[0].prompt;
		// Active repo 'unknown' has NO segment in the map → FULL_TASK fallback.
		expect(firstPrompt).not.toContain("Active segment ID: TP-X::unknown");
		expect(firstPrompt).not.toContain("Your checkboxes for this step:");
	});
});
