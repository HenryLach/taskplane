# Task: TP-095 - Crash Recovery and Spawn Reliability

**Created:** 2026-03-29
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Addresses four related bugs (#333, #334, #335, #339) in the worker lifecycle — spawn reliability, crash recovery state, telemetry continuity, and lane stderr capture. Touches task-runner spawn paths and execution.ts lane spawning.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-095-crash-recovery-and-spawn-reliability/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix four related lifecycle bugs:

1. **Worker startup crashes (#335):** Pi process exits with code 1 in 0 seconds on first 3-5 spawn attempts, then succeeds. Investigation shows rapid sequential tmux session creation on Windows/MSYS2 is unreliable. Add startup verification and/or delay.

2. **Frozen lane-state after crash (#333):** When a worker crashes and the engine restarts it, the lane-state JSON retains stale values (currentStep: 0, workerStatus: "done", phase: "error"). The restarted worker's telemetry is invisible to the dashboard.

3. **Zeroed telemetry on restart (#334):** After crash restart, rpc-wrapper sidecar counters reset to zero. The dashboard shows "✓ Worker done" with no telemetry.

4. **Lane session stderr capture (#339):** When the lane session dies, stderr is lost to tmux scrollback. The supervisor can't diagnose lane deaths.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — `spawnAgentTmux()` function, worker polling loop, `writeLaneState()`
- `extensions/taskplane/execution.ts` — `buildTmuxSpawnArgs()`, `spawnLaneSession()`
- GitHub issues #333, #334, #335, #339 for full investigation notes

## Environment

- **Workspace:** `extensions/`, `bin/`
- **Services required:** tmux (for manual verification)

## File Scope

- `extensions/task-runner.ts`
- `extensions/taskplane/execution.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/rpc-wrapper.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read spawnAgentTmux() and the tmux session creation flow
- [ ] Read writeLaneState() and understand what fields are written
- [ ] Read buildTmuxSpawnArgs() in execution.ts for lane session spawning
- [ ] Read GitHub issues #333, #334, #335, #339

### Step 1: Worker spawn reliability (#335)

- [ ] After `tmux new-session -d` in `spawnAgentTmux()`, add a verification check: poll `tmux has-session` with short retry (3 attempts, 200ms apart) before proceeding to the polling loop
- [ ] If verification fails (session died on startup), log the failure and immediately retry the tmux spawn (max 2 retries)
- [ ] Log stderr output path for the failed session (for diagnosis)

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Lane-state reset on worker restart (#333)

- [ ] In the worker iteration loop, before spawning a new worker: reset stale lane-state fields (currentStep, workerStatus, workerExitDiagnostic, phase) to running/active values
- [ ] Call `writeLaneState()` immediately after reset so dashboard reflects the new state
- [ ] Ensure the reset happens BEFORE the new worker spawn, not after

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 3: Telemetry accumulation across restarts (#334)

- [ ] Before spawning a new worker iteration, read the current lane-state and preserve accumulated telemetry (workerInputTokens, workerOutputTokens, workerCostUsd, workerToolCount)
- [ ] When `onTelemetry` fires for the new worker, ADD to the preserved totals instead of replacing
- [ ] The sidecar for each iteration is separate (different timestamp), but the lane-state accumulates across iterations

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 4: Lane session stderr capture (#339)

- [ ] In `buildTmuxSpawnArgs()` in execution.ts: redirect lane session stderr to a log file alongside telemetry
- [ ] Path: `.pi/telemetry/{batchId}-lane-{N}-stderr.log`
- [ ] Use shell `2> >(tee -a <logfile> >&2)` or simpler `2>> <logfile>` redirect
- [ ] Ensure the log file path is available to the supervisor (add to batch state or discoverable from convention)

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: spawn verification retries on session startup failure
- [ ] Test: lane-state fields reset correctly between worker iterations
- [ ] Test: telemetry accumulates across worker restarts
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- None (internal fixes)

**Check If Affected:**
- `docs/how-to/troubleshoot-common-issues.md`

## Completion Criteria

- [ ] Worker spawn succeeds reliably on first attempt (or recovers within 1s)
- [ ] Dashboard shows correct telemetry after crash recovery
- [ ] Lane session stderr is captured to a log file
- [ ] All tests pass

## Git Commit Convention

- **Step completion:** `feat(TP-095): complete Step N — description`
- **Bug fixes:** `fix(TP-095): description`

## Do NOT

- Modify context pressure thresholds (TP-094)
- Modify dashboard rendering (TP-096)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
