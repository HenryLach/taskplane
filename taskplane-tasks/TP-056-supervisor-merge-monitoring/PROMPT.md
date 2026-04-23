# Task: TP-056 - Supervisor Merge Monitoring

**Created:** 2026-03-24
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a new monitoring subsystem to the supervisor during merge phase. Touches merge polling, supervisor event handling, and tmux session management. Medium blast radius across engine and supervisor modules.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-056-supervisor-merge-monitoring/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

During the merge phase, the supervisor has no visibility into whether merge agents are actually working. A merge agent can stall silently (tmux session dies, API hangs, agent loops) and the batch waits up to 90 minutes before the timeout fires. This was observed in production on 2026-03-24: the TP-053 merge agent stalled after 8 tool calls, produced no result file, and required manual intervention to kill the tmux session.

Implement active merge monitoring in the supervisor so stalled merge agents are detected within minutes, not after the full timeout window.

## Real-World Failure (2026-03-24, TP-053 batch)

```
[merge agent spawns in orch-henrylach-merge-1]
[8 tool calls, $0.14, then silence]
[tmux session alive but no output for 10+ minutes]
[no merge result file written]
[supervisor had zero visibility — waited passively]
[operator manually killed session via: tmux kill-session -t orch-henrylach-merge-1]
[engine detected session death → batch paused with merge failure]
[manual recovery: merge lane branch into orch branch, patch batch-state to completed]
```

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/supervisor.ts` — supervisor event handling, `merge_start`/`merge_failed` cases (~line 3461+), supervisor action logging
- `extensions/taskplane/merge.ts` — `waitForMergeResult()`, `spawnMergeAgent()`, merge polling loop
- `extensions/taskplane/engine.ts` — merge phase orchestration, engine event emission
- `extensions/taskplane/types.ts` — merge constants (`MERGE_TIMEOUT_MS`, `MERGE_POLL_INTERVAL_MS`)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/supervisor-merge-monitoring.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read supervisor merge event handling in `supervisor.ts` (~line 3461+)
- [ ] Read `waitForMergeResult()` in `merge.ts` — understand the polling loop
- [ ] Read merge phase orchestration in `engine.ts` — how merge agents are spawned and results collected
- [ ] Understand current merge constants in `types.ts`

### Step 1: Implement Merge Health Monitor

Create a merge health monitoring function that the engine calls periodically during the merge phase. The monitor checks each active merge session:

**Session liveness:**
- `tmux has-session -t <name>` — is the session still alive?
- If dead + no result file → immediate detection (don't wait for 90-min timeout)

**Activity detection:**
- `tmux capture-pane -t <name> -p -S -10` — capture last 10 lines of output
- Compare with previous capture (store snapshots keyed by session name)
- If output hasn't changed in N minutes, flag as possibly stalled

**Escalation tiers:**
- **Healthy:** session alive + output changing → no action
- **Possibly stalled:** session alive + no new output for 10 minutes → log warning, emit supervisor event
- **Dead:** session gone + no result file → emit event, trigger immediate session cleanup so `waitForMergeResult` exits early (don't wait for full timeout)
- **Stuck:** session alive + no new output for 20 minutes → emit event with recommendation to kill and retry

The monitor should:
- Run on its own interval (every 2-3 minutes) independent of the merge result poll
- Store session snapshots in memory (not persisted — monitoring is per-run)
- Emit structured events that the supervisor can format for the operator
- NOT kill sessions autonomously — that's the operator's or supervisor's decision in supervised mode

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified — add `MergeHealthMonitor` class or functions)
- `extensions/taskplane/types.ts` (modified — add monitoring constants)

### Step 2: Integrate with Engine and Supervisor

**Engine integration:**
- During the merge phase (after `spawnMergeAgent`, while `waitForMergeResult` runs), start the merge health monitor
- Pass active merge session names to the monitor
- When the monitor detects a dead session, signal `waitForMergeResult` to exit early rather than waiting for the full timeout
- Stop the monitor when the merge phase ends (success or failure)

**Supervisor integration:**
- Add new event types: `merge_health_warning`, `merge_health_dead`, `merge_health_stuck`
- Format these events for the operator:
  - Warning: "⚠️ Merge agent on lane N may be stalled (no output for 10 min)"
  - Dead: "💀 Merge agent on lane N session died — triggering early retry"
  - Stuck: "🔒 Merge agent on lane N appears stuck (no output for 20 min). Consider killing and retrying."
- In autonomous mode, the supervisor can use the `orch_abort` tool or bash to kill stuck sessions

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified — start/stop monitor during merge phase)
- `extensions/taskplane/supervisor.ts` (modified — handle new event types)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Create `extensions/tests/supervisor-merge-monitoring.test.ts` with:
  - Health classification tests: alive+changing=healthy, alive+stale=warning, dead+no-result=dead, alive+very-stale=stuck
  - Snapshot comparison logic tests
  - Event emission tests for each escalation tier
  - Early exit signaling tests (dead session → waitForMergeResult exits)
  - Source-based tests for integration points (engine starts/stops monitor, supervisor handles events)
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 4: Documentation & Delivery

- [ ] Update `docs/how-to/troubleshoot-common-issues.md` — add merge stall troubleshooting
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/how-to/troubleshoot-common-issues.md` — add section on merge agent stalls and monitoring

**Check If Affected:**
- `docs/explanation/persistence-and-resume.md` — may mention merge timeout behavior
- `extensions/taskplane/supervisor-primer.md` — add merge monitoring to supervisor knowledge base

## Completion Criteria

- [ ] Merge health monitor detects dead sessions within 1 poll interval (~2-3 min)
- [ ] Stall detection triggers warning events at 10 min and stuck events at 20 min
- [ ] Dead session detection signals early exit from `waitForMergeResult`
- [ ] Supervisor formats and displays merge health events to operator
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-056): complete Step N — description`
- **Bug fixes:** `fix(TP-056): description`
- **Tests:** `test(TP-056): description`
- **Hydration:** `hydrate: TP-056 expand Step N checkboxes`

## Do NOT

- Kill merge sessions autonomously in supervised mode — emit events, let the operator decide
- Replace the existing 90-minute timeout — the monitor complements it, doesn't replace it
- Persist monitoring state to disk — it's ephemeral per merge phase
- Change the merge result file format or merge agent behavior
- Modify the merge agent template or merger prompt

---

## Amendments (Added During Execution)

