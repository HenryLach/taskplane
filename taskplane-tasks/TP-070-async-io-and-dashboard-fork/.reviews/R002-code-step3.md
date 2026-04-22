# R002 — Code Review (Step 3: Convert Merge Polling to Async)

## Verdict
**REVISE** — good progress, but Step 3 is not fully complete against its own contract.

## Scope reviewed
- `extensions/taskplane/merge.ts`
- Neighboring async helper patterns in `extensions/taskplane/execution.ts`
- Related tests:
  - `extensions/tests/merge-timeout-resilience.test.ts`
  - `extensions/tests/supervisor-merge-monitoring.test.ts`
  - `extensions/tests/supervisor.test.ts`

## Validation run
- `cd extensions && npx vitest run tests/merge-timeout-resilience.test.ts tests/supervisor-merge-monitoring.test.ts tests/supervisor.test.ts` ✅
- `cd extensions && npx vitest run` ✅ (65 files / 2660 tests)

---

## Blocking finding

### 1) Merge polling path still performs synchronous file-existence checks (`existsSync`) on every poll tick
Step 3 explicitly calls for converting merge polling I/O to async. The read path is now async (`parseMergeResultAsync`), but existence checks in the same polling path remain synchronous.

**Where**
- `waitForMergeResult()`:
  - `merge.ts:762`
  - `merge.ts:803`
  - `merge.ts:821`
  - `merge.ts:846`
- `parseMergeResultAsync()` pre-check:
  - `merge.ts:269`
- `MergeHealthMonitor.poll()`:
  - `merge.ts:2732`

**Why this matters**
These are still event-loop-blocking syscalls in active polling loops. They are small but frequent, and this task’s objective is specifically to remove blocking poll-loop I/O.

**Suggested fix**
Use an async existence helper (e.g., `fs/promises.access` or shared `fileExistsAsync`) consistently in merge poll paths.

---

## Non-blocking note
- `captureMergePaneOutputAsync()` returns `result.stdout || null` while sync version uses `result.stdout ?? null`. If you want exact semantic parity, use `??` in async version too.

---

## Summary
Async tmux conversion and async merge-result parsing are implemented correctly, and tests are green. The remaining sync existence checks in merge poll loops keep Step 3 short of fully async polling behavior.