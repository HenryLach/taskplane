# Agent Mailbox: Cross-Agent Steering Protocol

**Status:** Phase 2 Implemented (TP-089, TP-090)  
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

### Addressing

Agents are addressed by their tmux session name, which is unique per batch.

Each lane has a **lane-level** rpc-wrapper session that hosts task-runner (the
extension loop). Task-runner then spawns child rpc-wrapper sessions for the
worker and reviewer. The merger is spawned directly by the engine. Only the
child agent sessions (worker, reviewer, merger) are meaningful steering targets:

| Agent | Session Name Pattern | Example | Spawned by |
|-------|---------------------|---------|------------|
| Lane (task-runner) | `orch-{opId}-lane-{N}` | `orch-henrylach-lane-1` | engine (execution.ts) |
| **Worker** | `orch-{opId}-lane-{N}-worker` | `orch-henrylach-lane-1-worker` | task-runner |
| **Reviewer** | `orch-{opId}-lane-{N}-reviewer` | `orch-henrylach-lane-1-reviewer` | task-runner |
| **Merger** | `orch-{opId}-merge-{N}` | `orch-henrylach-merge-1` | engine (merge.ts) |
| Broadcast | `_broadcast` | `_broadcast` | — |

The lane-level session is NOT a steering target — it runs the task-runner
extension loop, not an LLM agent. The supervisor steers the `-worker`,
`-reviewer`, and `merge-` sessions.

The supervisor resolves session names from batch state (lane allocations).

### rpc-wrapper: new required args

rpc-wrapper currently has no knowledge of its own session identity or batch.
Two new CLI args are required:

```
--mailbox-dir <path>     # e.g., "/project/.pi/mailbox/20260328T195730/orch-henrylach-lane-1-worker"
```

The caller (task-runner or merge.ts) constructs the full path from batch ID,
session name, and state root — rpc-wrapper just checks `{mailboxDir}/inbox/`
on each turn. This follows the same pattern as `--sidecar-path` and
`--exit-summary-path` (caller constructs, rpc-wrapper uses).

Without this arg, mailbox checking is silently skipped (backward compatible
with non-orchestrated `/task` mode and older taskplane versions).

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

**Steering mode:** rpc-wrapper sends `{"type": "set_steering_mode", "mode": "all"}`
at session startup so all queued steering messages are delivered together at the
next turn boundary. Pi defaults to `one-at-a-time`, but agents on long turns
(many tool calls) may accumulate multiple messages — we want all of them
delivered at the first opportunity, not drip-fed one per turn.

**`follow_up` (separate RPC command):** Delivered only after the agent finishes
all tool calls and stops. The supervisor chooses `steer` vs `follow_up`
per-message based on intent:
- `steer` — "read this now and adjust your approach"
- `follow_up` — "when you're done, also do X"

This is an addressing decision per message, not a session-level configuration.

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
send_agent_message(to, content, type?)
  → Writes message to the target agent's inbox

read_agent_replies(from?)
  → Reads all outbox messages from a specific agent (or all agents)

broadcast_message(content, type?)
  → Writes message to _broadcast/inbox/
```

These are registered as supervisor extension tools (same pattern as
`orch_retry_task`, `orch_skip_task`, `orch_force_merge`).

## Implementation Phases

### Phase 1: Core mailbox + supervisor send (MVP) ✅ Implemented (TP-089)

- ✅ Mailbox directory structure and message format (`extensions/taskplane/mailbox.ts`, `types.ts`)
- ✅ rpc-wrapper: `--mailbox-dir` arg, inbox check on `message_end`, `steer` RPC injection
- ✅ rpc-wrapper: `set_steering_mode "all"` at session startup
- ✅ task-runner `spawnAgentTmux()`: pass `--mailbox-dir` for worker + reviewer sessions
- ✅ merge.ts `spawnMergeAgent()`: pass `--mailbox-dir` for merger sessions
- ✅ `send_agent_message` supervisor tool (writes to inbox, `extension.ts`)
- ✅ Batch cleanup includes `mailbox/{batchId}/` directory (post-integrate + 7-day stale sweep)
- ✅ Tests: message write/read/ack lifecycle, stale batch rejection, misdelivery prevention,
  rpc-wrapper integration, cleanup verification (45 new tests across 2 test files)

### Phase 2: Worker audit trail + STATUS.md visibility ✅ Implemented (TP-090)

- ✅ rpc-wrapper: `--steering-pending-path` arg, JSONL append after each delivered message
- ✅ task-runner `spawnAgentTmux()`: pass `--steering-pending-path` for worker sessions only
- ✅ task-runner polling loop: `.steering-pending` JSONL detection, STATUS.md execution log injection with message timestamp
- ✅ Content sanitization: newline collapse, pipe escape, 200-char truncation for markdown table safety
- ✅ Worker template: steering message guidance section
- ✅ Tests: rpc-wrapper JSONL write (3 tests), annotation behavior (5 tests), sanitization (5 tests),
  source contract (4 tests), plus full suite regression (3086 tests pass)

### Phase 3: Agent → supervisor replies ✅ Implemented (TP-106, TP-091)

- ✅ Agent outbox writes via `writeOutboxMessage()` in `mailbox.ts`
- ✅ Bridge extension tools: `notify_supervisor`, `escalate_to_supervisor` in `agent-bridge-extension.ts`
- ✅ `read_agent_replies` supervisor tool: **non-consuming** — reads pending + acked outbox history
- ✅ `readOutboxHistory()` provides durable reply visibility (outbox/ + outbox/processed/)
- ✅ Lane-runner polls outbox after worker exit and logs to STATUS.md
- ✅ Registry-first agent identity for all targeting and discovery
- ✅ Registry snapshot updated after each worker iteration

### Phase 4: Broadcast + rate limiting ✅ Implemented (TP-106, TP-092)

- ✅ `_broadcast` directory support via `writeBroadcastMessage()`
- ✅ `broadcast_message` supervisor tool
- ✅ Agent-host checks both own inbox AND `_broadcast/inbox/` on each `message_end`
- ✅ Rate limiting: max 1 message per agent per 30 seconds (in-memory tracker)
- ✅ `send_agent_message` enforces rate limit with retry-after countdown
- ✅ **Broadcast policy: all-or-none** — if any recipient is rate-limited, entire broadcast is rejected
- ✅ **Audit completeness:** all send/blocked/rate-limited decisions emit mailbox audit events
- ✅ Per-recipient rate-limit audit events include agent ID, reason, and retry-after

### Phase 5: Dashboard mailbox panel ✅ Implemented (TP-107, TP-093)

- ✅ "Messages" section in dashboard showing per-agent message activity
- ✅ Columns: timestamp, direction (→agent / ←supervisor), type, content preview, status
- ✅ Event-authoritative model: primary source is `.pi/mailbox/{batchId}/events.jsonl`
- ✅ Fallback: directory scans (inbox/ack/outbox/outbox/processed) for legacy compatibility
- ✅ Consumed replies included (outbox/processed/) — replies don't disappear after ack
- ✅ Broadcast delivery shown per-recipient with `_isBroadcast` flag
- ✅ Rate-limited events surfaced in panel timeline
- ✅ Real-time updates via dashboard SSE polling (same cadence as lane state)

## Open Questions

None currently.

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

4. ~~Should agents auto-acknowledge steering messages?~~
   **No explicit acknowledgment required.** Pi's `steer` command injects the
   message as a user message in the conversation — the LLM will see it and
   respond to it on its next turn (same as human steering). The agent can't
   "ignore" it. The `ack/` directory proves delivery at the RPC level. Whether
   the agent *followed* the instruction is visible from the work product
   (commits, STATUS.md changes). Requiring an explicit "I acknowledge" template
   instruction would burn tokens without adding signal.

5. ~~Message size limits?~~
   **4KB max content.** Steering messages should be concise directives. Larger
   context should be written to a separate file and referenced by path in the
   message. Enforced at write time in `send_agent_message`.

6. ~~Should the dashboard show the mailbox?~~
   **Yes.** A "Messages" section in the dashboard showing sent/pending/delivered
   messages per agent. Implementation in Phase 5 (after core mailbox is stable).
