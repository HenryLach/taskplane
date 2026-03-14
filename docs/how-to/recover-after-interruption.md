# Recover After Interruption

If your pi session crashes, terminal disconnects, machine sleeps, or orchestration is interrupted, use this guide to recover safely.

## What Taskplane persists

During orchestration, Taskplane writes recovery state under `.pi/`:

- `.pi/batch-state.json` — canonical orchestrator batch state
- `.pi/lane-state-*.json` — per-lane runtime sidecar state
- `.pi/worker-conversation-*.jsonl` — worker conversation logs (dashboard)
- `.pi/merge-request-*.json` / `.pi/merge-result-*.json` — merge sidecars
- `.pi/orch-abort-signal` — abort signal file (if abort requested)

Task-level progress is also persisted in task folders:

- `STATUS.md` (execution memory)
- `.DONE` markers

---

## Fast recovery path

### 1) Re-open project and start pi

```bash
cd my-project
pi
```

### 2) Attempt resume

Inside pi:

```
/orch-resume
```

Taskplane will reconcile persisted state against live signals:

- already completed tasks (`.DONE`) are marked complete
- alive sessions are reconnected
- interrupted tasks may be re-executed from preserved worktrees

### 3) Confirm state

```
/orch-status
```

---

## If `/orch` warns about orphan sessions

When you run `/orch ...`, Taskplane may detect orphaned sessions/state and prompt you to:

- `/orch-resume` to continue
- `/orch-abort` to clean up

Follow that recommendation rather than forcing a new batch immediately.

---

## Non-resumable states

A batch may be non-resumable if persisted phase is terminal (for example `failed`, `stopped`, `completed`) or state is invalid.

Recommended recovery:

1. Clean up:

```
/orch-abort
```

2. Re-plan:

```
/orch-plan all
```

3. Start fresh:

```
/orch all
```

---

## Manual recovery fallback

Use this only if normal commands cannot recover.

### 1) Kill lingering tmux sessions (tmux mode)

```bash
tmux list-sessions
tmux kill-session -t <session-name>
```

### 2) Remove stale batch state

Delete:

- `.pi/batch-state.json`
- `.pi/orch-abort-signal` (if present)

### 3) Re-run planning and execution

```
/orch-plan all
/orch all
```

---

## Tips to reduce recovery pain

- Keep merge failure policy at `on_merge_failure: pause`
- Prefer graceful abort before hard abort
- Use `/orch-plan all` before big runs to catch dependency issues early
- Commit task files before orchestration so worktrees see the same task set

---

## Related guides

- [Pause, Resume, or Abort a Batch](pause-resume-abort-a-batch.md)
- [Configure Task Orchestrator](configure-task-orchestrator.md)
