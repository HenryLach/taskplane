# `task-runner.yaml` Reference

Path: `.pi/task-runner.yaml`

This file configures Taskplane task execution (`/task`) and provides shared metadata for orchestration and task-creation workflows.

> Template source: `templates/config/task-runner.yaml`

> **JSON alternative:** These settings can also be configured via `.pi/taskplane-config.json`, which merges task-runner and orchestrator settings into a single file. See [Unified JSON Config](#unified-json-config) below for details and precedence rules.

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
quality_gate:
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
| `worker.thinking` | string | `""` | Thinking mode for worker agent. Empty string (or explicit `"inherit"`) = inherit active session thinking. |
| `worker.spawn_mode` | `"subprocess"` \| `"tmux"` | commented in template | Optional spawn mode override for task-runner. |

Notes:
- `spawn_mode` defaults to `subprocess` when not set.
- In orchestrated runs, environment variables set by orchestrator may override runner spawn behavior.
- For model/thinking override fields, literal `"inherit"` is accepted and normalized to empty-string inheritance semantics during config load.

### `reviewer`

| Field | Type | Template default | Description |
|---|---|---|---|
| `reviewer.model` | string | `""` | Reviewer model (empty = inherit session model). |
| `reviewer.tools` | string | `"read,write,bash,grep,find,ls"` | Tool allowlist for reviewer agent. |
| `reviewer.thinking` | string | `"off"` | Thinking mode for reviewer. Empty string (or explicit `"inherit"`) = inherit active session thinking. |

### `context`

| Field | Type | Template default | Description |
|---|---|---|---|
| `context.worker_context_window` | number | `0` (auto-detect) | Context window size for worker context pressure tracking. `0` or omitted = auto-detect from pi model registry (`ctx.model.contextWindow`), falling back to 200K if unavailable. Set explicitly to override. |
| `context.warn_percent` | number | `85` | Warn threshold for context utilization. |
| `context.kill_percent` | number | `95` | Hard-stop threshold for context utilization. |
| `context.max_worker_iterations` | number | `20` | Max worker iterations per step before failure. |
| `context.max_review_cycles` | number | `2` | Max revise loops per review stage. |
| `context.no_progress_limit` | number | `3` | Max no-progress iterations before marking failure. |
| `context.max_worker_minutes` | number | commented (`30`) | Optional per-worker wall-clock cap (used in tmux/orchestrated flows). |

### `quality_gate`

Opt-in post-completion quality gate. When enabled, a structured review runs after all steps complete but **before `.DONE` creation**. The review agent produces a JSON verdict (`PASS` or `NEEDS_FIXES`) with severity-classified findings. `.DONE` is only created after a `PASS` verdict.

When disabled (default), `.DONE` is created immediately after all steps complete — no behavioral change from the baseline task-runner.

| Field | Type | Template default | Description |
|---|---|---|---|
| `quality_gate.enabled` | boolean | `false` | Enable quality gate review before `.DONE` creation. |
| `quality_gate.review_model` | string | `""` | Model used for the quality gate review agent. Empty string = inherit from active pi session model. |
| `quality_gate.max_review_cycles` | number | `2` | Maximum total review cycles (initial + after fix) before marking the task failed. |
| `quality_gate.max_fix_cycles` | number | `1` | Maximum fix-agent cycles per quality gate run. |
| `quality_gate.pass_threshold` | `"no_critical"` \| `"no_important"` \| `"all_clear"` | `"no_critical"` | Severity threshold for a PASS decision. |

**Pass threshold behavior:**

| Threshold | PASS when |
|---|---|
| `no_critical` | No critical findings (important and suggestion findings allowed) |
| `no_important` | No critical findings and fewer than 3 important findings (suggestions allowed) |
| `all_clear` | Zero findings of any severity |

> **Note:** At all threshold levels, any finding with `status_mismatch` category triggers `NEEDS_FIXES` regardless of severity.

**Fail-open behavior:** If the review agent crashes, times out, or produces malformed/missing JSON, the verdict is treated as `PASS` so the quality gate never blocks task completion due to infrastructure failures.

Example:

```yaml
quality_gate:
  enabled: true
  review_model: "claude-sonnet-4-20250514"
  max_review_cycles: 2
  max_fix_cycles: 1
  pass_threshold: "no_critical"
```

### `model_fallback`

| Field | Type | Default | Description |
|---|---|---|---|
| `model_fallback` | `"inherit"` \| `"fail"` | `"inherit"` | Model fallback behavior when a configured model becomes unavailable mid-batch. |

**Values:**

| Value | Behavior |
|---|---|
| `"inherit"` | On `model_access_error` exit classification (401/403/429, model not found, API key expired), automatically retry the task once with the session model (no explicit `--model` flag). |
| `"fail"` | No model substitution — the task fails normally and the `on_task_failure` policy applies. |

Model access errors are detected from RPC exit summaries: HTTP 401/403/429 status codes, "model not found"/"model unavailable"/"model deprecated" messages, API key expiration, authentication/authorization failures, rate limits, and quota exhaustion.

The fallback uses a dedicated Tier 0 recovery budget with `maxRetries: 1`. If the session model also fails, the task fails normally.

Example:

```yaml
model_fallback: "fail"   # disable automatic fallback
```

In JSON config (`.pi/taskplane-config.json`), this is `taskRunner.modelFallback`.

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
- Task-runner directly consumes the core execution sections (`project`, `paths`, `testing`, `standards`, `standards_overrides`, `task_areas`, `worker`, `reviewer`, `context`, `quality_gate`).
- Additional sections (`reference_docs`, `never_load`, `self_doc_targets`, `protected_docs`) are primarily used by Taskplane skill/workflow conventions and broader ecosystem tooling.

---

## Unified JSON Config

Task-runner settings can be provided via the unified `.pi/taskplane-config.json` file instead of (or alongside) the YAML file. The JSON format merges settings from both `task-runner.yaml` and `task-orchestrator.yaml` into one file.

### Precedence

The config loader uses the following precedence:

1. **`.pi/taskplane-config.json` exists and is valid** → use it (YAML files are ignored)
2. **`.pi/taskplane-config.json` exists but is malformed** → error (hard failure, not a silent fallback)
3. **`.pi/taskplane-config.json` absent** → fall back to `.pi/task-runner.yaml` + `.pi/task-orchestrator.yaml`
4. **No config files present** → internal defaults

> **Important:** When `taskplane-config.json` is present, YAML files are completely ignored — they are not merged together. This is an either/or precedence, not a layered merge.

### Path resolution

Config files are resolved relative to the project root. In workspace/worktree mode, if the current working directory has no config files, the loader checks `TASKPLANE_WORKSPACE_ROOT` for config files before falling back to defaults.

### Error behavior

| Condition | Behavior |
|---|---|
| Valid JSON with `configVersion: 1` | Config loaded, missing fields filled from defaults |
| Valid JSON without `configVersion` | **Error:** `CONFIG_VERSION_MISSING` — loader throws, task-runner falls back to defaults |
| Malformed JSON (syntax error) | **Error:** `CONFIG_JSON_MALFORMED` — loader throws, task-runner falls back to defaults |
| JSON with unsupported `configVersion` | **Error:** `CONFIG_VERSION_UNSUPPORTED` — "please upgrade Taskplane" |
| YAML present, no JSON | YAML loaded and mapped to unified config shape |
| Malformed YAML | Silent fallback to internal defaults (legacy behavior preserved) |

### Key naming: YAML snake_case → JSON camelCase

The JSON format uses **camelCase** keys. YAML snake_case keys are mapped automatically by the loader.

| YAML key | JSON key |
|---|---|
| `worker_context_window` | `workerContextWindow` |
| `max_worker_iterations` | `maxWorkerIterations` |
| `warn_percent` | `warnPercent` |
| `kill_percent` | `killPercent` |
| `no_progress_limit` | `noProgressLimit` |
| `max_review_cycles` | `maxReviewCycles` |
| `max_worker_minutes` | `maxWorkerMinutes` |
| `spawn_mode` | `spawnMode` |
| `quality_gate` | `qualityGate` |
| `quality_gate.review_model` | `qualityGate.reviewModel` |
| `quality_gate.max_review_cycles` | `qualityGate.maxReviewCycles` |
| `quality_gate.max_fix_cycles` | `qualityGate.maxFixCycles` |
| `quality_gate.pass_threshold` | `qualityGate.passThreshold` |
| `model_fallback` | `modelFallback` |
| `standards_overrides` | `standardsOverrides` |
| `task_areas` | `taskAreas` |
| `reference_docs` | `referenceDocs` |
| `never_load` | `neverLoad` |
| `self_doc_targets` | `selfDocTargets` |
| `protected_docs` | `protectedDocs` |

> **Note:** User-defined dictionary keys (task area names, testing command names, reference doc IDs, etc.) are preserved verbatim in both formats.

### Section mapping

In the JSON file, task-runner settings live under the `taskRunner` key:

| YAML section | JSON path |
|---|---|
| `project` | `taskRunner.project` |
| `paths` | `taskRunner.paths` |
| `testing` | `taskRunner.testing` |
| `standards` | `taskRunner.standards` |
| `standards_overrides` | `taskRunner.standardsOverrides` |
| `worker` | `taskRunner.worker` |
| `reviewer` | `taskRunner.reviewer` |
| `context` | `taskRunner.context` |
| `quality_gate` | `taskRunner.qualityGate` |
| `model_fallback` | `taskRunner.modelFallback` |
| `task_areas` | `taskRunner.taskAreas` |
| `reference_docs` | `taskRunner.referenceDocs` |
| `never_load` | `taskRunner.neverLoad` |
| `self_doc_targets` | `taskRunner.selfDocTargets` |
| `protected_docs` | `taskRunner.protectedDocs` |

### Example JSON

```json
{
  "configVersion": 1,
  "taskRunner": {
    "project": {
      "name": "My Project",
      "description": "A short description of the project"
    },
    "paths": {
      "tasks": "taskplane-tasks",
      "architecture": "docs/architecture.md"
    },
    "testing": {
      "commands": {
        "test": "npm test",
        "build": "npm run build",
        "lint": "npm run lint"
      }
    },
    "standards": {
      "docs": ["README.md", "CONTRIBUTING.md"],
      "rules": ["Write tests for all new code"]
    },
    "worker": {
      "model": "",
      "tools": "read,write,edit,bash,grep,find,ls",
      "thinking": "off"
    },
    "reviewer": {
      "model": "",
      "tools": "read,bash,grep,find,ls",
      "thinking": "on"
    },
    "context": {
      "workerContextWindow": 0,
      "warnPercent": 85,
      "killPercent": 95,
      "maxWorkerIterations": 20,
      "maxReviewCycles": 2,
      "noProgressLimit": 3
    },
    "qualityGate": {
      "enabled": false,
      "reviewModel": "",
      "maxReviewCycles": 2,
      "maxFixCycles": 1,
      "passThreshold": "no_critical"
    },
    "modelFallback": "inherit",
    "taskAreas": {
      "core": {
        "path": "taskplane-tasks",
        "prefix": "CORE",
        "context": "taskplane-tasks/CONTEXT.md"
      }
    },
    "qualityGate": {
      "enabled": false,
      "reviewModel": "",
      "maxReviewCycles": 2,
      "maxFixCycles": 1,
      "passThreshold": "no_critical"
    },
    "referenceDocs": {},
    "neverLoad": [],
    "selfDocTargets": {},
    "protectedDocs": []
  }
}
```

> The `orchestrator` key is also available at the top level for orchestrator settings — see [Task Orchestrator Config Reference](task-orchestrator.yaml.md#unified-json-config).

---

## Related

- [Task Runner How-To](../../how-to/configure-task-runner.md)
- [Task Orchestrator Config Reference](task-orchestrator.yaml.md)
