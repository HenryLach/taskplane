# Runtime V2 Architecture

**Status:** Proposed  
**Related:** [README](README.md), `docs/specifications/taskplane/spawn-telemetry-stability.md`

## 1. Executive summary

Taskplane should keep its **durable data plane** and replace its fragile
**runtime control plane**.

### Keep

- `PROMPT.md`, `STATUS.md`, `.DONE`
- `.pi/batch-state.json`
- dependency DAG, waves, lanes, worktrees, orch branches
- supervisor and dashboard concepts
- packet-home / workspace mode contracts

### Replace

- TMUX as correctness infrastructure
- lane Pi sessions as orchestration hosts
- `/orch` bootstrapping `/task` through `TASK_AUTOSTART`
- sidecar-file tailing as the primary live telemetry transport
- session identity coupled to terminal sessions

## 2. Core diagnosis

The current failures are not isolated implementation bugs; they come from a
control plane with too many overlapping layers:

```text
operator pi session
  -> orch extension
    -> engine child
      -> tmux lane session
        -> rpc-wrapper
          -> pi task-runner session
            -> tmux worker session
              -> rpc-wrapper
                -> pi worker
```

This creates recurring instability:

1. **ambiguous ownership** — when a child dies, the system cannot reliably say
   which layer failed first or who should clean it up
2. **transport inversion** — directly related processes communicate live state
   through files rather than direct IPC
3. **extension-host coupling** — orchestrated execution depends on extension
   lifecycle behavior that was originally built for `/task`
4. **terminal dependency** — agent liveness and visibility depend on TMUX/MSYS
   behavior instead of deterministic Node process ownership

## 3. Target architecture

```text
operator pi session / supervisor
  -> taskplane extension (command surface only)
    -> engine process (deterministic Node)
      -> lane-runner process per active lane (deterministic Node)
        -> agent-host process: worker
          -> pi --mode rpc
        -> agent-host process: reviewer
          -> pi --mode rpc
      -> agent-host process: merger
        -> pi --mode rpc
```

### Key rule

**Every spawned process has exactly one deterministic owner.**

- extension owns engine process
- engine owns lane-runners and merge hosts
- lane-runner owns worker/reviewer hosts
- agent-host owns its Pi child

No process should need to infer liveness from TMUX server state.

## 4. Component responsibilities

## 4.1 Extension (`extensions/taskplane/extension.ts`)

Owns:

- command registration (`/orch*`, settings, supervisor tools)
- supervisor activation and routing UX
- batch start/resume/abort requests into the engine
- process-registry-backed operator tools (`list_active_agents`, `read_agent_status`, mailbox tools)

Does **not** own:

- lane execution loops
- worker/reviewer lifecycle
- live telemetry parsing from sidecar files

## 4.2 Engine process

Owns:

- discovery, DAG, wave planning, lane allocation
- persisted batch state and resume orchestration
- worktree/orch-branch lifecycle
- launching lane-runners and merge hosts
- aggregate policy decisions (pause, resume, abort, retry, skip, merge)
- high-level events to supervisor/dashboard

Does **not** own:

- per-task worker loops
- direct agent-tool protocol details

## 4.3 Lane-runner process

New deterministic runtime component.

Owns:

- exactly one lane worktree at a time
- serial task/segment execution inside that lane
- task execution state machine
- STATUS parsing, step progression, checkpoint discipline, .DONE handling
- reviewer orchestration for that lane
- lane snapshot emission
- packet-path authority enforcement

This replaces the current pattern where a lane is a Pi session loading the
`task-runner.ts` extension.

## 4.4 Agent-host process

New transport adapter around `pi --mode rpc`.

Owns:

- Pi subprocess lifecycle
- live RPC event parsing
- telemetry normalization
- mailbox inbox polling + `steer` injection
- conversation/event persistence
- exit summary generation
- process manifest updates

This is the right place for transport concerns currently split between TMUX,
`rpc-wrapper.mjs`, and lane-hosted extension code.

## 4.5 Dashboard server

Owns:

- reading normalized runtime artifacts
- SSE updates to browser clients
- conversation views from structured event logs
- mailbox/message panel
- process/agent status panels

It should never need TMUX pane capture for primary visibility.

## 5. Required invariants

1. **File-backed memory stays authoritative**
   - `STATUS.md` remains the execution memory.
   - `.DONE` remains the completion marker.

2. **Batch state remains resumable**
   - `.pi/batch-state.json` continues as canonical orchestration state.

3. **Live control uses direct ownership, not file polling between siblings**
   - parents receive child telemetry directly
   - files persist durable history and snapshots

4. **Mailbox is the only supported steering path**
   - operator talks to supervisor
   - supervisor talks to agents
   - agents reply/escalate through mailbox/outbox

5. **No correctness dependency on terminal infrastructure**
   - no task outcome should depend on `tmux has-session`, pane capture, or attachability

6. **Packet-home authority is explicit**
   - segment repo and packet repo may differ
   - packet file paths are passed explicitly, never inferred from `cwd`

## 6. Canonical runtime storage layout

Runtime V2 introduces a batch-scoped runtime directory:

```text
.pi/runtime/{batchId}/
├── agents/
│   └── {agentId}/
│       ├── manifest.json
│       ├── events.jsonl
│       ├── stderr.log
│       ├── exit.json
│       └── bridge/
├── lanes/
│   └── lane-{N}.json
├── merge/
│   └── merge-{N}.json
└── registry.json
```

Existing top-level durable files remain:

```text
.pi/batch-state.json
.pi/mailbox/{batchId}/...
.pi/supervisor/events.jsonl
.pi/supervisor/actions.jsonl
```

### Compatibility note

During migration, Runtime V2 may mirror selected legacy artifacts
(`lane-state-*.json`, legacy conversation JSONL names) so the dashboard and
supervisor tools can be migrated incrementally.

## 7. Agent identity

Runtime V2 keeps the familiar current identifiers but redefines them as
**agent IDs**, not TMUX session names.

Examples:

- `orch-henrylach-lane-1-worker`
- `orch-henrylach-lane-1-reviewer`
- `orch-henrylach-merge-1`

This preserves operator familiarity and minimizes command/tool churn while
removing any implication that an agent is backed by a terminal session.

## 8. Steering and visibility without TMUX

### Steering

- supervisor writes mailbox messages to agent inboxes
- agent-host checks mailbox at `message_end`
- agent-host injects messages via Pi RPC `steer`
- agent replies go to outbox and appear in supervisor/dashboard surfaces

### Visibility

- agent-host persists normalized event streams
- lane-runner emits lane snapshots directly
- dashboard renders full conversation from structured logs
- no pane capture fallback is required for the steady state

## 9. `/task` end state

`/task` is already deprecated in user-facing docs. Runtime V2 finishes the job:

- the **authoritative** execution path is `/orch`, even for one task
- legacy `/task` becomes a compatibility wrapper around the same headless
  execution core, or is removed in a future major version
- no mission-critical runtime logic should live only inside the deprecated path

## 10. Feature posture after redesign

### Must survive the redesign

- persistent worker context
- checkpoint discipline
- worker-driven review entrypoint (`review_step`) or a compatible replacement
- quality gate semantics
- model fallback
- supervisor alert flow
- polyrepo packet-home correctness

### May be reintroduced as optional optimizations after baseline stability

- persistent reviewer context
- advanced reviewer parking/wait loops
- optional detached runtime service beyond the operator session

## 11. Non-goals for Runtime V2 baseline

These are intentionally deferred until the headless runtime is stable:

- detached always-on background daemon/service
- remote multi-operator control plane
- cross-machine execution
- terminal attach/debug UX parity with TMUX

## 12. Success criteria

Runtime V2 is architecturally complete when:

- worker/reviewer/merge lifecycle no longer depends on TMUX
- the dashboard can show agent conversations and telemetry without pane capture
- `send_agent_message` and future mailbox features operate on agent IDs backed by a process registry
- the lane execution path no longer depends on `task-runner.ts` session lifecycle
- workspace/segment execution uses explicit packet-path authority end-to-end
