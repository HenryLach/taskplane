# Task: TP-097 - Stable Sidecar Identity and TMUX Lifecycle

**Created:** 2026-03-29
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes the root cause of worker telemetry being invisible after crash recovery (#354). Also addresses orphan tmux sessions (#242) and increases spawn retry budget (#335). High impact — this is the single biggest reliability gap in the orchestrator.
**Score:** 7/8 — Blast radius: 3, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-097-stable-sidecar-and-tmux-lifecycle/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix three related tmux/telemetry bugs that share a root cause — the sidecar path is generated from `Date.now()` inside each `spawnAgentTmux()` call, causing path mismatch across worker iterations after crash recovery:

1. **Sidecar path mismatch (#354):** Each `spawnAgentTmux()` call generates a unique sidecar path. After crash recovery, the new call tails a different file than the one the rpc-wrapper writes to. Worker telemetry goes to /dev/null. This is the root cause of #333 and #334 remaining broken despite TP-095 fixes.

2. **Orphan tmux sessions (#242):** When a task fails, the worker tmux session can survive as an orphan. The rpc-wrapper child process outlives the tmux session container, consuming CPU/IO. Need explicit process cleanup on task failure.

3. **Spawn retry budget (#335):** Current 2-retry limit is insufficient — crashes still happen on 3-5 attempts. Increase retry budget and add progressive delay.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — `spawnAgentTmux()` function (sidecar path generation, spawn verification, poll loop)
- GitHub issues #354, #242, #335

## Environment

- **Workspace:** `extensions/`, `bin/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/rpc-wrapper.test.ts`
- `extensions/tests/sidecar-tailing.test.ts`
- `extensions/tests/crash-recovery-spawn-reliability.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `spawnAgentTmux()` — trace sidecar path generation, poll loop, and how `onTelemetry` fires
- [ ] Read the iteration loop in `runWorker()` — understand how `spawnAgentTmux` is called across iterations
- [ ] Read GitHub issues #354 (sidecar mismatch), #242 (orphan sessions), #335 (spawn crashes)
- [ ] Identify how the sidecar path is passed to rpc-wrapper via `--sidecar-path`

### Step 1: Stable sidecar identity (#354)

Make the sidecar path deterministic per session, not per spawn attempt:

- [ ] Move sidecar path generation OUT of `spawnAgentTmux()` — the caller (`runWorker()`) should generate it once and pass it in
- [ ] Add `sidecarPath` and `exitSummaryPath` as required parameters to `spawnAgentTmux()` instead of generating them internally
- [ ] In the iteration loop, generate the sidecar path ONCE (before the first iteration) using a stable key: `{opId}-{batchId}-{repoId}-{taskId}-{lane}-{role}`
- [ ] Append to the same sidecar across iterations (rpc-wrapper already appends, just needs the same path)
- [ ] Ensure `tailState` is preserved across iterations (pass it through the iteration loop) so tailing resumes from the last position

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Orphan process cleanup (#242)

- [ ] After `spawnAgentTmux().promise` resolves (session ended), check for orphan rpc-wrapper/pi processes by PID
- [ ] rpc-wrapper should write its PID to a file alongside the sidecar: `{sidecarPath}.pid`
- [ ] On session end, read the PID file and send SIGTERM if the process is still alive
- [ ] On task failure (no .DONE), explicitly kill the worker tmux session AND check for orphan PIDs
- [ ] Clean up PID files during post-batch cleanup

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `bin/rpc-wrapper.mjs` (modified — PID file write)

### Step 3: Spawn retry improvements (#335)

- [ ] Increase `SPAWN_MAX_RETRIES` from 2 to 5
- [ ] Increase initial `SPAWN_VERIFY_DELAY_MS` from 300 to 500
- [ ] Add progressive delay: retry N waits `N * 500ms` (already partially implemented, verify)
- [ ] Log each retry with the exact stderr from the failed session (if available)

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: sidecar path is stable across iterations (same path reused)
- [ ] Test: tailState accumulates across iterations (no reset)
- [ ] Test: PID file written by rpc-wrapper, read on cleanup
- [ ] Test: orphan process detection and cleanup
- [ ] Test: spawn retry budget of 5 with progressive delay
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- None (internal fixes)

**Check If Affected:**
- `docs/how-to/troubleshoot-common-issues.md`

## Completion Criteria

- [ ] Worker telemetry visible in dashboard after crash recovery
- [ ] Context pressure thresholds fire correctly after crash recovery
- [ ] No orphan rpc-wrapper/pi processes after task failure
- [ ] Spawn succeeds reliably within 5 retries
- [ ] All tests pass

## Git Commit Convention

- **Step completion:** `feat(TP-097): complete Step N — description`
- **Bug fixes:** `fix(TP-097): description`

## Do NOT

- Modify dashboard rendering (TP-098)
- Modify integration flow (TP-099)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
