# Bridge and Mailbox Protocols

**Status:** Proposed  
**Related:** [02-runtime-process-model.md](02-runtime-process-model.md), `docs/specifications/taskplane/agent-mailbox-steering.md`

## 1. Purpose

Runtime V2 needs two distinct communication layers:

1. **Mailbox** — cross-agent / supervisor messaging, durable, asynchronous, auditable
2. **Runtime bridge** — deterministic request/response protocol between lane-runner and Pi agents for execution-time callbacks such as reviews and segment-expansion requests

The current mailbox work (TP-089, TP-090) remains strategically correct and
should be preserved. What changes is the runtime substrate around it.

## 2. Mailbox remains the canonical steering channel

### Rule

Operators do not type into agents directly.

Communication path is always:

```text
operator -> supervisor -> mailbox -> agent-host -> Pi RPC steer -> agent
```

This is a feature, not a limitation:

- one conversation surface for the user
- auditable steering history
- no terminal-state hazards
- no accidental agent bypass of supervisor policy

## 3. Mailbox identity model

Mailbox addressing continues to use the familiar current strings, but they are
**agent IDs**, not TMUX session names.

### Examples

- `orch-henrylach-lane-1-worker`
- `orch-henrylach-lane-1-reviewer`
- `orch-henrylach-merge-1`
- `_broadcast`

Existing TP-089/090 file layout can be preserved:

```text
.pi/mailbox/{batchId}/
├── {agentId}/
│   ├── inbox/
│   ├── ack/
│   ├── outbox/
│   └── processed/
└── _broadcast/
    └── inbox/
```

## 4. Supervisor -> agent flow

```text
supervisor tool
  -> write mailbox message
    -> agent-host checks inbox at message_end
      -> inject via Pi RPC steer
        -> move inbox file to ack/
          -> emit message-delivered event
```

### Required properties

- delivery occurs at turn boundaries
- delivery is durable across host crashes until acked
- dashboard shows pending vs delivered status
- no TMUX liveness check is involved

### `send_agent_message` validation source

`send_agent_message()` should validate against the **process registry**, not TMUX:

- batch exists and is non-terminal
- target agent ID exists in registry for the batch
- target is in a live/steerable state

## 5. Agent -> supervisor flow

TP-091 becomes a first-class Runtime V2 feature, not an afterthought.

```text
agent tool / bridge
  -> write outbox message
    -> engine or lane-runner polls/receives it
      -> emit supervisor alert + dashboard event
        -> supervisor may reply through mailbox
```

### Required message types

- `reply`
- `escalate`

### Typical use cases

- worker asks for guidance under ambiguity
- worker acknowledges a steering message with a status update
- reviewer escalates malformed request or blocked state
- merge agent escalates impossible/manual conflict
- future segment expansion request references supervisor decision flow

## 6. Mailbox follow-ons under Runtime V2

## 6.1 TP-091 — replies

Keep the task, but re-scope implementation assumptions:

- outbox reader should be engine/lane-runner/process-registry aware
- reply display should target supervisor + dashboard surfaces
- session-name assumptions must become agent-ID assumptions

## 6.2 TP-092 — broadcast and rate limiting

Keep the task almost unchanged.

Runtime V2 still needs:

- `_broadcast` support
- per-agent rate limiting
- compatibility with mailbox delivery at `message_end`

## 6.3 TP-093 — dashboard mailbox panel

Keep the task, but build the panel on top of:

- mailbox directories
- registry-backed agent metadata
- normalized message delivery events

not TMUX-derived lane/session assumptions.

## 7. Runtime bridge purpose

The mailbox is not sufficient for synchronous execution callbacks like:

- `review_step`
- `wait_for_review`
- `request_segment_expansion`
- structured runtime acknowledgments that must return data to the current turn

These need a **bridge protocol** between Pi agents and their deterministic owner.

## 8. Bridge design goals

1. deterministic and file-backed
2. works in worker/reviewer/merge agents without TMUX
3. supports request/response semantics
4. survives parent/child crashes cleanly
5. is minimal and role-focused

## 9. Bridge topology

Per-agent bridge directories live under the runtime root:

```text
.pi/runtime/{batchId}/agents/{agentId}/bridge/
├── requests/
├── responses/
└── signals/
```

### Protocol shape

- agent-side bridge tool writes a request file
- deterministic owner writes a response file
- tool polls/waits for matching response with timeout

This mirrors the existing file-first coordination style already used in Taskplane.

## 10. Minimal bridge tools

## 10.1 `review_step`

Available to worker agents.

Request shape:

```json
{
  "id": "req-001",
  "type": "review_step",
  "taskId": "TP-091",
  "step": 2,
  "reviewType": "plan",
  "requestPath": "...",
  "responsePath": "..."
}
```

Response shape:

```json
{
  "id": "req-001",
  "ok": true,
  "verdict": "APPROVE",
  "reviewPath": "...",
  "summary": "No blocking issues"
}
```

### Baseline requirement

The worker must be able to request and receive a deterministic review verdict
without the lane itself being a Pi extension host.

## 10.2 `notify_supervisor`

Available to all agent roles.

Purpose:

- durable agent -> supervisor escalation
- convenience wrapper for outbox writing
- avoids requiring agents to hand-roll JSON with `write`/`bash`

## 10.3 `reply_supervisor`

Available to all agent roles.

Purpose:

- structured response to a `query`
- explicit threading through `replyTo`

## 10.4 `request_segment_expansion`

Available to worker agents in segment-aware runtime.

Purpose:

- structured handoff into the future TP-086 / TP-087 expansion flow

## 10.5 `wait_for_review` (optional optimization)

This remains optional for the first stable Runtime V2 cut.

If persistent reviewers are retained or reintroduced, `wait_for_review` can be
implemented as a bridge-based parked reviewer flow. If not, Runtime V2 may use
fresh reviewer processes first and add persistent reviewer parking later.

## 11. Why bridge + mailbox instead of one protocol

They solve different problems:

| Need | Mailbox | Bridge |
|---|---|---|
| Supervisor steering | ✅ | ❌ |
| Agent replies/escalations | ✅ | ⚠️ could, but not ideal |
| Audit trail | ✅ | ✅ |
| Synchronous tool result | ❌ | ✅ |
| Cross-role messaging | ✅ | ❌ owner-local only |
| Review callback | ❌ | ✅ |

## 12. Conversation visibility contract

Mailbox events and bridge events both need to be visible downstream.

### Mailbox event types

- `message_sent`
- `message_delivered`
- `message_replied`
- `message_escalated`
- `message_rate_limited`

### Bridge event types

- `review_requested`
- `review_completed`
- `review_failed`
- `segment_expansion_requested`
- `segment_expansion_decided`

The dashboard should render these without needing to inspect raw implementation files.

## 13. Supervisor-facing tool set after redesign

Required tools:

- `send_agent_message(to, content, type?)`
- `read_agent_replies(from?)`
- `broadcast_message(content, type?)`
- existing recovery tools (`orch_retry_task`, `orch_skip_task`, `orch_force_merge`, etc.)

### Recommended additions

- `read_agent_messages(agentId?)` — unified sent + delivered + reply history
- `read_agent_events(agentId?)` — normalized event tail for diagnosis

## 14. Rate limiting

Rate limiting from TP-092 remains valid.

### Required policy

- max 1 supervisor-originated message per agent per 30 seconds by default
- broadcast counts against each recipient’s budget
- `abort` may bypass or use a stricter dedicated policy if required
- rate-limit decisions are surfaced to supervisor and dashboard

## 15. Failure semantics

### Mailbox failure

If mailbox delivery fails:

- message remains in inbox until delivered or explicitly invalidated
- invalid target/state is rejected before write
- ack state remains authoritative for delivery confirmation

### Bridge failure

If a bridge request times out:

- the tool call returns a structured failure to the agent
- deterministic owner records the timeout in runtime events
- supervisor may be alerted if policy requires

## 16. Acceptance criteria

This protocol layer is accepted when:

- steering works without TMUX installed
- agents can escalate/reply without hand-rolling JSON via generic tools
- worker review callbacks no longer depend on the lane being a Pi extension host
- dashboard can show mailbox activity and bridge-driven review activity
- TP-091, TP-092, TP-093, and future TP-086 all fit the same protocol family
