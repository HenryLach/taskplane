/**
 * #629 — Review-gate remediation spawn: behavioural test.
 *
 * After a finalize refusal (#626 gate) the operator runs orch_retry_task +
 * orch_resume. The lane relaunches with EVERY checkbox already checked. Before
 * #629 the iteration loop broke on "no remaining steps" without spawning a
 * worker, and the gate refused again — the alert's promised remedy ("have the
 * worker address the findings and re-run review_step") was unreachable.
 *
 * Architecture: `mock.module("../taskplane/agent-host.ts")` intercepts
 * `spawnAgent`. The mock plays the worker: it may drop a fresh APPROVE review
 * file (simulating a successful review_step) and resolves a clean exit.
 *
 * Scenarios:
 *   1. gate outstanding → ONE remediation spawn whose prompt names the gate →
 *      mock writes R002 APPROVE → task finalizes succeeded, .DONE created.
 *   2. gate never clears → exactly MAX (2) remediation spawns → task fails with
 *      exitDiagnostic.classification === "review_gate_refusal", no .DONE.
 *   3. no reviews at all → zero spawns, succeeded (pre-#629 behaviour intact).
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/review-remediation-spawn.test.ts
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "./expect.ts";

// ── spawnAgent mock (must be installed before importing lane-runner) ──

interface SpawnCall {
	prompt: string;
}
let spawnCalls: SpawnCall[] = [];
/** Per-test hook: called on each spawn with the call index; may write review files. */
let onSpawn: ((index: number) => void) | null = null;
/** The lane-runner's review-boundary bridge (2nd spawnAgent arg), captured per spawn. */
let lastOnEvent: ((evt: unknown) => void) | null = null;

const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn((opts: { prompt: string }, onEvent?: (evt: unknown) => void) => {
	lastOnEvent = onEvent ?? null;
	const index = spawnCalls.length;
	spawnCalls.push({ prompt: opts.prompt });
	onSpawn?.(index);
	const result = {
		exitCode: 0,
		signal: null,
		durationMs: 1200,
		killed: false,
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: 0.01,
		toolCalls: 2,
		lastTool: "review_step",
		retries: 0,
		compactions: 0,
		contextUsage: null,
		error: null,
		agentEnded: true,
		stderrTail: "",
	};
	return { promise: Promise.resolve(result), kill: () => {} } as unknown as ReturnType<
		typeof realAgentHost.spawnAgent
	>;
});

mock.module("../taskplane/agent-host.ts", {
	namedExports: { ...realAgentHost, spawnAgent: mockSpawnAgent },
});

const { executeTaskV2 } = await import("../taskplane/lane-runner.ts");
const { resolvePacketPaths } = await import("../taskplane/types.ts");

// ── Fixtures: single-step, single-segment (plain) task, all boxes checked ──

const PROMPT_MD = `# TP-R: Remediation fixture

**Created:** 2026-09-06
**Size:** S

## Review Level: 1

## Mission

Drive the #629 remediation path.

## Steps

### Step 1: Implement thing

- [ ] Do the thing
- [ ] Test the thing

## Do NOT

- Nothing.

---
`;

const STATUS_MD_ALL_COMPLETE = `# TP-R — Status

**Current Step:** Step 1: Implement thing
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 1
**Review Counter:** 1

---

### Step 1: Implement thing
**Status:** ✅ Complete

- [x] Do the thing
- [x] Test the thing

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---
`;

const REVISE_REVIEW = `# Code Review — Step 1

## Verdict: REVISE

## Findings

- P1: missing null check in thing()
`;

const APPROVE_REVIEW = `# Code Review — Step 1

## Verdict: APPROVE

All findings addressed.
`;

describe("#629 — review-gate remediation spawn (behavioural)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;
	let reviewsDir: string;

	function buildUnitAndConfig() {
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-R",
			taskId: "TP-R",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-R",
				taskName: "Remediation fixture",
				reviewLevel: 1,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
			},
		};
		const config = {
			batchId: "tp629-remediation",
			agentIdPrefix: "orch-test",
			laneNumber: 1,
			worktreePath,
			branch: "test-branch",
			repoId: "default",
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
		return { unit, config, packet };
	}

	beforeEach(() => {
		spawnCalls = [];
		onSpawn = null;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp629-remediation-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-R");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD_ALL_COMPLETE);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
		reviewsDir = resolvePacketPaths(taskFolder).reviewsDir;
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("1. outstanding REVISE → one remediation spawn (prompt names the gate) → APPROVE clears it → succeeded + .DONE", async () => {
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(reviewsDir, "R001-code-step1.md"), REVISE_REVIEW);
		// The "worker" addresses the findings and re-runs review_step → R002 APPROVE.
		onSpawn = () => writeFileSync(join(reviewsDir, "R002-code-step1.md"), APPROVE_REVIEW);

		const { unit, config, packet } = buildUnitAndConfig();
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(spawnCalls.length).toBe(1);
		const prompt = spawnCalls[0].prompt;
		expect(prompt).toContain("REVIEW GATE OUTSTANDING");
		expect(prompt).toContain("code-step1: R001-code-step1.md → REVISE");
		expect(prompt).toContain("call review_step for that step again");
		expect(prompt).toContain("Do NOT write .DONE");
		// Not the premature-exit nag.
		expect(prompt).not.toContain("You exited previously without completing all steps");

		expect(result.outcome.status).toBe("succeeded");
		expect(existsSync(packet.donePath)).toBe(true);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).toContain("Review remediation");
		// Checkboxes untouched.
		expect(status).toContain("- [x] Do the thing");
		expect(status).toContain("- [x] Test the thing");
	});

	it("2. gate never clears → exactly 2 remediation spawns → failed with review_gate_refusal, no .DONE", async () => {
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(reviewsDir, "R001-code-step1.md"), REVISE_REVIEW);
		// Worker "tries" but the reviewer keeps saying REVISE.
		onSpawn = (i) => writeFileSync(join(reviewsDir, `R00${i + 2}-code-step1.md`), REVISE_REVIEW);

		const { unit, config, packet } = buildUnitAndConfig();
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		expect(spawnCalls.length).toBe(2);
		expect(result.outcome.status).toBe("failed");
		expect(result.outcome.exitDiagnostic?.classification).toBe("review_gate_refusal");
		expect(result.outcome.exitDiagnostic?.exitCode).toBe(0);
		expect(result.outcome.exitReason).toContain("latest review verdict is not APPROVE");
		expect(result.outcome.exitReason).toContain("R003-code-step1.md: REVISE");
		expect(existsSync(packet.donePath)).toBe(false);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).toContain("Review remediation exhausted");
		expect(status).toContain("Finalize refused");
	});

	it("6. a duplicated review_completed for the SAME review file is ignored (one file = one review; no double notify, no double streak)", async () => {
		// Penster feedback on #632: a duplicate review_completed for R002 reached the
		// supervisor. Drive the bridge with the same end boundary twice.
		mkdirSync(reviewsDir, { recursive: true });
		const r1 = join(reviewsDir, "R001-code-step1.md");
		writeFileSync(r1, REVISE_REVIEW);
		const engineEvents: Array<{ type: string; reviewRound?: number }> = [];
		const eventsPath = join(tmpRoot, ".pi", "supervisor", "events.jsonl");
		onSpawn = () => {
			const bridge = lastOnEvent;
			if (!bridge) return;
			const evt = (type: string) => ({
				batchId: "tp629-remediation",
				agentId: "orch-test-lane-1-worker",
				role: "worker",
				laneNumber: 1,
				taskId: "TP-R",
				ts: Date.now(),
				type,
				payload: { step: 1, reviewType: "code", disposition: "REVISE", reviewPath: r1 },
			});
			bridge(evt("review_requested"));
			bridge(evt("review_completed"));
			bridge(evt("review_completed")); // the duplicate
			// The worker then "fixes" and gets an APPROVE so the task can finalize.
			writeFileSync(join(reviewsDir, "R002-code-step1.md"), APPROVE_REVIEW);
		};
		const { unit, config } = buildUnitAndConfig();
		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		// Give the lazy emitEngineEvent import a tick to flush.
		await new Promise((r) => setTimeout(r, 200));
		if (existsSync(eventsPath)) {
			for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
				if (!line.trim()) continue;
				try {
					const e = JSON.parse(line) as { type: string; taskId?: string; reviewRound?: number };
					if (e.taskId === "TP-R") engineEvents.push(e);
				} catch {
					/* skip */
				}
			}
		}
		const completed = engineEvents.filter((e) => e.type === "review_completed");
		expect(completed.length).toBe(1); // NOT 2
		expect(completed[0].reviewRound).toBe(1); // streak advanced once, not twice
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).toContain("Duplicate review boundary");
	});

	it("7. step-completion heuristic does NOT flip a REVISE'd step to ✅ Complete (phantom STATUS edit, feedback #3 item 4)", async () => {
		// All checkboxes checked, step still In Progress (worker reverted it per the recovery
		// recipe), latest code review REVISE. The worker's spawn "does" a re-review → still REVISE.
		writeFileSync(
			join(taskFolder, "STATUS.md"),
			STATUS_MD_ALL_COMPLETE.replace(
				"### Step 1: Implement thing\n**Status:** ✅ Complete",
				"### Step 1: Implement thing\n**Status:** 🟨 In Progress",
			),
		);
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(reviewsDir, "R001-code-step1.md"), REVISE_REVIEW);
		onSpawn = (i) => writeFileSync(join(reviewsDir, `R00${i + 2}-code-step1.md`), REVISE_REVIEW);
		const { unit, config } = buildUnitAndConfig();
		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		// The step block must still read In Progress — never flipped by the runtime.
		const stepBlock = status.slice(status.indexOf("### Step 1"), status.indexOf("## Reviews"));
		expect(stepBlock).toContain("**Status:** 🟨 In Progress");
		expect(stepBlock).not.toContain("**Status:** ✅ Complete");
		expect(status).toContain("Step completion withheld");
	});

	it("3. no reviews at all → zero spawns, succeeded (pre-#629 behaviour preserved)", async () => {
		const { unit, config, packet } = buildUnitAndConfig();
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		expect(spawnCalls.length).toBe(0);
		expect(result.iterations).toBe(0);
		expect(result.outcome.status).toBe("succeeded");
		expect(existsSync(packet.donePath)).toBe(true);
	});

	it("5. two-step task, gate on step 1 (not the last step): focus step is Step 1 and the STATUS heading is untouched", async () => {
		writeFileSync(
			join(taskFolder, "PROMPT.md"),
			PROMPT_MD.replace(
				"- [ ] Test the thing\n",
				"- [ ] Test the thing\n\n### Step 2: Ship it\n\n- [ ] Tag release\n",
			),
		);
		writeFileSync(
			join(taskFolder, "STATUS.md"),
			STATUS_MD_ALL_COMPLETE.replace(
				"- [x] Test the thing\n",
				"- [x] Test the thing\n\n---\n\n### Step 2: Ship it\n**Status:** ✅ Complete\n\n- [x] Tag release\n",
			),
		);
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(reviewsDir, "R001-code-step1.md"), REVISE_REVIEW);
		writeFileSync(join(reviewsDir, "R002-code-step2.md"), APPROVE_REVIEW);
		onSpawn = () => writeFileSync(join(reviewsDir, "R003-code-step1.md"), APPROVE_REVIEW);

		const { unit, config } = buildUnitAndConfig();
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		expect(spawnCalls.length).toBe(1);
		expect(result.outcome.status).toBe("succeeded");
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		// Focus step derived from the gate key (`code-step1` → Step 1), not the last step.
		expect(status).toContain("Review remediation — Step 1: Implement thing");
		expect(status).not.toContain("Review remediation — Step 2");
		// Neither step was flipped back to In Progress (the task-level header
		// Status also reads Complete after finalize — count step blocks only).
		const stepBlocks = status.split(/^### Step /m).slice(1);
		expect(stepBlocks.length).toBe(2);
		for (const block of stepBlocks) expect(block).toContain("**Status:** ✅ Complete");
		expect(status).not.toContain("🟨 In Progress");
	});

	it("4. remediation iterations are not counted as no-progress (stall counter stays at 0)", async () => {
		mkdirSync(reviewsDir, { recursive: true });
		writeFileSync(join(reviewsDir, "R001-code-step1.md"), REVISE_REVIEW);
		onSpawn = (i) => writeFileSync(join(reviewsDir, `R00${i + 2}-code-step1.md`), REVISE_REVIEW);
		const { unit, config } = buildUnitAndConfig();
		await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			{ ...config, noProgressLimit: 1 } as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		// With noProgressLimit=1 an un-exempted 0-checkbox iteration would have
		// failed the task as "Task blocked: No progress" after the FIRST spawn.
		expect(spawnCalls.length).toBe(2);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).not.toContain("No progress after");
		expect(status).toContain("not counted toward stall");
	});
});
