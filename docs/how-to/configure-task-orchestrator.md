# Configure Orchestrator Settings

This guide explains how to tune parallel execution, worktrees, merge behavior, and failure handling for `/orch` commands.

## Where settings live

- **Primary:** `.pi/taskplane-config.json` — under the `orchestrator` key
- **Interactive:** Run `/taskplane-settings` to view and edit settings in a TUI
- **Legacy fallback:** `.pi/task-orchestrator.yaml` (still loaded if present, but JSON takes precedence)

If neither file exists, run:

```bash
taskplane init
```

---

## Full section guide

### `orchestrator.orchestrator`

```json
{
  "orchestrator": {
    "orchestrator": {
      "maxLanes": 3,
      "worktreeLocation": "subdirectory",
      "worktreePrefix": "taskplane-wt",
      "batchIdFormat": "timestamp",
      "spawnMode": "subprocess"
    }
  }
}
```

- `maxLanes` — max parallel lanes.
- `worktreeLocation`:
  - `"subdirectory"` → `.worktrees/<prefix>-<N>`
  - `"sibling"` → `../<prefix>-<N>`
- `spawnMode` — `"subprocess"` (headless execution).

### `orchestrator.dependencies`

```json
{
  "orchestrator": {
    "dependencies": {
      "source": "prompt",
      "cache": true
    }
  }
}
```

- `source: "prompt"` — parses `## Dependencies` from `PROMPT.md`.
- `cache: true` — speeds repeated planning and discovery.

### `orchestrator.assignment`

```json
{
  "orchestrator": {
    "assignment": {
      "strategy": "affinity-first",
      "sizeWeights": {
        "S": 1,
        "M": 2,
        "L": 4
      }
    }
  }
}
```

Controls lane balancing:

- `"affinity-first"` — prefers keeping related work grouped
- `"round-robin"` — simple rotation
- `"load-balanced"` — weight-based balancing via `sizeWeights`

### `orchestrator.preWarm`

```json
{
  "orchestrator": {
    "preWarm": {
      "autoDetect": false,
      "commands": {},
      "always": []
    }
  }
}
```

Optional pre-run commands (disabled by default).

### `orchestrator.merge`

```json
{
  "orchestrator": {
    "merge": {
      "model": "",
      "tools": "read,write,edit,bash,grep,find,ls",
      "verify": [],
      "order": "fewest-files-first"
    }
  }
}
```

- `model` — merger model (empty = inherit from session).
- `verify` — commands run after each merge (add only safe, deterministic checks).
- `order` — lane merge order policy.

### `orchestrator.failure`

```json
{
  "orchestrator": {
    "failure": {
      "onTaskFailure": "skip-dependents",
      "onMergeFailure": "pause",
      "stallTimeout": 30,
      "maxWorkerMinutes": 30,
      "abortGracePeriod": 60
    }
  }
}
```

- `onTaskFailure`:
  - `"skip-dependents"` (default)
  - `"stop-wave"`
  - `"stop-all"`
- `onMergeFailure`:
  - `"pause"` (recommended)
  - `"abort"`
- `stallTimeout` — minutes before a task is considered stalled.
- `maxWorkerMinutes` — task-runner timeout budget in orchestrated runs.
- `abortGracePeriod` — graceful abort wait (seconds) before force kill.

### `orchestrator.monitoring`

```json
{
  "orchestrator": {
    "monitoring": {
      "pollInterval": 5
    }
  }
}
```

Polling interval (seconds) for the orchestrator monitoring loop.

---

## Recommended starter profile

```json
{
  "orchestrator": {
    "orchestrator": {
      "maxLanes": 3,
      "spawnMode": "subprocess"
    },
    "failure": {
      "onTaskFailure": "skip-dependents",
      "onMergeFailure": "pause",
      "stallTimeout": 30
    },
    "monitoring": {
      "pollInterval": 5
    }
  }
}
```

Start conservative, then increase parallelism after stable runs.

---

## Tuning tips

- Increase `maxLanes` only if your tests/CI and machine can handle it.
- Keep `onMergeFailure: "pause"` so humans can resolve conflicts and `/orch-resume`.
- Keep `verify` short and deterministic to avoid slow merge bottlenecks.

---

## Validate configuration

```bash
taskplane doctor
```

Inside pi:

```
/orch-plan all
/orch all
```

---

## Related guides

- [Run Your First Orchestration](../tutorials/run-your-first-orchestration.md)
- [Pause, Resume, or Abort a Batch](pause-resume-abort-a-batch.md)
- [Recover After Interruption](recover-after-interruption.md)
- [`/taskplane-settings` Reference](../reference/configuration/taskplane-settings.md)
