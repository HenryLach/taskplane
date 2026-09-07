/**
 * Held state — pure transitions, authority checks and completion predicates (#627).
 *
 * A hold is a durable, runner-owned record opened when a worker escalates to
 * the supervisor. While a unit (task or segment) has an unresolved hold it
 * cannot complete: no `.DONE`, no step check-off, no merge, no cleanup. The
 * hold is released ONLY by a typed `ruling` mailbox message whose `replyTo`
 * equals the escalation id and whose actor role was stamped by a trusted
 * issuing path (the supervisor's `send_agent_message` tool, or an explicit
 * operator command). Acknowledgements (`info`) never release or extend the
 * deadline; `query` wakes the runner to answer; `abort` cancels, never approves.
 *
 * Everything in this module is pure and synchronous — the lane-runner owns
 * the wait loop, the engine owns persistence. Records are treated as
 * immutable values; every transition returns a new record.
 *
 * Design: docs/specifications/taskplane/held-state-spec.md
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { MailboxMessage } from "./types.ts";

// ── Types ─────────────────────────────────────────────────────────────

export type HoldPhase = "open" | "released" | "cancelled";

/**
 * Delivery of the ruling to a worker:
 *  - `none`         — no ruling yet
 *  - `pending`      — ruling accepted, no worker has been given it
 *  - `in-flight`    — a worker was spawned with the ruling in its initial input
 *  - `acknowledged` — that worker confirmed receipt (`notify_supervisor(replyTo=rulingId)`)
 */
export type HoldDeliveryState = "none" | "pending" | "in-flight" | "acknowledged";

export type RulingActorRole = "supervisor" | "operator";

export interface RulingActor {
	role: RulingActorRole;
	/** Who issued it (supervisor session name, operator id, …). */
	id: string;
	/** Optional reference to an out-of-band authorization (ticket, thread, …). */
	authorizationRef?: string;
}

export interface HoldRuling {
	/** Mailbox message id of the ruling. */
	id: string;
	/** Must equal the hold's `escalationId`. */
	replyTo: string;
	actor: RulingActor;
	instructions: string;
	/** Epoch ms when the runner accepted the ruling. */
	acceptedAt: number;
}

export interface HoldRecord {
	/** Primary key within a batch — the worker's escalation message id. */
	escalationId: string;
	batchId: string;
	taskId: string;
	/** Segment identity for segment-aware units; null for whole-task units. */
	segmentId: string | null;
	/** Durable unit-attempt identity (not a pid); ties the hold to one lane run. */
	executionId: string;
	/** Mailbox alias the supervisor addresses — may have no live process. */
	agentId: string;
	laneNumber: number;
	openedAt: number;
	/** Absolute epoch ms. Acknowledgements never move it. */
	deadline: number;
	expiredAt?: number;
	phase: HoldPhase;
	/** Full escalation text (not a preview). */
	escalation: string;
	/** Review gates named by the escalation, when the runner can tell. */
	gateRefs?: string[];
	ruling?: HoldRuling;
	deliveryState: HoldDeliveryState;
	deliveryAttemptId?: string;
	/** Epoch ms of the most recent supervisor acknowledgement (`info`). Informational only. */
	lastAcknowledgedAt?: number;
	/** Why the hold was cancelled (abort / operator). */
	cancelReason?: string;
	cancelledAt?: number;
	/** Ratification record ids that closed this escalation (Stage 2). */
	ratificationIds?: string[];
}

export const HOLD_TIMEOUT_MINUTES_DEFAULT = 240;
export const HOLD_TIMEOUT_MINUTES_MIN = 5;
export const HOLD_TIMEOUT_MINUTES_MAX = 10_080; // 7 days

/** Clamp an operator-supplied hold timeout into the supported range. */
export function normalizeHoldTimeoutMinutes(value: unknown): number {
	const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(n)) return HOLD_TIMEOUT_MINUTES_DEFAULT;
	return Math.min(HOLD_TIMEOUT_MINUTES_MAX, Math.max(HOLD_TIMEOUT_MINUTES_MIN, Math.trunc(n)));
}

// ── Construction ──────────────────────────────────────────────────────

export interface OpenHoldInput {
	escalation: Pick<MailboxMessage, "id" | "content" | "timestamp">;
	batchId: string;
	taskId: string;
	segmentId: string | null;
	executionId: string;
	agentId: string;
	laneNumber: number;
	holdTimeoutMinutes: number;
	gateRefs?: string[];
	now?: number;
}

export function createHoldRecord(input: OpenHoldInput): HoldRecord {
	const now = input.now ?? Date.now();
	const openedAt = Math.min(now, input.escalation.timestamp || now);
	return {
		escalationId: input.escalation.id,
		batchId: input.batchId,
		taskId: input.taskId,
		segmentId: input.segmentId,
		executionId: input.executionId,
		agentId: input.agentId,
		laneNumber: input.laneNumber,
		openedAt,
		deadline: openedAt + normalizeHoldTimeoutMinutes(input.holdTimeoutMinutes) * 60_000,
		phase: "open",
		escalation: input.escalation.content,
		...(input.gateRefs && input.gateRefs.length > 0 ? { gateRefs: [...input.gateRefs] } : {}),
		deliveryState: "none",
	};
}

// ── Selection ─────────────────────────────────────────────────────────

/** Exact unit identity (task + segment). */
export function sameUnit(
	record: Pick<HoldRecord, "taskId" | "segmentId">,
	taskId: string,
	segmentId: string | null | undefined,
): boolean {
	return record.taskId === taskId && (record.segmentId ?? null) === (segmentId ?? null);
}

/**
 * Binding rule (Sage review, blocker 5): a hold BINDS a unit when it is on the
 * same task and either side is the whole task. A whole-task hold binds every
 * segment; a segment hold binds its own segment AND the whole-task unit — so a
 * resume that runs the task as one unit can never step around a segment's hold.
 */
export function holdBindsUnit(
	record: Pick<HoldRecord, "taskId" | "segmentId">,
	taskId: string,
	segmentId: string | null | undefined,
): boolean {
	if (record.taskId !== taskId) return false;
	const hs = record.segmentId ?? null;
	const us = segmentId ?? null;
	return hs === null || us === null || hs === us;
}

export function holdsForUnit(
	holds: readonly HoldRecord[],
	taskId: string,
	segmentId: string | null | undefined,
): HoldRecord[] {
	return holds.filter((h) => holdBindsUnit(h, taskId, segmentId));
}

export function holdsForTask(holds: readonly HoldRecord[], taskId: string): HoldRecord[] {
	return holds.filter((h) => h.taskId === taskId);
}

/** Holds that still bind the unit: open (incl. expired) or released-but-undelivered. */
export function unresolvedHoldsForUnit(
	holds: readonly HoldRecord[],
	taskId: string,
	segmentId: string | null | undefined,
): HoldRecord[] {
	return holdsForUnit(holds, taskId, segmentId).filter(isHoldUnresolved);
}

export function isHoldUnresolved(h: HoldRecord): boolean {
	if (h.phase === "open") return true;
	if (h.phase === "released") return h.deliveryState !== "acknowledged";
	return false;
}

export function isHoldExpired(h: HoldRecord, now: number = Date.now()): boolean {
	return h.phase === "open" && (h.expiredAt !== undefined || now >= h.deadline);
}

export function findHold(
	holds: readonly HoldRecord[],
	escalationId: string,
): HoldRecord | undefined {
	return holds.find((h) => h.escalationId === escalationId);
}

// ── Completion authority ──────────────────────────────────────────────

export type CompletionAuthority =
	| { blocked: false }
	| { blocked: true; reason: string; escalationIds: string[] };

/**
 * The single predicate every completion path consults: `.DONE` creation or
 * acceptance, step check-off, segment success, wave merge, catch-up merge,
 * force merge, cleanup. A unit is blocked while any of its holds is open
 * (expired holds are still open — expiry parks, it does not release) or
 * released with the ruling not yet acknowledged by a worker.
 */
export function evaluateCompletionAuthority(
	holds: readonly HoldRecord[],
	taskId: string,
	segmentId: string | null | undefined,
): CompletionAuthority {
	const binding = unresolvedHoldsForUnit(holds, taskId, segmentId);
	if (binding.length === 0) return { blocked: false };
	const parts = binding.map((h) => {
		if (h.phase === "open") {
			return `${h.escalationId} (open${h.expiredAt !== undefined ? ", expired" : ""} — awaiting ruling)`;
		}
		return `${h.escalationId} (ruled by ${h.ruling?.actor.role ?? "?"}, ruling not yet acknowledged by a worker)`;
	});
	return {
		blocked: true,
		reason: `completion withheld: ${parts.join("; ")}`,
		escalationIds: binding.map((h) => h.escalationId),
	};
}

/** Task-level view: blocked if ANY unit of the task is blocked. */
export function taskCompletionBlocked(holds: readonly HoldRecord[], taskId: string): boolean {
	return holdsForTask(holds, taskId).some(isHoldUnresolved);
}

// ── Mail classification & ruling validation ───────────────────────────

export type HoldMailKind = "ruling" | "ack" | "query" | "abort" | "ignore";

/**
 * Classify a message that arrived in a held unit's inbox. Only the runner
 * consumes hold-control mail; anything that is not addressed to an unresolved
 * hold of this unit is `ignore` (left for ordinary delivery).
 */
export function classifyHoldMail(
	msg: Pick<MailboxMessage, "type" | "replyTo">,
	holds: readonly HoldRecord[],
	taskId: string,
	segmentId: string | null | undefined,
): HoldMailKind {
	const unitHolds = unresolvedHoldsForUnit(holds, taskId, segmentId);
	if (unitHolds.length === 0) return "ignore";
	switch (msg.type) {
		case "ruling":
			return "ruling";
		case "info":
			return "ack";
		case "query":
			return "query";
		case "abort":
			return "abort";
		default:
			// `steer` is ordinary mail — it does NOT release a hold (spec §Mailbox).
			return "ignore";
	}
}

export type RulingValidation =
	| { ok: true; hold: HoldRecord }
	| {
			ok: false;
			code:
				| "not-a-ruling"
				| "missing-reply-to"
				| "unknown-escalation"
				| "wrong-unit"
				| "wrong-execution"
				| "not-open"
				| "missing-actor"
				| "invalid-role"
				| "empty-instructions";
			reason: string;
	  };

export interface RulingScope {
	taskId: string;
	segmentId: string | null | undefined;
	/** When provided, the ruling must target this lane run (guards lane-id reuse). */
	executionId?: string;
}

const VALID_ROLES: ReadonlySet<string> = new Set<RulingActorRole>(["supervisor", "operator"]);

/**
 * A ruling is valid only when it is a `ruling` message, correlated by
 * `replyTo` to an OPEN hold of exactly this unit (and execution, when known),
 * carries a trusted actor with a recognised role, and has instructions.
 * Timestamps and "later steer" are never sufficient.
 */
export function validateRuling(
	msg: Pick<MailboxMessage, "type" | "replyTo" | "content" | "actor">,
	holds: readonly HoldRecord[],
	scope: RulingScope,
): RulingValidation {
	if (msg.type !== "ruling") {
		return { ok: false, code: "not-a-ruling", reason: `message type "${msg.type}" is not a ruling` };
	}
	if (!msg.replyTo) {
		return {
			ok: false,
			code: "missing-reply-to",
			reason: "ruling has no replyTo — it must name the escalation id it resolves",
		};
	}
	const hold = findHold(holds, msg.replyTo);
	if (!hold) {
		return {
			ok: false,
			code: "unknown-escalation",
			reason: `no hold with escalation id ${msg.replyTo}`,
		};
	}
	if (!holdBindsUnit(hold, scope.taskId, scope.segmentId)) {
		return {
			ok: false,
			code: "wrong-unit",
			reason: `escalation ${hold.escalationId} belongs to ${hold.taskId}${hold.segmentId ? `::${hold.segmentId}` : ""}, not this unit`,
		};
	}
	if (scope.executionId !== undefined && hold.executionId !== scope.executionId) {
		return {
			ok: false,
			code: "wrong-execution",
			reason: `escalation ${hold.escalationId} was raised by execution ${hold.executionId}, not ${scope.executionId}`,
		};
	}
	if (hold.phase !== "open") {
		return {
			ok: false,
			code: "not-open",
			reason: `escalation ${hold.escalationId} is already ${hold.phase}`,
		};
	}
	const actor = msg.actor;
	if (!actor || typeof actor !== "object" || typeof actor.id !== "string" || !actor.id) {
		return {
			ok: false,
			code: "missing-actor",
			reason: "ruling carries no trusted actor stamp",
		};
	}
	if (!VALID_ROLES.has(actor.role)) {
		return {
			ok: false,
			code: "invalid-role",
			reason: `actor role "${String(actor.role)}" is not supervisor|operator`,
		};
	}
	if (typeof msg.content !== "string" || msg.content.trim().length === 0) {
		return { ok: false, code: "empty-instructions", reason: "ruling has no instructions" };
	}
	return { ok: true, hold };
}

// ── Transitions (pure) ────────────────────────────────────────────────

export function applyRuling(
	hold: HoldRecord,
	msg: Pick<MailboxMessage, "id" | "replyTo" | "content" | "actor">,
	now: number = Date.now(),
): HoldRecord {
	if (hold.phase !== "open")
		throw new Error(`cannot rule on ${hold.phase} hold ${hold.escalationId}`);
	if (!msg.actor) throw new Error("ruling without actor");
	return {
		...hold,
		phase: "released",
		ruling: {
			id: msg.id,
			replyTo: msg.replyTo ?? hold.escalationId,
			actor: { ...msg.actor },
			instructions: msg.content,
			acceptedAt: now,
		},
		deliveryState: "pending",
	};
}

export function recordAcknowledgement(hold: HoldRecord, now: number = Date.now()): HoldRecord {
	// Acks never change phase or deadline.
	return { ...hold, lastAcknowledgedAt: now };
}

export function markDeliveryInFlight(hold: HoldRecord, attemptId: string): HoldRecord {
	if (hold.phase !== "released") throw new Error(`no ruling to deliver on ${hold.escalationId}`);
	return { ...hold, deliveryState: "in-flight", deliveryAttemptId: attemptId };
}

export function markDeliveryAcknowledged(hold: HoldRecord): HoldRecord {
	if (hold.phase !== "released") throw new Error(`no ruling to acknowledge on ${hold.escalationId}`);
	return { ...hold, deliveryState: "acknowledged" };
}

export function cancelHold(hold: HoldRecord, reason: string, now: number = Date.now()): HoldRecord {
	return { ...hold, phase: "cancelled", cancelReason: reason, cancelledAt: now };
}

export function expireHold(hold: HoldRecord, now: number = Date.now()): HoldRecord {
	if (hold.phase !== "open" || hold.expiredAt !== undefined) return hold;
	return { ...hold, expiredAt: now };
}

/** Replace a record by escalation id (or append). Never drops other holds. */
export function upsertHold(holds: readonly HoldRecord[], record: HoldRecord): HoldRecord[] {
	const idx = holds.findIndex((h) => h.escalationId === record.escalationId);
	if (idx === -1) return [...holds, record];
	const next = holds.slice();
	next[idx] = record;
	return next;
}

/**
 * Escalations in a worker's outbox that have no hold record yet. Used at
 * escalation time and on resume replay (crash between outbox write and hold
 * persist must not lose the hold).
 */
export interface EscalationScopeFilter {
	taskId: string;
	segmentId: string | null | undefined;
	/**
	 * Accept an UNSCOPED escalation only if it was written at/after this time
	 * (i.e. by the worker of the current run). Older unscoped messages are
	 * ambiguous and are never guessed into this unit.
	 */
	sinceTs?: number;
}

export function selectUnrecordedEscalations(
	outbox: readonly MailboxMessage[],
	holds: readonly HoldRecord[],
	filter?: EscalationScopeFilter,
): MailboxMessage[] {
	const known = new Set(holds.map((h) => h.escalationId));
	return outbox.filter((m) => {
		if (m.type !== "escalate" || known.has(m.id)) return false;
		if (!filter) return true;
		return escalationMatchesUnit(m, filter);
	});
}

/** Does this escalation belong to the unit (by stamp, or — unscoped — by time)? */
export function escalationMatchesUnit(
	m: Pick<MailboxMessage, "scope" | "timestamp">,
	filter: EscalationScopeFilter,
): boolean {
	if (m.scope) {
		return (
			m.scope.taskId === filter.taskId && (m.scope.segmentId ?? null) === (filter.segmentId ?? null)
		);
	}
	return filter.sinceTs !== undefined && m.timestamp >= filter.sinceTs;
}

/**
 * A worker reply that acknowledges delivery of a ruling: `reply` with
 * `replyTo` equal to the ruling id of an in-flight/pending hold of this unit.
 */
export function findDeliveryAcknowledgements(
	outbox: readonly Pick<MailboxMessage, "type" | "replyTo">[],
	holds: readonly HoldRecord[],
	taskId: string,
	segmentId: string | null | undefined,
): HoldRecord[] {
	const awaiting = holdsForUnit(holds, taskId, segmentId).filter(
		(h) => h.phase === "released" && h.deliveryState !== "acknowledged" && h.ruling,
	);
	if (awaiting.length === 0) return [];
	const replyIds = new Set(
		outbox.filter((m) => m.type === "reply" && m.replyTo).map((m) => m.replyTo as string),
	);
	return awaiting.filter((h) => replyIds.has(h.ruling!.id));
}

// ── Prompts & summaries ───────────────────────────────────────────────

/**
 * Ruling block for the relaunched worker's INITIAL input. Placed ahead of the
 * ordinary task instructions. Includes the acknowledgement contract.
 */
export function buildRulingPromptLines(holds: readonly HoldRecord[]): string[] {
	const delivered = holds.filter((h) => h.phase === "released" && h.ruling);
	if (delivered.length === 0) return [];
	const lines: string[] = [
		"## Ruling received — read before anything else",
		"",
		"You previously escalated to the supervisor and the lane was held. A ruling has been issued.",
		"",
	];
	for (const h of delivered) {
		const r = h.ruling!;
		lines.push(
			`### Ruling ${r.id} (by ${r.actor.role}${r.actor.authorizationRef ? `, ref ${r.actor.authorizationRef}` : ""}) — resolves escalation ${h.escalationId}`,
			"",
			`Your escalation: "${truncate(h.escalation, 400)}"`,
			"",
			"Ruling:",
			...r.instructions.split("\n").map((l) => `> ${l}`),
			"",
		);
	}
	lines.push(
		"**First action:** acknowledge receipt by calling " +
			`notify_supervisor(content="ack ruling", replyTo="${delivered[0].ruling!.id}")` +
			(delivered.length > 1 ? " (one call per ruling id above)" : "") +
			" — the runtime will not accept task completion until every ruling is acknowledged.",
		"",
		"Then apply the ruling. A ruling releases execution; it does not approve the result — review",
		"gates still apply, and you must not claim a ruling in a commit message except via the trailer",
		`\`Taskplane-Ruling: ${delivered.map((h) => h.ruling!.id).join(", ")}\`.`,
		"",
	);
	return lines;
}

export function buildHoldStatusSummary(
	holds: readonly HoldRecord[],
	now: number = Date.now(),
): string {
	if (holds.length === 0) return "no holds";
	return holds
		.map((h) => {
			const unit = h.segmentId ? `${h.taskId}::${h.segmentId}` : h.taskId;
			const age = Math.max(0, Math.round((now - h.openedAt) / 60_000));
			const left = Math.round((h.deadline - now) / 60_000);
			let state: string;
			if (h.phase === "open") {
				state = isHoldExpired(h, now) ? "open, EXPIRED" : `open, ${left} min to deadline`;
			} else if (h.phase === "released") {
				state = `released by ${h.ruling?.actor.role} (delivery ${h.deliveryState})`;
			} else {
				state = `cancelled${h.cancelReason ? `: ${h.cancelReason}` : ""}`;
			}
			return `${unit} lane ${h.laneNumber} · ${h.escalationId} · ${state} · opened ${age} min ago · "${truncate(h.escalation, 120)}"`;
		})
		.join("\n");
}

function truncate(s: string, n: number): string {
	const one = s.replace(/\s+/g, " ").trim();
	return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

// ── Persistence validation ────────────────────────────────────────────

const PHASES: ReadonlySet<string> = new Set<HoldPhase>(["open", "released", "cancelled"]);
const DELIVERY: ReadonlySet<string> = new Set<HoldDeliveryState>([
	"none",
	"pending",
	"in-flight",
	"acknowledged",
]);

/** Structural validation for a persisted hold record (schema v5). */
export function isValidHoldRecord(obj: unknown): obj is HoldRecord {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
	const h = obj as Record<string, unknown>;
	if (typeof h.escalationId !== "string" || !h.escalationId) return false;
	if (typeof h.batchId !== "string" || typeof h.taskId !== "string") return false;
	if (h.segmentId !== null && typeof h.segmentId !== "string") return false;
	if (typeof h.executionId !== "string" || typeof h.agentId !== "string") return false;
	if (typeof h.laneNumber !== "number") return false;
	if (typeof h.openedAt !== "number" || typeof h.deadline !== "number") return false;
	if (typeof h.phase !== "string" || !PHASES.has(h.phase)) return false;
	if (typeof h.escalation !== "string") return false;
	if (typeof h.deliveryState !== "string" || !DELIVERY.has(h.deliveryState)) return false;
	if (h.phase === "released") {
		const r = h.ruling as Record<string, unknown> | undefined;
		if (!r || typeof r !== "object") return false;
		if (typeof r.id !== "string" || typeof r.replyTo !== "string") return false;
		if (r.replyTo !== h.escalationId) return false;
		const a = r.actor as Record<string, unknown> | undefined;
		if (!a || typeof a.id !== "string" || !VALID_ROLES.has(String(a.role))) return false;
		if (typeof r.instructions !== "string" || typeof r.acceptedAt !== "number") return false;
	}
	return true;
}

// ── Store contract ────────────────────────────────────────────────────

/**
 * Hold persistence contract handed to the lane-runner by the engine.
 *
 * Transitions that open or release a hold MUST be durable before the runner
 * acts on them (acks the escalation, spawns with a ruling, completes): `open`
 * and `update` therefore persist synchronously and THROW on failure. This is
 * deliberately not the best-effort `persistRuntimeState()` path — a lost hold
 * is a released hold.
 */
export interface HoldStore {
	/** Current hold table (all units of the batch). Returns a fresh array. */
	list(): HoldRecord[];
	/** Persist a new hold. Idempotent on escalation id. Throws on persistence failure. */
	open(record: HoldRecord): void;
	/** Persist a transitioned record (must already exist). Throws on persistence failure. */
	update(record: HoldRecord): void;
}

export class HoldPersistenceError extends Error {
	readonly escalationId: string;
	constructor(escalationId: string, cause: unknown) {
		super(
			`hold ${escalationId} could not be persisted: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		this.name = "HoldPersistenceError";
		this.escalationId = escalationId;
	}
}

/**
 * Build a store over a mutable owner (the engine's runtime batch state).
 * `persist` must write the WHOLE batch state durably and throw on failure;
 * on failure the in-memory table is rolled back so memory never claims a
 * hold the disk does not have.
 */
export function createHoldStore(
	owner: { holds?: HoldRecord[] },
	persist: (reason: string) => void,
): HoldStore {
	const commit = (next: HoldRecord[], reason: string, escalationId: string): void => {
		const prev = owner.holds;
		owner.holds = next;
		try {
			persist(reason);
		} catch (err) {
			owner.holds = prev;
			throw new HoldPersistenceError(escalationId, err);
		}
	};
	return {
		list: () => (owner.holds ?? []).map((h) => ({ ...h })),
		open: (record) => {
			const current = owner.holds ?? [];
			if (current.some((h) => h.escalationId === record.escalationId)) return; // idempotent
			commit([...current, { ...record }], `hold-open:${record.escalationId}`, record.escalationId);
		},
		update: (record) => {
			const current = owner.holds ?? [];
			if (!current.some((h) => h.escalationId === record.escalationId)) {
				throw new HoldPersistenceError(record.escalationId, new Error("unknown hold"));
			}
			commit(
				upsertHold(current, { ...record }),
				`hold-${record.phase}:${record.escalationId}`,
				record.escalationId,
			);
		},
	};
}

/** Volatile store for tests and legacy callers that run without an engine. */
export function createInMemoryHoldStore(initial: HoldRecord[] = []): HoldStore {
	return createHoldStore({ holds: [...initial] }, () => {});
}

// ── Reconstruction from durable mailbox evidence ───────────────────────

export type HoldReconstruction =
	| {
			ok: true;
			holds: HoldRecord[];
			evidence: { escalations: number; rulings: number; acks: number };
	  }
	| { ok: false; error: string };

/**
 * Rebuild the hold table for a batch whose `batch-state.json` is gone, from the
 * mailbox on disk (Sage review, blocker 7). Authority must be recoverable or
 * the reconstruction is refused — never silently empty.
 *
 * Evidence considered, per `<agent>-worker` mailbox directory:
 *  - `escalate` messages in `outbox/` and `outbox/processed/` → hold candidates.
 *    Attribution is by the message's stamped `scope` ONLY: an unscoped
 *    escalation cannot be attributed (registry manifests are overwritten, so a
 *    lane's "current task" is not ownership evidence) → refuse.
 *  - `ruling` messages in the agent's `inbox/` and `ack/` → release, when the
 *    FULL ruling validation passes against the candidate (correlation, unit,
 *    actor, instructions). Earliest valid ruling wins (deterministic).
 *  - `reply` messages in `outbox/` + `outbox/processed/` with `replyTo` =
 *    ruling id → delivery acknowledged.
 *  - Nothing else changes phase: an escalation with no valid ruling stays
 *    OPEN (fail closed; the operator rules or aborts).
 *  - Segment-scoped evidence with no segment topology to attach to → refuse
 *    (the caller reconstructs `segments: []`).
 *  - Unreadable or malformed mailbox files → refuse, not "no evidence".
 */
export function reconstructHoldsFromMailbox(
	stateRoot: string,
	batchId: string,
	opts: {
		knownTaskIds: ReadonlySet<string>;
		/** True when the caller can attach segment-scoped holds to real segment records. */
		hasSegmentTopology: boolean;
		laneNumberForAgent: (agentId: string) => number | undefined;
		holdTimeoutMinutes?: number;
		now?: number;
	},
): HoldReconstruction {
	const root = join(stateRoot, ".pi", "mailbox", batchId);
	if (!existsSync(root))
		return { ok: true, holds: [], evidence: { escalations: 0, rulings: 0, acks: 0 } };

	const readMessages = (dir: string): MailboxMessage[] | { error: string } => {
		if (!existsSync(dir)) return [];
		let entries: string[];
		try {
			entries = readdirSync(dir).filter((f) => f.endsWith(".msg.json"));
		} catch (err) {
			return { error: `${dir}: ${err instanceof Error ? err.message : String(err)}` };
		}
		const out: MailboxMessage[] = [];
		for (const f of entries.sort()) {
			try {
				const parsed = JSON.parse(readFileSync(join(dir, f), "utf-8")) as MailboxMessage;
				if (
					!parsed ||
					typeof parsed !== "object" ||
					typeof parsed.id !== "string" ||
					typeof parsed.type !== "string"
				) {
					return { error: `${join(dir, f)}: malformed mailbox message` };
				}
				if (parsed.batchId !== batchId) continue;
				out.push(parsed);
			} catch (err) {
				return { error: `${join(dir, f)}: ${err instanceof Error ? err.message : String(err)}` };
			}
		}
		return out;
	};

	let agents: string[];
	try {
		agents = readdirSync(root).filter((d) => d.endsWith("-worker"));
	} catch (err) {
		return {
			ok: false,
			error: `mailbox root unreadable: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const holds: HoldRecord[] = [];
	const evidence = { escalations: 0, rulings: 0, acks: 0 };
	for (const agentId of agents) {
		const outboxes = [
			readMessages(join(root, agentId, "outbox")),
			readMessages(join(root, agentId, "outbox", "processed")),
		];
		const inboxes = [
			readMessages(join(root, agentId, "inbox")),
			readMessages(join(root, agentId, "ack")),
		];
		for (const r of [...outboxes, ...inboxes]) {
			if (!Array.isArray(r))
				return { ok: false, error: `hold authority cannot be recovered: ${r.error}` };
		}
		const outbox = (outboxes as MailboxMessage[][]).flat();
		const inbox = (inboxes as MailboxMessage[][]).flat();
		const laneNumber = opts.laneNumberForAgent(agentId);

		for (const esc of outbox.filter((m) => m.type === "escalate")) {
			evidence.escalations++;
			if (!esc.scope) {
				return {
					ok: false,
					error: `hold authority cannot be recovered: escalation ${esc.id} in ${agentId}'s outbox has no unit scope and cannot be attributed. Restore .pi/batch-state.json from backup, or resolve the escalation out of band and move the message out of the mailbox.`,
				};
			}
			if (!opts.knownTaskIds.has(esc.scope.taskId)) {
				return {
					ok: false,
					error: `hold authority cannot be recovered: escalation ${esc.id} names task ${esc.scope.taskId}, which is not part of the reconstructed batch.`,
				};
			}
			if (esc.scope.segmentId && !opts.hasSegmentTopology) {
				return {
					ok: false,
					error: `hold authority cannot be recovered: escalation ${esc.id} is scoped to segment ${esc.scope.segmentId} but the segment topology cannot be reconstructed. Restore .pi/batch-state.json from backup.`,
				};
			}
			if (laneNumber === undefined) {
				return {
					ok: false,
					error: `hold authority cannot be recovered: no lane number for ${agentId}`,
				};
			}
			let record = createHoldRecord({
				escalation: esc,
				batchId,
				taskId: esc.scope.taskId,
				segmentId: esc.scope.segmentId ?? null,
				executionId: "reconstructed",
				agentId,
				laneNumber,
				holdTimeoutMinutes: opts.holdTimeoutMinutes ?? HOLD_TIMEOUT_MINUTES_DEFAULT,
				now: opts.now,
			});
			// Earliest VALID ruling releases.
			const rulings = inbox
				.filter((m) => m.type === "ruling" && m.replyTo === esc.id)
				.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
			for (const r of rulings) {
				const v = validateRuling(r, [record], { taskId: record.taskId, segmentId: record.segmentId });
				if (v.ok) {
					record = applyRuling(record, r, r.timestamp);
					evidence.rulings++;
					break;
				}
			}
			if (record.phase === "released" && record.ruling) {
				const rulingId = record.ruling.id;
				if (outbox.some((m) => m.type === "reply" && m.replyTo === rulingId)) {
					record = markDeliveryAcknowledged(markDeliveryInFlight(record, "reconstructed"));
					evidence.acks++;
				}
			}
			holds.push(record);
		}
	}
	return { ok: true, holds, evidence };
}
