# Configure Task Runner (`.pi/task-runner.yaml`)

This guide explains how to configure Taskplane's single-task execution behavior.

## Where this file lives

- Path: `.pi/task-runner.yaml`
- Used by: `/task` and also partially by `/orch` (task area discovery)

If the file is missing, run:

```bash
taskplane init
```

---

## Minimal working config

A small config from `taskplane init` can be enough to run tasks:

```yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"

reference_docs: {}
standards: {}

testing:
  commands:
    unit: "npm test"
    build: "npm run build"
```

Task-runner will fill missing fields with defaults.

---

## Full section guide

### `project`

```yaml
project:
  name: "Example Project"
  description: "Short description"
```

Used in reviewer prompts and task context.

### `paths`

```yaml
paths:
  tasks: "taskplane-tasks"
  architecture: "docs/architecture.md"
```

Project path metadata for prompts/context.

### `testing.commands`

```yaml
testing:
  commands:
    test: "npm test"
    build: "npm run build"
    lint: "npm run lint"
```

These commands are injected into execution/review context. Keep only safe, relevant commands.

### `standards`

```yaml
standards:
  docs:
    - "README.md"
    - "CONTRIBUTING.md"
  rules:
    - "Keep changes scoped to the task"
    - "Update docs when behavior changes"
```

Global coding/review standards.

### `standards_overrides`

```yaml
standards_overrides:
  backend:
    docs: ["docs/backend-standards.md"]
    rules: ["Do not bypass auth middleware"]
```

Area-specific standards override global standards when task folder path matches that area.

### `worker`

```yaml
worker:
  model: ""
  tools: "read,write,edit,bash,grep,find,ls"
  thinking: ""
  spawn_mode: "subprocess"
```

- `model: ""` means inherit current pi session model.
- `thinking: ""` means inherit current pi session thinking mode (`"inherit"` alias is also accepted).
- `spawn_mode`: `subprocess` (default).

### `reviewer`

```yaml
reviewer:
  model: ""
  tools: "read,write,bash,grep,find,ls"
  thinking: "off"
```

Set `reviewer.model` explicitly (optional) to use a different model than worker for stronger cross-model review.

### `context`

```yaml
context:
  worker_context_window: 200000
  warn_percent: 70
  kill_percent: 85
  max_worker_iterations: 20
  max_review_cycles: 2
  no_progress_limit: 3
  max_worker_minutes: 30
```

Controls loop safety, context pressure, and retry limits.

### `task_areas` (required in practice)

```yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"
```

This is the most important section for discovery and orchestration.

### `reference_docs`

```yaml
reference_docs:
  overview: "README.md"
  architecture: "docs/architecture.md"
```

Reference document catalog used by task-creation workflows.

### `never_load`

```yaml
never_load:
  - "PROGRESS.md"
  - "HANDOFF-LOG.md"
```

Docs that should be excluded from task context loading.

### `self_doc_targets`

```yaml
self_doc_targets:
  tech_debt: "CONTEXT.md ## Technical Debt / Future Work"
```

Targets where agents should log discoveries.

### `protected_docs`

```yaml
protected_docs:
  - "docs/"
  - "templates/"
```

Paths requiring explicit approval before edits.

---

## Recommended baseline for most projects

- Keep `worker.model` empty (inherit from session)
- Optionally set a fixed `reviewer.model` for cross-model review
- Keep `max_worker_iterations` modest (10–20)
- Keep `task_areas` small at first, then split by domain
- Add only test/build commands that are deterministic

---

## Validate your config

After edits:

```bash
taskplane doctor
```

Then in pi:

```
/task path/to/PROMPT.md
```

---

## Related guides

- [Define Task Areas](define-task-areas.md)
- [Configure Task Orchestrator](configure-task-orchestrator.md)
