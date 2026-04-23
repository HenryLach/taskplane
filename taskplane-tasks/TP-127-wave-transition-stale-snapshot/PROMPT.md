# Task: TP-127 - Fix Wave Transition Stale Snapshot

**Created:** 2026-04-02
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Targeted bug fix for monitor liveness check during wave transitions. Small scope, single file change.
**Score:** 2/8 — Blast radius: 1 (execution.ts only), Pattern novelty: 0 (extending existing guard), Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-127-wave-transition-stale-snapshot/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix the monitor reporting tasks as "failed" at wave transitions in multi-wave batches.

**Root cause:** When wave 2 starts a new task on the same lane, the V2 lane snapshot still contains the previous wave's terminal data (`status: "complete"`, `taskId: "TP-122"`). The monitor's `resolveTaskMonitorState` reads this stale snapshot and reports `sessionAlive = false` because `snap.status !== "running"`. This gets cached in `terminalTasks` as "failed" and never corrects.

The startup grace (snap == null → assume alive) doesn't help because the snapshot EXISTS — it's just stale from the previous task.

**Fix:** In `resolveTaskMonitorState`, when the V2 lane snapshot exists but its `taskId` doesn't match the task being monitored, treat it as stale (same as null → assume alive). The lane-runner will overwrite it with the new task's snapshot shortly.

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- None

## Context to Read First

- `extensions/taskplane/execution.ts` — `resolveTaskMonitorState()` function, search for "readLaneSnapshot"

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/process-registry.ts` (readLaneSnapshot return type may need taskId)
- `extensions/tests/engine-runtime-v2-routing.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read the `resolveTaskMonitorState` function in execution.ts
- [ ] Understand the current liveness check: `snap == null → alive`, `snap.status === "running" → alive`, else `dead`

### Step 1: Fix the stale snapshot check
- [ ] In `resolveTaskMonitorState`, after reading the lane snapshot, check if `snap.taskId` matches the `taskId` parameter
- [ ] If snapshot exists but taskId doesn't match → treat as stale (assume alive, same as null case)
- [ ] If `readLaneSnapshot` doesn't return `taskId`, update it to include the field (it's already in the snapshot JSON)

### Step 2: Tests
- [ ] Add test: stale snapshot from different task → sessionAlive = true (startup grace)
- [ ] Add test: current task snapshot with status "running" → sessionAlive = true
- [ ] Add test: current task snapshot with status "complete" → sessionAlive = false
- [ ] Run full suite
- [ ] Fix failures

### Step 3: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Change the monitor's terminalTasks caching behavior
- Modify monitorLanes or executeWave
- Touch the dashboard rendering

## Git Commit Convention

- `fix(TP-127): ...`
