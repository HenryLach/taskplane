# Pause, Resume, or Abort a Batch

Use these commands to control active orchestration safely.

## Command summary

| Command | Purpose |
|---|---|
| `/orch-pause` | Pause after in-flight tasks reach a safe stop point |
| `/orch-resume` | Resume paused/interrupted batch from persisted state |
| `/orch-abort` | Graceful abort (checkpoint-aware, then cleanup) |
| `/orch-abort --hard` | Immediate abort (kill sessions now) |

---

## Pause a batch

Run inside pi:

```
/orch-pause
```

Behavior:

- Sets orchestrator pause signal
- Active lanes stop after current task boundary (not mid-edit)
- Batch phase becomes paused
- You can later continue with `/orch-resume`

Use pause when you need to inspect state or temporarily stop execution without discarding progress.

---

## Resume a paused/interrupted batch

```
/orch-resume
```

Resume flow:

1. Load `.pi/batch-state.json`
2. Validate phase eligibility (`paused`, `executing`, `merging`)
3. Reconcile live sessions + `.DONE` markers
4. Reconnect to alive tasks when possible
5. Re-execute interrupted tasks when needed
6. Continue at first incomplete wave

If no resumable state exists, you'll get a clear message and can start fresh with `/orch all`.

---

## Abort a batch

### Graceful abort (default)

```
/orch-abort
```

Behavior:

- Writes `.pi/orch-abort-signal`
- Signals pause/stop behavior
- Terminates orchestrator-related sessions
- Cleans up persisted batch state
- Preserves worktrees/branches for investigation

### Hard abort

```
/orch-abort --hard
```

Use when execution is wedged and immediate stop is required.

---

## Which command should I use?

- Use **pause** when you plan to continue soon.
- Use **resume** after interruptions, crashes, or intentional pauses.
- Use **graceful abort** when you want to stop this batch and cleanly reset orchestration state.
- Use **hard abort** only when graceful behavior cannot recover quickly.

---

## Typical workflows

### Planned pause + resume

```
/orch all
/orch-pause
# inspect things
/orch-resume
```

### Resolve merge conflict then continue

```
/orch all
# batch pauses due to merge failure policy
# resolve conflict in integration branch/worktree
/orch-resume
```

### Cancel current batch and restart

```
/orch-abort
/orch-plan all
/orch all
```

---

## Troubleshooting

### “No active batch is running” when pausing

There is nothing in a running phase. Start with `/orch all`.

### “Cannot resume”

State may be terminal (`failed`, `completed`, `stopped`) or missing. Run `/orch-abort` to clean stale artifacts, then start a new batch.

### Abort appears stuck

Retry with hard mode:

```
/orch-abort --hard
```
