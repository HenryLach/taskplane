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

### Merge agent stall or silent failure

During the merge phase, a merge agent can stall silently — the tmux session stays alive but produces no output, and no result file is written. The orchestrator actively monitors merge sessions and will emit health events:

- **⚠️ Warning (10 min):** `Merge agent on lane N may be stalled` — the agent has had no output for 10 minutes. This is a soft warning; the agent may still recover.
- **🔒 Stuck (20 min):** `Merge agent on lane N appears stuck` — no output for 20 minutes. The agent is very likely hung. Consider manual intervention.
- **💀 Dead:** `Merge agent on lane N session died` — the tmux session exited without writing a result. The existing timeout/retry mechanism will handle this automatically.

**If you see a stuck warning:**

1. Inspect the merge session directly:
   ```bash
   tmux attach-session -t <session-name>
   ```
2. Check recent output:
   ```bash
   tmux capture-pane -t <session-name> -p -S -20
   ```
3. If truly stuck, kill the session to trigger a retry:
   ```bash
   tmux kill-session -t <session-name>
   ```
   The orchestrator will detect the dead session and handle retry/failure per the `on_merge_failure` policy.

**Prevention tips:**
- Keep merge timeout reasonable: `merge.timeoutMinutes` (default 90, can reduce for faster detection)
- Monitor the supervisor output for health events during merge phases
- Health events appear in `.pi/supervisor/events.jsonl` for programmatic consumption

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
2. Automatically retry the task with the session model (when `taskRunner.modelFallback: "inherit"`, which is the default)
3. Log the fallback: `🔄 Tier 0: Retrying task TP-XXX (model_access_error, attempt 1/1)`

**If you want to disable automatic fallback** (fail immediately instead):

```json
{
  "taskRunner": {
    "modelFallback": "fail"
  }
}
```

**If the session model also fails**, the task fails normally under the `on_task_failure` policy.

## Merge agent stalls

### Symptoms

- Batch stuck in `merging` phase for an extended period
- Supervisor reports: `⚠️ Merge agent on lane N may be stalled`
- Supervisor reports: `🔒 Merge agent on lane N appears stuck`
- Supervisor reports: `💀 Merge agent on lane N session died`

### What the merge health monitor does

Since TP-056, the orchestrator actively monitors merge agent sessions during the merge phase:

| Status | Meaning | Detection |
|--------|---------|-----------|
| **Healthy** | Session alive, output changing | Normal operation |
| **Warning** | Session alive, no output for 10 min | Supervisor notification |
| **Stuck** | Session alive, no output for 20 min | Supervisor notification with kill suggestion |
| **Dead** | Session gone, no result file | Immediate detection, early exit |

The monitor runs on a 2-minute polling interval and emits events to the supervisor. It does **not** kill sessions autonomously — the operator decides.

### Manual recovery

1. **Check the session directly:**
   ```bash
   tmux attach -t <session-name>
   ```

2. **Kill a stuck merge session:**
   ```bash
   tmux kill-session -t <session-name>
   ```
   The engine will detect the dead session and handle the failure via the `on_merge_failure` policy.

3. **If the batch paused after a merge failure:**
   ```text
   /orch-resume
   ```

4. **If the merge worktree is corrupted:**
   ```bash
   git worktree list           # find the merge worktree
   git worktree remove --force <path>
   git worktree prune
   ```
   Then resume or restart the batch.

### Adjusting timeouts

Increase the merge timeout in `.pi/taskplane-config.json`:

```json
{
  "orchestrator": {
    "merge": {
      "timeoutMinutes": 30
    }
  }
}
```

The timeout can be changed while a batch is running — the engine re-reads it before each retry attempt.

---

## If still blocked

Collect:

- `taskplane doctor` output
- failing command + exact error
- relevant config snippets (`.pi/*.yaml`)

Then open an issue:

- https://github.com/HenryLach/taskplane/issues
