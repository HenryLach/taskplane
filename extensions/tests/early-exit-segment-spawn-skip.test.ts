/**
 * TP-196 / #508 — Pre-spawn segment-completion early-exit behavioural test.
 *
 * Proves the end-to-end contract: when a lane resumes a segment whose
 * checkboxes are ALREADY all complete in STATUS.md, the lane-runner
 * iteration loop MUST NOT spawn a worker agent. This eliminates one
 * wasted iteration (~30-60s + token cost) per segment in batches with
 * many segments.
 *
 * Test architecture:
 *   - `mock.module("../taskplane/agent-host.ts", ...)` intercepts
 *     `spawnAgent` BEFORE the lane-runner module is imported, so the
 *     spawn-call counter increments any time the iteration loop reaches
 *     the spawn site.
 *   - We construct a fixture worktree with a real PROMPT.md and a real
 *     STATUS.md whose Step 1 segment checkboxes are all `[x]`.
 *   - We invoke `executeTaskV2(unit, config, pauseSignal)` and assert:
 *       1. `spawnAgentCallCount === 0` (no worker spawn) — the #508 contract.
 *       2. The returned `iterations` field is 0 (no iteration consumed).
 *
 * NOTE: The existing `remainingSteps.length === 0` break at the top of the
 * iteration loop already enforces this property in the simple all-complete
 * case (after TP-174's commit `3ef96db8` made `remainingSteps` use
 * `isSegmentComplete`). The new TP-196 / #508 explicit `shouldSkipSpawn...`
 * check acts as a defense-in-depth backstop and a clear contract assertion
 * point. This test verifies the end-to-end behavioural property regardless
 * of which guard fires; the structural unit tests in
 * `segment-scoped-lane-runner.test.ts` (sections 10.x) cover the new
 * helper's contract directly.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/early-exit-segment-spawn-skip.test.ts
 */

import { describe, it, mock, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { shouldSkipSpawnForCompleteSegment } from "../taskplane/lane-runner.ts";

// ── Helper-level behavioural tests (no module mocking required) ─────

describe("shouldSkipSpawnForCompleteSegment — pure-helper behavioural contract", () => {
	const STATUS_ALL_COMPLETE = `# TP-X — Status

**Current Step:** Step 1: Build api segment
**Iteration:** 1

---

### Step 1: Build api segment
**Status:** 🟨 In Progress

#### Segment: api
- [x] Create endpoint
- [x] Add validation
- [x] Update docs

#### Segment: web
- [ ] Create UI component
- [ ] Wire up form

---
`;

	const STATUS_API_PARTIAL = `# TP-X — Status

### Step 1: Build api segment
**Status:** 🟨 In Progress

#### Segment: api
- [x] Create endpoint
- [ ] Add validation
- [ ] Update docs

---
`;

	it("returns true when ALL repoStepNumbers segments are complete for currentRepoId", () => {
		const result = shouldSkipSpawnForCompleteSegment(STATUS_ALL_COMPLETE, new Set([1]), "api");
		expect(result).toBe(true);
	});

	it("returns false when one segment checkbox is still unchecked", () => {
		const result = shouldSkipSpawnForCompleteSegment(STATUS_API_PARTIAL, new Set([1]), "api");
		expect(result).toBe(false);
	});

	it("returns false in FULL_TASK mode (null repoStepNumbers)", () => {
		const result = shouldSkipSpawnForCompleteSegment(STATUS_ALL_COMPLETE, null, "api");
		expect(result).toBe(false);
	});

	it("returns false when currentRepoId is null (no segment context)", () => {
		const result = shouldSkipSpawnForCompleteSegment(STATUS_ALL_COMPLETE, new Set([1]), null);
		expect(result).toBe(false);
	});

	it("returns false when repoStepNumbers is empty", () => {
		const result = shouldSkipSpawnForCompleteSegment(STATUS_ALL_COMPLETE, new Set(), "api");
		expect(result).toBe(false);
	});

	it("returns false when one of several repoStepNumbers has an incomplete segment", () => {
		// Step 1 api segment complete, Step 2 has no api segment block → counts as incomplete.
		const status = `### Step 1
#### Segment: api
- [x] done

### Step 2
#### Segment: api
- [ ] not yet
`;
		const result = shouldSkipSpawnForCompleteSegment(status, new Set([1, 2]), "api");
		expect(result).toBe(false);
	});
});

// ── Lane-runner end-to-end: spawnAgent must NOT be called ───────────

// `mock.module` MUST run before importing the lane-runner module.
let spawnAgentCallCount = 0;
let spawnAgentLastArgs: unknown[] | null = null;

const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn((...args: unknown[]) => {
	spawnAgentCallCount += 1;
	spawnAgentLastArgs = args;
	// Return a stub that vaguely resembles a SpawnedAgent so the loop body
	// can complete if it accidentally reaches the spawn site. We use a
	// rejected promise so the loop unwinds cleanly through error handling.
	return {
		kill: () => {},
		result: Promise.reject(
			new Error("TP-196 / #508 test sentinel: spawnAgent should not be called for completed segments"),
		),
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

// Minimal PROMPT.md for a 2-step task with one explicit segment.
const PROMPT_MD = `# TP-X: Behavioural test for #508

**Created:** 2026-05-10
**Size:** S

## Review Level: 0

## Mission

Single-segment task to drive lane-runner iteration loop in tests.

## Steps

### Step 0: Preflight

#### Segment: api
- [ ] Verify api repo

### Step 1: Implement endpoint

#### Segment: api
- [ ] Create endpoint
- [ ] Add validation
- [ ] Update docs

## Do NOT

- Don't do anything; this is a fixture.

---

`;

const STATUS_MD_ALL_COMPLETE = `# TP-X — Status

**Current Step:** Step 1: Implement endpoint
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 0
**Review Counter:** 0

---

### Step 0: Preflight
**Status:** ✅ Complete

#### Segment: api
- [x] Verify api repo

---

### Step 1: Implement endpoint
**Status:** ✅ Complete

#### Segment: api
- [x] Create endpoint
- [x] Add validation
- [x] Update docs

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

Fixture for TP-196 / #508.
`;

describe("executeTaskV2 — pre-spawn early-exit (TP-196 / #508)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;

	beforeEach(() => {
		spawnAgentCallCount = 0;
		spawnAgentLastArgs = null;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp196-508-e2e-"));
		worktreePath = join(tmpRoot, "worktree");
		mkdirSync(worktreePath, { recursive: true });
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-X");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD_ALL_COMPLETE);
		// Create a state root area so logExecution writes succeed.
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("does NOT spawn a worker when all segment checkboxes are already complete (#508)", async () => {
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
				taskName: "Behavioural test for #508",
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
						stepName: "Implement endpoint",
						segments: [
							{
								repoId: "api",
								checkboxes: ["- [ ] Create endpoint", "- [ ] Add validation", "- [ ] Update docs"],
							},
						],
					},
				],
			},
		};

		const config = {
			batchId: "tp196-508-test",
			agentIdPrefix: "orch-test",
			laneNumber: 1,
			worktreePath,
			branch: "test-branch",
			repoId: "api",
			stateRoot: tmpRoot,
			workerModel: "",
			workerTools: "",
			workerThinking: "",
			workerSystemPrompt: "",
			workerSegmentPrompt: "",
			reviewerModel: "",
			reviewerThinking: "",
			reviewerTools: "",
			maxIterations: 10,
			noProgressLimit: 3,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
		};

		const pauseSignal = { paused: false };

		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			pauseSignal,
		);

		// Primary assertion: spawnAgent was NEVER called (#508 contract).
		expect(spawnAgentCallCount).toBe(0);
		expect(spawnAgentLastArgs).toBe(null);

		// Secondary assertion: iteration counter stayed at 0.
		expect(result.iterations).toBe(0);
	});
});
