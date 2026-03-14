# Define Task Areas

Task areas organize your task backlog into logical domains and tell Taskplane where to discover tasks.

## What is a task area?

A task area is an entry in `.pi/task-runner.yaml` under `task_areas`:

```yaml
task_areas:
  auth:
    path: "taskplane-tasks/auth/tasks"
    prefix: "AUTH"
    context: "taskplane-tasks/auth/CONTEXT.md"
```

Each area defines:

- `path`: folder containing task directories
- `prefix`: task ID prefix (used in folder/task naming)
- `context`: area-level context file

---

## How discovery works

The orchestrator scans each area path for **immediate subdirectories** and expects task folders with `PROMPT.md`.

Conventions that matter:

- Task folder names should begin with ID pattern like `AUTH-001-...`
- `PROMPT.md` should include heading `# Task: AUTH-001 - ...`
- Tasks with `.DONE` are treated as completed
- `archive/` folders are skipped by discovery

---

## Add a new area (step-by-step)

### 1) Create directories

```bash
mkdir -p taskplane-tasks/auth/tasks
```

### 2) Create area context file

`taskplane-tasks/auth/CONTEXT.md`:

```md
# Auth — Context

**Last Updated:** 2026-03-14
**Status:** Active
**Next Task ID:** AUTH-001

## Current State
Domain context for authentication and authorization work.
```

### 3) Add area entry to `.pi/task-runner.yaml`

```yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"
  auth:
    path: "taskplane-tasks/auth/tasks"
    prefix: "AUTH"
    context: "taskplane-tasks/auth/CONTEXT.md"
```

### 4) Validate

```bash
taskplane doctor
```

### 5) Test discovery

Inside pi:

```
/orch-plan auth
/orch-deps auth
```

---

## Naming conventions (recommended)

- Area keys: lowercase kebab-case (`auth`, `billing`, `platform-observability`)
- Prefixes: short uppercase (`AUTH`, `BIL`, `OBS`)
- Task folders: `<PREFIX>-<NNN>-<slug>`

Examples:

- `AUTH-001-login-flow`
- `BIL-014-stripe-webhooks`
- `OBS-003-alert-routing`

---

## Dependency notation across areas

In `PROMPT.md`, dependencies can be:

- same-area or global ID: `AUTH-002`
- area-qualified: `billing/BIL-004`

Area-qualified dependencies reduce ambiguity in large multi-area projects.

---

## Growth pattern

### Stage 1: Single area

```yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"
```

### Stage 2: Domain split

```yaml
task_areas:
  auth: ...
  billing: ...
  notifications: ...
```

### Stage 3: Domain + platform

```yaml
task_areas:
  auth: ...
  billing: ...
  infrastructure: ...
  observability: ...
```

---

## How task creation uses areas

The `create-taskplane-task` skill reads `task_areas` and each area's `CONTEXT.md` to choose placement and next task ID.

So after adding a new area, task creation workflows can target it immediately.

---

## Troubleshooting

### `Area path does not exist`

Create the missing directory and re-run `taskplane doctor`.

### Tasks not discovered

Check:

- folder is inside configured `path`
- folder name starts with ID prefix pattern
- `PROMPT.md` exists and has valid `# Task: ...` heading

### Ambiguous dependency IDs

Use area-qualified dependencies like `auth/AUTH-010`.
