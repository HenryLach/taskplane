# Specification: Hybrid IPC Architecture

**Status:** Draft v1
**Created:** 2026-04-14
**Author:** Supervisor + Operator
**Reviewed by:** Sage (architectural consultation)

---

## Problem Statement

Taskplane's inter-agent communication is entirely file-based: mailbox directories,
signal files, JSON snapshots, and polling loops. This provides excellent durability
and crash-recovery but introduces unnecessary latency in time-sensitive paths:

- **Exit interception replies:** Supervisor writes instructions to worker mailbox,
  lane-runner polls every 2 seconds. A 60-second timeout with 2-second polls means
  up to 30 wasted poll cycles.
- **Steering message delivery:** Messages written to inbox files are only picked up
  when the agent-host's mailbox poll fires (every few seconds).
- **Wrap-up signal detection:** Workers check for `.task-wrap-up` between tool calls,
  which can delay detection by the duration of one tool execution.

Meanwhile, pi's `control.ts` extension demonstrates a complementary approach: Unix
socket-based inter-session communication with instant delivery, turn_end subscriptions,
and session discovery. This creates an opportunity for a hybrid architecture.

---

## Design Principle: Persist First, Deliver Fast Second

Every IPC message follows the same contract:

1. **Write to durable storage first** (file) — this is the source of truth
2. **Attempt fast delivery second** (nudge/socket) — best-effort, instant
3. **Fall back to polling** if fast delivery fails — the file is always there

The durable plane is authoritative. The realtime plane is an optimization.
If the fast path fails (process died, socket unavailable, nudge lost), the
polling fallback reads the file within one poll cycle. No message is ever lost.

```
┌─────────────────────────────────────────────────────┐
│  REALTIME PLANE (nudges, sockets)                   │
│  Fast delivery, best-effort, ephemeral              │
│  Only between processes that support it              │
├─────────────────────────────────────────────────────┤
│  DURABLE PLANE (files)                              │
│  Source of truth, crash-safe, resumable              │
│  Used by everything: workers, engine, dashboard     │
└─────────────────────────────────────────────────────┘
```

---

## Current IPC Inventory

| Channel | Writer | Reader | Mechanism | Latency | Durable? |
|---------|--------|--------|-----------|---------|----------|
| Supervisor → Worker steering | Supervisor | agent-host mailbox poll | File (inbox JSON) | 2-5s poll | ✅ |
| Worker → Supervisor alerts | lane-runner callback | Supervisor IPC message | In-process callback | Instant | ❌ (memory only) |
| Exit interception reply | Supervisor | lane-runner inbox poll | File (inbox JSON) | 0-60s poll | ✅ |
| Wrap-up signal | Supervisor/engine | Worker tool-call boundary | File (.task-wrap-up) | 0-30s | ✅ |
| Abort signal | Operator/supervisor | Engine poll | File (.pi/orch-abort-signal) | 0-5s poll | ✅ |
| Lane telemetry | agent-host | Dashboard HTTP poll | File (lane-N.json) | 3-5s poll | ✅ |
| Merge results | Merge agent | Engine | File (merge-result-*.json) | Read after exit | ✅ |
| Batch state | Engine | Everything | File (batch-state.json) | Immediate (write) | ✅ |

---

## Participant Capabilities

| Participant | Lifecycle | Pi Session? | Socket capable? | File capable? |
|-------------|-----------|-------------|-----------------|---------------|
| Supervisor | Long-lived | ✅ Yes | ✅ Yes (control.ts) | ✅ Yes |
| Worker | Transient | ❌ (--mode rpc) | ❌ No native socket | ✅ Yes |
| Engine | Long-lived | ❌ (worker_thread) | ⚠️ Custom only | ✅ Yes |
| Lane-runner | Per-task | ❌ (function in engine) | ⚠️ Via engine IPC | ✅ Yes |
| Merge agent | Transient | ❌ (--mode rpc) | ❌ No native socket | ✅ Yes |
| Dashboard | Long-lived | ❌ (HTTP server) | ⚠️ Could add WebSocket | ✅ Yes (reads) |
| Operator | Long-lived | ✅ Yes | ✅ Yes (control.ts) | ✅ Yes |

**Key insight:** Only the supervisor and operator are long-lived pi sessions
that can natively use control.ts sockets. All other participants need either
custom IPC or file-based communication.

---

## What Should Stay File-Only

These signals must remain file-based for safety and durability:

| Signal | Why files are correct |
|--------|---------------------|
| `.task-wrap-up` | Workers check between tool calls — file matches the check granularity |
| `.pi/orch-abort-signal` | Must survive any process death — file is the safest medium |
| `merge-result-*.json` | Written by transient merge agent, read after agent exits |
| `batch-state.json` | Resume authority — must be durable across any crash |
| `lane-N.json` | Dashboard polls HTTP — file-backed is the right model |
| `batch-history.json` | Permanent audit trail — file is correct |

---

# Phase A: Nudge Overlay for Exit Interception

**Goal:** Eliminate polling latency in the supervisor exit interception reply
path. When the supervisor sends instructions to a worker via the exit
interception flow, the lane-runner receives the reply instantly instead of
waiting up to 2 seconds for the next poll cycle.

**Risk:** Low — additive change, file-based path remains as fallback.

## A.1 Problem

The exit interception flow (TP-172) works as follows:

1. Worker produces text-only response → `agent_end` fires
2. `onPrematureExit` callback checks for progress → no progress
3. Lane-runner fires supervisor alert
4. Lane-runner polls worker mailbox inbox every 2 seconds for supervisor reply
5. Supervisor reads alert, writes reply to mailbox inbox file
6. Lane-runner eventually picks up reply on next poll cycle
7. Reply is sent as new prompt to the still-alive worker

Step 4-6 has 0-2 seconds of unnecessary latency per poll cycle, and the
entire flow has a 60-second timeout. With a nudge, step 6 becomes instant.

## A.2 Design

The lane-runner's `onPrematureExit` callback runs inside the engine's
worker_thread. The supervisor runs in the main pi process. Communication
between them already exists via the IPC alert system (supervisor receives
alerts from the engine). The nudge needs to flow in the reverse direction:
supervisor → engine → lane-runner.

```
Supervisor writes reply to mailbox file (DURABLE)
    ↓
Supervisor sends nudge to engine via existing IPC
    ↓
Engine forwards nudge to the waiting lane-runner callback
    ↓
Lane-runner drains inbox immediately (reads the file)
    ↓
Reply delivered to worker — no polling delay
```

The nudge carries only a signal ("check your inbox"), not the message content.
The message is always read from the durable file. This ensures:
- The file is the single source of truth
- If the nudge is lost, polling picks up the reply within 2 seconds
- No duplicate delivery — the file is read once and acked

## A.3 Implementation

### Nudge signal format

```typescript
interface InboxNudge {
  type: "inbox-nudge";
  targetAgentId: string;  // e.g., "orch-henry-lane-1-worker"
  batchId: string;
}
```

### Engine-side nudge receiver

The engine (worker_thread) maintains a map of pending inbox waiters:

```typescript
// In engine worker thread
const inboxWaiters = new Map<string, () => void>();  // agentId → resolve callback

// Register waiter (called by lane-runner's onPrematureExit)
function waitForInboxNudge(agentId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    inboxWaiters.set(agentId, resolve);
    setTimeout(() => {
      inboxWaiters.delete(agentId);
      resolve();  // timeout — fallback to poll
    }, timeoutMs);
  });
}

// Handle nudge from supervisor (via worker_thread message)
parentPort.on("message", (msg) => {
  if (msg.type === "inbox-nudge") {
    const waiter = inboxWaiters.get(msg.targetAgentId);
    if (waiter) {
      inboxWaiters.delete(msg.targetAgentId);
      waiter();  // wake up the lane-runner
    }
  }
});
```

### Lane-runner inbox wait (hybrid)

```typescript
// In onPrematureExit callback
const supervisorReply = await new Promise<string | null>((resolve) => {
  const deadline = Date.now() + SUPERVISOR_REPLY_TIMEOUT_MS;

  // Fast path: wait for nudge from engine
  const nudgePromise = waitForInboxNudge(workerAgentId, SUPERVISOR_REPLY_TIMEOUT_MS);

  const checkInbox = () => {
    const messages = readInbox(inboxDir, config.batchId);
    for (const { filename, message } of messages) {
      if (message.timestamp >= escalationTimestamp && message.from === "supervisor") {
        ackMessage(inboxDir, filename);
        resolve(message.content);
        return true;
      }
    }
    return false;
  };

  // Check immediately (message might already be there)
  if (checkInbox()) return;

  // Wait for nudge OR poll timeout
  nudgePromise.then(() => {
    if (checkInbox()) return;
    // Nudge fired but no message yet — fall back to polling
    const poll = setInterval(() => {
      if (Date.now() >= deadline) {
        clearInterval(poll);
        resolve(null);
        return;
      }
      checkInbox();
    }, POLL_INTERVAL_MS);
  });
});
```

### Supervisor nudge sender

When the supervisor writes a reply to the worker's mailbox, it also sends
a nudge through the existing IPC channel:

```typescript
// After writing reply to mailbox file
send_agent_message(to: workerAgentId, content: reply);

// Also send nudge to engine (new capability)
sendEngineNudge({ type: "inbox-nudge", targetAgentId: workerAgentId, batchId });
```

The `sendEngineNudge` function uses the existing supervisor → engine IPC
channel (the same channel used for alerts in the reverse direction).

## A.4 Fallback Behavior

If the nudge is lost (supervisor crashed, IPC channel broken, race condition):
- The lane-runner's polling fallback fires within 2 seconds
- The file is still there — no message lost
- The only cost is 0-2 seconds of unnecessary latency (same as today)

If the nudge arrives but the file isn't written yet (race):
- `checkInbox()` returns false
- Polling fallback fires and picks up the file when it appears
- The nudge just caused one early (empty) inbox check — harmless

## A.5 Files Changed

| File | Change |
|------|--------|
| `extensions/taskplane/engine-worker.ts` | Add inbox waiter registry and nudge handler |
| `extensions/taskplane/lane-runner.ts` | Hybrid inbox wait (nudge + poll fallback) |
| `extensions/taskplane/supervisor.ts` | Send nudge after writing reply to mailbox |
| `extensions/taskplane/types.ts` | InboxNudge interface |

## A.6 Testing

- Unit test: nudge wakes up waiter immediately
- Unit test: waiter falls back to polling when no nudge arrives
- Unit test: nudge before file write → polling picks up file
- Integration test: exit interception with nudge — verify < 100ms reply delivery

---

# Phase B: Supervisor Control Socket

**Goal:** Enable the supervisor as a control.ts socket endpoint for operator
tooling and automation.

**Status:** Strategy outlined. Depends on control.ts being available as a
loadable extension.

## B.1 Use Cases

### Operator sends commands from another terminal

```bash
# Skip a task
pi -p --session-control --control-session supervisor \
  --send-session-message "skip TP-005" --send-session-wait turn_end

# Get batch status
pi -p --session-control --control-session supervisor \
  --send-session-message "How's the batch going?" --send-session-wait turn_end

# Get AI-generated progress summary
pi -p --session-control --control-session supervisor \
  --send-session-message "Summarize what's happened so far"
```

### CI/automation hooks

```bash
# Subscribe to batch completion
pi -p --session-control --control-session supervisor \
  --send-session-message "Notify me when the batch completes" \
  --send-session-wait turn_end
```

### External monitoring

```bash
# Get last supervisor status without disrupting the session
pi -p --session-control --control-session supervisor \
  --send-session-message "" --send-session-mode steer
```

## B.2 Implementation Notes

- The supervisor pi session would need `--session-control` enabled at launch
- The supervisor's session name could be deterministic (e.g., `taskplane-supervisor-{batchId}`)
- No changes to Taskplane code needed — just enabling the flag and documenting
  the operator workflow
- Worker sessions are `--mode rpc --no-session` and cannot participate

## B.3 Considerations

- The supervisor already handles operator messages via the normal pi conversation
- Control sockets add a second input channel — the supervisor prompt needs to
  handle both gracefully
- Rate limiting: external messages shouldn't overwhelm the supervisor during
  a critical recovery operation

---

# Phase C: Dashboard WebSocket Push

**Goal:** Replace dashboard HTTP polling with WebSocket push for real-time
updates.

**Status:** Future exploration. Not blocking any current functionality.

## C.1 Concept

Today the dashboard polls `/api/batch-state` every 3-5 seconds. With a
WebSocket connection, the engine could push updates instantly:

- Lane progress changes
- Task status transitions
- Wave start/complete events
- Merge agent telemetry
- Supervisor recovery actions

This eliminates polling latency for the dashboard without changing the
underlying data model (still backed by files).

## C.2 Implementation Approach

The dashboard server (`server.cjs`) would:
1. Accept WebSocket connections alongside HTTP
2. Watch relevant files (batch-state.json, lane-N.json) for changes
3. Push diffs to connected WebSocket clients

The file remains the source of truth. The WebSocket is a notification
channel, not a data channel — clients still read the full state from
files/HTTP when they reconnect.

---

# Phase D: Multi-Supervisor Socket Coordination

**Goal:** Enable multiple supervisor sessions to coordinate via control
sockets during parallel segment execution (Phase C of segment-aware steps).

**Status:** Future exploration. Depends on Phase B/C of segment-aware steps
and this spec's Phase B.

## D.1 Concept

When parallel segments across repos need coordinated step-boundary merges,
per-repo supervisors (or a single supervisor with sub-agents) could use
control sockets for:

- Merge lock acquisition ("I'm merging shared-libs, wait")
- Step completion notifications ("shared-libs Step 1 done, web-client can proceed")
- Conflict escalation ("merge conflict in shared-libs, need human input")

## D.2 Considerations

- This requires the segment-aware steps Phase B/C architecture first
- Socket-based coordination is ephemeral — file-based merge queue (from
  segment spec) remains the durable fallback
- Session discovery via `list_sessions` enables dynamic supervisor registration

---

## References

- `control.ts` — pi session control extension (Unix socket RPC)
- `docs/specifications/taskplane/segment-aware-steps.md` — segment-aware execution spec
- TP-172 — supervisor-in-the-loop exit interception (current file-based impl)
- Sage architectural consultation — "persist first, deliver fast second" principle
