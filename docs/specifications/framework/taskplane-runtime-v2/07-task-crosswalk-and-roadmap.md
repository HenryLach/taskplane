# Task Crosswalk and Recommended Roadmap

**Status:** Proposed  
**Related:** [06-migration-and-rollout.md](06-migration-and-rollout.md)

## 1. Purpose

This document maps the current open Taskplane task horizon onto Runtime V2 so
future implementation work stays aligned with the new architecture instead of
reinforcing the legacy TMUX-centered path.

## 2. Current open task horizon reviewed

### Mailbox / messaging

- TP-091 — agent-to-supervisor replies
- TP-092 — broadcast and rate limiting
- TP-093 — dashboard mailbox panel

### Packet-home / segment / polyrepo

- TP-082 — packet-path env contract and task-runner authority
- TP-083 — supervisor segment recovery and reordering
- TP-084 — segment observability, docs, and polyrepo acceptance
- TP-085 — segment frontier scheduler and resume reconstruction
- TP-086 — dynamic segment expansion protocol and supervisor decisions
- TP-087 — dynamic segment expansion graph mutation and resume
- TP-088 — engine/resume packet-path threading

## 3. Crosswalk summary

| Existing task | Keep / Re-scope / Supersede | Runtime V2 interpretation |
|---|---|---|
| TP-091 | **Re-scope** | replies/outbox should target registry-backed agent IDs and Runtime V2 events |
| TP-092 | **Keep** | broadcast + rate limiting still needed; just remove TMUX assumptions |
| TP-093 | **Re-scope** | mailbox panel should read runtime-v2 registry + mailbox + normalized message events |
| TP-082 | **Keep, but lift earlier** | packet-path authority becomes a foundation, not a late feature |
| TP-083 | **Re-scope** | supervisor recovery/reordering should target execution units, not TMUX session state |
| TP-084 | **Re-scope** | observability should land on normalized runtime artifacts |
| TP-085 | **Keep** | segment frontier belongs naturally in engine + lane-runner |
| TP-086 | **Keep** | use bridge + supervisor decision plumbing |
| TP-087 | **Keep** | apply graph mutation on execution-unit-aware runtime state |
| TP-088 | **Keep, but lift earlier** | engine/resume packet threading is a base invariant |

## 4. Existing completed work to preserve

| Completed task | Runtime V2 disposition |
|---|---|
| TP-089 | preserve mailbox core and rpc injection semantics |
| TP-090 | preserve steering annotation concept; adapt to new runtime event/snapshot flow |
| TP-094 | preserve authoritative contextUsage handling |
| TP-095 | treat as incident history; most TMUX-specific retry machinery should disappear |
| TP-096 | preserve supervisor recovery tools, but retarget them to registry/runtime artifacts |
| TP-097 | stable sidecar identity concept becomes stable agent/event identity |
| TP-098 | preserve log de-duplication intent in the new event model |

## 5. Recommended implementation order

## Workstream 0 — Assumption lab gate

### Recommended deliverables

1. stage and execute `TP-110`
2. validate direct-child host viability without TMUX
3. validate mailbox steering on the direct host
4. document any still-open packet-path and bridge risks before refactor tasks proceed

### Why first

This prevents the Runtime V2 refactor from being driven entirely by architecture
intuition without a platform-level proof pass.

## Workstream 1 — Runtime foundations

### Recommended deliverables

1. extract `task-executor-core`
2. define runtime registry and normalized event schema
3. define packet-path authority contract (`ExecutionUnit` + packet fields)
4. implement `agent-host.mjs`

### Why first

Without this, new tasks will keep accumulating inside the old `/task` + TMUX substrate.

## Workstream 2 — Single-task `/orch` on Runtime V2

### Recommended deliverables

1. implement headless `lane-runner.ts`
2. make `/orch <PROMPT.md>` use lane-runner + agent-host + packet-path contract
3. keep legacy backend behind feature flag for batch mode initially

### Why second

This gives a narrow end-to-end proving ground before full batch migration.

## Workstream 3 — Mailbox completion on Runtime V2

### Recommended deliverables

1. re-scope TP-091 replies/outbox
2. land TP-092 broadcast/rate limiting
3. implement runtime bridge for `review_step` and supervisor messaging tools
4. land TP-093 dashboard mailbox panel on new artifacts

## Workstream 4 — Batch mode migration

### Recommended deliverables

1. engine launches lane-runners instead of lane Pi/TMUX sessions
2. merge agent moves to agent-host direct child path
3. list/read tools switch to registry-backed liveness

## Workstream 5 — Packet-home / segment parity

### Recommended deliverables

1. land TP-082 and TP-088 on the new runtime contracts
2. continue TP-085 segment frontier
3. continue TP-086 / TP-087 expansion flow
4. re-scope TP-083 / TP-084 to new event model

## 6. Suggested epic structure

If you want to re-task this work cleanly, these are the epics I would stage.

## Epic A — Headless Runtime Foundation

Scope:

- `task-executor-core`
- `agent-host`
- registry/events/snapshots
- single-task `/orch` path

Acceptance:

- one task can run end-to-end without TMUX
- dashboard can show live conversation and telemetry

## Epic B — Mailbox-First Supervisor Control

Scope:

- TP-091, TP-092, TP-093 re-scoped
- bridge tools for review/reply/escalation
- registry-backed operator tools

Acceptance:

- supervisor can steer, query, receive replies, and broadcast without TMUX

## Epic C — Batch and Merge Runtime Migration

Scope:

- lane-runner batch integration
- merge host migration
- tool and dashboard parity
- legacy backend feature flag

Acceptance:

- full batch executes on Runtime V2 backend with worktrees and orch branches preserved

## Epic D — Polyrepo and Segment Runtime Parity

Scope:

- TP-082 through TP-088 on Runtime V2
- packet-home correctness
- segment frontier + expansion + resume
- polyrepo acceptance suite

Acceptance:

- workspace/segment roadmap is unblocked on the new runtime

## 7. Tasks that become legacy-only

These areas should stop receiving major design investment except as migration shims:

- TMUX worker spawn retries
- TMUX session discovery as the primary operator surface
- pane capture as the conversation viewer source
- `/task` as a privileged implementation host

## 8. Hard recommendation

If you stage new implementation tasks from this plan, do **not** continue the
old pattern of tasking mailbox/dashboard work separately from runtime extraction.

The correct dependency order is:

```text
runtime ownership -> mailbox/bridge completion -> dashboard on new artifacts -> segment expansion on new runtime
```

not:

```text
more TMUX/runtime patching -> more mailbox features on TMUX assumptions -> later redesign
```

## 9. Ready-to-build order

If I were sequencing the actual coding effort, I would do it in this order:

1. `TP-110` assumption lab gate
2. Runtime foundation spec acceptance
3. `task-executor-core` extraction
4. `agent-host.mjs`
5. single-task `/orch <PROMPT.md>` on new backend
6. registry-backed `send_agent_message` + `list_active_agents`
7. TP-091 + TP-092 on new backend
8. dashboard conversation/message migration (TP-093)
9. full lane-runner batch integration
10. TP-082 + TP-088 packet-path authority end-to-end
11. TP-085..TP-087 segment roadmap continuation

## 10. What success looks like

After this roadmap, Taskplane should have:

- one execution architecture instead of a legacy `/task` architecture plus an `/orch` wrapper architecture
- one steering model (supervisor + mailbox)
- one visibility model (dashboard + normalized events)
- one identity model (agent IDs backed by a process registry)
- one polyrepo execution story (explicit packet-home authority)
