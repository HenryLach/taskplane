# Task: TP-046 — Async Merge Polling (Unblock Supervisor During Merges)

**Created:** 2026-03-23
**Size:** M
**GitHub Issue:** #136

## Review Level: 2 (Plan and Code)

**Assessment:** Converts synchronous merge polling to async. Touches merge.ts, engine.ts, resume.ts — core execution paths. Must preserve all existing merge behavior while yielding the event loop.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-046-async-merge-polling/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Convert the merge polling loop from synchronous (`sleepSync`) to async
(`setTimeout`-based delay) so that the Node.js event loop is not blocked
during merge operations. This unblocks the supervisor agent, heartbeat
updates, and user input during the merge phase.

Currently `waitForMergeResult()` calls `sleepSync(5000)` in a tight loop,
which blocks the entire pi process for the duration of the merge (up to 70+
minutes). The supervisor cannot respond, heartbeats go stale, and the
dashboard freezes.

## Dependencies

None.

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/merge.ts` — `waitForMergeResult()`, `spawnMergeAgent()`, `mergeWave()`
- `extensions/taskplane/worktree.ts` — `sleepSync()` implementation
- `extensions/taskplane/engine.ts` — calls `mergeWave()` / `mergeWaveByRepo()`
- `extensions/taskplane/resume.ts` — calls `mergeWave()` in resume merge-retry path

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/merge.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/tests/merge-timeout-resilience.test.ts` (update if needed)

## Steps

### Step 0: Preflight

- [ ] Read `waitForMergeResult()` — understand the full polling loop, timeout, session liveness, grace period
- [ ] Read `mergeWave()` — understand how it calls `waitForMergeResult()` and `spawnMergeAgent()`
- [ ] Read `mergeWaveByRepo()` — wrapper that calls `mergeWave()` per repo group
- [ ] Read engine.ts and resume.ts callers — understand the async context these run in
- [ ] Identify ALL `sleepSync` call sites in merge.ts (polling, spawn retry, cleanup delays)
- [ ] Read `sleepSync()` implementation — understand why it blocks (execSync ping/sleep)

### Step 1: Add Async Sleep Utility

- [ ] Add `sleepAsync(ms: number): Promise<void>` to `worktree.ts` (or a shared util)
- [ ] Implementation: `new Promise(resolve => setTimeout(resolve, ms))`
- [ ] Keep `sleepSync` for callers that genuinely need synchronous behavior (if any remain)

### Step 2: Convert waitForMergeResult to Async

- [ ] Change `waitForMergeResult` signature to `async` → returns `Promise<MergeResult>`
- [ ] Replace `sleepSync(MERGE_POLL_INTERVAL_MS)` with `await sleepAsync(MERGE_POLL_INTERVAL_MS)`
- [ ] Replace `sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS)` with `await sleepAsync(...)`
- [ ] Preserve ALL existing behavior: timeout check, result file check, session liveness, grace period
- [ ] Preserve the retry-on-timeout loop (TP-038)

### Step 3: Convert mergeWave and Callers to Async

- [ ] Change `mergeWave` signature to `async` → returns `Promise<MergeWaveResult>`
- [ ] Update `mergeWaveByRepo` if it wraps `mergeWave`
- [ ] Update `engine.ts` callers — already async, just need `await`
- [ ] Update `resume.ts` callers — already async, just need `await`
- [ ] Convert `sleepSync` calls in `spawnMergeAgent` retry loop to async (change `spawnMergeAgent` to async)
- [ ] Convert `sleepSync(500)` delay calls in merge worktree cleanup to async where possible

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Existing merge-timeout-resilience tests still pass (update if signatures changed)
- [ ] Existing merge-repo-scoped tests still pass
- [ ] Existing cleanup-resilience tests still pass
- [ ] Existing orch-direct-implementation tests still pass
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

None — internal behavior change only.

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `waitForMergeResult` is async (does not block event loop during polling)
- [ ] Supervisor remains responsive during merge phase
- [ ] All existing merge behavior preserved (timeout, retry, grace period, liveness check)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-046): complete Step N — description`
- **Bug fixes:** `fix(TP-046): description`
- **Tests:** `test(TP-046): description`

## Do NOT

- Remove `sleepSync` entirely — other non-merge callers may still need it
- Change the merge result file format or polling semantics
- Change the merge agent spawn mechanism (tmux sessions)
- Add new dependencies

---

## Amendments (Added During Execution)
