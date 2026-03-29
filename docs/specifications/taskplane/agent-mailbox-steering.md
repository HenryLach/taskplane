# Agent Mailbox: Cross-Agent Steering Protocol

**Status:** Draft  
**Author:** Supervisor (Claude)  
**Created:** 2026-03-28  
**Issue:** TBD

## Problem Statement

The supervisor has no way to communicate with running agents. When a worker
misinterprets a task, skips a review finding, or takes a wrong approach, the
supervisor is powerless until the agent finishes (or exhausts its context window
at $8+ cost). Similarly, agents have no way to escalate questions or report
blockers back to the supervisor without terminating.

### Concrete failures this would have prevented

1. **TP-080/081:** Worker implemented steps before requesting plan review.
   Supervisor could have sent: "Stop — call review_step(type=plan) BEFORE
   implementing. You're doing it backwards."
2. **TP-081:** Reviewer returned REQUEST CHANGES (mapped to UNKNOWN). Supervisor
   could have sent: "Re-read the review at .reviews/R002-code-step2.md and
   address the persistence durability gap before proceeding."
3. **TP-079:** Worker burned 18M tokens across 6 review cycles. Supervisor
   could have sent: "You're at 12M tokens. Commit what you have, wrap up, and
   mark the task complete."

## Design Goals

1. **Reliable delivery** — Messages must reach the intended agent, not get lost
2. **No misdelivery** — An agent must never receive a message intended for someone else
3. **No stale messages** — Messages from previous batches must never be seen
4. **Low overhead** — Checking for messages must be cheap (~0.1ms per check)
5. **Auditable** — All messages are preserved for post-batch analysis
6. **Zero dependencies** — No Redis, no database, no network services
7. **Cross-platform** — Windows, macOS, Linux
8. **Bidirectional** — Agents can reply to the supervisor

## Architecture: File Mailbox + RPC Injection

The system has two layers with distinct responsibilities:

1. **File-based mailbox** — coordination, addressing, lifecycle, audit trail.
   The supervisor writes message files; rpc-wrapper reads them; processed
   messages are preserved for debugging. Bidirectional: agents write replies
   to their outbox, the engine picks them up and alerts the supervisor.

2. **Pi RPC `steer` command** — actual delivery into the agent's LLM context.
   rpc-wrapper reads a message file from the inbox and injects it via the
   `steer` RPC command on the stdin pipe it owns to the pi process. The agent
   sees it as a user message on its next turn. Non-blocking, guaranteed.

**Why two layers?** rpc-wrapper is the only process that can inject into an
agent's context (it owns the stdin pipe). But the supervisor runs in a separate
process with no access to that pipe. The file mailbox bridges the gap. It also
provides bidirectional communication — agents can write replies to their outbox,
which the engine polls and surfaces to the supervisor via alerts.

Alternatives like `tmux send-keys` (typing JSON into the rpc-wrapper's terminal
stdin) were considered for direct injection but rejected: one-way only (no reply
channel), JSON escaping nightmares on Windows, and no delivery confirmation.
The file mailbox adds ~0.1ms of latency per turn check, which is negligible
against 2-30s LLM turns and delivers at the same cadence anyway (turn boundaries).

### Why file-based for the coordination layer

| Approach | Verdict | Reason |
|----------|---------|--------|
| **Files** | ✅ Selected | Zero deps, cross-platform, survives crashes, human-debuggable, bidirectional, already the coordination pattern |
| Named pipes | ❌ | Platform-specific (Windows vs Unix), don't survive process restarts, one-way |
| Unix domain sockets | ❌ | Not available on Windows |
| SQLite | ❌ | Adds a dependency, overkill for low-volume messaging |
| tmux send-keys | ❌ | One-way (no reply channel), JSON escaping issues on Windows, no delivery confirmation |
| Shared memory | ❌ | Platform-specific, complex, no persistence |
| Environment variables | ❌ | Immutable after process start |

File-based coordination is already the proven pattern in taskplane:
- `.DONE` files signal task completion
- `.review-signal-{NNN}` files coordinate reviewer handoff
- `lane-state-*.json` files share telemetry with the dashboard
- `merge-request-*.txt` files pass work to merge agents

## Architecture

### Directory Structure

```
.pi/mailbox/{batchId}/
├── {sessionName}/
│   ├── inbox/
│   │   └── {timestamp}-{nonce}.msg.json     # Pending message
│   ├── ack/
│   │   └── {timestamp}-{nonce}.msg.json     # Processed (moved from inbox)
│   └── outbox/
│       └── {timestamp}-{nonce}.msg.json     # Agent → supervisor reply
└── _broadcast/
    └── inbox/
        └── {timestamp}-{nonce}.msg.json     # Message to all agents
```

**Key design choices:**

- **Batch-scoped root:** `{batchId}` in the path makes stale message
  contamination structurally impossible. Different batches have different
  directories.
- **Session-scoped subdirectories:** Each agent has its own mailbox keyed by
  tmux session name (already guaranteed unique per batch).
- **Inbox/ack separation:** Processed messages move to `ack/` rather than
  being deleted, preserving a full audit trail.
- **Broadcast directory:** `_broadcast/` is a special address. Agents check
  both their own inbox AND `_broadcast/inbox/` on each poll.

### Message Format

```json
{
  "id": "1774744971303-a7f2c",
  "batchId": "20260328T195730",
  "from": "supervisor",
  "to": "orch-henrylach-lane-1",
  "timestamp": 1774744971303,
  "type": "steer",
  "priority": "normal",
  "content": "The reviewer found a persistence durability gap in R002. When you implement Step 3, add a regression test that persists state twice where a task is not in current lanes on the second write, and asserts v4 fields survive.",
  "expectsReply": false,
  "replyTo": null
}
```

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `steer` | supervisor → agent | Course correction. Agent must acknowledge and follow. |
| `query` | supervisor → agent | Request for status/info. Agent replies via outbox. |
| `abort` | supervisor → agent | Graceful stop. Agent wraps up current work and exits. |
| `info` | supervisor → agent | FYI context. Agent reads but no action required. |
| `reply` | agent → supervisor | Response to a `query` or acknowledgment of `steer`. |
| `escalate` | agent → supervisor | Agent-initiated: blocked, confused, or needs guidance. |

### Priority Levels

| Priority | Behavior |
|----------|----------|
| `normal` | Processed at next check cycle |
| `urgent` | Processed immediately; agent interrupts current work |

### Addressing

Agents are addressed by their tmux session name, which is unique per batch:

| Agent | Session Name Pattern | Example |
|-------|---------------------|---------|
| Worker | `orch-{opId}-lane-{N}` | `orch-henrylach-lane-1` |
| Reviewer | `orch-{opId}-lane-{N}-reviewer` | `orch-henrylach-lane-1-reviewer` |
| Merger | `orch-{opId}-merge-{N}` | `orch-henrylach-merge-1` |
| Broadcast | `_broadcast` | `_broadcast` |

The supervisor resolves session names from batch state (lane allocations).

## Delivery: Supervisor → Agent

### End-to-end data flow

```
Supervisor                    File System                    rpc-wrapper              pi (agent)
    │                              │                              │                       │
    │  send_agent_message(to,msg)  │                              │                       │
    │─────────────────────────────→│                              │                       │
    │  write inbox/{ts}-{nonce}.json                              │                       │
    │                              │                              │                       │
    │                              │   (on next message_end)      │                       │
    │                              │   readdirSync(inbox/)        │                       │
    │                              │◀─────────────────────────────│                       │
    │                              │   readFileSync(msg.json)     │                       │
    │                              │◀─────────────────────────────│                       │
    │                              │   validate batchId + to      │                       │
    │                              │                              │                       │
    │                              │                              │  steer RPC command    │
    │                              │                              │──────────────────────→│
    │                              │                              │  (queued, non-blocking)│
    │                              │                              │                       │
    │                              │   rename(inbox→ack)          │                       │
    │                              │◀─────────────────────────────│                       │
    │                              │                              │                       │
    │                              │                              │  (next turn boundary) │
    │                              │                              │                       │
    │                              │                              │  agent sees message   │
    │                              │                              │  as user input        │
```

### Pi RPC `steer` command (the injection primitive)

Pi's RPC protocol provides exactly the right primitive:

```json
{"type": "steer", "message": "Stop — call review_step(type=plan) BEFORE implementing."}
```

**Behavior:** The message is queued while the agent is running and delivered
**after the current tool call chain finishes, before the next LLM call.** The
agent does not stop, block, or lose work. The steering message appears as a
new user message in the conversation, and the LLM processes it on its next turn.

This is the same mechanism that makes human steering work — when a user types
while an agent is running, the message is queued and delivered at the next
natural break point.

**Steering modes** (configurable per session via `set_steering_mode`):
- `"one-at-a-time"` (default): one steering message per completed turn
- `"all"`: all queued steering messages delivered at once

**Also available:**
- `follow_up` — delivered only after the agent finishes all tool calls. Good
  for "when you're done, also do X."

### rpc-wrapper: the injection gateway

The rpc-wrapper process is the **only** process that can inject into an agent's
LLM context, because it is the only process that holds the `proc.stdin` pipe to
the pi child process:

```
┌─────────────┐    stdin pipe    ┌──────────┐
│ rpc-wrapper  │ ──────────────→ │  pi (RPC) │  ← agent lives here
│ (owns pipe)  │ ←────────────── │           │
└─────────────┘    stdout pipe   └──────────┘
```

Injecting a steering message is one line:

```javascript
proc.stdin.write(JSON.stringify({ type: "steer", message: content }) + "\n");
```

**Mailbox check — on every `message_end` event** (end of an LLM turn):

1. `readdirSync(inboxPath)` — check for pending messages (~0.1ms)
2. If empty, also check `_broadcast/inbox/` (~0.1ms)
3. If messages found, sort by timestamp, read each one
4. Validate: `batchId` matches, `to` matches own session name (or `_broadcast`)
5. **Inject via `steer` RPC command** — guaranteed to enter the agent's context
6. Log to stderr: `[STEERING] Delivered message {id} to {sessionName}`
7. Move processed messages from `inbox/` to `ack/`
8. Write `.steering-pending` flag for task-runner STATUS.md annotation

**Why this is safe (no blocking):**
- Pi queues the `steer` message internally
- The agent continues its current tool execution uninterrupted
- The message is delivered between the current tool chain and the next LLM call
- The agent sees it as a user message and incorporates it naturally
- This is identical to how human steering works in interactive mode

**Why `message_end` is the right check point:**
- It fires after each LLM turn (before the next tool call starts)
- It's already where rpc-wrapper does post-turn work (display, stats query)
- Checking an empty directory adds ~0.1ms — negligible vs the 2-30s LLM turn

### STATUS.md annotation (worker audit trail)

In addition to RPC injection, the task-runner extension annotates STATUS.md
so steering messages are visible in the dashboard and preserved for review:

**In the worker polling loop** (runs between every LLM iteration):

1. Check `{taskFolder}/.steering-pending` flag (set by rpc-wrapper after delivery)
2. If present, read the delivered message details
3. Inject into STATUS.md execution log:
   ```
   | {timestamp} | ⚠️ Steering | {content} |
   ```
4. Delete the `.steering-pending` flag

This is supplementary — the RPC injection already delivered the message to the
agent's context. The STATUS.md annotation provides dashboard visibility and
audit trail.

### Delivery guarantee matrix

| Mechanism | Worker | Reviewer | Merger | Latency | Reliability |
|-----------|--------|----------|--------|---------|-------------|
| RPC `steer` via rpc-wrapper | ✅ | ✅ | ✅ | Next turn boundary | Guaranteed (pi protocol) |
| STATUS.md annotation | ✅ | ❌ | ❌ | Next polling iteration | Supplementary |

All agent types get RPC injection — the most reliable mechanism. Workers
additionally get STATUS.md annotation for dashboard visibility.

## Delivery: Agent → Supervisor

Communication is bidirectional. Agents write replies and escalations to their
outbox; the engine picks them up and alerts the supervisor.

### End-to-end data flow

```
pi (agent)                  File System                    Engine                  Supervisor
    │                            │                            │                        │
    │  write outbox/{msg}.json   │                            │                        │
    │───────────────────────────→│                            │                        │
    │  (via bash/write tool)     │                            │                        │
    │                            │                            │                        │
    │                            │  (engine monitoring loop)  │                        │
    │                            │  scan outbox/ directories  │                        │
    │                            │◀───────────────────────────│                        │
    │                            │                            │                        │
    │                            │                            │  supervisor-alert IPC  │
    │                            │                            │───────────────────────→│
    │                            │                            │  (sendUserMessage)     │
    │                            │                            │                        │
    │                            │                            │  supervisor reads msg  │
    │                            │                            │  and can respond via   │
    │                            │                            │  send_agent_message()  │
```

### Outbox message format

```json
{
  "id": "1774745000000-b8e3d",
  "batchId": "20260328T195730",
  "from": "orch-henrylach-lane-1",
  "to": "supervisor",
  "timestamp": 1774745000000,
  "type": "escalate",
  "content": "Step 2 requires modifying persistence.ts but the file has 1,800 lines and I've already used 40% of my context reading it. Should I proceed with surgical edits or request a context reset?",
  "expectsReply": true,
  "replyTo": null
}
```

The engine's monitoring loop already polls lane state every 2 seconds. Add an
outbox scan to the same loop. When messages are found, emit a `supervisor-alert`
IPC message (same mechanism as TP-076 autonomous alerts). The supervisor
receives the alert via `sendUserMessage` and can respond with
`send_agent_message()`.

## Safety Invariants

### 1. No stale message contamination

- **Structural:** Mailbox root includes `{batchId}`. Different batches cannot
  see each other's messages.
- **Validation:** Every message includes a `batchId` field. Readers reject
  messages where `batchId` doesn't match the current batch.
- **Cleanup:** `mailbox/{batchId}/` is deleted during batch artifact cleanup
  (same lifecycle as telemetry files).

### 2. No misdelivery

- **Structural:** Each agent reads only from its own `{sessionName}/inbox/`
  directory. Session names are unique per batch.
- **Validation:** Readers verify `msg.to === ownSessionName` (or `_broadcast`).
  Messages with wrong `to` are logged as errors and moved to `ack/` with an
  error annotation.
- **Atomic writes:** Messages are written to a temp file first, then renamed
  into the inbox. This prevents agents from reading partial writes.

### 3. No lost messages

- **Durable:** File system writes are durable across process crashes. If an
  agent dies before processing a message, the message remains in `inbox/`
  for the next agent instance (after crash recovery/restart).
- **Idempotent:** Processing a message is idempotent — reading and acking
  the same message twice is harmless.

### 4. No duplicate processing

- **Atomic move:** `rename(inbox/msg, ack/msg)` is atomic on all platforms.
  If two processes race, only one rename succeeds; the other gets ENOENT
  and skips.

## Overhead Analysis

### Per-turn cost (rpc-wrapper check)

```
readdirSync(inbox/)     ~0.05ms  (empty directory)
readdirSync(_broadcast/) ~0.05ms  (empty directory)
────────────────────────────────
Total per turn:          ~0.1ms
```

For comparison, an LLM turn takes 2,000–30,000ms. The mailbox check is
**0.001–0.005%** of turn time. Negligible.

### Per-message cost

```
readFileSync(msg.json)   ~0.1ms   (< 4KB file)
JSON.parse()             ~0.01ms
renameSync(inbox→ack)    ~0.1ms
────────────────────────────────
Total per message:       ~0.2ms
```

### Context cost

A steering message injected into STATUS.md consumes ~200–500 tokens of the
worker's context window. For a 1M-token context, this is 0.02–0.05%. Even
10 steering messages would consume < 1%.

## Supervisor Tools

The supervisor needs tools to send and receive messages:

```
send_agent_message(to, content, type?, priority?)
  → Writes message to the target agent's inbox

read_agent_replies(from?)
  → Reads all outbox messages from a specific agent (or all agents)

broadcast_message(content, type?, priority?)
  → Writes message to _broadcast/inbox/
```

These are registered as supervisor extension tools (same pattern as
`orch_retry_task`, `orch_skip_task`, `orch_force_merge`).

## Implementation Phases

### Phase 1: Core mailbox + supervisor send (MVP)

- Mailbox directory structure and message format
- `send_agent_message` supervisor tool
- rpc-wrapper inbox check on `message_end`
- rpc-wrapper stderr notification for delivered messages
- Batch cleanup includes mailbox directory
- Tests: message write/read/ack lifecycle, stale batch rejection, misdelivery prevention

### Phase 2: Worker context injection

- task-runner `.steering-pending` flag detection
- STATUS.md execution log injection
- `check_messages` tool in task-runner
- Worker template steering message instructions
- Tests: end-to-end steering message delivery to worker context

### Phase 3: Agent → supervisor replies

- Agent outbox writes (via bash/write tools or `send_reply` tool)
- Engine outbox polling + supervisor alert emission
- `read_agent_replies` supervisor tool
- Tests: round-trip message exchange

### Phase 4: Broadcast + urgent priority

- `_broadcast` directory support
- Urgent priority: interrupt current work
- `broadcast_message` supervisor tool
- Rate limiting: max 1 message per agent per 30 seconds

## Open Questions

1. **Should agents auto-acknowledge steering messages?**
   Option A: Agent must explicitly acknowledge (auditable but depends on LLM compliance).
   Option B: Moving to `ack/` counts as acknowledgment (reliable but less visible).
   Current design: Option B for delivery, Option A encouraged in template.

2. **Message size limits?**
   Proposed: 4KB max content. Steering messages should be concise directives,
   not essays. Larger context should be written to a separate file and
   referenced.

3. **Should the dashboard show the mailbox?**
   A "Messages" panel showing sent/pending/acked messages per agent would give
   the operator visibility into steering activity. Low priority but valuable
   for debugging.

## Resolved Questions

1. ~~Should rpc-wrapper inject messages into the LLM context directly?~~
   **Yes.** Pi's RPC protocol supports `steer` (queued, non-blocking, delivered
   at turn boundaries). rpc-wrapper is the only process with access to the
   agent's stdin pipe, making it the natural injection gateway.

2. ~~File-based vs alternative transport?~~
   **File-based for coordination, RPC for injection.** Files handle addressing,
   lifecycle, audit trail, and bidirectional communication. The `steer` RPC
   command handles the actual delivery into the agent's context. This gives us
   the reliability of files with the guaranteed delivery of RPC.

3. ~~Direct injection (tmux send-keys) vs file mailbox?~~
   **File mailbox only.** tmux send-keys is one-way (no reply channel), has
   JSON escaping issues on Windows, and provides no delivery confirmation.
   The file mailbox adds negligible latency (~0.1ms per check) and delivers
   at the same cadence (turn boundaries). Not worth the complexity.
