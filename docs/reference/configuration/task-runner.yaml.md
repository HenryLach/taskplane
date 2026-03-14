# `task-runner.yaml` Reference

Path: `.pi/task-runner.yaml`

This file configures Taskplane task execution (`/task`) and provides shared metadata for orchestration and task-creation workflows.

> Template source: `templates/config/task-runner.yaml`

---

## Schema overview

```yaml
project:
paths:
testing:
standards:
standards_overrides:
worker:
reviewer:
context:
task_areas:
reference_docs:
never_load:
self_doc_targets:
protected_docs:
```

---

## Field reference

### `project`

| Field | Type | Template default | Description |
|---|---|---|---|
| `project.name` | string | `"Example Project"` | Project display name used in prompts/status UI context. |
| `project.description` | string | `"Replace with a short description of your project"` | Short project description for agent context. |

### `paths`

| Field | Type | Template default | Description |
|---|---|---|---|
| `paths.tasks` | string | `"tasks"` | Logical tasks root path metadata. |
| `paths.architecture` | string | `"docs/architecture.md"` | Path to architecture document used in context references. |

### `testing`

| Field | Type | Template default | Description |
|---|---|---|---|
| `testing.commands` | map<string,string> | `{ test, build, lint }` | Named verification commands available to agents/reviewers. |

Example:

```yaml
testing:
  commands:
    test: "npm test"
    build: "npm run build"
    lint: "npm run lint"
```

### `standards`

| Field | Type | Template default | Description |
|---|---|---|---|
| `standards.docs` | string[] | `README.md`, `CONTRIBUTING.md` | Docs to treat as coding/review standards references. |
| `standards.rules` | string[] | 4 default rules | Plain-language rules injected into agent context. |

### `standards_overrides`

| Field | Type | Template default | Description |
|---|---|---|---|
| `standards_overrides` | map<string,{docs?:string[], rules?:string[]}> | `{}` | Per-area standards overrides keyed by area name. |

If a task path matches a configured task area, that area's override applies.

### `worker`

| Field | Type | Template default | Description |
|---|---|---|---|
| `worker.model` | string | `""` | Worker model. Empty string = inherit from active pi session model. |
| `worker.tools` | string | `"read,write,edit,bash,grep,find,ls"` | Tool allowlist passed to worker agent invocations. |
| `worker.thinking` | string | `"off"` | Thinking mode setting passed to worker agent. |
| `worker.spawn_mode` | `"subprocess"` \| `"tmux"` | commented in template | Optional spawn mode override for task-runner. |

Notes:
- `spawn_mode` defaults to `subprocess` when not set.
- In orchestrated runs, environment variables set by orchestrator may override runner spawn behavior.

### `reviewer`

| Field | Type | Template default | Description |
|---|---|---|---|
| `reviewer.model` | string | `""` | Reviewer model (empty = inherit session model). |
| `reviewer.tools` | string | `"read,write,bash,grep,find,ls"` | Tool allowlist for reviewer agent. |
| `reviewer.thinking` | string | `"off"` | Thinking mode for reviewer. |

### `context`

| Field | Type | Template default | Description |
|---|---|---|---|
| `context.worker_context_window` | number | `200000` | Context window size used for worker context pressure tracking. |
| `context.warn_percent` | number | `70` | Warn threshold for context utilization. |
| `context.kill_percent` | number | `85` | Hard-stop threshold for context utilization. |
| `context.max_worker_iterations` | number | `20` | Max worker iterations per step before failure. |
| `context.max_review_cycles` | number | `2` | Max revise loops per review stage. |
| `context.no_progress_limit` | number | `3` | Max no-progress iterations before marking failure. |
| `context.max_worker_minutes` | number | commented (`30`) | Optional per-worker wall-clock cap (used in tmux/orchestrated flows). |

### `task_areas`

| Field | Type | Template default | Description |
|---|---|---|---|
| `task_areas` | map<string,TaskArea> | `core`, `docs` examples | Declares discoverable task area directories. |
| `task_areas.<area>.path` | string | area-specific | Directory containing task folders. |
| `task_areas.<area>.prefix` | string | area-specific | Task ID prefix convention for that area. |
| `task_areas.<area>.context` | string | area-specific | Area context file path (CONTEXT.md). |

Example:

```yaml
task_areas:
  auth:
    path: "taskplane-tasks/auth/tasks"
    prefix: "AUTH"
    context: "taskplane-tasks/auth/CONTEXT.md"
```

### `reference_docs`

| Field | Type | Template default | Description |
|---|---|---|---|
| `reference_docs` | map<string,string> | `overview`, `architecture`, `contributing` | Named reference docs catalog for high-context task creation workflows. |

### `never_load`

| Field | Type | Template default | Description |
|---|---|---|---|
| `never_load` | string[] | `PROGRESS.md`, `HANDOFF-LOG.md` | Files/docs that should not be loaded into task execution context. |

### `self_doc_targets`

| Field | Type | Template default | Description |
|---|---|---|---|
| `self_doc_targets` | map<string,string> | `tech_debt` entry | Target anchors where agents should log discoveries. |

### `protected_docs`

| Field | Type | Template default | Description |
|---|---|---|---|
| `protected_docs` | string[] | `docs/`, `templates/` | Paths requiring explicit user approval before modification. |

---

## Runtime behavior notes

- If `.pi/task-runner.yaml` is missing or malformed, task-runner falls back to internal defaults.
- Task-runner directly consumes the core execution sections (`project`, `paths`, `testing`, `standards`, `standards_overrides`, `task_areas`, `worker`, `reviewer`, `context`).
- Additional sections (`reference_docs`, `never_load`, `self_doc_targets`, `protected_docs`) are primarily used by Taskplane skill/workflow conventions and broader ecosystem tooling.

---

## Related

- [Task Runner How-To](../../how-to/configure-task-runner.md)
- [Task Orchestrator Config Reference](task-orchestrator.yaml.md)
