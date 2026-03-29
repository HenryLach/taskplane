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

## Why File-Based

Evaluated alternatives:

| Approach | Verdict | Reason |
|----------|---------|--------|
| **Files** | ✅ Selected | Zero deps, cross-platform, survives crashes, human-debuggable, already the coordination pattern (lane-state, .DONE, review-signal) |
| Named pipes | ❌ | Platform-specific (Windows vs Unix), don't survive process restarts |
| Unix domain sockets | ❌ | Not available on Windows |
| SQLite | ❌ | Adds a dependency, overkill for low-volume messaging |
| IPC (stdin/stdout) | ❌ | rpc-wrapper owns the pipe; can't inject mid-conversation without pi RPC protocol support |
| Shared memory | ❌ | Platform-specific, complex, no persistence |
| Environment variables | ❌ | Immutable after process start |

File-based messaging is already the proven pattern in taskplane:
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

## Delivery Mechanism

### Layer 1: rpc-wrapper (universal, reliable)

The rpc-wrapper process wraps every agent session. It already processes RPC
events between pi and the LLM, making it the ideal interception point.

**On every `message_end` event** (which marks the end of an LLM turn):

1. `readdirSync(inboxPath)` — check for pending messages (~0.1ms)
2. If empty, also check `_broadcast/inbox/` (~0.1ms)
3. If messages found, sort by timestamp, read each one
4. Validate: `batchId` matches, `to` matches own session name (or `_broadcast`)
5. **Inject message content into stderr** as a visible `[STEERING]` notification
6. Move processed messages from `inbox/` to `ack/`

The injected notification appears in the tmux pane but does NOT enter the LLM's
context directly. For that, we need Layer 2.

**On every `tool_execution_end` event:**

If there are pending urgent messages, rpc-wrapper can signal the task-runner
extension by writing a flag file (`{taskFolder}/.steering-pending`). The
extension picks this up in its polling loop.

### Layer 2: task-runner extension (worker-specific, context-injected)

The task-runner extension runs inside the worker's pi process and has access
to the tool response pipeline.

**In the worker polling loop** (runs between every LLM iteration):

1. Check `{taskFolder}/.steering-pending` flag (set by rpc-wrapper)
2. If present, read the agent's `inbox/` directory
3. Inject message content into STATUS.md execution log:
   ```
   | {timestamp} | ⚠️ Steering | {content} |
   ```
4. The worker sees the steering message when it next reads STATUS.md
5. Delete the `.steering-pending` flag
6. Move processed messages to `ack/`

**Additionally, add a `check_messages` tool:**

```typescript
tools.push({
  name: "check_messages",
  description: "Check for steering messages from the supervisor",
  parameters: {},
  handler: async () => {
    const messages = readInbox(sessionName, batchId);
    if (messages.length === 0) {
      return { content: [{ type: "text", text: "No pending messages." }] };
    }
    // Move to ack, return content
    for (const msg of messages) moveToAck(msg);
    const formatted = messages.map(m =>
      `[${m.type.toUpperCase()}] ${m.content}`
    ).join("\n\n");
    return { content: [{ type: "text", text: formatted }] };
  },
});
```

Worker template instructs: "Call `check_messages()` at the start of each step
and after receiving any REVISE verdict."

### Layer 3: Worker template (soft instruction)

The worker template includes guidance:

```markdown
## Steering Messages

The supervisor may send you steering messages during execution. These appear
in the STATUS.md execution log as `⚠️ Steering` entries. When you see one:

1. **Read the message carefully** — it contains corrections or context
2. **Adjust your approach** based on the instruction
3. **Acknowledge** by logging in STATUS.md: "Acknowledged steering: [summary]"

You can also call `check_messages()` explicitly to check for pending messages.
```

### Delivery guarantee matrix

| Mechanism | Worker | Reviewer | Merger | Latency |
|-----------|--------|----------|--------|---------|
| rpc-wrapper stderr | ✅ | ✅ | ✅ | Next turn end |
| STATUS.md injection | ✅ | ❌ | ❌ | Next polling iteration |
| `check_messages` tool | ✅ | ❌ | ❌ | On-demand |
| Template instruction | ✅ | partial | partial | LLM-dependent |

Workers get all four layers. Reviewers and mergers get the rpc-wrapper layer,
which is sufficient for their shorter lifespans.

## Agent → Supervisor Communication

### Outbox writes

Agents write to their outbox when they need to escalate:

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

### Supervisor pickup

The engine's monitoring loop already polls lane state every 2 seconds. Add an
outbox check to the same loop:

1. Scan `outbox/` directories for all active sessions
2. If messages found, emit a `supervisor-alert` IPC message (same mechanism
   as TP-076 autonomous alerts)
3. The supervisor receives the alert via `sendUserMessage` and can respond

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

1. **Should rpc-wrapper inject messages into the LLM context directly?**
   Pi's RPC protocol doesn't currently support injecting user messages from
   external callers. If pi adds a `send_user_message` RPC command, rpc-wrapper
   could inject steering messages directly into the conversation — the most
   reliable delivery mechanism possible. Worth discussing with the pi team.

2. **Should agents auto-acknowledge steering messages?**
   Option A: Agent must explicitly acknowledge (auditable but depends on LLM compliance).
   Option B: Moving to `ack/` counts as acknowledgment (reliable but less visible).
   Current design: Option B for delivery, Option A encouraged in template.

3. **Message size limits?**
   Proposed: 4KB max content. Steering messages should be concise directives,
   not essays. Larger context should be written to a separate file and
   referenced.

4. **Should the dashboard show the mailbox?**
   A "Messages" panel showing sent/pending/acked messages per agent would give
   the operator visibility into steering activity. Low priority but valuable
   for debugging.
