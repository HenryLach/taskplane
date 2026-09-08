/**
 * ruling-trailer.test.ts — commit-message ruling citation validation (#627 Stage 2b).
 *
 * Part 1: pure unit tests for `parseRulingCitations` / `validateRulingCitations`.
 * Part 2: behavioural lane-runner test with a REAL `git init` worktree where the
 *         mocked worker commits (a) a valid trailer → no flag, (b) an unknown id
 *         → `unknown-ruling` flag + audit entry + alert, (c) a prose claim
 *         "R004 cap ruling (FIX)" without a trailer → `prose-claim` flag. Task
 *         status is unaffected in all three.
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const { parseRulingCitations, validateRulingCitations } = await import(
	"../taskplane/ruling-trailer.ts"
);
const { createHoldRecord, applyRuling, markDeliveryInFlight, markDeliveryAcknowledged } =
	await import("../taskplane/hold-state.ts");
type HoldRecord = import("../taskplane/hold-state.ts").HoldRecord;

const TASK_ID = "TP-RUL";

/** A released + acknowledged hold carrying `rulingId`, bound to the given unit. */
function ruledHold(escId: string, rulingId: string, segmentId: string | null = null): HoldRecord {
	const base = createHoldRecord({
		escalation: { id: escId, content: "cap hit", timestamp: 1_000 },
		batchId: "tp199-rul",
		taskId: TASK_ID,
		segmentId,
		executionId: "exec-1",
		agentId: "orch-test-lane-1-worker",
		laneNumber: 1,
		holdTimeoutMinutes: 240,
		now: 1_000,
	});
	const released = applyRuling(
		base,
		{ id: rulingId, replyTo: escId, content: "rule: proceed", actor: { role: "supervisor", id: "sup" } },
		2_000,
	);
	return markDeliveryAcknowledged(markDeliveryInFlight(released, "delivered"));
}

// ── Part 1: parser ────────────────────────────────────────────────────

describe("parseRulingCitations", () => {
	it("single trailer id", () => {
		const c = parseRulingCitations("fix: thing\n\nTaskplane-Ruling: ruling-1\n");
		assert.deepEqual(c.trailerIds, ["ruling-1"]);
		assert.deepEqual(c.proseClaims, []);
	});

	it("multiple ids on one trailer line (comma-split)", () => {
		const c = parseRulingCitations("fix: thing\n\nTaskplane-Ruling: r1, r2 ,r3\n");
		assert.deepEqual(c.trailerIds, ["r1", "r2", "r3"]);
	});

	it("no citation at all", () => {
		const c = parseRulingCitations("feat: ordinary commit\n\nNo rulings here.\n");
		assert.deepEqual(c.trailerIds, []);
		assert.deepEqual(c.proseClaims, []);
	});

	it("prose claim outside a trailer is captured, not counted as a trailer id", () => {
		const c = parseRulingCitations("fix: apply R004 cap ruling (FIX)\n\nbody\n");
		assert.deepEqual(c.trailerIds, []);
		assert.equal(c.proseClaims.length, 1);
		assert.match(c.proseClaims[0], /R004 cap ruling \(FIX\)/);
	});

	it("the Taskplane-Ruling trailer line is NOT double-counted as a prose claim", () => {
		const c = parseRulingCitations("fix: thing\n\nTaskplane-Ruling: ruling-1\n");
		assert.deepEqual(c.proseClaims, []);
	});
});

// ── Part 1: validator ─────────────────────────────────────────────────

describe("validateRulingCitations", () => {
	const unit = { taskId: TASK_ID, segmentId: null };

	it("valid: an id carried by a hold binding this unit → no flag", () => {
		const holds = [ruledHold("esc-1", "ruling-1")];
		const flags = validateRulingCitations({ trailerIds: ["ruling-1"], proseClaims: [] }, holds, unit);
		assert.deepEqual(flags, []);
	});

	it("unknown: an id no hold carries → unknown-ruling flag", () => {
		const flags = validateRulingCitations({ trailerIds: ["nope"], proseClaims: [] }, [], unit);
		assert.equal(flags.length, 1);
		assert.equal(flags[0].kind, "unknown-ruling");
		assert.equal(flags[0].ref, "nope");
	});

	it("wrong-unit: an id carried by a hold of ANOTHER unit → wrong-unit flag", () => {
		// A ruling that binds a different segment of the task — not this whole-task
		// unit's binding set… actually holds bind broadly; use a different taskId.
		const otherHold = {
			...ruledHold("esc-2", "ruling-other"),
			taskId: "TP-OTHER",
		} as HoldRecord;
		const flags = validateRulingCitations(
			{ trailerIds: ["ruling-other"], proseClaims: [] },
			[otherHold],
			unit,
		);
		assert.equal(flags.length, 1);
		assert.equal(flags[0].kind, "wrong-unit");
		assert.equal(flags[0].ref, "ruling-other");
	});

	it("prose: every prose claim is flagged", () => {
		const flags = validateRulingCitations(
			{ trailerIds: [], proseClaims: ["R004 cap ruling (FIX)"] },
			[],
			unit,
		);
		assert.equal(flags.length, 1);
		assert.equal(flags[0].kind, "prose-claim");
	});
});

// ── Part 2: behavioural lane-runner scan ──────────────────────────────

interface SpawnCall {
	prompt: string;
}
let spawnCalls: SpawnCall[] = [];
let onSpawn: ((index: number) => void) | null = null;

const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn((opts: { prompt: string }) => {
	const index = spawnCalls.length;
	spawnCalls.push({ prompt: opts.prompt });
	onSpawn?.(index);
	const result = {
		exitCode: 0,
		signal: null,
		durationMs: 1000,
		killed: false,
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: 0.01,
		toolCalls: 1,
		lastTool: "edit",
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
const { createInMemoryHoldStore } = await import("../taskplane/hold-state.ts");

const PROMPT_MD = `# TP-RUL: ruling citation fixture

**Size:** S

## Review Level: 0

## Mission

Drive the #627 Stage 2b ruling citation scan.

## Steps

### Step 1: Do the thing

- [ ] Do the thing

## Do NOT

- Nothing.

---
`;

const STATUS_INCOMPLETE = `# TP-RUL — Status

**Current Step:** Step 1: Do the thing
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 0

---

### Step 1: Do the thing
**Status:** 🟨 In Progress

- [ ] Do the thing

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---
`;

const STATUS_COMPLETE = STATUS_INCOMPLETE.replace(
	"### Step 1: Do the thing\n**Status:** 🟨 In Progress\n\n- [ ] Do the thing",
	"### Step 1: Do the thing\n**Status:** ✅ Complete\n\n- [x] Do the thing",
);

describe("#627 Stage 2b — lane-runner ruling citation scan (behavioural)", () => {
	let tmpRoot: string;
	let worktreePath: string;
	let taskFolder: string;
	let alerts: Array<{ category: string; summary: string; context?: Record<string, unknown> }>;

	function git(...args: string[]): void {
		execFileSync("git", args, { cwd: worktreePath, stdio: "pipe" });
	}

	function auditEntries(): Array<Record<string, unknown>> {
		const p = join(tmpRoot, ".pi", "supervisor", "actions.jsonl");
		if (!existsSync(p)) return [];
		return readFileSync(p, "utf-8")
			.split("\n")
			.filter((l) => l.trim())
			.map((l) => JSON.parse(l) as Record<string, unknown>);
	}

	beforeEach(() => {
		spawnCalls = [];
		onSpawn = null;
		alerts = [];
		tmpRoot = mkdtempSync(join(tmpdir(), "tp199-rul-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-RUL");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_INCOMPLETE);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
		git("init", "-q");
		git("config", "user.email", "t@t.t");
		git("config", "user.name", "t");
		git("config", "commit.gpgsign", "false");
		writeFileSync(join(worktreePath, "seed.txt"), "seed\n");
		git("add", "-A");
		git("commit", "-q", "-m", "seed");
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	function buildConfig(holds: HoldRecord[]) {
		return {
			batchId: "tp199-rul",
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
			maxIterations: 4,
			noProgressLimit: 2,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
			holdStore: createInMemoryHoldStore(holds),
			onSupervisorAlert: (a: {
				category: string;
				summary: string;
				context?: Record<string, unknown>;
			}) => {
				alerts.push(a);
			},
		};
	}

	function buildUnit() {
		const packet = resolvePacketPaths(taskFolder);
		return {
			id: TASK_ID,
			taskId: TASK_ID,
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: TASK_ID,
				taskName: "ruling citation fixture",
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
	}

	/** The mocked worker: commit `commitMsg` and mark the step complete. */
	function workerCommits(commitMsg: string): void {
		onSpawn = () => {
			writeFileSync(join(worktreePath, "work.txt"), `done ${Date.now()}\n`);
			git("add", "-A");
			git("commit", "-q", "-m", commitMsg);
			writeFileSync(join(taskFolder, "STATUS.md"), STATUS_COMPLETE);
		};
	}

	async function run(holds: HoldRecord[]) {
		const unit = buildUnit();
		const config = buildConfig(holds);
		return executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
	}

	it("(a) valid Taskplane-Ruling trailer → no flag, task succeeds", async () => {
		workerCommits("fix(TP-RUL): apply ruled remediation\n\nTaskplane-Ruling: ruling-1\n");
		const r = await run([ruledHold("esc-1", "ruling-1")]);
		assert.equal(r.outcome.status, "succeeded");
		assert.equal(
			alerts.some((a) => a.summary.includes("Ruling citation flagged")),
			false,
			"a valid citation must not be flagged",
		);
		assert.equal(
			auditEntries().some((e) => e.action === "ruling_citation_flagged"),
			false,
		);
	});

	it("(b) unknown ruling id → unknown-ruling flag + audit entry + alert; status unaffected", async () => {
		workerCommits("fix(TP-RUL): claim a ruling\n\nTaskplane-Ruling: ruling-ghost\n");
		const r = await run([]);
		assert.equal(r.outcome.status, "succeeded"); // status UNAFFECTED
		const alert = alerts.find((a) => a.summary.includes("Ruling citation flagged"));
		assert.ok(alert, "expected a ruling-citation alert");
		assert.match(alert!.summary, /ruling-ghost/);
		const entry = auditEntries().find((e) => e.action === "ruling_citation_flagged");
		assert.ok(entry, "expected a ruling_citation_flagged audit entry");
		assert.equal(entry!.classification, "diagnostic");
		assert.match(String(entry!.detail), /unknown-ruling/);
	});

	it("(c) prose 'R004 cap ruling (FIX)' without a trailer → prose-claim flag; status unaffected", async () => {
		workerCommits("R004 cap ruling (FIX)\n\napplied the remediation\n");
		const r = await run([]);
		assert.equal(r.outcome.status, "succeeded"); // status UNAFFECTED
		const alert = alerts.find((a) => a.summary.includes("Ruling citation flagged"));
		assert.ok(alert, "expected a ruling-citation alert");
		const entry = auditEntries().find((e) => e.action === "ruling_citation_flagged");
		assert.ok(entry, "expected a ruling_citation_flagged audit entry");
		assert.match(String(entry!.detail), /prose-claim/);
	});
});
