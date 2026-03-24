# Troubleshoot Common Issues

Use this guide for common setup and runtime problems.

## First step for most issues

Run:

```bash
taskplane doctor
```

It checks prerequisites, config files, and task area paths.

---

## Setup issues

### `taskplane: command not found`

Use one of:

```bash
npx taskplane <command>
.pi/npm/node_modules/.bin/taskplane <command>
```

Or install globally:

```bash
pi install npm:taskplane
```

### `/task` or `/orch` unknown in pi

Ensure Taskplane is installed via pi package system:

```bash
pi install npm:taskplane
# or project-local
pi install -l npm:taskplane
```

### Missing `.pi/task-runner.yaml` / `.pi/task-orchestrator.yaml`

Initialize project:

```bash
taskplane init
```

---

## Orchestration issues

### No tasks discovered

Check:

- `task_areas` paths exist
- task folders are under area path
- `PROMPT.md` exists and has parseable ID heading
- `.DONE` tasks are intentionally skipped

Useful commands:

```text
/orch-plan all
/orch-deps all
```

### Dependency errors (`DEP_UNRESOLVED`, etc.)

Fix bad dependency references in `PROMPT.md`:

- use canonical IDs like `AUTH-003`
- use area-qualified IDs when ambiguous (`auth/AUTH-003`)

### Batch paused on merge failure

Resolve merge issue, then:

```text
/orch-resume
```

### Resume fails / stale state

Try:

```text
/orch-abort
/orch-plan all
/orch all
```

As fallback remove stale `.pi/batch-state.json` and restart.

### Stalled workers

Adjust in `.pi/task-orchestrator.yaml`:

- `failure.stall_timeout`
- `failure.max_worker_minutes`

Then rerun.

---

## Worktree/tmux issues

### Worktree cleanup failures

Lingering sessions can lock directories (especially on Windows).

Try:

```text
/orch-abort
```

Then manually inspect:

```bash
git worktree list
tmux list-sessions
```

### Orphan tmux sessions

Use:

```text
/orch-sessions
/orch-abort
```

Manual cleanup if needed:

```bash
tmux kill-session -t <session-name>
```

---

## Version compatibility issues

### pi/runtime mismatch symptoms

- commands not loading
- extension startup errors

Check versions:

```bash
taskplane version
pi --version
node --version
```

Taskplane requires Node 22+ and compatible pi runtime.

---

## Model becomes unavailable mid-batch

If a configured worker/reviewer model becomes unavailable (API key expired, rate limit, model deprecated), the orchestrator will:

1. Classify the exit as `model_access_error`
2. Automatically retry the task with the session model (when `failure.model_fallback: "inherit"`, which is the default)
3. Log the fallback: `🔄 Model fallback: Retrying task TP-XXX with session model`

**If you want to disable automatic fallback** (fail immediately instead):

```json
{
  "orchestrator": {
    "failure": {
      "modelFallback": "fail"
    }
  }
}
```

**If the session model also fails**, the task fails normally under the `on_task_failure` policy.

## If still blocked

Collect:

- `taskplane doctor` output
- failing command + exact error
- relevant config snippets (`.pi/*.yaml`)

Then open an issue:

- https://github.com/HenryLach/taskplane/issues
