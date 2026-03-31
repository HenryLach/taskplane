# Runtime Process Model

**Status:** Proposed (updated 2026-03-30 with implementation findings from TP-102/103/104)  
**Related:** [01-architecture.md](01-architecture.md)

## 1. Purpose

This document defines the concrete process model for Runtime V2:

- who spawns what
- who owns cleanup
- how liveness is tracked
- how `/task` is removed from the critical path
- how existing execution semantics move into headless runtime code

## 2. Process tree

```text
operator pi session
  -> taskplane extension host
    -> engine process
      -> lane-runner process (lane 1)
        -> agent-host (worker)
          -> pi --mode rpc
        -> agent-host (reviewer)
          -> pi --mode rpc
      -> lane-runner process (lane 2)
      -> agent-host (merge-1)
        -> pi --mode rpc
```

## 3. Ownership rules

## 3.1 Extension owns the engine

The extension may start, stop, or reconnect to the engine, but it does not own
per-agent subprocesses directly.

## 3.2 Engine owns lane-runners and merge hosts

The engine is the single authority for:

- launching lane-runners for active lanes
- launching merge hosts for active merges
- sending pause/resume/abort signals downward
- updating batch state based on child results

## 3.3 Lane-runner owns worker and reviewer hosts

The lane-runner is the only authority for:

- worker iteration loops
- reviewer launches for the current lane/task
- status progression within that lane
- deciding when to respawn a worker due to context limit, timer, or crash

## 3.4 Agent-host owns exactly one Pi child

The agent-host owns:

- the child process handle
- stdin/stdout/stderr
- exit classification input
- mailbox injection timing
- runtime manifest updates

No other process should attempt to kill or infer state for the Pi child except
through the host’s parent.

## 4. New runtime modules

## 4.1 `task-executor-core.ts`

A shared, headless library extracted from `task-runner.ts`.

Owns:

- task packet parsing
- STATUS parsing and mutation helpers
- step progression rules
- checkpoint and completion logic
- quality gate orchestration contracts
- worker/reviewer prompt assembly

Does not own:

- extension UI
- command registration
- parent/child process management

## 4.2 `lane-runner.ts`

Headless per-lane runtime process.

Suggested inputs:

- batch metadata
- lane metadata (lane number, branch, worktree, repoId)
- assigned execution units (task or segment)
- config snapshot
- packet-path authority data
- runtime root path

Suggested outputs:

- lane snapshots
- task outcomes
- structured lane events
- child agent launch requests (internal to process)

## 4.3 `agent-host.mjs`

Replacement for the current TMUX-backed `rpc-wrapper.mjs` role.

Minimum responsibilities:

- spawn `pi --mode rpc --no-session` with `shell: false`
- parse RPC JSONL
- normalize telemetry and conversation events
- inject mailbox messages with RPC `steer`
- write manifest/events/exit files
- stream normalized events to parent over IPC or stdout

## 4.4 `agent-bridge-extension.ts`

Minimal extension loaded into Pi agents only when a runtime callback is needed.

Candidate tools:

- `review_step`
- `wait_for_review` (optional baseline; may be deferred if persistent reviewer is temporarily removed)
- `notify_supervisor`
- `reply_supervisor`
- `request_segment_expansion`

This extension should stay intentionally tiny and protocol-focused.

## 5. Stable agent IDs

Runtime V2 keeps current human-readable IDs but treats them as runtime IDs,
not terminal names.

| Role | Canonical ID example |
|---|---|
| worker | `orch-henrylach-lane-1-worker` |
| reviewer | `orch-henrylach-lane-1-reviewer` |
| merger | `orch-henrylach-merge-1` |
| lane-runner | `orch-henrylach-lane-1` |

### Rule

These identifiers are **opaque stable runtime IDs**. Tools and dashboard code
must stop assuming they correspond to a TMUX session.

## 6. Process registry

Runtime V2 replaces TMUX discovery with a file-backed process registry.

### Canonical registry

```text
.pi/runtime/{batchId}/registry.json
```

### Per-agent manifest

```text
.pi/runtime/{batchId}/agents/{agentId}/manifest.json
```

Suggested manifest shape:

```json
{
  "batchId": "20260330T120000",
  "agentId": "orch-henrylach-lane-1-worker",
  "role": "worker",
  "laneNumber": 1,
  "taskId": "TP-091",
  "repoId": "default",
  "pid": 12345,
  "parentPid": 12000,
  "startedAt": 1774850000000,
  "status": "running",
  "cwd": "C:/dev/taskplane/.worktrees/.../lane-1",
  "packet": {
    "promptPath": "...",
    "statusPath": "...",
    "donePath": "...",
    "reviewsDir": "..."
  }
}
```

## 6.1 Registry invariants

1. Parent writes the manifest before the child is considered visible.
2. Parent updates status on normal exit, kill, timeout, crash, and orphan recovery.
3. Operator tools read the registry, not TMUX.
4. Resume/orphan cleanup validates `pid` + process liveness + `startedAt`.

## 7. Liveness and cleanup semantics

## 7.1 Live control

Use actual child handles and parent-owned timers/signals.

Do **not** use:

- `tmux has-session`
- shell polling to infer child existence
- delayed session stabilization loops as the primary liveness mechanism

## 7.2 Graceful stop sequence

For worker/reviewer/merge hosts:

1. send mailbox `abort` or runtime stop request
2. allow wrap-up grace period
3. send process termination
4. escalate to force kill after timeout
5. mark manifest/exit summary accordingly

## 7.3 Orphan recovery on restart

At engine startup or resume:

1. load runtime registry for the batch
2. inspect recorded PIDs
3. determine which processes are still alive
4. either reconnect (if supported in the phase) or terminate and rehydrate from file-backed state
5. never leave a live unknown child burning credits silently

### Baseline recommendation

For first Runtime V2 implementation, prioritize:

- **detect + terminate + rehydrate**

before attempting:

- **full live reattachment to pre-existing agent-host processes**

This gives deterministic recovery faster.

## 8. Execution lifecycle

## 8.1 Batch start

1. extension requests batch start
2. engine writes batch state and runtime root
3. engine provisions worktrees/branches
4. engine spawns lane-runners
5. lane-runners begin execution units
6. dashboard and supervisor read registry/events immediately

## 8.2 Single lane execution

1. lane-runner receives next execution unit
2. lane-runner resolves packet paths and worktree paths
3. lane-runner spawns worker host
4. worker host streams normalized events directly back to lane-runner
5. lane-runner updates lane snapshot and STATUS-driven state
6. when reviews are required, lane-runner spawns reviewer host(s)
7. lane-runner writes `.DONE` if completion criteria are met
8. lane-runner returns outcome to engine

## 8.3 Merge execution

1. engine provisions merge worktree
2. engine spawns merge host directly
3. merge host emits normalized merge telemetry/events
4. engine applies merge result and proceeds or pauses

## 9. `/task` deprecation strategy

Runtime V2 should stop treating `/task` as a privileged implementation host.

### Public product position

- `/orch <PROMPT.md>` is the only recommended single-task execution path
- `/task` remains deprecated and should not receive new architecture-critical features

### Implementation position

Two acceptable end states:

#### Option A — compatibility shim

`/task` becomes a thin wrapper that invokes the same headless execution core used
by `/orch` single-task mode.

#### Option B — removal in next major

- remove `/task`, `/task-status`, `/task-pause`, `/task-resume`
- provide migration messaging and aliases during transition period

### Mandatory rule

No new critical runtime behavior may be implemented only inside `task-runner.ts`
as a Pi extension.

## 10. Worker/reviewer feature posture

## 10.1 Baseline required for first Runtime V2

- persistent worker context
- review support at step boundaries
- mailbox steering
- quality gate support
- model fallback
- deterministic crash/timeout handling

## 10.2 Allowed simplification for first stable cut

If needed for stability, Runtime V2 may temporarily ship with:

- **ephemeral reviewers as the baseline**

while keeping the protocol open for later reintroduction of persistent reviewer
parking (`wait_for_review`) as an optimization.

That trade is acceptable because resilience is the higher-order requirement.

## 11. Packet-path authority in the process model

Every lane-runner and agent-host launch contract must carry explicit packet paths
when the packet home differs from the active segment repo.

Required fields:

- `promptPath`
- `statusPath`
- `donePath`
- `reviewsDir`

This is the runtime equivalent of the planned TP-082 / TP-088 contract.

## 12. Windows-specific requirements

Runtime V2 must eliminate the classes of Windows failures currently amplified by
TMUX/MSYS shells.

Required rules:

1. prefer `spawn(..., { shell: false })`
2. pass argument arrays, not shell-composed strings
3. avoid terminal/session semantics for liveness
4. avoid shell quoting as a primary correctness mechanism
5. use process-registry-based cleanup instead of server/session cleanup

## 13. Implementation notes (from TP-102/103/104)

### Executor-core extraction scope

TP-103 extracted 15 pure helper functions (parsing, status mutation, review
request generation, verdict extraction, git helpers) into
`extensions/taskplane/task-executor-core.ts`. The execution state machine
functions (`executeTask`, `runWorker`, `doReview`) remain in `task-runner.ts`
because they depend on Pi's `ExtensionContext` for spawn modes and UI callbacks.
TP-105 (lane-runner) will consume the core module directly and provide its own
execution state machine without the extension host coupling.

### Registry lifecycle wiring

The process registry (`extensions/taskplane/process-registry.ts`) is wired into
`agent-host.ts` `spawnAgent()`: manifests are written before the agent is
considered visible, and updated to terminal status on exit/crash/timeout/kill.
Callers opt in to registry integration by providing `stateRoot` in
`AgentHostOptions`.

### Timeout vs killed distinction

`agent-host.ts` tracks a separate `timedOut` flag. The exit event type is
`agent_timeout` for timeouts and `agent_killed` for explicit kills. The registry
manifest status maps to `timed_out` vs `killed` accordingly.

### Extension loading safety

`agent-host.ts` always passes `--no-extensions` to prevent auto-discovery from
cwd, even when explicit `-e` entries are provided. This matches the fix from
TP-095 that eliminated duplicate extension loading in the legacy TMUX path.

### Lane-runner implementation approach (TP-105)

The lane-runner (`extensions/taskplane/lane-runner.ts`) is implemented as a
headless module, not a separate child process. This is intentional for the first
Runtime V2 slice — it minimizes integration complexity while delivering the same
ownership semantics. A process boundary can be introduced later if isolation
between the engine and lane execution becomes necessary.

The integration point is `executeLaneV2()` in `execution.ts`, which has the same
return type (`LaneExecutionResult`) as the legacy `executeLane()`. This allows
the engine to switch between backends based on a runtime config flag during
the migration period (TP-108).

## 14. Acceptance criteria

This process model is accepted when:

- `list_active_agents` can be implemented entirely from the process registry
- `send_agent_message` no longer checks `tmuxHasSession()`
- lane progress does not require a lane Pi session to host task execution
- worker/reviewer crashes are reported from actual process ownership and exit summaries
- the system can run without TMUX installed
