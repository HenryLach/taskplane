# Persistence and Resume

Taskplane persists orchestration state so interrupted batches can be resumed safely.

Primary mechanism:

- persisted batch state (`.pi/batch-state.json`)
- task-local markers (`STATUS.md`, `.DONE`)
- lane sidecar files for monitoring/debugging

---

## State files

### `.pi/batch-state.json`

Canonical persisted orchestration state.

Contains (high level):

- schema version (`schemaVersion`)
- batch metadata (`batchId`, phase, timestamps, mode)
- wave plan and current wave index
- per-lane records (session/worktree/branch/task IDs, repo ID)
- per-task records (status, folder, session, timings, done marker, repo attribution)
- merge summaries (grouped by repo in workspace mode)
- aggregate counters and error history

### Lane sidecars (`.pi/lane-state-*.json`)

Written by task-runner in orchestrated mode for live dashboard visibility.

### Task-local files

- `STATUS.md` = execution memory
- `.DONE` = completion marker

---

## Write strategy and integrity

Batch state writes are atomic:

1. write JSON to temp file (`batch-state.json.tmp`)
2. rename temp file to final path
3. retry rename on transient file-lock issues

Benefits:

- avoids partial/corrupt writes
- safer recovery after abrupt termination

---

## When state is persisted

During `/orch` execution, state is persisted at key transitions, including:

- batch start
- wave index changes
- task status transitions
- pause events
- resume reconciliation points

This keeps recovery point close to live execution.

---

## Resume eligibility

`/orch-resume` only resumes batches in resumable phases:

- `paused`
- `executing`
- `merging`

Non-resumable phases (for example `failed`, `stopped`, `completed`) require cleanup/new batch.

---

## Resume algorithm (conceptual)

1. Load and validate `.pi/batch-state.json`
2. Check resumable phase
3. Detect alive orchestrator/lane sessions
4. Detect `.DONE` markers (active and archived candidate paths)
5. Reconcile each task into one action:
   - mark complete
   - reconnect
   - re-execute
   - mark failed
   - skip terminal
   - pending (never started)
6. Compute first incomplete wave (skipping waves where all tasks are terminal)
7. Reconstruct runtime counters/state (including blocked-task accounting)
8. Seed blocked task set from reconciled failures and their transitive dependents
9. Continue execution from resume wave

### Workspace mode (polyrepo)

In workspace mode, resume reconciliation is repo-aware:

- Each persisted lane and task record carries a `repoId` identifying its target repo
- Repo roots are resolved at resume time from workspace config (not stored as absolute paths, keeping state portable)
- Reconciliation actions (reconnect, re-execute, worktree reset, cleanup) use per-lane repo roots
- Cross-repo dependency propagation: a failure in one repo correctly blocks dependents in another repo
- Lane metadata and task repo attribution are preserved across resume checkpoints

Backward compatibility:

- State files from before workspace mode (schema v1, no repo fields) resume identically to existing behavior
- Missing repo fields default to `undefined` and fall through to single-repo semantics

---

## Orphan detection on startup

When `/orch ...` is invoked, startup analysis checks:

- orphan sessions
- persisted state status (valid/missing/invalid/io-error)
- done markers

Recommended actions:

- `resume`
- `abort-orphans`
- `cleanup-stale`
- `start-fresh`

This prevents accidental overlapping batches.

---

## Abort interactions

`/orch-abort` writes `.pi/orch-abort-signal`.

Lane polling checks this signal and exits accordingly; abort then cleans or resets persisted batch state, while preserving worktrees/branches for inspection.

---

## Operational guidance

- Prefer `on_merge_failure: pause` so you can resolve and resume
- Use graceful abort before hard abort
- Use `/orch-status` and dashboard to verify post-resume trajectory
- If state is unrecoverable, cleanup and restart with `/orch-plan all` → `/orch all`

---

## Related

- [Pause, Resume, or Abort a Batch](../how-to/pause-resume-abort-a-batch.md)
- [Recover After Interruption](../how-to/recover-after-interruption.md)
- [Waves, Lanes, and Worktrees](waves-lanes-and-worktrees.md)
