# `task-orchestrator.yaml` Reference

Path: `.pi/task-orchestrator.yaml`

This file configures parallel orchestration behavior for `/orch*` commands.

> Template source: `templates/config/task-orchestrator.yaml`

> **JSON alternative:** These settings can also be configured via `.pi/taskplane-config.json`, which merges task-runner and orchestrator settings into a single file. See [Unified JSON Config](#unified-json-config) below for details and precedence rules.

---

## Schema overview

```yaml
orchestrator:
dependencies:
assignment:
pre_warm:
merge:
failure:
monitoring:
```

---

## Field reference

### `orchestrator`

| Field | Type | Template default | Description |
|---|---|---|---|
| `orchestrator.max_lanes` | number | `3` | Maximum parallel execution lanes/worktrees. |
| `orchestrator.worktree_location` | `"sibling"` \| `"subdirectory"` | `"subdirectory"` | Where lane worktree directories are created. |
| `orchestrator.worktree_prefix` | string | `"taskplane-wt"` | Prefix used for worktree directory names and lane branch naming. |
| `orchestrator.batch_id_format` | `"timestamp"` \| `"sequential"` | `"timestamp"` | Batch ID format used in logs/branch naming. |
| `orchestrator.spawn_mode` | `"tmux"` \| `"subprocess"` | `"subprocess"` | How lane sessions are spawned. |
| `orchestrator.tmux_prefix` | string | `"orch"` | Prefix for orchestrator tmux sessions (tmux mode). |
| `orchestrator.operator_id` | string | `""` (auto-detected) | Operator identifier for team-scale collision resistance. See [naming](#operator-identity-and-naming). |

`worktree_location` values:

- `subdirectory`: `.worktrees/<prefix>-N`
- `sibling`: `../<prefix>-N`

### `dependencies`

| Field | Type | Template default | Description |
|---|---|---|---|
| `dependencies.source` | `"prompt"` \| `"agent"` | `"prompt"` | Dependency extraction source. |
| `dependencies.cache` | boolean | `true` | Cache dependency analysis results between runs. |

### `assignment`

| Field | Type | Template default | Description |
|---|---|---|---|
| `assignment.strategy` | `"affinity-first"` \| `"round-robin"` \| `"load-balanced"` | `"affinity-first"` | Lane assignment strategy. |
| `assignment.size_weights` | map<string,number> | `S:1`, `M:2`, `L:4` | Relative weights used by size-aware assignment logic. |

### `pre_warm`

| Field | Type | Template default | Description |
|---|---|---|---|
| `pre_warm.auto_detect` | boolean | `false` | Enable automatic pre-warm command detection. |
| `pre_warm.commands` | map<string,string> | `{}` | Named pre-warm commands. |
| `pre_warm.always` | string[] | `[]` | Commands always run before wave execution. |

### `merge`

| Field | Type | Template default | Description |
|---|---|---|---|
| `merge.model` | string | `""` | Merge-agent model (empty = inherit active session model). |
| `merge.tools` | string | `"read,write,edit,bash,grep,find,ls"` | Merge-agent tool allowlist. |
| `merge.verify` | string[] | `[]` | Verification commands run after merge operations. |
| `merge.order` | `"fewest-files-first"` \| `"sequential"` | `"fewest-files-first"` | Lane merge ordering policy. |

### `failure`

| Field | Type | Template default | Description |
|---|---|---|---|
| `failure.on_task_failure` | `"skip-dependents"` \| `"stop-wave"` \| `"stop-all"` | `"skip-dependents"` | Batch behavior when a task fails. |
| `failure.on_merge_failure` | `"pause"` \| `"abort"` | `"pause"` | Behavior when a merge step fails. |
| `failure.stall_timeout` | number | `30` | Stall detection threshold (minutes-equivalent logic in monitor cycle). |
| `failure.max_worker_minutes` | number | `30` | Max worker runtime budget per task in orchestrated mode. |
| `failure.abort_grace_period` | number | `60` | Graceful abort wait time (seconds) before forced termination. |

### `monitoring`

| Field | Type | Template default | Description |
|---|---|---|---|
| `monitoring.poll_interval` | number | `5` | Poll interval (seconds) for lane/task monitoring loop. |

---

## Runtime behavior notes

- The orchestrator loads this file and merges missing fields with internal defaults.
- Missing or malformed file falls back to safe defaults.
- Orchestrator also reads `.pi/task-runner.yaml` for `task_areas` and shared metadata.

---

## Operator identity and naming

The `operator_id` field controls how lane sessions, worktree directories, git branches, and merge artifacts are named. This enables **collision-resistant naming** when multiple operators run orchestrator batches concurrently on the same machine or repo.

### Resolution order

The operator identifier (`opId`) is resolved from the first non-empty source:

1. `TASKPLANE_OPERATOR_ID` environment variable
2. `orchestrator.operator_id` config field
3. Current OS username (auto-detected via `os.userInfo().username`)
4. Fallback: `"op"`

The resolved value is sanitized (lowercase, alphanumeric + hyphens only) and truncated to 12 characters.

### Naming patterns

| Artifact | Pattern | Example |
|---|---|---|
| TMUX session (repo mode) | `{tmux_prefix}-{opId}-lane-{N}` | `orch-alice-lane-1` |
| TMUX session (workspace) | `{tmux_prefix}-{opId}-{repoId}-lane-{N}` | `orch-alice-api-lane-1` |
| Merge session | `{tmux_prefix}-{opId}-merge-{N}` | `orch-alice-merge-1` |
| Worktree directory | `{worktree_prefix}-{opId}-{N}` | `taskplane-wt-alice-1` |
| Git branch | `task/{opId}-lane-{N}-{batchId}` | `task/alice-lane-1-20260315T190000` |
| Merge temp branch | `_merge-temp-{opId}-{batchId}` | `_merge-temp-alice-20260315T190000` |
| Merge sidecar | `merge-result-w{W}-lane{L}-{opId}-{batchId}.json` | `merge-result-w1-lane1-alice-20260315T190000.json` |

### Recommendations

- **CI environments:** Set `TASKPLANE_OPERATOR_ID` explicitly (e.g., `ci-runner-1`) to avoid OS username variability.
- **Team usage:** Ensure operator identifiers are unique within the first 12 characters after sanitization. Names like `ci-runner-team-alpha` and `ci-runner-team-beta` both truncate to `ci-runner-te` — use shorter, distinct prefixes instead.
- **Sanitization note:** Dots and underscores are collapsed to hyphens, so `john.doe` and `john-doe` resolve to the same `opId`.

---

## Unified JSON Config

Orchestrator settings can be provided via the unified `.pi/taskplane-config.json` file instead of (or alongside) the YAML file. The JSON format merges settings from both `task-orchestrator.yaml` and `task-runner.yaml` into one file.

### Precedence

The config loader uses the following precedence:

1. **`.pi/taskplane-config.json` exists and is valid** → use it (YAML files are ignored)
2. **`.pi/taskplane-config.json` exists but is malformed** → error (hard failure, not a silent fallback)
3. **`.pi/taskplane-config.json` absent** → fall back to `.pi/task-orchestrator.yaml` + `.pi/task-runner.yaml`
4. **No config files present** → internal defaults

> **Important:** When `taskplane-config.json` is present, YAML files are completely ignored — they are not merged together. This is an either/or precedence, not a layered merge.

### Path resolution

Config files are resolved relative to the project root. In workspace/worktree mode, if the current working directory has no config files, the loader checks `TASKPLANE_WORKSPACE_ROOT` for config files before falling back to defaults.

### Error behavior

| Condition | Behavior |
|---|---|
| Valid JSON with `configVersion: 1` | Config loaded, missing fields filled from defaults |
| Valid JSON without `configVersion` | **Error:** `CONFIG_VERSION_MISSING` — loader throws |
| Malformed JSON (syntax error) | **Error:** `CONFIG_JSON_MALFORMED` — loader throws |
| JSON with unsupported `configVersion` | **Error:** `CONFIG_VERSION_UNSUPPORTED` — "please upgrade Taskplane" |
| YAML present, no JSON | YAML loaded and mapped to unified config shape |
| Malformed YAML | Silent fallback to internal defaults (legacy behavior preserved) |

### Key naming: YAML snake_case → JSON camelCase

The JSON format uses **camelCase** keys. YAML snake_case keys are mapped automatically by the loader.

| YAML key | JSON key |
|---|---|
| `max_lanes` | `maxLanes` |
| `worktree_location` | `worktreeLocation` |
| `worktree_prefix` | `worktreePrefix` |
| `batch_id_format` | `batchIdFormat` |
| `spawn_mode` | `spawnMode` |
| `tmux_prefix` | `tmuxPrefix` |
| `operator_id` | `operatorId` |
| `size_weights` | `sizeWeights` |
| `auto_detect` | `autoDetect` |
| `pre_warm` | `preWarm` |
| `on_task_failure` | `onTaskFailure` |
| `on_merge_failure` | `onMergeFailure` |
| `stall_timeout` | `stallTimeout` |
| `max_worker_minutes` | `maxWorkerMinutes` |
| `abort_grace_period` | `abortGracePeriod` |
| `poll_interval` | `pollInterval` |

> **Note:** User-defined dictionary keys (size weight labels like `S`/`M`/`L`, pre-warm command names, etc.) are preserved verbatim in both formats.

### Section mapping

In the JSON file, orchestrator settings live under the `orchestrator` key:

| YAML section | JSON path |
|---|---|
| `orchestrator` | `orchestrator.orchestrator` |
| `dependencies` | `orchestrator.dependencies` |
| `assignment` | `orchestrator.assignment` |
| `pre_warm` | `orchestrator.preWarm` |
| `merge` | `orchestrator.merge` |
| `failure` | `orchestrator.failure` |
| `monitoring` | `orchestrator.monitoring` |

### Example JSON

```json
{
  "configVersion": 1,
  "orchestrator": {
    "orchestrator": {
      "maxLanes": 3,
      "worktreeLocation": "subdirectory",
      "worktreePrefix": "taskplane-wt",
      "batchIdFormat": "timestamp",
      "spawnMode": "subprocess",
      "tmuxPrefix": "orch",
      "operatorId": ""
    },
    "dependencies": {
      "source": "prompt",
      "cache": true
    },
    "assignment": {
      "strategy": "affinity-first",
      "sizeWeights": { "S": 1, "M": 2, "L": 4 }
    },
    "preWarm": {
      "autoDetect": false,
      "commands": {},
      "always": []
    },
    "merge": {
      "model": "",
      "tools": "read,write,edit,bash,grep,find,ls",
      "verify": [],
      "order": "fewest-files-first"
    },
    "failure": {
      "onTaskFailure": "skip-dependents",
      "onMergeFailure": "pause",
      "stallTimeout": 30,
      "maxWorkerMinutes": 30,
      "abortGracePeriod": 60
    },
    "monitoring": {
      "pollInterval": 5
    }
  }
}
```

> The `taskRunner` key is also available at the top level for task-runner settings — see [Task Runner Config Reference](task-runner.yaml.md#unified-json-config).

---

## Related

- [Task Orchestrator How-To](../../how-to/configure-task-orchestrator.md)
- [Task Runner Config Reference](task-runner.yaml.md)
