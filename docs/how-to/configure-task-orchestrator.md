# Configure Task Orchestrator (`.pi/task-orchestrator.yaml`)

This guide explains how to tune parallel execution, worktrees, merge behavior, and failure handling for `/orch` commands.

## Where this file lives

- Path: `.pi/task-orchestrator.yaml`
- Used by: `/orch`, `/orch-plan`, `/orch-status`, `/orch-resume`, `/orch-abort`

If the file is missing, run:

```bash
taskplane init
```

---

## Full section guide

### `orchestrator`

```yaml
orchestrator:
  max_lanes: 3
  worktree_location: "subdirectory"
  worktree_prefix: "taskplane-wt"
  batch_id_format: "timestamp"
  spawn_mode: "subprocess"
  tmux_prefix: "orch"
```

- `max_lanes`: max parallel lanes
- `worktree_location`:
  - `subdirectory` → `.worktrees/<prefix>-N`
  - `sibling` → `../<prefix>-N`
- `spawn_mode`:
  - `subprocess`: headless, no tmux dependency
  - `tmux`: attachable sessions for deep visibility
- `tmux_prefix`: session naming prefix in tmux mode

### `dependencies`

```yaml
dependencies:
  source: "prompt"
  cache: true
```

- `source: prompt` parses `## Dependencies` from `PROMPT.md`
- `cache: true` speeds repeated planning/discovery

### `assignment`

```yaml
assignment:
  strategy: "affinity-first"
  size_weights:
    S: 1
    M: 2
    L: 4
```

Controls lane balancing.

- `affinity-first`: prefers keeping related work grouped
- `round-robin`: simple rotation
- `load-balanced`: weight-based balancing via `size_weights`

### `pre_warm`

```yaml
pre_warm:
  auto_detect: false
  commands: {}
  always: []
```

Optional pre-run commands (disabled by default).

### `merge`

```yaml
merge:
  model: ""
  tools: "read,write,edit,bash,grep,find,ls"
  verify: []
  order: "fewest-files-first"
```

- `model`: merger model (empty = inherit from session)
- `verify`: commands run after each merge (add only safe, deterministic checks)
- `order`: lane merge order policy

### `failure`

```yaml
failure:
  on_task_failure: "skip-dependents"
  on_merge_failure: "pause"
  stall_timeout: 30
  max_worker_minutes: 30
  abort_grace_period: 60
```

- `on_task_failure`:
  - `skip-dependents` (default)
  - `stop-wave`
  - `stop-all`
- `on_merge_failure`:
  - `pause` (recommended)
  - `abort`
- `stall_timeout`: minutes before task considered stalled
- `max_worker_minutes`: task-runner timeout budget in orchestrated runs
- `abort_grace_period`: graceful abort wait before force kill

### `monitoring`

```yaml
monitoring:
  poll_interval: 5
```

Polling interval (seconds) for orchestrator monitoring loop.

---

## Recommended starter profile

```yaml
orchestrator:
  max_lanes: 3
  spawn_mode: "subprocess"

failure:
  on_task_failure: "skip-dependents"
  on_merge_failure: "pause"
  stall_timeout: 30

monitoring:
  poll_interval: 5
```

Start conservative, then increase parallelism after stable runs.

---

## Tuning tips

- Increase `max_lanes` only if your tests/CI and machine can handle it.
- Keep `on_merge_failure: pause` so humans can resolve conflicts and `/orch-resume`.
- Use `tmux` mode when debugging orchestration behavior.
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
