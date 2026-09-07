/**
 * Held state — pure module + persistence contract (#627, Stage 1a).
 *
 * Covers: record construction and deadline; completion authority for every
 * phase/delivery combination; ruling validation (correlation, unit, execution,
 * phase, actor, role, content); classification of hold mail (steer never
 * releases); delivery acknowledgement matching; unrecorded-escalation replay;
 * schema v4→v5 upconvert and v5 validation of the holds table.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	applyRuling,
	buildHoldStatusSummary,
	buildRulingPromptLines,
	cancelHold,
	classifyHoldMail,
	createHoldRecord,
	evaluateCompletionAuthority,
	expireHold,
	findDeliveryAcknowledgements,
	HOLD_TIMEOUT_MINUTES_DEFAULT,
	HOLD_TIMEOUT_MINUTES_MAX,
	HOLD_TIMEOUT_MINUTES_MIN,
	isHoldExpired,
	isValidHoldRecord,
	markDeliveryAcknowledged,
	markDeliveryInFlight,
	normalizeHoldTimeoutMinutes,
	recordAcknowledgement,
	selectUnrecordedEscalations,
	taskCompletionBlocked,
	upsertHold,
	validateRuling,
	type HoldRecord,
} from "../taskplane/hold-state.ts";
import {
	upconvertV4toV5,
	validatePersistedState,
	serializeBatchState,
} from "../taskplane/persistence.ts";
import {
	BATCH_STATE_SCHEMA_VERSION,
	defaultBatchDiagnostics,
	defaultResilienceState,
	type MailboxMessage,
} from "../taskplane/types.ts";

const T0 = 1_800_000_000_000;

function escalation(over: Partial<MailboxMessage> = {}): MailboxMessage {
	return {
		id: "esc-1",
		batchId: "b1",
		from: "orch-lane-1-worker",
		to: "supervisor",
		timestamp: T0,
		type: "escalate",
		content: "Step 5 gate at cap: P1 remains (auth token reuse). Need ruling: fix or accept?",
		expectsReply: true,
		replyTo: null,
		...over,
	};
}

function openHold(over: Partial<HoldRecord> = {}): HoldRecord {
	return {
		...createHoldRecord({
			escalation: escalation(),
			batchId: "b1",
			taskId: "TP-1",
			segmentId: null,
			executionId: "exec-A",
			agentId: "orch-lane-1-worker",
			laneNumber: 1,
			holdTimeoutMinutes: 240,
			now: T0,
		}),
		...over,
	};
}

function ruling(over: Partial<MailboxMessage> = {}): MailboxMessage {
	return {
		id: "rul-1",
		batchId: "b1",
		from: "supervisor",
		to: "orch-lane-1-worker",
		timestamp: T0 + 60_000,
		type: "ruling",
		content: "Fix it: rotate the token per request; do not accept.",
		expectsReply: false,
		replyTo: "esc-1",
		actor: { role: "supervisor", id: "sup-session" },
		...over,
	};
}

describe("hold-state: construction", () => {
	it("opens with deadline = openedAt + timeout, phase open, delivery none", () => {
		const h = openHold();
		assert.equal(h.phase, "open");
		assert.equal(h.deliveryState, "none");
		assert.equal(h.openedAt, T0);
		assert.equal(h.deadline, T0 + 240 * 60_000);
		assert.equal(h.escalation, escalation().content, "full text, not a preview");
	});

	it("normalizes the timeout into 5..10080 with default 240", () => {
		assert.equal(normalizeHoldTimeoutMinutes(undefined), HOLD_TIMEOUT_MINUTES_DEFAULT);
		assert.equal(normalizeHoldTimeoutMinutes("garbage"), HOLD_TIMEOUT_MINUTES_DEFAULT);
		assert.equal(normalizeHoldTimeoutMinutes(1), HOLD_TIMEOUT_MINUTES_MIN);
		assert.equal(normalizeHoldTimeoutMinutes(1e9), HOLD_TIMEOUT_MINUTES_MAX);
		assert.equal(normalizeHoldTimeoutMinutes(90.7), 90);
	});

	it("uses the escalation timestamp as openedAt when it precedes now (replay after crash)", () => {
		const h = createHoldRecord({
			escalation: escalation({ timestamp: T0 - 600_000 }),
			batchId: "b1",
			taskId: "TP-1",
			segmentId: null,
			executionId: "e",
			agentId: "a",
			laneNumber: 1,
			holdTimeoutMinutes: 60,
			now: T0,
		});
		assert.equal(h.openedAt, T0 - 600_000);
		assert.equal(
			h.deadline,
			T0 - 600_000 + 3_600_000,
			"deadline anchored to the escalation, not the replay",
		);
	});
});

describe("hold-state: completion authority (the single predicate)", () => {
	it("open hold blocks", () => {
		const r = evaluateCompletionAuthority([openHold()], "TP-1", null);
		assert.equal(r.blocked, true);
		if (r.blocked) assert.deepEqual(r.escalationIds, ["esc-1"]);
	});

	it("expired hold still blocks — expiry parks, it does not release", () => {
		const h = expireHold(openHold(), T0 + 300 * 60_000);
		assert.equal(h.expiredAt, T0 + 300 * 60_000);
		const r = evaluateCompletionAuthority([h], "TP-1", null);
		assert.equal(r.blocked, true);
		if (r.blocked) assert.match(r.reason, /expired/);
	});

	it("released but undelivered / in-flight blocks; acknowledged does not", () => {
		const released = applyRuling(openHold(), ruling(), T0 + 60_000);
		assert.equal(released.phase, "released");
		assert.equal(released.deliveryState, "pending");
		assert.equal(evaluateCompletionAuthority([released], "TP-1", null).blocked, true);
		const inFlight = markDeliveryInFlight(released, "attempt-1");
		assert.equal(evaluateCompletionAuthority([inFlight], "TP-1", null).blocked, true);
		const acked = markDeliveryAcknowledged(inFlight);
		assert.equal(evaluateCompletionAuthority([acked], "TP-1", null).blocked, false);
	});

	it("cancelled hold does not block (abort path ends the task by other means)", () => {
		const c = cancelHold(openHold(), "abort", T0 + 1);
		assert.equal(evaluateCompletionAuthority([c], "TP-1", null).blocked, false);
	});

	it("binding rule: another task never binds; a segment hold binds its segment AND the whole-task unit; a whole-task hold binds every segment; sibling segments are independent", () => {
		const other = openHold({ taskId: "TP-2" });
		const seg = openHold({ escalationId: "esc-seg", segmentId: "TP-1::api" });
		const whole = openHold({ escalationId: "esc-whole", segmentId: null });
		assert.equal(evaluateCompletionAuthority([other], "TP-1", null).blocked, false);
		// Sage blocker 5: a resume that runs the task as ONE unit cannot step around a segment's hold
		assert.equal(evaluateCompletionAuthority([seg], "TP-1", null).blocked, true);
		assert.equal(evaluateCompletionAuthority([seg], "TP-1", "TP-1::api").blocked, true);
		assert.equal(evaluateCompletionAuthority([seg], "TP-1", "TP-1::web").blocked, false);
		assert.equal(evaluateCompletionAuthority([whole], "TP-1", "TP-1::web").blocked, true);
		// task-level view sees any unit of the task
		assert.equal(taskCompletionBlocked([seg], "TP-1"), true);
		// a ruling for the segment hold is accepted by the whole-task unit's runner
		const v = validateRuling(ruling({ replyTo: "esc-seg" }), [seg], {
			taskId: "TP-1",
			segmentId: null,
		});
		assert.equal(v.ok, true);
		const w = validateRuling(ruling({ replyTo: "esc-seg" }), [seg], {
			taskId: "TP-1",
			segmentId: "TP-1::web",
		});
		assert.equal(w.ok, false);
	});

	it("all holds on a unit must resolve — a second open escalation keeps blocking", () => {
		const first = markDeliveryAcknowledged(
			markDeliveryInFlight(applyRuling(openHold(), ruling(), T0), "a"),
		);
		const second = openHold({ escalationId: "esc-2" });
		const r = evaluateCompletionAuthority([first, second], "TP-1", null);
		assert.equal(r.blocked, true);
		if (r.blocked) assert.deepEqual(r.escalationIds, ["esc-2"]);
	});

	it("acknowledgements never change phase, delivery or deadline", () => {
		const h = openHold();
		const acked = recordAcknowledgement(h, T0 + 100 * 60_000);
		assert.equal(acked.phase, "open");
		assert.equal(acked.deadline, h.deadline);
		assert.equal(acked.lastAcknowledgedAt, T0 + 100 * 60_000);
		assert.equal(isHoldExpired(acked, T0 + 241 * 60_000), true, "deadline still fires");
	});
});

describe("hold-state: ruling validation", () => {
	const holds = [openHold()];
	const scope = { taskId: "TP-1", segmentId: null, executionId: "exec-A" };

	it("accepts a correlated, authorized ruling", () => {
		const v = validateRuling(ruling(), holds, scope);
		assert.equal(v.ok, true);
	});

	it("rejects steer (steer is ordinary mail and never releases)", () => {
		const v = validateRuling(ruling({ type: "steer" }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "not-a-ruling");
	});

	it("rejects a ruling without replyTo, or naming an unknown escalation", () => {
		let v = validateRuling(ruling({ replyTo: null }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "missing-reply-to");
		v = validateRuling(ruling({ replyTo: "esc-999" }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "unknown-escalation");
	});

	it("rejects a ruling for another unit or another execution (lane-id reuse guard)", () => {
		let v = validateRuling(ruling(), holds, { taskId: "TP-2", segmentId: null });
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "wrong-unit");
		v = validateRuling(ruling(), holds, { ...scope, executionId: "exec-B" });
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "wrong-execution");
	});

	it("rejects a second ruling on an already-released hold", () => {
		const released = applyRuling(openHold(), ruling(), T0);
		const v = validateRuling(ruling({ id: "rul-2" }), [released], scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "not-open");
	});

	it("rejects missing actor, unknown role, and model-supplied nonsense roles", () => {
		let v = validateRuling(ruling({ actor: undefined }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "missing-actor");
		v = validateRuling(ruling({ actor: { role: "worker" as any, id: "x" } }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "invalid-role");
		v = validateRuling(ruling({ actor: { role: "operator", id: "" } }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "missing-actor");
	});

	it("rejects empty instructions", () => {
		const v = validateRuling(ruling({ content: "   " }), holds, scope);
		assert.equal(v.ok, false);
		if (!v.ok) assert.equal(v.code, "empty-instructions");
	});

	it("accepts an operator ruling and records the role on the record", () => {
		const r = applyRuling(
			openHold(),
			ruling({ actor: { role: "operator", id: "henry", authorizationRef: "thread-42" } }),
			T0,
		);
		assert.equal(r.ruling?.actor.role, "operator");
		assert.equal(r.ruling?.actor.authorizationRef, "thread-42");
		assert.equal(r.ruling?.replyTo, "esc-1");
	});
});

describe("hold-state: mail classification and delivery", () => {
	it("classifies hold mail; steer is ignored; nothing is hold mail without an unresolved hold", () => {
		const holds = [openHold()];
		assert.equal(
			classifyHoldMail({ type: "ruling", replyTo: "esc-1" }, holds, "TP-1", null),
			"ruling",
		);
		assert.equal(classifyHoldMail({ type: "info", replyTo: null }, holds, "TP-1", null), "ack");
		assert.equal(classifyHoldMail({ type: "query", replyTo: null }, holds, "TP-1", null), "query");
		assert.equal(classifyHoldMail({ type: "abort", replyTo: null }, holds, "TP-1", null), "abort");
		assert.equal(
			classifyHoldMail({ type: "steer", replyTo: "esc-1" }, holds, "TP-1", null),
			"ignore",
		);
		assert.equal(classifyHoldMail({ type: "ruling", replyTo: "esc-1" }, [], "TP-1", null), "ignore");
		assert.equal(
			classifyHoldMail({ type: "ruling", replyTo: "esc-1" }, holds, "TP-9", null),
			"ignore",
		);
	});

	it("matches a worker reply with replyTo=rulingId as delivery acknowledgement", () => {
		const inFlight = markDeliveryInFlight(applyRuling(openHold(), ruling(), T0), "att");
		const outbox = [
			{ type: "reply" as const, replyTo: "rul-1" },
			{ type: "reply" as const, replyTo: "something-else" },
		];
		const acked = findDeliveryAcknowledgements(outbox, [inFlight], "TP-1", null);
		assert.deepEqual(
			acked.map((h) => h.escalationId),
			["esc-1"],
		);
		assert.equal(
			findDeliveryAcknowledgements([{ type: "escalate", replyTo: "rul-1" }], [inFlight], "TP-1", null)
				.length,
			0,
			"only reply-typed messages acknowledge",
		);
	});

	it("selects escalations with no record yet (crash-replay contract)", () => {
		const outbox = [
			escalation(),
			escalation({ id: "esc-2" }),
			{ ...escalation({ id: "r" }), type: "reply" as const },
		];
		const missing = selectUnrecordedEscalations(outbox, [openHold()]);
		assert.deepEqual(
			missing.map((m) => m.id),
			["esc-2"],
		);
	});

	it("upsert replaces by escalation id and never drops others", () => {
		const a = openHold();
		const b = openHold({ escalationId: "esc-2" });
		const next = upsertHold([a, b], { ...a, lastAcknowledgedAt: 1 });
		assert.equal(next.length, 2);
		assert.equal(next[0].lastAcknowledgedAt, 1);
		assert.equal(upsertHold([a], b).length, 2);
	});

	it("ruling prompt names the ruling id, role, and the acknowledgement call", () => {
		const released = applyRuling(openHold(), ruling(), T0);
		const lines = buildRulingPromptLines([released]).join("\n");
		assert.match(lines, /Ruling rul-1 \(by supervisor\)/);
		assert.match(lines, /notify_supervisor\(content="ack ruling", replyTo="rul-1"\)/);
		assert.match(lines, /Taskplane-Ruling: rul-1/);
		assert.match(lines, /does not approve the result/);
		assert.deepEqual(buildRulingPromptLines([openHold()]), [], "no prompt without a ruling");
	});

	it("status summary distinguishes open / expired / released / cancelled", () => {
		const open = openHold();
		const expired = expireHold(openHold({ escalationId: "e2" }), T0 + 1);
		const released = applyRuling(openHold({ escalationId: "e3" }), ruling({ replyTo: "e3" }), T0);
		const cancelled = cancelHold(openHold({ escalationId: "e4" }), "abort", T0);
		const s = buildHoldStatusSummary([open, expired, released, cancelled], T0 + 60_000);
		assert.match(s, /esc-1 · open, 239 min to deadline/);
		assert.match(s, /e2 · open, EXPIRED/);
		assert.match(s, /e3 · released by supervisor \(delivery pending\)/);
		assert.match(s, /e4 · cancelled: abort/);
	});
});

describe("hold-state: persistence (schema v5)", () => {
	function v4State(): Record<string, unknown> {
		return {
			schemaVersion: 4,
			phase: "paused",
			batchId: "b1",
			baseBranch: "main",
			orchBranch: "orch/x",
			mode: "repo",
			startedAt: T0,
			updatedAt: T0,
			endedAt: null,
			currentWaveIndex: 0,
			totalWaves: 1,
			wavePlan: [["TP-1"]],
			lanes: [],
			tasks: [],
			mergeResults: [],
			totalTasks: 1,
			succeededTasks: 0,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			blockedTaskIds: [],
			lastError: null,
			errors: [],
			resilience: defaultResilienceState(),
			diagnostics: defaultBatchDiagnostics(),
			segments: [],
		};
	}

	it("upconverts v4 → v5 with an empty holds table (idempotent)", () => {
		const obj = v4State();
		upconvertV4toV5(obj);
		assert.equal(obj.schemaVersion, 5);
		assert.deepEqual(obj.holds, []);
		(obj.holds as unknown[]).push(openHold());
		upconvertV4toV5(obj);
		assert.equal((obj.holds as unknown[]).length, 1, "no-op on v5");
	});

	it("validatePersistedState accepts a v4 file and returns v5 with holds", () => {
		const st = validatePersistedState(v4State());
		assert.equal(st.schemaVersion, BATCH_STATE_SCHEMA_VERSION);
		assert.deepEqual(st.holds, []);
	});

	it("validatePersistedState accepts valid holds and rejects malformed / duplicate / uncorrelated ones", () => {
		const good = { ...v4State(), schemaVersion: 5, holds: [openHold()] };
		assert.equal(validatePersistedState(good).holds.length, 1);

		const released = applyRuling(openHold({ escalationId: "e9" }), ruling({ replyTo: "e9" }), T0);
		assert.equal(validatePersistedState({ ...good, holds: [released] }).holds[0].phase, "released");

		assert.throws(
			() => validatePersistedState({ ...good, holds: "nope" }),
			/Missing or invalid "holds"/,
		);
		assert.throws(
			() => validatePersistedState({ ...good, holds: [{ escalationId: "x" }] }),
			/holds\[0\] is not a valid hold record/,
		);
		assert.throws(
			() => validatePersistedState({ ...good, holds: [openHold(), openHold()] }),
			/duplicates escalation id/,
		);
		// released without a ruling, or with a ruling whose replyTo mismatches, is invalid
		assert.throws(
			() => validatePersistedState({ ...good, holds: [{ ...openHold(), phase: "released" }] }),
			/not a valid hold record/,
		);
		assert.throws(
			() =>
				validatePersistedState({
					...good,
					holds: [{ ...released, ruling: { ...released.ruling!, replyTo: "other" } }],
				}),
			/not a valid hold record/,
		);
		// a v5 file with a missing holds field is refused (no silent backfill of an authoritative table)
		const { holds: _h, ...noHolds } = good;
		assert.throws(() => validatePersistedState(noHolds), /Missing or invalid "holds"/);
	});

	it("isValidHoldRecord rejects a released record whose actor role is not supervisor|operator", () => {
		const released = applyRuling(openHold(), ruling(), T0) as any;
		assert.equal(isValidHoldRecord(released), true);
		released.ruling.actor.role = "worker";
		assert.equal(isValidHoldRecord(released), false);
	});

	it("serializeBatchState round-trips holds verbatim", () => {
		const h = applyRuling(openHold(), ruling(), T0);
		const runtime: any = {
			phase: "paused",
			batchId: "b1",
			baseBranch: "main",
			orchBranch: "orch/x",
			mode: "repo",
			pauseSignal: { paused: true, cause: "hold-timeout" },
			waveResults: [],
			currentWaveIndex: 0,
			totalWaves: 1,
			blockedTaskIds: new Set(),
			startedAt: T0,
			endedAt: null,
			totalTasks: 1,
			succeededTasks: 0,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			errors: [],
			currentLanes: [],
			dependencyGraph: null,
			mergeResults: [],
			segments: [],
			holds: [h],
		};
		const json = serializeBatchState(runtime, [["TP-1"]], [], []);
		const parsed = validatePersistedState(JSON.parse(json));
		assert.equal(parsed.schemaVersion, 5);
		assert.deepEqual(parsed.holds, [h]);
	});
});
