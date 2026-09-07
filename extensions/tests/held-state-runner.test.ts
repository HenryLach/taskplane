/**
 * #627 — first-class `held` state: lane-runner behavioural suite.
 *
 * Real lane-runner (`executeTaskV2`), real mailbox, real hold store over a
 * mutable owner; only `spawnAgent` is mocked. Each scenario drives the runner
 * through worker "sessions" (the mock) and supervisor mail (files), and
 * asserts on the returned outcome, the persisted hold table, STATUS.md, the
 * spawned prompts and the supervisor alerts.
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect } from "./expect.ts";

let spawnPrompts: string[] = [];
let onSpawn: ((index: number) => void | Promise<void>) | null = null;

const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn((opts: { prompt: string }) => {
	const index = spawnPrompts.length;
	spawnPrompts.push(opts.prompt);
	const result = {
		exitCode: 0,
		signal: null,
		durationMs: 500,
		killed: false,
		inputTokens: 5,
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
	const promise = (async () => {
		await onSpawn?.(index);
		return result;
	})();
	return { promise, kill: () => {} } as unknown as ReturnType<typeof realAgentHost.spawnAgent>;
});
mock.module("../taskplane/agent-host.ts", {
	namedExports: { ...realAgentHost, spawnAgent: mockSpawnAgent },
});

const { executeTaskV2 } = await import("../taskplane/lane-runner.ts");
const { resolvePacketPaths } = await import("../taskplane/types.ts");
const { writeOutboxMessage, writeMailboxMessage, sessionInboxDir } = await import(
	"../taskplane/mailbox.ts"
);
const { createHoldStore } = await import("../taskplane/hold-state.ts");
type HoldRecord = import("../taskplane/hold-state.ts").HoldRecord;
const { resolveTaskMonitorState } = await import("../taskplane/execution.ts");

const PROMPT_MD = `# TP-H: Hold fixture

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

**Status:** 🔄 In Progress

---

### Step 1: Implement thing

- [x] Do the thing
- [ ] Test the thing

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---
`;

describe("#627 — held state (lane-runner behavioural)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;
	const BATCH = "tp627";
	const AGENT = "orch-test-lane-1-worker";
	let alerts: Array<{ category: string; summary: string; context?: Record<string, unknown> }> = [];
	let owner: { holds?: HoldRecord[] };
	let persistCount: number;
	let failPersist: boolean;

	function buildUnitAndConfig(over: Record<string, unknown> = {}) {
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
		const holdStore = createHoldStore(owner, () => {
			if (failPersist) throw new Error("disk full");
			persistCount++;
		});
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
			maxIterations: 6,
			noProgressLimit: 2,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
			holdStore,
			holdPollIntervalMs: 50,
			holdTimeoutMinutes: 240,
			onSupervisorAlert: (a: {
				category: string;
				summary: string;
				context?: Record<string, unknown>;
			}) => {
				alerts.push(a);
			},
			...over,
		};
		return { unit, config, packet, holdStore };
	}

	function run(
		config: unknown,
		unit: unknown,
		pause: { paused: boolean; cause?: string } = { paused: false },
	) {
		return executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as Parameters<typeof executeTaskV2>[1],
			pause as Parameters<typeof executeTaskV2>[2],
		);
	}

	/** The "worker" files an escalation (expectsReply). */
	function escalate(content: string): string {
		return writeOutboxMessage(tmpRoot, BATCH, AGENT, {
			from: AGENT,
			type: "escalate",
			content,
			expectsReply: true,
		}).id;
	}
	/** Supervisor mail into the worker's inbox. */
	function mail(type: string, content: string, extra: Record<string, unknown> = {}) {
		return writeMailboxMessage(tmpRoot, BATCH, AGENT, {
			from: "supervisor",
			type: type as never,
			content,
			...extra,
		});
	}
	function ruling(
		replyTo: string,
		content = "Ruling: fix it, do not accept",
		actor = { role: "supervisor", id: "sup" },
	) {
		return mail("ruling", content, { replyTo, actor });
	}
	function checkBox() {
		writeFileSync(
			join(taskFolder, "STATUS.md"),
			status().replace("- [ ] Test the thing", "- [x] Test the thing"),
		);
	}
	function status(): string {
		return readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
	}
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	function holds(): HoldRecord[] {
		return owner.holds ?? [];
	}
	/** Wait until the runner has entered the hold loop (snapshot says held). */
	async function untilHeld(timeoutMs = 3000) {
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs) {
			if (status().includes("| Held |")) return;
			await sleep(20);
		}
		throw new Error("runner did not publish Held");
	}

	beforeEach(() => {
		spawnPrompts = [];
		onSpawn = null;
		alerts = [];
		owner = { holds: [] };
		persistCount = 0;
		failPersist = false;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp627-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-H");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
	});

	afterEach((t) => {
		if (process.env.HOLD_DEBUG && t.name) {
			try {
				console.error("STATUS>>", status());
				console.error("HOLDS>>", JSON.stringify(owner.holds));
				console.error(
					"ALERTS>>",
					alerts.map((a) => a.summary.slice(0, 80)),
				);
			} catch {}
		}
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("escalation opens a durable hold BEFORE the outbox message is acked; worker exit enters the hold loop with NO relaunch; ruling releases and is delivered in the next worker's INITIAL input; acknowledgement restores completion", async () => {
		let escId = "";
		onSpawn = async (i) => {
			if (i === 0) escId = escalate("Cap reached at gate round 2; P1 remains. Fix or accept?");
			if (i === 1) {
				// The relaunched worker must see the ruling first, then acknowledge it,
				// then finish the work.
				expect(spawnPrompts[1].startsWith("## Ruling received")).toBe(true);
				expect(spawnPrompts[1]).toContain("Ruling: fix it, do not accept");
				expect(spawnPrompts[1]).toContain(`resolves escalation ${escId}`);
				const rulingId = holds()[0].ruling!.id;
				expect(spawnPrompts[1]).toContain(`replyTo="${rulingId}"`);
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "reply",
					content: "ack ruling",
					replyTo: rulingId,
				});
				checkBox();
			}
		};
		const { unit, config } = buildUnitAndConfig();
		const p = run(config, unit);

		await untilHeld();
		// Persisted before ack: the hold exists, the escalation is no longer pending in the outbox.
		expect(holds().length).toBe(1);
		expect(holds()[0].escalationId).toBe(escId);
		expect(holds()[0].phase).toBe("open");
		expect(holds()[0].escalation).toContain("Fix or accept?"); // full text
		expect(persistCount).toBeGreaterThan(0);
		expect(spawnPrompts.length).toBe(1); // no relaunch while held
		expect(status()).toContain("Hold opened");
		expect(status()).toContain("Held — awaiting ruling");
		expect(
			alerts.some((a) => a.summary.includes("Lane held") && a.summary.includes("zero cost")),
		).toBe(true);

		// A steer is ordinary mail — it does not release.
		mail("steer", "please continue");
		await sleep(200);
		expect(holds()[0].phase).toBe("open");
		expect(spawnPrompts.length).toBe(1);

		// An info acknowledges without releasing or moving the deadline.
		const deadline = holds()[0].deadline;
		mail("info", "seen, operator consulted");
		await sleep(200);
		expect(holds()[0].phase).toBe("open");
		expect(holds()[0].deadline).toBe(deadline);
		expect(holds()[0].lastAcknowledgedAt).toBeGreaterThan(0);
		expect(status()).toContain("Hold acknowledged");

		// The ruling releases; the worker is relaunched with it; ack completes.
		ruling(escId);
		const result = await p;
		expect(result.outcome.status).toBe("succeeded");
		expect(spawnPrompts.length).toBe(2);
		const h = holds()[0];
		expect(h.phase).toBe("released");
		expect(h.ruling?.actor.role).toBe("supervisor");
		expect(h.ruling?.replyTo).toBe(escId);
		expect(h.deliveryState).toBe("acknowledged");
		expect(status()).toContain("Ruling accepted");
		expect(status()).toContain("Ruling delivered");
		expect(status()).toContain("Ruling acknowledged");
		expect(status()).not.toContain("No progress");
	});

	it("a ruling without replyTo, for another unit, or without a trusted actor is rejected (consumed + alerted) and the hold stays open", async () => {
		let escId = "";
		onSpawn = (i) => {
			if (i === 0) escId = escalate("need ruling");
		};
		const { unit, config } = buildUnitAndConfig();
		const p = run(config, unit);
		await untilHeld();

		mail("ruling", "no replyTo", { actor: { role: "supervisor", id: "s" } });
		mail("ruling", "wrong escalation", {
			replyTo: "esc-unknown",
			actor: { role: "supervisor", id: "s" },
		});
		mail("ruling", "no actor", { replyTo: escId });
		mail("ruling", "bad role", { replyTo: escId, actor: { role: "worker", id: "w" } });
		await sleep(300);
		expect(holds()[0].phase).toBe("open");
		expect(spawnPrompts.length).toBe(1);
		const rejected = alerts.filter((a) => a.summary.includes("Ruling rejected"));
		expect(rejected.length).toBe(4);
		expect(status()).toContain("Ruling rejected");
		// rejected rulings are consumed (not re-processed every poll)
		const inbox = sessionInboxDir(tmpRoot, BATCH, AGENT);
		expect(readdirSync(inbox).filter((f) => f.endsWith(".msg.json")).length).toBe(0);

		// then a correct operator ruling releases
		ruling(escId, "Operator ruling: accept the P1 as documented risk", {
			role: "operator",
			id: "henry",
		});
		onSpawn = (i) => {
			if (i === 1) {
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "reply",
					content: "ack",
					replyTo: holds()[0].ruling!.id,
				});
				checkBox();
			}
		};
		const result = await p;
		expect(result.outcome.status).toBe("succeeded");
		expect(holds()[0].ruling?.actor.role).toBe("operator");
	});

	it("query is answered by the runner from stored state — no spawn, no release", async () => {
		onSpawn = (i) => {
			if (i === 0) escalate("q?");
		};
		const { unit, config } = buildUnitAndConfig();
		const pause = { paused: false };
		const p = run(config, unit, pause);
		await untilHeld();
		mail("query", "status?");
		await sleep(250);
		const ans = alerts.find((a) => a.summary.includes("Hold status"));
		expect(ans !== undefined).toBe(true);
		expect(ans!.summary).toContain("answered by the runner (no worker spawned)");
		expect(ans!.summary).toContain("open, 2");
		expect(spawnPrompts.length).toBe(1);
		expect(holds()[0].phase).toBe("open");
		pause.paused = true; // unwind
		const r = await p;
		expect(r.outcome.status).toBe("held");
	});

	it("abort cancels the hold (never approves) and fails the task; completion authority is not blocked afterwards", async () => {
		onSpawn = (i) => {
			if (i === 0) escalate("abort me");
		};
		const { unit, config } = buildUnitAndConfig();
		const p = run(config, unit);
		await untilHeld();
		mail("abort", "operator cancelled the packet");
		const r = await p;
		expect(r.outcome.status).toBe("failed");
		expect(r.outcome.exitReason).toContain("Hold cancelled");
		expect(holds()[0].phase).toBe("cancelled");
		expect(holds()[0].cancelReason).toContain("operator cancelled");
		expect(spawnPrompts.length).toBe(1);
	});

	it("pause during a hold unwinds with a `held` outcome; the hold and the STATUS line survive; a fresh run resumes the hold WITHOUT spawning and still honours the ruling", async () => {
		let escId = "";
		onSpawn = (i) => {
			if (i === 0) escId = escalate("pause me");
		};
		const { unit, config, holdStore } = buildUnitAndConfig();
		const pause = { paused: false, cause: undefined as string | undefined };
		const p = run(config, unit, pause);
		await untilHeld();
		pause.paused = true;
		pause.cause = "operator";
		const r1 = await p;
		expect(r1.outcome.status).toBe("held");
		expect(r1.outcome.exitReason).toContain("batch paused (operator)");
		expect(holds()[0].phase).toBe("open");

		// New lane run over the same durable table (what resume does): no spawn
		// until a ruling; the ruling is then delivered in the initial input.
		spawnPrompts = [];
		onSpawn = (i) => {
			if (i === 0) {
				expect(spawnPrompts[0].startsWith("## Ruling received")).toBe(true);
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "reply",
					content: "ack",
					replyTo: holds()[0].ruling!.id,
				});
				checkBox();
			}
		};
		const { unit: u2, config: c2 } = buildUnitAndConfig({ holdStore });
		const p2 = run(c2, u2);
		await sleep(300);
		expect(spawnPrompts.length).toBe(0); // resumed straight into the hold loop
		ruling(escId);
		const r2 = await p2;
		expect(r2.outcome.status).toBe("succeeded");
		expect(spawnPrompts.length).toBe(1);
	});

	it("deadline expiry parks the batch (pause cause hold-timeout), keeps the hold OPEN and returns `held` — acks never extend the deadline", async () => {
		onSpawn = (i) => {
			if (i === 0) escalate("slow ruling");
		};
		const { unit, config } = buildUnitAndConfig({ holdTimeoutMinutes: 5 });
		const pause = { paused: false, cause: undefined as string | undefined };
		// Shorten the deadline after the hold opens by editing the durable record
		// (the store owner is ours): deadline in 300ms.
		const p = run(config, unit, pause);
		await untilHeld();
		owner.holds![0] = { ...owner.holds![0], deadline: Date.now() + 300 };
		mail("info", "ack"); // must not extend
		const r = await p;
		expect(r.outcome.status).toBe("held");
		expect(r.outcome.exitReason).toContain("Hold timeout");
		expect(pause.paused).toBe(true);
		expect(pause.cause).toBe("hold-timeout");
		expect(holds()[0].phase).toBe("open");
		expect(holds()[0].expiredAt).toBeGreaterThan(0);
		expect(
			alerts.some((a) => a.summary.includes("Hold timeout") && a.category === "task-failure"),
		).toBe(true);
		expect(spawnPrompts.length).toBe(1);
	});

	it("Sage blocker 1: a ruling queued while the hold was EXPIRED/parked is consumed on the next run instead of re-parking with the ruling unread", async () => {
		let escId = "";
		onSpawn = (i) => {
			if (i === 0) escId = escalate("slow ruling");
		};
		const { unit, config, holdStore } = buildUnitAndConfig({ holdTimeoutMinutes: 5 });
		const pause = { paused: false, cause: undefined as string | undefined };
		const p = run(config, unit, pause);
		await untilHeld();
		owner.holds![0] = { ...owner.holds![0], deadline: Date.now() - 1 };
		const r1 = await p;
		expect(r1.outcome.status).toBe("held");
		expect(pause.cause).toBe("hold-timeout");
		expect(holds()[0].expiredAt).toBeGreaterThan(0);

		// While parked, the supervisor rules. Then the operator resumes.
		ruling(escId, "Ruling after the deadline");
		spawnPrompts = [];
		onSpawn = (i) => {
			if (i === 0) {
				expect(spawnPrompts[0]).toContain("Ruling after the deadline");
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "reply",
					content: "ack",
					replyTo: holds()[0].ruling!.id,
				});
				checkBox();
			}
		};
		const { unit: u2, config: c2 } = buildUnitAndConfig({ holdStore, holdTimeoutMinutes: 5 });
		const r2 = await run(c2, u2, { paused: false });
		expect(r2.outcome.status).toBe("succeeded");
		expect(holds()[0].phase).toBe("released");
		expect(alerts.filter((a) => a.summary.includes("Hold timeout")).length).toBe(1); // no second park
	});

	it("Sage blocker 2: a held return from the post-loop (iteration budget exhausted, ruling never acknowledged) PARKS the batch instead of leaving the wave monitor waiting forever", async () => {
		let escId = "";
		onSpawn = (i) => {
			if (i === 0) escId = escalate("never acked");
			// every later worker checks the box but never acknowledges the ruling
			if (i >= 1) checkBox();
		};
		const { unit, config } = buildUnitAndConfig({ maxIterations: 3, noProgressLimit: 10 });
		const pause = { paused: false, cause: undefined as string | undefined };
		const p = run(config, unit, pause);
		await untilHeld();
		ruling(escId);
		const r = await p;
		expect(r.outcome.status).toBe("held");
		expect(r.outcome.exitReason).toContain("Iteration budget exhausted");
		expect(pause.paused).toBe(true);
		expect(pause.cause).toBe("hold-timeout");
		expect(holds()[0].deliveryState).toBe("in-flight");
		expect(alerts.some((a) => a.summary.includes("iteration budget exhausted**"))).toBe(true);
		expect(status()).not.toMatch(/\*\*Status:\*\* ✅ Complete/);
		expect(existsSync(join(taskFolder, ".DONE"))).toBe(false);
	});

	it("Sage blocker 6: an escalation stamped for ANOTHER unit in this lane's outbox is left alone (no hold under the wrong task, not acked)", async () => {
		onSpawn = (i) => {
			if (i === 0) {
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "belongs to TP-OTHER",
					expectsReply: true,
					scope: { taskId: "TP-OTHER", segmentId: null },
				});
				checkBox();
			}
		};
		const { unit, config } = buildUnitAndConfig();
		const r = await run(config, unit);
		expect(r.outcome.status).toBe("succeeded");
		expect(holds().length).toBe(0);
		expect(status()).toContain("Escalation not for this unit");
		const outboxDir = join(tmpRoot, ".pi", "mailbox", BATCH, AGENT, "outbox");
		expect(readdirSync(outboxDir).filter((f) => f.endsWith(".msg.json")).length).toBe(1);
	});

	it("a worker-written .DONE while held is quarantined, never accepted; step check-off is withheld; the monitor reports `held` instead of succeeded/stalled", async () => {
		onSpawn = (i) => {
			if (i === 0) {
				escalate("hold but I'm done");
				// the worker checks everything and writes .DONE anyway (TP-2037 class)
				checkBox();
				writeFileSync(join(taskFolder, ".DONE"), "done!");
			}
		};
		const { unit, config, packet } = buildUnitAndConfig();
		const pause = { paused: false };
		const p = run(config, unit, pause);
		await untilHeld();
		expect(existsSync(packet.donePath)).toBe(false);
		expect(readdirSync(taskFolder).some((f) => f.startsWith(".DONE.unauthorized-"))).toBe(true);
		expect(status()).toContain(".DONE quarantined");
		expect(status()).not.toContain("✅ Complete");

		// Monitor: hold-first.
		const { evaluateCompletionAuthority } = await import("../taskplane/hold-state.ts");
		writeFileSync(join(taskFolder, ".DONE"), "done again");
		const tracker = {
			lastMtime: 0,
			stallTimerStart: Date.now() - 999_999,
			statusFileSeenOnce: true,
			firstObservedAt: 0,
		};
		const snap = await resolveTaskMonitorState(
			"TP-H",
			packet.donePath,
			AGENT,
			{ parsed: null, error: null },
			tracker as never,
			60_000,
			Date.now(),
			undefined,
			undefined,
			undefined,
			evaluateCompletionAuthority(holds(), "TP-H", null),
		);
		expect(snap.status).toBe("held");
		expect(snap.sessionAlive).toBe(true);
		expect(tracker.stallTimerStart).toBe(null);

		pause.paused = true;
		const r = await p;
		expect(r.outcome.status).toBe("held");
	});

	it("hold persistence failure is fail-closed: the escalation stays in the outbox (not acked), an alert fires, and the next drain retries", async () => {
		let escId = "";
		onSpawn = async (i) => {
			if (i === 0) {
				failPersist = true;
				escId = escalate("persist me");
			}
		};
		const { unit, config } = buildUnitAndConfig();
		const pause = { paused: false };
		const p = run(config, unit, pause);
		// give the live drain a moment, then the worker exits; post-exit drain also fails
		await sleep(400);
		expect(holds().length).toBe(0);
		expect(status()).toContain("Hold persist failed");
		expect(alerts.some((a) => a.summary.includes("Hold could not be persisted"))).toBe(true);
		// The message is still pending in the outbox (not moved to processed/).
		const outboxDir = join(tmpRoot, ".pi", "mailbox", BATCH, AGENT, "outbox");
		expect(readdirSync(outboxDir).some((f) => f.startsWith(escId))).toBe(true);
		// Recovery: the disk comes back; a later drain (next iteration) records the hold.
		failPersist = false;
		await untilHeld(5000);
		expect(holds().length).toBe(1);
		pause.paused = true;
		await p;
	});

	it("ruling not acknowledged by the relaunched worker is replayed in the following initial input (at-least-once), and completion stays withheld until acknowledged", async () => {
		let escId = "";
		onSpawn = (i) => {
			if (i === 0) escId = escalate("replay me");
			if (i === 1) {
				// worker checks the box but never acknowledges the ruling
				checkBox();
			}
			if (i === 2) {
				expect(spawnPrompts[2].startsWith("## Ruling received")).toBe(true);
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "reply",
					content: "ack",
					replyTo: holds()[0].ruling!.id,
				});
			}
		};
		const { unit, config } = buildUnitAndConfig();
		const p = run(config, unit);
		await untilHeld();
		ruling(escId);
		const r = await p;
		expect(r.outcome.status).toBe("succeeded");
		expect(spawnPrompts.length).toBe(3);
		expect(status()).toContain("Ruling not acknowledged");
		expect(status()).toContain("Ruling delivery iteration");
		expect(holds()[0].deliveryState).toBe("acknowledged");
	});
});
