# Commands Reference

This page documents Taskplane command surfaces:

1. pi session slash commands (`/task`, `/orch*`)
2. CLI shell commands (`taskplane ...`)

> Slash commands are registered by Taskplane extensions when loaded in pi.

---

## Task Runner Commands

### `/task <path/to/PROMPT.md>`

Start autonomous execution of a single task.

**Syntax**

```text
/task <path/to/PROMPT.md>
```

**Behavior**

- Resolves path from current working directory
- Parses `PROMPT.md`
- Loads existing `STATUS.md` (or generates one if missing)
- Creates `.reviews/` if needed
- Starts worker/reviewer loop

**Examples**

```text
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
/task taskplane-tasks/auth/AUTH-014-rbac/PROMPT.md
```

**Common responses**

- `Usage: /task <path/to/PROMPT.md>` if missing arg
- `File not found: ...` if path is invalid
- Warning if another task is already running

---

### `/task-status`

Show current in-memory + STATUS.md task progress.

**Syntax**

```text
/task-status
```

**Behavior**

- Prints task ID/name, phase, iteration count, review count
- Prints per-step checkbox totals
- Re-reads `STATUS.md` and refreshes runner widget state

**Common responses**

- `No task loaded. Use /task <path/to/PROMPT.md>`
- `STATUS.md not found`

---

### `/task-pause`

Pause task execution after current worker iteration completes.

**Syntax**

```text
/task-pause
```

**Behavior**

- Sets runner phase to paused
- Does not force-kill worker mid-iteration

**Common responses**

- `No task is running`

---

### `/task-resume`

Resume a paused task.

**Syntax**

```text
/task-resume
```

**Behavior**

- Requires a paused task to be loaded in memory
- Restarts execution loop from current STATUS state

**Common responses**

- `Task is not paused`
- `No task loaded`

---

## Orchestrator Commands

### `/orch <areas|paths|all>`

Start parallel batch execution.

**Syntax**

```text
/orch <areas|paths|all>
```

**Arguments**

- `all` — scan all configured task areas
- one or more area names (e.g. `auth billing`)
- one or more filesystem paths (area dir or specific task prompt path)

**Behavior**

- Runs orphan-session/state detection before starting
- Discovers tasks and dependencies
- Computes waves and lane assignments
- Executes tasks in isolated worktrees
- Merges successful lane branches

**Examples**

```text
/orch all
/orch auth billing
/orch taskplane-tasks/auth/tasks
/orch taskplane-tasks/auth/tasks/AUTH-001-login/PROMPT.md
```

---

### `/orch-plan <areas|paths|all> [--refresh]`

Preview execution plan without running tasks.

**Syntax**

```text
/orch-plan <areas|paths|all> [--refresh]
```

**Options**

- `--refresh` — bypass dependency cache and force re-scan

**Output includes**

- preflight checks
- discovery results
- dependency graph
- wave plan and lane assignment estimate

**Examples**

```text
/orch-plan all
/orch-plan auth billing
/orch-plan all --refresh
```

---

### `/orch-status`

Show current batch progress summary.

**Syntax**

```text
/orch-status
```

**Output includes**

- batch ID and phase
- current wave index / total waves
- succeeded, failed, skipped, blocked, total task counts
- elapsed time
- error count (if any)

---

### `/orch-pause`

Pause batch after current tasks finish.

**Syntax**

```text
/orch-pause
```

**Behavior**

- Sets orchestrator pause signal
- Lane polling sees signal and stops scheduling further work

**Common responses**

- No active batch
- Batch already paused

---

### `/orch-resume`

Resume a paused or interrupted batch from persisted state.

**Syntax**

```text
/orch-resume
```

**Behavior**

- Loads `.pi/batch-state.json`
- Validates resumable phase
- Reconciles `.DONE` markers and live sessions
- Reconnects/re-executes tasks as needed
- Continues from first incomplete wave

**Common responses**

- No batch state to resume
- State invalid or non-resumable phase
- Cannot resume while a batch is actively running

---

### `/orch-abort [--hard]`

Abort current batch.

**Syntax**

```text
/orch-abort [--hard]
```

**Modes**

- default (graceful): cooperative stop + cleanup
- `--hard`: immediate session termination

**Behavior**

- Writes abort signal file: `.pi/orch-abort-signal`
- Attempts to terminate matching tmux sessions
- Cleans in-memory/persisted batch state
- Preserves worktrees/branches for inspection

---

### `/orch-deps <areas|paths|all> [--refresh] [--task <ID>]`

Show dependency graph.

**Syntax**

```text
/orch-deps <areas|paths|all> [--refresh] [--task <ID>]
```

**Options**

- `--refresh` — bypass dependency cache
- `--task <ID>` — filter to one task (e.g. `--task AUTH-014`)

**Examples**

```text
/orch-deps all
/orch-deps auth --refresh
/orch-deps all --task AUTH-014
```

---

### `/orch-sessions`

List active orchestrator tmux sessions.

**Syntax**

```text
/orch-sessions
```

**Behavior**

- Lists sessions matching configured orchestrator tmux prefix
- Useful for debugging/resume/cleanup in tmux mode

---

## CLI Commands

These are shell commands (not pi slash commands).

### `taskplane init [options]`

Scaffold Taskplane project files (`.pi/`, agents, task templates).

### `taskplane doctor`

Validate installation and project configuration.

### `taskplane version`

Show package and environment version details.

### `taskplane dashboard [--port <n>] [--no-open]`

Launch the web dashboard server.

### `taskplane uninstall [options]`

Uninstall Taskplane project artifacts and optionally the installed package.

Common options:

- `--dry-run` — preview what would be removed
- `--yes` — skip confirmations
- `--package` — also run `pi remove` for this scope
- `--package-only` — remove package only, skip project cleanup
- `--local` / `--global` — force package uninstall scope
- `--remove-tasks` — also remove task area directories from `.pi/task-runner.yaml`
- `--all` — equivalent to `--package --remove-tasks`

Notes:

- Package removal deletes Taskplane extensions, skills, and dashboard package files.
- Project cleanup preserves task directories by default unless `--remove-tasks` is passed.

---

## Related

- [Task Runner Config Reference](configuration/task-runner.yaml.md)
- [Task Orchestrator Config Reference](configuration/task-orchestrator.yaml.md)
- [Task Format Reference](task-format.md)
