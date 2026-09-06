/**
 * #630 — Worker exits when an expectsReply escalation goes unanswered; lane-runner
 * relaunched it with the "you exited prematurely — work continuously" nag (the
 * prompt that pushes a holding worker toward self-release), or — with the
 * engine gone — nothing relaunched it and the registry lied.
 *
 * Tier-1 scope (the in-tool wait / first-class `held` state is #627's design):
 *   - a clean exit after an unanswered escalation is a HOLD exit: not counted
 *     toward the no-progress stall limit; relaunch prompt is a hold-resume
 *     prompt; bounded by MAX_HOLD_RELAUNCHES then fails with an explicit
 *     "Hold unresolved" reason + supervisor alert.
 *   - a steer delivered after the escalation clears the hold.
 *   - send_agent_message to a dead-pid agent returns a distinct, actionable error.
 *
 * Behavioural: mocked spawnAgent + real lane-runner; the mock "worker" writes an
 * escalation to its outbox and exits cleanly (exactly what happened).
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
function readSrc(file: string): string {
	return readFileSync(join(HERE, "..", "taskplane", file), "utf-8");
}

let spawnPrompts: string[] = [];
let onSpawn:
	| ((index: number, opts: { mailboxDir?: string; steeringPendingPath?: string | null }) => void)
	| null = null;
/** Optional async hook run by the mock worker BEFORE it "exits" (drives onPrematureExit). */
let beforeExit:
	| ((
			index: number,
			opts: { onPrematureExit?: (m: string) => Promise<string | null> },
	  ) => Promise<void>)
	| null = null;

const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn(
	(opts: { prompt: string; mailboxDir?: string; steeringPendingPath?: string | null }) => {
		const index = spawnPrompts.length;
		spawnPrompts.push(opts.prompt);
		onSpawn?.(index, opts);
		const result = {
			exitCode: 0,
			signal: null,
			durationMs: 800,
			killed: false,
			inputTokens: 5,
			outputTokens: 5,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			costUsd: 0.01,
			toolCalls: 1,
			lastTool: "escalate_to_supervisor",
			retries: 0,
			compactions: 0,
			contextUsage: null,
			error: null,
			agentEnded: true,
			stderrTail: "",
		};
		const promise = (async () => {
			if (beforeExit) await beforeExit(index, opts as never);
			return result;
		})();
		return { promise, kill: () => {} } as unknown as ReturnType<typeof realAgentHost.spawnAgent>;
	},
);
mock.module("../taskplane/agent-host.ts", {
	namedExports: { ...realAgentHost, spawnAgent: mockSpawnAgent },
});

const { executeTaskV2 } = await import("../taskplane/lane-runner.ts");
const { resolvePacketPaths } = await import("../taskplane/types.ts");
const { writeOutboxMessage } = await import("../taskplane/mailbox.ts");

const PROMPT_MD = `# TP-H: Hold fixture

**Created:** 2026-09-06
**Size:** S

## Review Level: 1

## Mission

Hold for a ruling.

## Steps

### Step 1: Implement thing

- [ ] Do the thing
- [ ] Test the thing

## Do NOT

- Nothing.

---
`;

const STATUS_MD = `# TP-H — Status

**Current Step:** Step 1: Implement thing
**Status:** 🟡 In Progress
**Iteration:** 1
**Review Level:** 1
**Review Counter:** 0

---

### Step 1: Implement thing
**Status:** 🟨 In Progress

- [x] Do the thing
- [ ] Test the thing

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---
`;

describe("#630 — hold-aware relaunch (behavioural)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;
	const BATCH = "tp630-hold";
	const AGENT = "orch-test-lane-1-worker";
	let alerts: Array<{ category: string; summary: string; context?: Record<string, unknown> }> = [];

	function buildUnitAndConfig(noProgressLimit = 3) {
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-H",
			taskId: "TP-H",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-H",
				taskName: "Hold fixture",
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
			batchId: BATCH,
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
			noProgressLimit,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
			onSupervisorAlert: (a: {
				category: string;
				summary: string;
				context?: Record<string, unknown>;
			}) => {
				alerts.push(a);
			},
		};
		return { unit, config, packet };
	}

	/** The "worker" files an escalation (expectsReply) and exits cleanly. */
	function escalate(content: string): string {
		const msg = writeOutboxMessage(tmpRoot, BATCH, AGENT, {
			from: AGENT,
			type: "escalate",
			content,
			expectsReply: true,
		});
		return msg.id;
	}

	beforeEach(() => {
		spawnPrompts = [];
		onSpawn = null;
		beforeExit = null;
		alerts = [];
		tmpRoot = mkdtempSync(join(tmpdir(), "tp630-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-H");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("unanswered escalation: hold exits are NOT stalls; relaunch prompt is hold-resume (not the nag); bounded then 'Hold unresolved' + alert", async () => {
		// Every spawn: the worker (re)states it is holding and exits without progress.
		onSpawn = (i) => {
			if (i === 0) escalate("Cap reached at plan-gate round 2; requesting a ruling.");
		};
		const { unit, config } = buildUnitAndConfig(/* noProgressLimit */ 1);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);

		// 1 initial + MAX_HOLD_RELAUNCHES(3) relaunches = 4 spawns (noProgressLimit=1 would
		// otherwise have failed the task as "No progress" after the first exit).
		expect(spawnPrompts.length).toBe(4);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).not.toContain("No progress after");
		expect(status).toContain("Hold exit");
		// Relaunch prompts are hold-resume prompts, never the premature-exit nag.
		for (const p of spawnPrompts.slice(1)) {
			expect(p).toContain("YOU ARE ON HOLD awaiting a supervisor ruling");
			expect(p).toContain("do NOT proceed past the hold");
			expect(p).not.toContain("CRITICAL: You have exited");
			expect(p).not.toContain("Work continuously through ALL remaining checkboxes");
		}
		// Bounded: fails with an explicit governance reason + supervisor alert.
		expect(result.outcome.status).toBe("failed");
		expect(result.outcome.exitReason).toContain("Hold unresolved");
		expect(result.outcome.exitReason).toContain("no supervisor reply");
		expect(status).toContain("Held — ruling outstanding");
		const hold = alerts.find((a) => a.summary.includes("Hold unresolved"));
		expect(hold !== undefined).toBe(true);
		expect(hold!.category).toBe("task-failure");
		expect(String(hold!.context?.messageId ?? "")).not.toBe("");
	});

	it("a steer delivered AFTER the escalation clears the hold; the next relaunch gets the normal prompt", async () => {
		onSpawn = (i, opts) => {
			if (i === 0) escalate("Need a ruling on scope.");
			if (i === 1 && opts.steeringPendingPath) {
				// The supervisor replied during this session: agent-host appends the
				// delivered steer to .steering-pending.
				writeFileSync(
					opts.steeringPendingPath,
					`${JSON.stringify({ ts: Date.now() + 1000, content: "Ruling: proceed with option B", id: "m-1" })}\n`,
				);
			}
		};
		const { unit, config } = buildUnitAndConfig(/* noProgressLimit */ 2);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		// Spawn 0: escalates (hold exit → relaunch). Spawn 1: hold-resume prompt; a
		// steer arrives → hold cleared. Spawns 2..: normal iterations; with no
		// progress they now count toward the stall limit (2) → task blocked.
		expect(spawnPrompts[1]).toContain("YOU ARE ON HOLD");
		expect(spawnPrompts[2]).not.toContain("YOU ARE ON HOLD");
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).toContain("⚠️ Steering");
		expect(result.outcome.exitReason).toContain("No progress"); // normal stall semantics resumed
		expect(result.outcome.exitReason).not.toContain("Hold unresolved");
	});
});

describe("#630 — Sage blockers (behavioural)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;
	const BATCH = "tp630-b";
	const AGENT = "orch-test-lane-1-worker";
	let alerts: Array<{ category: string; summary: string }> = [];

	function buildUnitAndConfig(noProgressLimit = 3) {
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-H",
			taskId: "TP-H",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-H",
				taskName: "Hold fixture",
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
			batchId: BATCH,
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
			noProgressLimit,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
			onSupervisorAlert: (a: { category: string; summary: string }) => {
				alerts.push(a);
			},
		};
		return { unit, config };
	}

	beforeEach(() => {
		spawnPrompts = [];
		onSpawn = null;
		beforeExit = null;
		alerts = [];
		tmpRoot = mkdtempSync(join(tmpdir(), "tp630b-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-H");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("BLOCKER 1: a ruling consumed by the exit-intercept path releases the hold", async () => {
		const { writeMailboxMessage } = await import("../taskplane/mailbox.ts");
		onSpawn = (i) => {
			if (i === 0) {
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "Need a ruling.",
					expectsReply: true,
				});
			}
		};
		// Spawn 1 (hold-resume relaunch): the worker "tries to exit"; agent-host calls
		// onPrematureExit, which polls the INBOX (not .steering-pending) and returns the
		// supervisor reply as the next prompt. Drive exactly that path.
		beforeExit = async (i, opts) => {
			if (i === 1 && opts.onPrematureExit) {
				setTimeout(() => {
					writeMailboxMessage(tmpRoot, BATCH, AGENT, {
						from: "supervisor",
						type: "steer",
						content: "Ruling: proceed with option A and re-run the review.",
					});
				}, 300);
				const reprompt = await opts.onPrematureExit("I am holding for a ruling.");
				expect(reprompt).toContain("Ruling: proceed with option A");
			}
		};
		const { unit, config } = buildUnitAndConfig(2);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).toContain("Exit intercept reprompt");
		expect(spawnPrompts[1]).toContain("YOU ARE ON HOLD"); // relaunch 1 was a hold-resume
		// The hold was released by the intercept path: spawn 2 is a normal prompt and the
		// task ends via ordinary stall accounting, NOT 'Hold unresolved'.
		expect(spawnPrompts[2]).not.toContain("YOU ARE ON HOLD");
		expect(result.outcome.exitReason).not.toContain("Hold unresolved");
	});

	it("BLOCKER 1b (first-spawn variant): escalation still in the outbox when the intercept consumes the ruling → no hold is (re)created", async () => {
		const { writeMailboxMessage } = await import("../taskplane/mailbox.ts");
		// Spawn 0: the worker writes an escalation and IMMEDIATELY tries to exit —
		// the intercept consumes the ruling BEFORE the outbox has been drained.
		beforeExit = async (i, opts) => {
			if (i === 0 && opts.onPrematureExit) {
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "Need a ruling (first spawn).",
					expectsReply: true,
				});
				await new Promise((r) => setTimeout(r, 20)); // ensure reply ts > escalation ts
				setTimeout(() => {
					writeMailboxMessage(tmpRoot, BATCH, AGENT, {
						from: "supervisor",
						type: "steer",
						content: "Ruling: proceed; the plan is approved as-is.",
					});
				}, 300);
				const reprompt = await opts.onPrematureExit("Holding.");
				expect(reprompt).toContain("Ruling: proceed");
			}
		};
		const { unit, config } = buildUnitAndConfig(1);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		// The later drain sees an escalation OLDER than the accepted reply → no hold:
		// ordinary stall accounting (limit 1) ends the task after the first spawn.
		expect(spawnPrompts.length).toBe(1);
		expect(result.outcome.exitReason).toContain("No progress");
		expect(result.outcome.exitReason).not.toContain("Hold unresolved");
	});

	it("HARDENING: an OLDER reply cannot suppress a genuinely NEWER escalation", async () => {
		onSpawn = (i, opts) => {
			if (i === 0 && opts.steeringPendingPath) {
				// A steer delivered first (older) …
				writeFileSync(
					opts.steeringPendingPath,
					`${JSON.stringify({ ts: Date.now() - 5000, content: "earlier unrelated steer", id: "m-0" })}\n`,
				);
				// … then the worker escalates (newer).
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "New question after that steer.",
					expectsReply: true,
				});
			}
		};
		const { unit, config } = buildUnitAndConfig(1);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		// The newer escalation holds: 1 + 3 relaunches, then the explicit governance failure.
		expect(spawnPrompts.length).toBe(4);
		expect(result.outcome.exitReason).toContain("Hold unresolved");
	});

	it("BLOCKER 2: a reply created after the escalation but before its drain still counts (causal timestamps)", async () => {
		// Escalation message timestamp T0; steering entry timestamp T0+1 written BEFORE
		// the escalation is drained (both land in the same post-exit processing).
		onSpawn = (i, opts) => {
			if (i === 0) {
				const msg = writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "Ruling needed.",
					expectsReply: true,
				});
				if (opts.steeringPendingPath) {
					writeFileSync(
						opts.steeringPendingPath,
						`${JSON.stringify({ ts: msg.timestamp + 1, content: "Ruling: go.", id: "m-2" })}\n`,
					);
				}
			}
		};
		const { unit, config } = buildUnitAndConfig(1);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		// Hold released in the same pass → ordinary no-progress accounting (limit 1) → stall, not a hold failure.
		expect(result.outcome.exitReason).toContain("No progress");
		expect(result.outcome.exitReason).not.toContain("Hold unresolved");
		expect(spawnPrompts.length).toBe(1);
	});

	it("BLOCKER 3: pre-existing uncommitted work (real git) does not mask hold exits — bound still 1+3 spawns", async () => {
		const { execSync } = await import("node:child_process");
		// Make the worktree a real git repo with a committed file and a DIRTY change.
		execSync("git init -q", { cwd: worktreePath });
		execSync("git config user.email t@t && git config user.name t", { cwd: worktreePath });
		writeFileSync(join(worktreePath, "src.ts"), "export const a = 1;\n");
		execSync("git add -A && git commit -q -m init", { cwd: worktreePath });
		writeFileSync(join(worktreePath, "src.ts"), "export const a = 2; // uncommitted\n");
		onSpawn = (i) => {
			if (i === 0) {
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "Holding.",
					expectsReply: true,
				});
			}
		};
		const { unit, config } = buildUnitAndConfig(3);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		expect(spawnPrompts.length).toBe(4); // NOT maxIterations (10) via soft-progress masking
		expect(result.outcome.exitReason).toContain("Hold unresolved");
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).not.toContain("Soft progress");
	});
});

describe("#630 — wiring", () => {
	it("send_agent_message to a dead-pid agent returns a distinct, actionable error (pid, last-seen, resume hint)", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(/is DEAD: its process \(PID \$\{manifest\.pid\}\) no longer exists/.test(flat)).toBe(true);
		expect(flat).toContain(
			"Do NOT hand-edit registry.json. orch_resume(force=true) reconciles the dead worker",
		);
		// It runs BEFORE the generic unknown-session validation.
		const src = readSrc("extension.ts");
		const dead = src.indexOf("is DEAD: its process");
		const unknown = src.indexOf("Build valid runtime agent IDs (registry-first, legacy fallback).");
		expect(dead).toBeGreaterThan(-1);
		expect(unknown).toBeGreaterThan(dead);
	});

	it("lane-runner: hold state is recorded on escalation surfacing and cleared on a later steer", () => {
		const flat = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		// Only an escalation NEWER than the last supervisor reply creates a hold.
		expect(flat).toContain('if (msg.type === "escalate" && msg.timestamp > lastSupervisorReplyTs) {');
		expect(flat).toContain(
			"pendingEscalation = { id: msg.id, ts: msg.timestamp, preview: sanitized };",
		);
		// The exit-intercept's accepted reply advances the reply watermark and releases the hold.
		expect(flat).toContain(
			"lastSupervisorReplyTs = Math.max(lastSupervisorReplyTs, acceptedReplyTs || Date.now());",
		);
		expect(flat).toContain(
			"if (pendingEscalation && entry.ts >= pendingEscalation.ts) { pendingEscalation = null; holdRelaunches = 0; }",
		);
		expect(readSrc("lane-runner.ts")).toContain("const MAX_HOLD_RELAUNCHES = 3;");
	});
});
