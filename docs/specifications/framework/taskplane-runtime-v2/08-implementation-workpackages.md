# Implementation Work Packages

**Status:** Proposed build plan  
**Related:** [07-task-crosswalk-and-roadmap.md](07-task-crosswalk-and-roadmap.md)

## 1. Purpose

This document turns the Runtime V2 architecture into concrete build packages
with code touchpoints and acceptance criteria.

## 2. WP-1 — Extract headless execution core

### Goal

Separate execution semantics from the deprecated `/task` extension host.

### Likely code touchpoints

- `extensions/task-runner.ts`
- new `extensions/taskplane/task-executor-core.ts`
- status parsing/mutation helpers already in `task-runner.ts`
- tests currently targeting task-runner behavior

### Deliverables

- headless execution library with no Pi UI/session assumptions
- compatibility wrapper retained temporarily in `task-runner.ts`
- no behavior drift in STATUS/.DONE semantics

### Acceptance

- existing execution semantics still pass regression tests
- `/orch` can call the shared execution core without `TASK_AUTOSTART`

## 3. WP-2 — Agent host

### Goal

Replace TMUX-backed child hosting with direct child-process ownership.

### Likely code touchpoints

- `bin/rpc-wrapper.mjs` -> evolve or split into `agent-host.mjs`
- new `extensions/taskplane/process-registry.ts`
- `extensions/taskplane/types.ts`
- telemetry-related tests (`rpc-wrapper.test.ts`, telemetry tests)

### Deliverables

- direct `pi --mode rpc` host
- registry/manifest updates
- normalized events
- mailbox inbox delivery preserved

### Acceptance

- worker host runs without TMUX installed
- exit summary + telemetry + mailbox delivery all work on direct-child backend

## 4. WP-3 — Lane runner

### Goal

Introduce a deterministic headless lane runtime.

### Likely code touchpoints

- new `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/resume.ts`

### Deliverables

- lane-runner launch contract
- direct worker/reviewer ownership
- lane snapshot emission
- no lane Pi session requirement

### Acceptance

- single-task `/orch <PROMPT.md>` runs end-to-end through lane-runner
- engine receives task outcomes without TMUX session polling

## 5. WP-4 — Registry-backed operator tools

### Goal

Remove TMUX assumptions from operator/supervisor tools.

### Likely code touchpoints

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/sessions.ts` (likely replaced or heavily rewritten)
- dashboard server agent-status loading paths

### Deliverables

- `send_agent_message` validates against registry
- `list_active_agents` reads registry
- `read_agent_status` reads lane snapshots + packet paths

### Acceptance

- tools work when TMUX is absent
- no tool calls `tmuxHasSession()` for agent liveness

## 6. WP-5 — Mailbox completion and bridge tools

### Goal

Finish the messaging stack on Runtime V2.

### Likely code touchpoints

- `extensions/taskplane/mailbox.ts`
- new `extensions/taskplane/agent-bridge-extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- mailbox tests

### Deliverables

- TP-091 replies/outbox
- TP-092 broadcast/rate limiting
- bridge tools for review and supervisor contact

### Acceptance

- supervisor can query and receive replies from live agents
- worker can request review without lane extension hosting

## 7. WP-6 — Dashboard migration

### Goal

Make dashboard the complete primary visibility surface.

### Likely code touchpoints

- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- `dashboard/public/index.html`

### Deliverables

- registry-backed agent panel
- normalized conversation viewer
- TP-093 messages panel
- diagnostics panel updates

### Acceptance

- pane capture no longer required for primary worker visibility
- mailbox activity and agent conversation visible on Runtime V2 backend

## 8. WP-7 — Packet-path authority

### Goal

Thread packet-home authority end-to-end in the new runtime.

### Likely code touchpoints

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/resume.ts`
- lane-runner inputs
- multi-repo tests

### Deliverables

- TP-082/TP-088 semantics on Runtime V2 launch contracts
- authoritative `.DONE`/`STATUS.md` checks in execution and resume

### Acceptance

- packet-home repo != execution repo works correctly in workspace mode
- resume never guesses packet paths from `cwd`

## 9. WP-8 — Segment runtime continuation

### Goal

Continue TP-085..TP-087 on the new execution-unit-based runtime.

### Likely code touchpoints

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- supervisor alert + dashboard integration

### Deliverables

- segment frontier
- expansion request protocol
- graph mutation + persisted revisioning

### Acceptance

- segment roadmap proceeds without reintroducing TMUX/runtime coupling

## 10. Definition of done for the full program

The Runtime V2 program is done when:

- TMUX is not required for correctness
- `/orch` is the sole authoritative execution path
- mailbox and dashboard provide all required steering and visibility
- worker/reviewer/merge lifecycle is registry-backed and directly owned
- polyrepo packet-home correctness and segment roadmap both sit on the same runtime foundation
