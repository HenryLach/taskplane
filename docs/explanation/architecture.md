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
│         │  /orch* commands      │  (task-orchestrator extension)│
│         │                       │                               │
│         └───────────┬───────────┘                               │
│                     │                                           │
│                     │ spawns workers/reviewers/mergers          │
│                     ▼                                           │
│       orch branch (orch/{opId}-{batchId})                      │
│       ├── lane worktrees + subprocess agents                       │
│       ├── merge worktrees (per wave)                           │
│       └── /orch-integrate → user's working branch              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

               taskplane CLI + package files
        (bin/, extensions/, skills/, templates/, dashboard/)
```

---

## Major modules

### 1) Task Orchestrator extension (`extensions/task-orchestrator.ts` + `extensions/taskplane/*`)

The sole user-facing command surface. Owns all task execution — from single
tasks to parallel batch execution:

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

**Non-blocking execution model:** `/orch` and `/orch-resume` start the engine
in a dedicated `worker_thread` and return control to the pi session immediately.
The engine runs its wave loop in a separate V8 isolate, communicating state
transitions via `postMessage` to the main thread — which forwards them as
structured events to `.pi/supervisor/events.jsonl` and drives the dashboard
widget. Control signals (pause, resume, abort) are forwarded from the main
thread to the worker via `postMessage`. If the worker thread fails to spawn,
the engine falls back to main-thread execution via `setTimeout(0)`. This keeps
the pi session free for the operator to run `/orch-status`, `/orch-pause`, or
interact with the supervisor agent while the batch executes.

### 2) CLI (`bin/taskplane.mjs`)

Owns project scaffolding and diagnostics:

- `taskplane init`
- `taskplane doctor`
- `taskplane version`
- `taskplane dashboard`

It does **not** execute task logic itself; that lives in extensions.

### 3) Dashboard (`dashboard/server.cjs` + `dashboard/public/*`)

A standalone Node server + static frontend reading sidecar state (`.pi/*`) and streaming updates via SSE.

### 4) Skills and templates

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

Global preferences in `~/.pi/agent/taskplane/preferences.json` provide the baseline for all projects, and project config applies sparse overrides on top (schema defaults → global preferences → project overrides).

Customized per repository.

---

## Data and control flow

1. User invokes command in pi (`/orch*`)
2. Extension loads config from `.pi/taskplane-config.json` (or YAML fallback)
3. Orchestrator performs execution
   - `/orch` and `/orch-resume` launch the engine asynchronously — the command handler returns immediately, and the engine runs its wave loop in the background
   - Engine state transitions emit structured events (`wave_start`, `task_complete`, `task_failed`, `merge_start`, `merge_success`, `merge_failed`, `batch_complete`, `batch_paused`) to `.pi/supervisor/events.jsonl`
   - In-memory callbacks update the dashboard widget in real time
4. Progress is persisted to files (`STATUS.md`, `.DONE`, `.pi/batch-state.json`, lane sidecars, `.pi/supervisor/events.jsonl`)
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

## Runtime V2

Taskplane uses **Runtime V2**, a direct-child execution backend with no external
process manager dependencies. All worker, reviewer, and merge agents run as
direct child processes managed by the `agent-host.ts` + `process-registry.ts`
modules.

Key properties:

- **No TMUX dependency** — agents spawn as subprocess children, not terminal sessions
- **Mailbox-first communication** — the supervisor steers agents via file-based mailbox,
  not terminal I/O
- **Registry-backed liveness** — `process-registry.ts` tracks all spawned processes
  with PID-based health checks
- **Lane snapshot telemetry** — `.pi/runtime/{batchId}/lanes/lane-N.json` provides
  real-time progress, token counts, and cost for the dashboard

See `docs/specifications/framework/taskplane-runtime-v2/` for the full
architecture specification.

---

## Related

- [Execution Model](execution-model.md)
- [Waves, Lanes, and Worktrees](waves-lanes-and-worktrees.md)
- [Persistence and Resume](persistence-and-resume.md)
