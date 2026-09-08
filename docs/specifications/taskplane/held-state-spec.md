# Held state and typed rulings — design spec (#627, companion to #626/#628/#630/#631)

Status: **Stage 1 implemented**; **Stage 2a (ratification record + finalize binding) implemented** (#627, TP-198); **Stage 2b (`authorizeCompletion()` unification + `Taskplane-Ruling:` trailer validation) implemented** (#627, TP-199). Design Sage-reviewed 2026-09-07. Stages 3–4 below.

## Problem

A review-cap escalation has no runtime representation. The lane "holds" only as long as the
worker's prompt discipline and a supervisor's acknowledgements keep it alive: every relaunch spawns a
real worker, hold state is volatile (lost on pause/resume), any `steer` releases it, `.DONE` and the
wave merge have no precondition tied to an open escalation, and the stall monitor cannot tell a held
lane from a dead one. Four incidents (TP-2037/2039/2042/2047) and one hour-long ack loop.

## Design in one paragraph

`held` is a **non-terminal execution-unit state owned by the lane-runner**, not a worker state. While
held, `executeTaskV2()` awaits a cheap, cancellable in-engine wait loop: no worker or reviewer process,
no relaunches, no iteration/stall consumption. The hold is a **durable record in `batch-state.json`**
(top-level `holds` table) written through a **strict** persistence path *before* the escalation is
acknowledged. It is released **only** by a typed ruling whose `replyTo` equals the escalation id and
whose actor role was stamped by a trusted issuing path. The ruling is delivered in the relaunched
worker's **initial prompt** and considered delivered only on explicit acknowledgement. A **single
completion-authorization predicate** is consulted by every path that can complete, merge, or clean up a
unit. The wave barrier is unchanged: a held lane blocks *that wave's* completion/merge, not its peers.

## Data

```ts
interface HoldRecord {
  escalationId: string;            // primary key within batch (idempotent on duplicates)
  batchId: string; taskId: string; segmentId: string | null;
  executionId: string;             // durable unit-attempt identity, not a pid
  agentId: string; laneNumber: number;   // mailbox alias; may have no live process
  openedAt: number; deadline: number; expiredAt?: number;
  phase: "open" | "released" | "cancelled";
  escalation: string;              // full request text
  gateRefs?: ReviewGateRef[];
  ruling?: { id: string; replyTo: string; actor: { role: "supervisor" | "operator"; id: string;
             authorizationRef?: string }; instructions: string; acceptedAt: number };
  deliveryState: "none" | "pending" | "in-flight" | "acknowledged";
  deliveryAttemptId?: string;
  ratificationIds?: string[];
}
```

- `held` added to task status, segment status, monitor state, lane snapshot. **Not** added to
  `RuntimeAgentStatus` — the worker really exited; the held snapshot has `worker: null` + hold summary.
- Schema bump; old states load an empty `holds` table. Multiple open holds per unit allowed; all must
  resolve. **Retry is not release** — holds survive `orch_retry_task`.
- Config: `taskRunner.worker.holdTimeoutMinutes` (default 240). `deadline = openedAt + timeout`; **acks never
  extend it; administrative pause and engine downtime do not suspend it**; renewal is an explicit,
  audited operator action.

## Transitions

| Event | Behaviour |
|---|---|
| Blocking escalation in outbox | Persist open hold (strict) **before** acking/draining; install completion barrier |
| Worker still alive | Quiesce at a safe boundary; terminate stragglers; premature-exit re-prompting disabled |
| No processes | Publish `held` (status, snapshot, STATUS.md line); enter runner wait loop |
| `info` | Record ack; no spawn, no release, no deadline change |
| `query` | Wake runner, answer from stored hold/escalation; **no release, no spawn** |
| Typed ruling, correlated + authorized | Persist ruling + `deliveryState=pending`; continue when batch executable |
| Continuation | Persist delivery attempt; ruling text at top of the worker's initial prompt; replayed until acknowledged (`notify_supervisor(replyTo=rulingId)`); at-least-once |
| `abort` | Cancel hold, never approve; preserve evidence |
| Pause (any cause) | Wait loop exits; lane returns **`held`** outcome; record + worktree preserved |
| Deadline expiry | `expiredAt` set; one alert; batch parks paused with cause **`hold-timeout`** (never cleared by Tier-0 policy); task stays held |

Hold checks are **not** buried under `progressDelta <= 0` / clean-exit — a worker that checks every
box, crashes, or writes `.DONE` cannot escape an open hold.

## Mailbox and authority

- `MailboxTarget = live-agent | held-unit {agentId, taskId, segmentId, executionId, escalationIds}`.
  Held targets require `replyTo` and bind to the exact unit (lane-id reuse cannot deliver a stale ruling).
- `send_agent_message` gains an explicit **ruling** form (`type: "ruling"`, `replyTo` required).
  **Plain `steer` no longer releases a hold.** Results: *delivered* / *queued for runner* / *queued while paused*.
- Hold-control mail has **one consumer: the runner.** `agent-host.checkMailbox` and exit-intercept
  do not consume `ruling`/hold-scoped messages.
- Actor role is stamped by the issuing path: supervisor tool ⇒ `supervisor`; operator rulings need an
  explicit operator command/confirmation. Model-supplied `role: "operator"` or prose is not authority.

## Monitoring, wave, merge, cleanup

- Monitor resolves durable holds **before** `.DONE`, dead-pid and stall checks; held units are exempt
  from worker-stall accounting; runner heartbeats the lane snapshot (runner health ≠ worker liveness);
  a stale held heartbeat is an engine problem for recovery, never permission to complete/respawn.
- Held outcomes are neither failed nor skipped; later tasks on the lane stay pending; a held segment
  never advances the frontier; an interrupted wave never falls through as successful.
- Ordinary merge, catch-up merge and force-merge **reject** branches with unresolved held work.
- Cleanup protects held worktrees **even when git-clean** (committed-but-unmerged work matters).
- `supervisor_takeover` / `orch_pause` on a held unit: preserve; never drain unpersisted escalations;
  notification suppression and execution state handled separately.

## Resume order (hold-first)

1. Verify engine ownership (#631). 2. Load/validate holds; replay unprocessed scope-stamped
escalation/control mail (covers crash between outbox write and hold persist). 3. Apply hold authority
to task and segment frontiers. 4. Only then inspect `.DONE`, choose reconnect/re-execute, consider
catch-up merge. 5. Restore held controllers **without spawning**.
**Interrupted-work re-execution becomes lane-parallel** (serial within a lane) so a restored hold does
not block unrelated resumed work.

## Finalize: permission to resume ≠ permission to finalize

A ruling releases execution; it does not approve the result. Order:
**ruling → fold → verification → ratification record → linked APPROVE → `.DONE`.**

```ts
interface GateRatification {
  id: string; taskId: string; segmentId: string | null; gate: string; rulingId: string;
  ratifier: Actor; closedEscalationIds: string[];
  supersededReview: { path: string; sha256: string };
  findings: Array<{ ref: string; disposition: "fixed" | "ruled"; evidenceRefs: string[] }>;
  proofSet: ProofRef[];            // revision + artifact hashes
}
```

A trusted operation validates and persists the record, then writes the next R-numbered APPROVE file
referencing it; the finalize gate validates reference, scope, authority and proof binding. Later
blocking reviews or relevant code changes invalidate a stale ratification.

**Stage 2a implemented (TP-198).** The record is written to
`R{NNN}-{gate}.ratification.json` (same `{NNN}` as the APPROVE markdown it
authorizes, allocated from the global `**Review Counter:**`), and the authorizing
APPROVE review file carries the exact link line `Ratification: <id>`. The trusted
operation is the `ratify_gate` supervisor tool (stamps role `supervisor`) and the
`/orch-ratify` operator command (stamps role `operator`); it canonicalizes the
proof to an immutable object id equal to the current worktree HEAD, requires a
clean (source) working tree, and audits `gate_ratified`. The finalize gate
(`findBlockingReviewGates` in `lane-runner.ts`) treats a linked APPROVE as
blocking unless the record validates (via `validateRatification`) and is not
`isRatificationStale`, emitting `review_gate_refusal` with
`reviewInterventionKind: "invalid-ratification"`. An APPROVE with NO
`Ratification:` link keeps today's behaviour (not blocking — the full coverage
gate is #626).

**Stage 2b implemented (TP-199).** `authorizeCompletion()` (`completion-authority.ts`)
is now the single completion predicate: it composes hold authority
(`evaluateCompletionAuthority`) → blocking review gates (latest REVISE/RETHINK) →
linked-APPROVE ratification validity, reporting ALL blockers. The lane-runner's
finalize path and resume's `.DONE` acceptance (`collectDoneTaskIdsForResume`)
both call it, so a worker-written `.DONE` over a blocking gate is refused on
resume exactly as it is live (including the clean-source-tree drift binding when
the lane worktree exists). An unauthorized worker-written `.DONE` is quarantined;
failure to remove it never makes it authoritative. Commits reference rulings via
a structured trailer `Taskplane-Ruling: <id>` (`ruling-trailer.ts`); after each
iteration the runtime validates every citation against the durable hold table and
FLAGS unknown ids, wrong-unit ids, and prose ruling claims — logged to STATUS,
written to the audit trail (`ruling_citation_flagged`, classification
`diagnostic`) and surfaced to the supervisor as one alert per iteration. A flag
never changes task status, releases a hold, or counts toward progress/stall, and
is never evidence of approval.

## Staging

- **Stage 1 — core held state** (#627, closes #630): types/schema/persistence (strict path),
  `hold-state.ts` (pure transitions, authority/correlation, delivery replay, deadline, completion
  predicate), mailbox typed ruling + held target + exclusive consumption, lane-runner controller
  replacing `pendingEscalation`/`MAX_HOLD_RELAUNCHES`, execution/engine (persistence callback, held
  monitoring, wave accounting, `hold-timeout` pause), resume hold-first + lane-parallel restart,
  extension/supervisor/merge/cleanup/worktree safeguards, dashboard `held`, primer/docs.
- **Stage 2 — ratification** (#627 remainder, feeds #626):
  - **Stage 2a (DONE, TP-198):** `GateRatification` record + validation + staleness (`ratification.ts`),
    trusted ratify operation (`ratifyGate` in `ratification-op.ts`; `ratify_gate` tool + `/orch-ratify`
    command), finalize-gate binding (`invalid-ratification` refusal), record filename
    `R{NNN}-{gate}.ratification.json` + `Ratification: <id>` link line.
  - **Stage 2b (DONE, TP-199):** `authorizeCompletion()` unification (`completion-authority.ts`)
    across the live finalize gate and resume `.DONE` acceptance, commit trailer
    (`Taskplane-Ruling: <id>`) parsing + validation (`ruling-trailer.ts`) with per-iteration
    citation flagging (`ruling_citation_flagged` audit + supervisor alert; diagnostic-only).
- **Stage 3 — #631 lease/generation** (fencing for split-brain; prerequisite for trusting single-writer).
- **Stage 4 — #628 takeover state machine**, **#626 full coverage gate**.

## Sage's pushbacks (accepted)
"Zero cost" = zero agent/token cost, not zero engine resources. Queries wake the runner, they don't buy a
worker session. Heartbeating STATUS.md is not a substitute for hold-aware monitoring. Prose commit
citations are unverifiable — require the structured trailer. Ratification is a companion feature.

## Risks
Split-brain engines (needs #631 fencing before trusting single-writer); crash/delivery gaps (strict
persist-before-ack + replay tests at every boundary); incomplete authority coverage (monitor, resume,
segment, recovery bypasses); forged provenance (workers share the filesystem — trusted issuance is not
a sandbox); scope creep.

## Required behavioural tests
Two-lane live **and resumed** execution with one held; same-lane serialization; `.DONE` over a hold
(worker-written, heuristic, monitor, resume); wrong-role / wrong-scope / stale-lane rulings; `query`
and `abort`; pause during delivery; deadline expiry → `hold-timeout`; duplicate escalations/rulings;
crash at each persistence/delivery boundary; stale ratification after a later REVISE.
