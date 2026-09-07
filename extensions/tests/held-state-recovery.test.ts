/**
 * #627 Stage 1c — recovery seams around the held state:
 *   - resume reconciliation is hold-first (durable table + unrecorded outbox escalations)
 *   - outbox drains preserve escalations (takeover / hard-fail paths)
 *   - engine pre-cleanup preserves worktrees while holds are unresolved
 *   - supervisor tools: ruling form + held-unit target, retry/force-merge refusals,
 *     operator command (source wiring — tool bodies are closures inside activate())
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";
import {
	pinHeldSegments,
	reconcileTaskStates,
	replayUnrecordedEscalations,
} from "../taskplane/resume.ts";
import { reconstructHoldsFromMailbox } from "../taskplane/hold-state.ts";
import { quarantineUnauthorizedDoneMarkers } from "../taskplane/resume.ts";
import { readOutboxStrict } from "../taskplane/mailbox.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { drainAgentOutbox, writeOutboxMessage, sessionOutboxDir } from "../taskplane/mailbox.ts";
import { applyRuling, createHoldRecord, type HoldRecord } from "../taskplane/hold-state.ts";
import type { PersistedBatchState } from "../taskplane/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
function readSrc(file: string): string {
	return readFileSync(join(HERE, "..", "taskplane", file), "utf-8");
}

function hold(over: Partial<HoldRecord> = {}): HoldRecord {
	return {
		...createHoldRecord({
			escalation: { id: "esc-1", content: "need ruling", timestamp: 1 },
			batchId: "b",
			taskId: "TP-1",
			segmentId: null,
			executionId: "e",
			agentId: "orch-op-lane-1-worker",
			laneNumber: 1,
			holdTimeoutMinutes: 240,
			now: 1,
		}),
		...over,
	};
}

function state(tasks: Array<Partial<PersistedBatchState["tasks"][number]>>): PersistedBatchState {
	return {
		tasks: tasks.map((t) => ({
			taskId: "TP-1",
			laneNumber: 1,
			sessionName: "orch-op-lane-1",
			status: "running",
			taskFolder: "",
			startedAt: 1,
			endedAt: null,
			doneFileFound: false,
			exitReason: "",
			...t,
		})),
	} as unknown as PersistedBatchState;
}

describe("#627 — resume reconciliation is hold-first", () => {
	it("a hold-blocked task with a stale .DONE and a dead session is re-executed as held, never mark-complete", () => {
		const r = reconcileTaskStates(
			state([{ taskId: "TP-1" }]),
			new Set(),
			new Set(["TP-1"]), // .DONE present
			new Set(["TP-1"]), // worktree exists
			new Set(["TP-1"]), // hold-blocked
		);
		expect(r[0].action).toBe("re-execute");
		expect(r[0].liveStatus).toBe("held");
		expect(r[0].doneFileFound).toBe(true); // observed, not obeyed
	});

	it("hold-blocked without a worktree stays pending (re-allocated, then held); non-blocked tasks keep the old precedence", () => {
		const r = reconcileTaskStates(
			state([{ taskId: "TP-1" }, { taskId: "TP-2", sessionName: "orch-op-lane-2" }]),
			new Set(),
			new Set(["TP-2"]),
			new Set(),
			new Set(["TP-1"]),
		);
		expect(r[0].action).toBe("pending");
		expect(r[0].liveStatus).toBe("held");
		expect(r[1].action).toBe("mark-complete");
	});

	it("a persisted `held` status with no table entry falls through to re-execute (worktree) — never terminal", () => {
		const r = reconcileTaskStates(
			state([{ taskId: "TP-1", status: "held" }]),
			new Set(),
			new Set(),
			new Set(["TP-1"]),
		);
		expect(r[0].action).toBe("re-execute");
	});
});

describe("#627 — outbox drains preserve escalations", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "tp627-drain-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("drainAgentOutbox moves replies to processed/ but leaves escalate messages in place by default", () => {
		const esc = writeOutboxMessage(root, "b", "a1", {
			from: "a1",
			type: "escalate",
			content: "hold",
			expectsReply: true,
		});
		writeOutboxMessage(root, "b", "a1", { from: "a1", type: "reply", content: "fyi" });
		const n = drainAgentOutbox(root, "b", "a1");
		expect(n).toBe(1);
		const remaining = readdirSync(sessionOutboxDir(root, "b", "a1")).filter((f) =>
			f.endsWith(".msg.json"),
		);
		expect(remaining.length).toBe(1);
		expect(remaining[0].startsWith(esc.id)).toBe(true);
		// explicit teardown may drain everything
		expect(drainAgentOutbox(root, "b", "a1", { preserveEscalations: false })).toBe(1);
		expect(
			existsSync(join(sessionOutboxDir(root, "b", "a1"), "processed", `${esc.id}.msg.json`)),
		).toBe(true);
	});
});

describe("#627 — wiring: engine, resume, extension", () => {
	const engine = readSrc("engine.ts").replace(/\s+/g, " ");
	const resume = readSrc("resume.ts").replace(/\s+/g, " ");
	const ext = readSrc("extension.ts").replace(/\s+/g, " ");
	const exec = readSrc("execution.ts").replace(/\s+/g, " ");

	it("engine: hold store is strict, threaded into every executeWave call, and unresolved holds preserve worktrees", () => {
		expect(engine).toContain(
			"const holdStore = createHoldStore(batchState, (reason) => persistRuntimeStateStrict(",
		);
		const calls = engine.split("await executeWave(").length - 1;
		const passes = engine.split("onLaneRespawned ?? undefined, holdStore, );").length - 1;
		expect(calls).toBe(2);
		expect(passes).toBe(2);
		expect(engine).toContain(
			"if (!preserveWorktreesForResume && (batchState.holds ?? []).some(isHoldUnresolved)) {",
		);
		expect(engine).toContain(
			"(waveResult.pausedTaskIds?.length ?? 0) > 0 || heldIds.length > 0 || operatorPaused",
		);
	});

	it("execution: monitor consults hold authority before .DONE; tally exposes heldTaskIds; held lane leaves tasks pending", () => {
		expect(exec.indexOf("Priority 0 (#627): hold-blocked → held")).toBeLessThan(
			exec.indexOf("Priority 1: .DONE file found"),
		);
		expect(exec).toContain("if (holdAuthority?.blocked) { tracker.stallTimerStart = null;");
		expect(exec).toContain('} else if (t.status === "held") {');
		expect(exec).toContain(
			'status: (pauseSignal.paused || laneHeld) && !shouldSkipRemaining ? "pending" : "skipped"',
		);
	});

	it("resume: holds restored verbatim; hold-first set from table + unrecorded outbox escalations; lane-parallel re-execution; held outcome preserved", () => {
		expect(resume).toContain(
			"batchState.holds = (persistedState.holds ?? []).map((h) => ({ ...h }));",
		);
		expect(resume).toContain(
			"if (taskCompletionBlocked(persistedState.holds ?? [], task.taskId)) { holdBlockedTaskIds.add(task.taskId);",
		);
		// Sage blocker 6: replay is validated + persisted BEFORE frontier repair and reconciliation
		const src = readSrc("resume.ts");
		const replayIdx = src.indexOf("const replay = replayUnrecordedEscalations(persistedState");
		const frontierIdx = src.indexOf(
			"const segmentFrontierByTask = reconstructSegmentFrontier(persistedState);",
		);
		const pinIdx = src.indexOf("pinHeldSegments(persistedState);");
		const reconcileIdx = src.indexOf("const reconciledTasks = reconcileTaskStates(");
		expect(replayIdx).toBeGreaterThan(-1);
		expect(replayIdx).toBeLessThan(frontierIdx);
		expect(frontierIdx).toBeLessThan(pinIdx);
		expect(pinIdx).toBeLessThan(reconcileIdx);
		expect(resume).toContain('throw new ResumeError("RESUME_INVALID_STATE", replay.error);');
		expect(resume).toContain("saveBatchState(JSON.stringify(persistedState, null, 2), stateRoot);");
		expect(resume).toContain("existingWorktreeTaskIds, holdBlockedTaskIds, );");
		expect(resume).toContain(
			"await Promise.all( [...reExecByLane.values()].map(async (laneTasks) => { for (const task of laneTasks) { await reExecuteOne(task); } }), );",
		);
		expect(resume).toContain(
			'if (pollResult.status === "held") { reExecuteFinalStatus.set(task.taskId, "held");',
		);
		// re-execution passes the store to executeLaneV2
		expect(resume).toContain("emitAlert, undefined, undefined, holdStore, );");
	});

	it("extension: send_agent_message gains type='ruling' + replyTo, stamps the supervisor actor, addresses held units without a live pid, validates against the table", () => {
		expect(ext).toContain('Type.Literal("ruling"),');
		expect(ext).toContain('actor: { role: "supervisor", id: "supervisor" },');
		expect(ext).toContain(
			"const heldHolds = (state.holds ?? []).filter((h) => h.agentId === to && isHoldUnresolved(h));",
		);
		expect(ext).toContain(
			"if (heldHolds.length > 0) { // Bypass the live-pid gates: the runner is the consumer.",
		);
		expect(ext).toContain(
			'const v = validateRuling( { type: "ruling", replyTo: opts.replyTo, content, actor: opts.actor }, state.holds ?? [], { taskId: target.taskId, segmentId: target.segmentId }, );',
		);
		expect(ext).toContain("has no unresolved hold — rulings only apply to held lanes.");
		// held-target path runs BEFORE the dead-pid / alive gates
		const src = readSrc("extension.ts");
		expect(src.indexOf("#627: held-unit target")).toBeLessThan(src.indexOf("is DEAD: its process"));
	});

	it("extension: /orch-rule is the only operator stamp; retry refuses held; force-merge refuses waves with held units; takeover reports holds", () => {
		expect(ext).toContain('pi.registerCommand("orch-rule", {');
		expect(ext).toContain('actor: { role: "operator", id: operatorId },');
		expect((ext.match(/role: "operator"/g) ?? []).length).toBe(1);
		expect(ext).toContain('if (taskRecord.status === "held") {');
		expect(ext).toContain("retry never releases a hold");
		expect(ext).toContain("bound by an unresolved hold — force merge refused");
		expect(ext).toContain("held unit(s) preserved (never a completion path)");
		expect(ext).toContain("escalations kept");
	});

	it("agent-host never consumes rulings; lane-runner intercept never consumes rulings", () => {
		expect(readSrc("agent-host.ts").replace(/\s+/g, " ")).toContain(
			'if (msg.type === "ruling") continue;',
		);
		expect(readSrc("lane-runner.ts").replace(/\s+/g, " ")).toContain(
			'if (message.type === "ruling") continue;',
		);
	});

	it("config/env: holdTimeoutMinutes threads loader → env → lane config", async () => {
		const { buildWorkerEnv } = await import("../taskplane/execution.ts");
		expect(buildWorkerEnv({ holdTimeoutMinutes: 30 }).TASKPLANE_HOLD_TIMEOUT_MIN).toBe("30");
		expect(buildWorkerEnv({ holdTimeoutMinutes: 1 }).TASKPLANE_HOLD_TIMEOUT_MIN).toBe("5");
		expect(buildWorkerEnv({}).TASKPLANE_HOLD_TIMEOUT_MIN).toBe(undefined);
		expect(readSrc("config-loader.ts")).toContain(
			"holdTimeoutMinutes: config.taskRunner.worker.holdTimeoutMinutes",
		);
		expect(exec).toContain(
			"holdTimeoutMinutes: normalizeHoldTimeoutMinutes(extraEnvVars?.TASKPLANE_HOLD_TIMEOUT_MIN),",
		);
	});

	it("a released-but-unacknowledged hold still blocks (the tool must not treat 'released' as done)", () => {
		const released = applyRuling(
			hold(),
			{ id: "r", replyTo: "esc-1", content: "x", actor: { role: "supervisor", id: "s" } },
			2,
		);
		const r = reconcileTaskStates(
			state([{ taskId: "TP-1" }]),
			new Set(),
			new Set(["TP-1"]),
			new Set(["TP-1"]),
			new Set(["TP-1"]),
		);
		expect(released.deliveryState).toBe("pending");
		expect(r[0].liveStatus).toBe("held");
	});
});

describe("#627 — Sage regressions: replay attribution, segment pinning, reconstruction", () => {
	function persisted(over: Partial<PersistedBatchState> = {}): PersistedBatchState {
		return {
			batchId: "b",
			tasks: [
				{
					taskId: "TP-A",
					laneNumber: 1,
					sessionName: "orch-op-lane-1",
					status: "succeeded",
					taskFolder: "",
					startedAt: 1,
					endedAt: 2,
					doneFileFound: true,
					exitReason: "",
				},
				{
					taskId: "TP-B",
					laneNumber: 1,
					sessionName: "orch-op-lane-1",
					status: "running",
					taskFolder: "",
					startedAt: 3,
					endedAt: null,
					doneFileFound: false,
					exitReason: "",
				},
			],
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-op-lane-1",
					worktreePath: "/wt",
					branch: "b1",
					taskIds: ["TP-A", "TP-B"],
				},
			],
			segments: [],
			holds: [],
			...over,
		} as unknown as PersistedBatchState;
	}
	const esc = (id: string, over: Record<string, unknown> = {}) => ({
		id,
		batchId: "b",
		from: "orch-op-lane-1-worker",
		to: "supervisor",
		timestamp: 10,
		type: "escalate",
		content: "?",
		expectsReply: true,
		replyTo: null,
		...over,
	});

	it("replay: a SCOPED escalation is attributed to its task even after the lane moved on (B escalated; A must not inherit it)", () => {
		const st = persisted();
		const r = replayUnrecordedEscalations(
			st,
			() => [esc("e1", { scope: { taskId: "TP-B", segmentId: null } })] as never,
		);
		expect(r.ok).toBe(true);
		expect(st.holds[0].taskId).toBe("TP-B");
		expect(st.holds[0].agentId).toBe("orch-op-lane-1-worker");
		expect(st.holds[0].executionId).toBe("replayed-on-resume");
	});

	it("replay: an UNSCOPED escalation on a lane that ran two tasks REFUSES the resume (never guessed)", () => {
		const st = persisted();
		const r = replayUnrecordedEscalations(st, () => [esc("e1")] as never);
		expect(r.ok).toBe(false);
		if (r.ok === false) {
			expect(r.error).toContain("unscoped escalation e1");
			expect(r.error).toContain("TP-A, TP-B");
		}
		expect(st.holds.length).toBe(0);
	});

	it("replay: an unscoped escalation on a single-task lane is attributed from the durable lane record; an unreadable outbox refuses", () => {
		const st = persisted({
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "orch-op-lane-1",
					worktreePath: "/wt",
					branch: "b1",
					taskIds: ["TP-B"],
				},
			],
		} as never);
		const r = replayUnrecordedEscalations(st, () => [esc("e1")] as never);
		expect(r.ok).toBe(true);
		expect(st.holds[0].taskId).toBe("TP-B");
		const bad = replayUnrecordedEscalations(persisted(), () => {
			throw new Error("EIO");
		});
		expect(bad.ok).toBe(false);
	});

	it("pinHeldSegments: a segment hold pins the held segment as active and marks task + segment held; a succeeded segment is left alone", () => {
		const st = persisted({
			tasks: [
				{
					taskId: "TP-B",
					laneNumber: 1,
					sessionName: "orch-op-lane-1",
					status: "failed",
					taskFolder: "",
					startedAt: 3,
					endedAt: 4,
					doneFileFound: false,
					exitReason: "x",
					activeSegmentId: null,
					segmentIds: ["TP-B::api", "TP-B::web"],
				},
			],
			segments: [
				{
					segmentId: "TP-B::api",
					taskId: "TP-B",
					repoId: "api",
					status: "failed",
					laneId: "",
					sessionName: "",
					worktreePath: "",
					branch: "",
					startedAt: 1,
					endedAt: 2,
					retries: 0,
					exitReason: "",
					dependsOnSegmentIds: [],
				},
				{
					segmentId: "TP-B::web",
					taskId: "TP-B",
					repoId: "web",
					status: "succeeded",
					laneId: "",
					sessionName: "",
					worktreePath: "",
					branch: "",
					startedAt: 1,
					endedAt: 2,
					retries: 0,
					exitReason: "",
					dependsOnSegmentIds: [],
				},
			],
			holds: [
				hold({ escalationId: "h-api", taskId: "TP-B", segmentId: "TP-B::api" }),
				hold({ escalationId: "h-web", taskId: "TP-B", segmentId: "TP-B::web" }),
			],
		} as never);
		const pinned = pinHeldSegments(st);
		expect(pinned).toEqual(["TP-B→TP-B::api"]);
		expect(st.tasks[0].activeSegmentId).toBe("TP-B::api");
		expect(st.tasks[0].status).toBe("held");
		expect(st.segments[0].status).toBe("held");
		expect(st.segments[1].status).toBe("succeeded");
	});

	describe("reconstructHoldsFromMailbox", () => {
		let root: string;
		beforeEach(() => {
			root = mkdtempSync(join(tmpdir(), "tp627-recon-"));
		});
		afterEach(() => {
			rmSync(root, { recursive: true, force: true });
		});
		function put(sub: string, msg: Record<string, unknown>) {
			const dir = join(root, ".pi", "mailbox", "b", "orch-op-lane-1-worker", sub);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${msg.id}.msg.json`), JSON.stringify(msg));
		}
		const agentDir = () => join(root, ".pi", "mailbox", "b", "orch-op-lane-1-worker");
		const opts = {
			knownTaskIds: new Set(["TP-A", "TP-B"]),
			hasSegmentTopology: false,
			laneNumberForAgent: () => 1,
		};

		it("A→B mailbox reuse: an UNSCOPED escalation refuses reconstruction; a SCOPED one is attributed to its own task", () => {
			put("outbox/processed", esc("e-old"));
			let r = reconstructHoldsFromMailbox(root, "b", opts);
			expect(r.ok).toBe(false);
			if (r.ok === false) expect(r.error).toContain("has no unit scope");
			rmSync(join(agentDir(), "outbox", "processed"), { recursive: true });
			put("outbox/processed", esc("e-a", { scope: { taskId: "TP-A", segmentId: null } }));
			put("outbox", esc("e-b", { scope: { taskId: "TP-B", segmentId: null }, timestamp: 20 }));
			r = reconstructHoldsFromMailbox(root, "b", opts);
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.holds.map((h) => `${h.escalationId}:${h.taskId}`).sort()).toEqual([
					"e-a:TP-A",
					"e-b:TP-B",
				]);
				expect(r.holds.every((h) => h.phase === "open")).toBe(true);
			}
		});

		it("a processed escalation with a VALID acked ruling reconstructs released+acknowledged; an invalid ruling (no actor) is ignored; earliest valid wins", () => {
			put("outbox/processed", esc("e1", { scope: { taskId: "TP-B", segmentId: null } }));
			put("ack", {
				id: "r-bad",
				batchId: "b",
				from: "supervisor",
				to: "orch-op-lane-1-worker",
				timestamp: 11,
				type: "ruling",
				content: "x",
				replyTo: "e1",
			});
			put("ack", {
				id: "r-late",
				batchId: "b",
				from: "supervisor",
				to: "orch-op-lane-1-worker",
				timestamp: 13,
				type: "ruling",
				content: "late",
				replyTo: "e1",
				actor: { role: "operator", id: "h" },
			});
			put("ack", {
				id: "r-ok",
				batchId: "b",
				from: "supervisor",
				to: "orch-op-lane-1-worker",
				timestamp: 12,
				type: "ruling",
				content: "fix",
				replyTo: "e1",
				actor: { role: "supervisor", id: "s" },
			});
			put("outbox/processed", {
				id: "a1",
				batchId: "b",
				from: "orch-op-lane-1-worker",
				to: "supervisor",
				timestamp: 14,
				type: "reply",
				content: "ack",
				replyTo: "r-ok",
			});
			const r = reconstructHoldsFromMailbox(root, "b", opts);
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.holds[0].phase).toBe("released");
				expect(r.holds[0].ruling?.id).toBe("r-ok");
				expect(r.holds[0].deliveryState).toBe("acknowledged");
				expect(r.evidence).toEqual({ escalations: 1, rulings: 1, acks: 1 });
			}
		});

		it("segment-scoped evidence with no topology refuses; unknown task refuses; malformed file refuses; empty mailbox is fine", () => {
			expect(reconstructHoldsFromMailbox(root, "b", opts).ok).toBe(true);
			put("outbox", esc("e-seg", { scope: { taskId: "TP-B", segmentId: "TP-B::api" } }));
			let r = reconstructHoldsFromMailbox(root, "b", opts);
			expect(r.ok).toBe(false);
			if (r.ok === false) expect(r.error).toContain("segment topology");
			rmSync(join(agentDir(), "outbox"), { recursive: true });
			put("outbox", esc("e-x", { scope: { taskId: "TP-Z", segmentId: null } }));
			r = reconstructHoldsFromMailbox(root, "b", opts);
			expect(r.ok).toBe(false);
			if (r.ok === false) expect(r.error).toContain("TP-Z");
			rmSync(join(agentDir(), "outbox"), { recursive: true });
			mkdirSync(join(agentDir(), "outbox"), { recursive: true });
			writeFileSync(join(agentDir(), "outbox", "junk.msg.json"), "{not json");
			r = reconstructHoldsFromMailbox(root, "b", opts);
			expect(r.ok).toBe(false);
		});
	});

	it("wiring: reconstruction refuses instead of emitting an empty table; retry helpers carry the store, proxy the batch pause signal, record held retries; hold loop reads inbox before deadline; budget-exhausted held parks; live drain filters by scope", () => {
		const p = readSrc("persistence.ts").replace(/\s+/g, " ");
		expect(p).toContain("const holdRebuild = reconstructHoldsFromMailbox(stateRoot, cand.batchId, {");
		expect(p).toContain("holds: reconstructedHolds,");
		const e = readSrc("engine.ts").replace(/\s+/g, " ");
		expect(
			(e.match(/const retryPauseSignal = linkedPauseSignal\(batchState\.pauseSignal\);/g) ?? [])
				.length,
		).toBe(2);
		expect(
			(e.match(/recordHeldRetryOutcome\(waveResult, allTaskOutcomes, taskId, retryOutcome\);/g) ?? [])
				.length,
		).toBe(2);
		const lr = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		const loop = lr.slice(lr.indexOf("const awaitHoldResolution = async"));
		expect(loop.indexOf("// Inbox: only hold-control mail is consumed here.")).toBeLessThan(
			loop.indexOf("const expired = current.find((h) => isHoldExpired(h, now));"),
		);
		expect(lr).toContain('logExecution(statusPath, "Held — budget exhausted", authority.reason);');
		expect(lr.slice(lr.indexOf("Held — budget exhausted"))).toContain(
			'pauseSignal.paused = true; pauseSignal.cause = "hold-timeout";',
		);
		expect(lr).toContain(
			'if (msg.type === "escalate" && !escalationMatchesUnit(msg, escalationFilter)) {',
		);
		expect(readSrc("agent-bridge-extension.ts")).toContain("taskId: process.env.TASKPLANE_TASK_ID,");
	});
});

describe("#627 — Sage round 2 regressions", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "tp627-r2-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("B: quarantineUnauthorizedDoneMarkers moves a held task's .DONE at the canonical folder so discovery keeps the task pending", () => {
		const taskFolder = join(root, "taskplane-tasks", "TP-1");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, ".DONE"), "claim");
		const st = {
			holds: [hold()],
			tasks: [
				{
					taskId: "TP-1",
					taskFolder,
					laneNumber: 1,
					sessionName: "s",
					status: "held",
					startedAt: 1,
					endedAt: null,
					doneFileFound: true,
					exitReason: "",
				},
			],
			lanes: [],
		} as unknown as PersistedBatchState;
		const moved = quarantineUnauthorizedDoneMarkers(st, root, null);
		expect(moved.length).toBe(1);
		expect(existsSync(join(taskFolder, ".DONE"))).toBe(false);
		expect(readdirSync(taskFolder).some((f) => f.startsWith(".DONE.unauthorized-"))).toBe(true);
		// a task without a hold is untouched
		const other = join(root, "taskplane-tasks", "TP-2");
		mkdirSync(other, { recursive: true });
		writeFileSync(join(other, ".DONE"), "legit");
		st.tasks.push({ taskId: "TP-2", taskFolder: other } as never);
		expect(quarantineUnauthorizedDoneMarkers(st, root, null).length).toBe(0);
		expect(existsSync(join(other, ".DONE"))).toBe(true);
	});

	it("B: resume's terminal gate parks a batch with unresolved holds before cleanup / completion (source order)", () => {
		const src = readSrc("resume.ts");
		const gate = src.indexOf("terminal gate: " + "$" + "{unresolved.length} unresolved hold(s)");
		const preserve = src.indexOf(
			"// ── TP-028: Preserve partial progress before terminal cleanup ──",
		);
		const completed = src.indexOf('batchState.phase = "completed";');
		expect(gate).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(preserve);
		expect(gate).toBeLessThan(completed);
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain(
			'(batchState.phase as OrchBatchPhase) === "completed" ) { batchState.phase = "paused";',
		);
		// quarantine runs BEFORE discovery / .DONE collection
		expect(
			src.indexOf("quarantineUnauthorizedDoneMarkers(persistedState, repoRoot, workspaceConfig)"),
		).toBeLessThan(src.indexOf("const doneTaskIds = collectDoneTaskIdsForResume("));
	});

	it("D: the stop-wave producer stamps its cause without overwriting an existing one; the linked retry signal ignores exactly that cause", async () => {
		const exec = readSrc("execution.ts").replace(/\s+/g, " ");
		expect(exec).toContain(
			'if (!wavePauseSignal.paused) wavePauseSignal.cause = "stop-wave"; wavePauseSignal.paused = true;',
		);
		// behavioural: build the proxy the way engine.ts does and check both directions
		const src = readSrc("engine.ts");
		const fnStart = src.indexOf("function linkedPauseSignal(");
		const fnEnd = src.indexOf("\n}\n", fnStart) + 3;
		const fnSrc = src
			.slice(fnStart, fnEnd)
			.replace(/: PauseSignal/g, "")
			.replace(/\(target\)/, "(target)")
			.replace(/set paused\(v: boolean\)/, "set paused(v)")
			.replace(/set cause\(v[^)]*\)/, "set cause(v)");
		const linked = new Function(`${fnSrc}; return linkedPauseSignal;`)();
		const batch: { paused: boolean; cause?: string } = { paused: true, cause: "stop-wave" };
		const proxy = linked(batch);
		expect(proxy.paused).toBe(false); // retry runs despite stop-wave
		batch.cause = "operator";
		expect(proxy.paused).toBe(true); // any other pause unwinds the retry
		proxy.paused = true;
		proxy.cause = "hold-timeout";
		expect(batch.cause).toBe("hold-timeout"); // a held retry parks the BATCH
	});

	it("E: pre-wave checkpoint context carries recovery metadata and a synthetic discovery for task folders", () => {
		const flat = readSrc("resume.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			"...(t.partialProgressCommits !== undefined ? { partialProgressCommits: t.partialProgressCommits } : {}),",
		);
		expect(flat).toContain(
			"...(t.exitDiagnostic !== undefined ? { exitDiagnostic: t.exitDiagnostic } : {}),",
		);
		expect(flat).toContain("discovery: () => preWaveDiscovery,");
		expect(flat).toContain("taskFolder: t.taskFolder, promptRepoId: t.repoId,");
	});

	it("F: readOutboxStrict throws on a malformed message where readOutbox swallows; resume replay and reconstruction refuse", async () => {
		const dir = join(root, ".pi", "mailbox", "b", "orch-op-lane-1-worker", "outbox");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "bad.msg.json"), JSON.stringify({ id: "x", type: "escalate" })); // no batchId/from/to/timestamp/content
		expect(() => readOutboxStrict(root, "b", "orch-op-lane-1-worker")).toThrow(
			/malformed mailbox message/,
		);
		const { readOutbox } = await import("../taskplane/mailbox.ts");
		expect(readOutbox(root, "b", "orch-op-lane-1-worker").length).toBe(0); // the permissive reader hides it
		const r = reconstructHoldsFromMailbox(root, "b", {
			knownTaskIds: new Set(["TP-1"]),
			hasSegmentTopology: false,
			laneNumberForAgent: () => 1,
		});
		expect(r.ok).toBe(false);
		expect(readSrc("resume.ts")).toContain(
			"readOutboxStrict(stateRoot, persistedState.batchId, agentId)",
		);
	});
});
