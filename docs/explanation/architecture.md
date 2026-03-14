# Architecture

Taskplane is a layered system built on top of pi:

1. **pi package layer** (distributed via npm + `pi install`)
2. **project configuration layer** (scaffolded into each repo by `taskplane init`)

This design keeps shipped code upgradeable while keeping project behavior customizable.

---

## High-level component map

```text
                         User Project
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  .pi/task-runner.yaml      .pi/task-orchestrator.yaml          │
│  .pi/agents/*.md           task folders (PROMPT.md/STATUS.md)  │
│                                                                 │
│         ┌───────────────────────┐                               │
│         │      pi session       │                               │
│         │                       │                               │
│         │  /task  /task-status  │  (task-runner extension)      │
│         │  /orch* commands      │  (task-orchestrator extension)│
│         └───────────┬───────────┘                               │
│                     │                                           │
│                     │ spawns workers/reviewers/mergers          │
│                     ▼                                           │
│              git worktrees + lane sessions                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

               taskplane CLI + package files
        (bin/, extensions/, skills/, templates/, dashboard/)
```

---

## Major modules

### 1) Task Runner extension (`extensions/task-runner.ts`)

Owns single-task execution:

- `/task`
- `/task-status`
- `/task-pause`
- `/task-resume`

Responsibilities:

- parse `PROMPT.md`
- generate/read `STATUS.md`
- run worker/reviewer loops
- enforce checkpoint discipline and iteration limits
- emit lane sidecar data for dashboard when orchestrated

### 2) Task Orchestrator extension (`extensions/task-orchestrator.ts` + `extensions/taskplane/*`)

Owns parallel batch execution:

- `/orch`, `/orch-plan`, `/orch-status`
- `/orch-pause`, `/orch-resume`, `/orch-abort`
- `/orch-deps`, `/orch-sessions`

Responsibilities:

- discover tasks by area/path
- parse dependencies and build DAG
- compute waves and lane assignments
- allocate lane worktrees/branches
- supervise execution + merges
- persist/reconcile state for resume

### 3) CLI (`bin/taskplane.mjs`)

Owns project scaffolding and diagnostics:

- `taskplane init`
- `taskplane doctor`
- `taskplane version`
- `taskplane dashboard`

It does **not** execute task logic itself; that lives in extensions.

### 4) Dashboard (`dashboard/server.cjs` + `dashboard/public/*`)

A standalone Node server + static frontend reading sidecar state (`.pi/*`) and streaming updates via SSE.

### 5) Skills and templates

- `skills/` provides reusable agent skills (e.g., task creation)
- `templates/` provides scaffolding assets copied/generated into projects

---

## Package layer vs project layer

### Package layer (immutable at runtime)

Delivered by `pi install npm:taskplane`:

- extensions
- skills
- dashboard server/frontend
- templates

Upgraded by `pi update`.

### Project layer (user-owned)

Created by `taskplane init`:

- `.pi/task-runner.yaml`
- `.pi/task-orchestrator.yaml`
- `.pi/agents/*.md`
- task directories (`PROMPT.md`, `STATUS.md`, area `CONTEXT.md`)

Customized per repository.

---

## Data and control flow

1. User invokes command in pi (`/task` or `/orch*`)
2. Extension loads config from `.pi/*.yaml`
3. Runner/orchestrator performs execution
4. Progress is persisted to files (`STATUS.md`, `.DONE`, `.pi/batch-state.json`, lane sidecars)
5. Dashboard reads persisted/sidecar state for live visualization

File-based state is intentional: recoverability and inspectability are first-class.

---

## Why this architecture

- **Resumability**: file-based state survives session/process loss
- **Isolation**: orchestrator uses git worktrees to prevent lane conflicts
- **Observability**: sidecars + dashboard make execution transparent
- **Upgradeability**: package code can evolve while project config remains editable
- **Composability**: task creation, execution, orchestration, and monitoring are separable concerns

---

## Related

- [Execution Model](execution-model.md)
- [Waves, Lanes, and Worktrees](waves-lanes-and-worktrees.md)
- [Persistence and Resume](persistence-and-resume.md)
