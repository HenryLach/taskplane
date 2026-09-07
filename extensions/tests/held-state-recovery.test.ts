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
import { reconcileTaskStates } from "../taskplane/resume.ts";
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
		expect(resume).toContain(
			"const unrecorded = selectUnrecordedEscalations( readOutbox(stateRoot, persistedState.batchId, workerAgentId), persistedState.holds ?? [], );",
		);
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
