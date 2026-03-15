# `task-orchestrator.yaml` Reference

Path: `.pi/task-orchestrator.yaml`

This file configures parallel orchestration behavior for `/orch*` commands.

> Template source: `templates/config/task-orchestrator.yaml`

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

## Related

- [Task Orchestrator How-To](../../how-to/configure-task-orchestrator.md)
- [Task Runner Config Reference](task-runner.yaml.md)
