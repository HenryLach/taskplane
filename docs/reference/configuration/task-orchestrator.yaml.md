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
verification:
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

#### Merge retry policy matrix

When a merge fails, the orchestrator classifies the failure and consults a built-in retry policy matrix before applying the `on_merge_failure` policy. Retriable failures are automatically retried up to the class-specific limit; non-retriable failures immediately trigger pause or abort per policy.

| Classification | Retriable | Max attempts | Cooldown | Exhaustion action |
|---|---|---|---|---|
| `verification_new_failure` | ✅ | 1 | 0 ms | `pause` — diagnostic emitted |
| `merge_conflict_unresolved` | ❌ | 0 | — | `on_merge_failure` policy — operator escalation |
| `cleanup_post_merge_failed` | ✅ | 1 | 2 000 ms | `pause` + wave gate (blocks next wave) |
| `git_worktree_dirty` | ✅ | 1 | 2 000 ms | `pause` |
| `git_lock_file` | ✅ | 2 | 3 000 ms | `pause` |

**Classification descriptions:**

- **`verification_new_failure`** — Post-merge verification detected genuinely new test failures (not present in the pre-merge baseline). The merge commit is rolled back to `baseHEAD` and one retry is allowed immediately.
- **`merge_conflict_unresolved`** — Git merge produced conflicts that the merge agent could not resolve. Not retriable — requires operator intervention.
- **`cleanup_post_merge_failed`** — Post-merge cleanup operations (worktree removal, branch deletion) failed. Retriable, but acts as a **wave gate**: the next wave cannot start until the issue is resolved.
- **`git_worktree_dirty`** — The merge worktree had unexpected uncommitted changes. Retriable after a 2-second cooldown.
- **`git_lock_file`** — A Git lock file (`.git/index.lock` or similar) blocked the operation. Retriable up to 2 times with 3-second cooldowns, as lock files are often transient.

**Retry behavior:**

1. On merge failure, the orchestrator classifies the error and looks up the policy matrix.
2. If the class is retriable and the retry count (persisted in batch state) is below `maxAttempts`, the orchestrator waits for the cooldown period and re-invokes the merge.
3. Retry counters are scoped by `{repoId}:w{N}:l{K}` (e.g., `api:w0:l1`). In single-repo mode, `repoId` defaults to `"default"`. Counters persist in `.pi/batch-state.json` under `resilience.retryCountByScope` and survive `/orch-resume`.
4. On retry exhaustion (all attempts consumed for a retriable class), the orchestrator **forces `paused` phase** regardless of the `on_merge_failure` setting. This ensures operators always have a chance to inspect the failure — even when `on_merge_failure` is set to `"abort"`.
5. Non-retriable classes (`merge_conflict_unresolved`) skip retries entirely and apply the `on_merge_failure` policy immediately (`pause` or `abort` per configuration).

> **Forced pause vs. policy:** Forced pause (overriding `on_merge_failure`) applies **only** in two situations: (1) retry exhaustion for a retriable class, and (2) rollback safe-stop (when a rollback itself fails). Initial non-retriable failures always respect the configured `on_merge_failure` policy.

> **Note:** The retry matrix is not configurable. The values above are built-in defaults derived from the resilience roadmap. Future releases may expose per-class overrides.

**Transaction records:**

Each lane merge attempt (success, failure, or rollback) produces a transaction record persisted at `.pi/verification/{opId}/txn-b{batchId}-repo-{repoId}-wave-{n}-lane-{k}.json`. These records capture `baseHEAD`, `laneHEAD`, `mergedHEAD`, rollback outcome, and recovery commands. If a rollback itself fails (safe-stop), the record includes exact `git` commands for manual recovery, and the merge worktree and temp branch are preserved.

### `monitoring`

| Field | Type | Template default | Description |
|---|---|---|---|
| `monitoring.poll_interval` | number | `5` | Poll interval (seconds) for lane/task monitoring loop. |

### `verification`

| Field | Type | Template default | Description |
|---|---|---|---|
| `verification.enabled` | boolean | `false` | Enable verification baseline fingerprinting. When false, no baseline capture or comparison occurs regardless of testing commands. |
| `verification.mode` | `"strict"` \| `"permissive"` | `"permissive"` | Behavior when baseline is unavailable (capture failure or no commands configured). |
| `verification.flaky_reruns` | number | `1` | Number of re-runs for failed commands when new failures are detected. Set to `0` to disable flaky detection. |

`verification.mode` values:

- `strict`: Baseline unavailable (capture failure or no `taskRunner.testing.commands` configured) triggers a merge failure. The `failure.on_merge_failure` policy then determines whether the batch pauses or aborts.
- `permissive`: Baseline unavailable logs a warning and continues without orchestrator-side verification. Merge-agent verification (`merge.verify`) still applies independently.

**How it works:**

Verification baseline fingerprinting runs orchestrator-side (in the merge flow), separate from merge-agent verification (`merge.verify`). When enabled:

1. **Baseline capture:** Before merging lanes, test commands from `taskRunner.testing.commands` are run on the pre-merge state to capture a baseline of existing failures.
2. **Post-merge capture:** After each successful lane merge, the same commands run again to capture post-merge state.
3. **Diff:** Only genuinely *new* failures (present post-merge but absent from the baseline) block the merge. Pre-existing failures pass through.
4. **Flaky handling:** When new failures are detected, only the failed commands are re-run up to `flaky_reruns` times. If failures clear on re-run, the lane is classified as `flaky_suspected` (warning only, does not block). If failures persist, the lane is blocked as `verification_new_failure`.

**Requirements:**

- `verification.enabled` must be `true` (feature flag, opt-in)
- `taskRunner.testing.commands` must have at least one command configured (these are the commands that get fingerprinted)
- Both conditions must be met for baseline capture to occur

> **Note:** `merge.verify` (agent-side verification) and `verification` (orchestrator-side baseline fingerprinting) are independent features. `merge.verify` commands are run by the merge agent and trigger agent-side revert logic. `verification` commands are run by the orchestrator and gate merge advancement based on fingerprint comparison. You can use either, both, or neither.

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
| TMUX session (single-repo mode) | `{tmux_prefix}-{opId}-lane-{N}` | `orch-alice-lane-1` |
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
| `flaky_reruns` | `flakyReruns` |

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
| `verification` | `orchestrator.verification` |

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
    },
    "verification": {
      "enabled": false,
      "mode": "permissive",
      "flakyReruns": 1
    }
  }
}
```

> The `taskRunner` key is also available at the top level for task-runner settings — see [Task Runner Config Reference](task-runner.yaml.md#unified-json-config).

---

## Related

- [Task Orchestrator How-To](../../how-to/configure-task-orchestrator.md)
- [Task Runner Config Reference](task-runner.yaml.md)
