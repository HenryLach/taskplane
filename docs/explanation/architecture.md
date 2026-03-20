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
│  .pi/taskplane-config.json    .pi/agents/*.md                  │
│  task folders (PROMPT.md / STATUS.md / .DONE)                  │
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
│       orch branch (orch/{opId}-{batchId})                      │
│       ├── lane worktrees + tmux sessions                       │
│       ├── merge worktrees (per wave)                           │
│       └── /orch-integrate → user's working branch              │
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
- `/orch-deps`, `/orch-sessions`, `/orch-integrate`

Responsibilities:

- discover tasks by area/path
- parse dependencies and build DAG
- compute waves and lane assignments
- allocate lane worktrees/branches
- supervise execution + merge lanes into a dedicated orch branch
- provide integration path back to working branch (`/orch-integrate`)
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

- `.pi/taskplane-config.json` — unified project configuration (JSON, camelCase keys)
- `.pi/agents/*.md` — agent system prompts
- task directories (`PROMPT.md`, `STATUS.md`, area `CONTEXT.md`)

Legacy `.pi/task-runner.yaml` and `.pi/task-orchestrator.yaml` are still supported
as fallback but `taskplane-config.json` takes precedence when present.

User preferences in `~/.pi/agent/taskplane/preferences.json` override project config.

Customized per repository.

---

## Data and control flow

1. User invokes command in pi (`/task` or `/orch*`)
2. Extension loads config from `.pi/taskplane-config.json` (or YAML fallback)
3. Runner/orchestrator performs execution
4. Progress is persisted to files (`STATUS.md`, `.DONE`, `.pi/batch-state.json`, lane sidecars)
5. Dashboard reads persisted/sidecar state for live visualization

**Orch branch model:** `/orch` creates a dedicated orch branch (e.g. `orch/op-<id>`) and merges completed lane work there — the user's working branch is never modified during execution. When the batch completes, the user integrates results via `/orch-integrate` (merge, fast-forward, or PR) or configures auto-integration.

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
