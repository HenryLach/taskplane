# Observability and Dashboard Model

**Status:** Proposed (updated 2026-03-30 with implementation findings from TP-104)  
**Related:** [01-architecture.md](01-architecture.md), [03-bridge-and-mailbox.md](03-bridge-and-mailbox.md)

## 1. Goal

Runtime V2 must provide **better** visibility than TMUX, not merely visibility
without TMUX.

The dashboard becomes the canonical operator surface for:

- live agent conversations
- lane/task/segment progress
- message steering and replies
- context/cost/tool telemetry
- process health
- supervisor actions and engine events

## 2. Design rule

**All primary visibility must come from normalized runtime artifacts, not
terminal capture.**

That means no dependence on:

- TMUX pane capture
- attachable terminals
- stderr-only diagnostics for routine monitoring

## 3. Event model

Agent-hosts should emit normalized events directly to their parent and persist
those same normalized events durably.

### Canonical per-agent log

```text
.pi/runtime/{batchId}/agents/{agentId}/events.jsonl
```

### Canonical aggregate snapshots

```text
.pi/runtime/{batchId}/lanes/lane-{N}.json
.pi/runtime/{batchId}/registry.json
```

## 4. Normalized event schema

Suggested common fields:

```json
{
  "batchId": "20260330T120000",
  "agentId": "orch-henrylach-lane-1-worker",
  "role": "worker",
  "laneNumber": 1,
  "taskId": "TP-091",
  "repoId": "default",
  "ts": 1774850000000,
  "type": "tool_call",
  "payload": { "tool": "read", "path": "STATUS.md" }
}
```

### Required event families

#### Lifecycle

- `agent_started`
- `agent_exited`
- `agent_killed`
- `agent_crashed`
- `agent_timeout`

#### Conversation

- `prompt_sent`
- `assistant_message`
- `tool_call`
- `tool_result`
- `message_delivered` (mailbox steer)
- `reply_sent`
- `escalation_sent`

#### Telemetry

- `usage_delta`
- `context_usage`
- `retry_started`
- `retry_finished`
- `compaction_started`
- `compaction_finished`

#### Review / bridge

- `review_requested`
- `review_completed`
- `review_failed`
- `segment_expansion_requested`
- `segment_expansion_decided`

#### Engine / supervisor

These continue to live in the existing supervisor event streams:

- `.pi/supervisor/events.jsonl`
- `.pi/supervisor/actions.jsonl`

## 5. Snapshot model

Snapshots are for current state; event logs are for history.

### Lane snapshot

Suggested shape:

```json
{
  "batchId": "20260330T120000",
  "laneNumber": 1,
  "laneId": "lane-1",
  "repoId": "default",
  "taskId": "TP-091",
  "segmentId": null,
  "status": "running",
  "worker": {
    "agentId": "orch-henrylach-lane-1-worker",
    "status": "running",
    "elapsedMs": 42000,
    "toolCalls": 18,
    "contextPct": 37.2,
    "costUsd": 0.41,
    "lastTool": "edit extensions/taskplane/engine.ts"
  },
  "reviewer": null,
  "progress": {
    "currentStep": "Step 2: Engine outbox polling",
    "checked": 5,
    "total": 14,
    "iteration": 2,
    "reviews": 1
  }
}
```

### Registry snapshot

Contains:

- live agents and lane-runners
- pids and statuses
- task/repo attribution
- start times and ownership metadata

This replaces TMUX discovery for active-agent surfaces.

## 6. Conversation viewer

The conversation viewer should read normalized event streams, not raw pane text.

### Required display abilities

- assistant messages in order
- tool call/result pairs
- injected steering messages at the correct point in the conversation
- review requests/verdict summaries
- agent replies/escalations
- token/context/cost summaries per turn

### Why this is better than terminal capture

- deterministic structure
- no ANSI noise
- no missing history due to scrollback limits
- works identically on Windows/macOS/Linux
- can be filtered and summarized intelligently

## 7. Dashboard sections after Runtime V2

## 7.1 Batch overview

Keep existing overview, but source it from batch state + runtime registry.

## 7.2 Lanes / tasks / segments

Show:

- lane health
- current task and segment
- packet-home repo where relevant
- progress from STATUS-derived snapshots
- worker/reviewer status and telemetry

## 7.3 Agents

A dedicated process-registry-backed panel replacing TMUX-centric views.

Show:

- agent ID
- role
- lane
- task / segment
- pid
- state (`running`, `wrapping_up`, `exited`, `crashed`)
- elapsed time
- context percent
- cost

## 7.4 Messages

TP-093 should land here in the Runtime V2 world.

Show:

- supervisor -> agent messages
- delivered status
- replies/escalations back to supervisor
- broadcast events
- rate-limit rejections

## 7.5 Supervisor

Keep and strengthen current supervisor visibility:

- lock state
- actions
- engine events
- conversation history
- recovery actions taken

## 7.6 Diagnostics

A first-class panel for:

- agent crashes / exit classifications
- retry histories
- timeout events
- bridge failures
- merge failures

## 8. Legacy compatibility shims

During migration, the dashboard server may temporarily support both:

### Legacy

- `.pi/lane-state-*.json`
- `.pi/telemetry/*.jsonl`
- `.pi/worker-conversation-*.jsonl`

### Runtime V2

- `.pi/runtime/{batchId}/lanes/*.json`
- `.pi/runtime/{batchId}/agents/*/events.jsonl`
- `.pi/runtime/{batchId}/registry.json`

The server should prefer Runtime V2 artifacts when both exist.

## 9. Cost and context accounting

The dashboard should stop reconstructing truth indirectly from mismatched files.

### Rule

- live telemetry comes directly from agent-host normalized events
- snapshots store already-aggregated current values
- event logs store full history

### Context pressure logic

- warning thresholds are driven by authoritative `contextUsage`
- kill/wrap-up decisions are visible in both lane snapshot and event stream
- context snapshots remain durable artifacts for later analysis

## 10. Operator tools backed by the same model

These tools should read the same registry/snapshots the dashboard reads:

- `read_agent_status`
- `list_active_agents`
- `read_agent_replies`
- future `read_agent_events`

This avoids tool/dashboard drift.

## 11. Acceptance tests for observability

Runtime V2 observability is not complete until the following are demonstrably true:

1. **No-TMUX visibility**
   - a running batch with TMUX absent still shows live worker conversations and telemetry

2. **Mailbox visibility**
   - steering messages appear as pending then delivered
   - replies and escalations appear in supervisor + dashboard

3. **Crash visibility**
   - agent crash produces exit classification, stderr path, and recovery context without manual log scraping

4. **Polyrepo visibility**
   - repo ID, packet-home repo, and active segment are visible where applicable

5. **Resume visibility**
   - after an interruption, registry/snapshot/event surfaces clearly distinguish resumed agents from historical ones

## 12. Soak-test observability requirements

For multi-hour and multi-day batches, the dashboard must remain useful without unbounded growth.

Required controls:

- incremental JSONL tailing
- bounded in-memory retention in the server
- per-panel truncation and pagination where needed
- log rotation/archival policies for runtime event files

## 13. Implementation notes (from TP-104, TP-107)

### Dashboard Runtime V2 integration (TP-107)

The dashboard server (`dashboard/server.cjs`) now loads Runtime V2 artifacts
alongside legacy data:

- `loadRuntimeRegistry(batchId)` — reads `.pi/runtime/{batchId}/registry.json`
- `loadRuntimeLaneSnapshots(batchId)` — reads `.pi/runtime/{batchId}/lanes/*.json`
- `loadRuntimeAgentEvents(batchId, agentId)` — reads per-agent `events.jsonl`
- `loadMailboxData(batchId)` — scans inbox/ack/outbox for all agents

The dashboard state includes `runtimeRegistry`, `runtimeLaneSnapshots`, and
`mailbox` fields. The frontend renders:

- **Agents panel** from the registry (role, status, lane, task, elapsed)
- **Messages panel** from mailbox data (direction, type, status, content preview)
- Both panels are hidden for legacy batches (no registry/mailbox data)

Legacy `laneStates`, `telemetry`, and `tmuxSessions` are still loaded for
backward compatibility. The dashboard shows whichever data is available.

### Event envelope attribution

`AgentHostOptions` carries `batchId`, `laneNumber`, `taskId`, and `repoId`.
All normalized `RuntimeAgentEvent` instances emitted by the agent-host include
these attribution fields from the caller-provided options — no empty-string
placeholders.

### Timeout event type

Timeout exits emit `agent_timeout` (not `agent_killed`). The distinction
is preserved in both the event stream and the registry manifest status
(`timed_out` vs `killed`).

## 14. Success criteria

This observability model is accepted when:

- the dashboard no longer needs TMUX pane capture for primary worker visibility
- the operator can inspect any active agent from structured logs alone
- mailbox activity and bridge-driven reviews are visible in one place
- lane snapshots and operator tools are derived from the same runtime truth
