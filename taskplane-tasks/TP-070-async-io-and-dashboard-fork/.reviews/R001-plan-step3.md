# R001 — Plan Review (Step 3: Convert Merge Polling to Async)

## Verdict
**Changes requested** — Step 3 is partially implemented, but the current plan/status is not sufficient to satisfy the Step 3 contract in `PROMPT.md`.

## Reviewed artifacts
- `taskplane-tasks/TP-070-async-io-and-dashboard-fork/PROMPT.md`
- `taskplane-tasks/TP-070-async-io-and-dashboard-fork/STATUS.md`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/execution.ts`
- `extensions/tests/supervisor-merge-monitoring.test.ts`
- `extensions/tests/merge-timeout-resilience.test.ts`
- Validation run: `cd extensions && npx vitest run tests/supervisor-merge-monitoring.test.ts tests/merge-timeout-resilience.test.ts`

## Blocking findings

### 1) Plan does not cover the remaining sync file-read path in merge polling
`PROMPT.md` Step 3 explicitly calls for replacing `existsSync(merge-result.json) + readFileSync` with async equivalents (`PROMPT.md:118-122`).

However, `waitForMergeResult()` still relies on:
- `existsSync(resultPath)` checks in the poll loop (`merge.ts:581, 622, 640, 665`)
- `parseMergeResult(resultPath)` from the poll loop (`merge.ts:583, 624, 642, 667`)

And `parseMergeResult()` still uses synchronous/blocking internals:
- `readFileSync(resultPath, "utf-8")` (`merge.ts:154`)
- `sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS)` retry waits (`merge.ts:158`)

**Why this blocks:** the merge poll path still contains event-loop blocking file I/O + blocking sleep behavior.

---

### 2) Step 3 status checkboxes are too coarse and currently overstate completion
`STATUS.md` marks Step 3 complete with only two high-level items (`STATUS.md:42-46`), but the prompt scope is broader:
- wait loop tmux liveness ✅ largely addressed
- merge health monitor tmux liveness/capture ✅ addressed
- merge result file I/O async conversion ❌ not fully addressed

**Why this blocks:** completion is not yet aligned with the explicit Step 3 requirements.

---

### 3) Plan omits required test updates for async-signature migration
The current code shape has moved to async forms (e.g., `poll(): Promise<void>`, async tmux helpers), but tests still assert old sync source patterns. The targeted test run reports **9 failures**:
- `tests/supervisor-merge-monitoring.test.ts` (source checks tied to `poll(): void`, `tmuxHasSession(...)`, etc.)
- `tests/merge-timeout-resilience.test.ts` (string assertions expecting `tmuxKillSession(...)` and narrow substring windows)

Relevant brittle checks include:
- `poll(): void {` expectations (`supervisor-merge-monitoring.test.ts:506, 525, 540, 551, 662, 684`)
- sync liveness call expectation (`supervisor-merge-monitoring.test.ts:511, 711`)
- sync kill-call expectation (`merge-timeout-resilience.test.ts:76`)

**Why this blocks:** Step 3 plan is missing concrete test migration tasks, so the task cannot reach the “ZERO test failures” bar deterministically.

## Required plan updates before execution/closure
1. **Add explicit async merge-result parsing work** in Step 3:
   - introduce async read/parse path (e.g., `parseMergeResultAsync` or equivalent),
   - remove blocking `sleepSync` from merge polling path,
   - keep validation semantics/error codes unchanged.
2. **Split Step 3 into concrete sub-checks** in `STATUS.md` (tmux async, merge-result async read/parse, monitor async polling, overlap safety).
3. **Add Step 3 test-migration checklist** for sync→async source assertions:
   - update `supervisor-merge-monitoring.test.ts` expectations for async poll/liveness calls,
   - update `merge-timeout-resilience.test.ts` sync kill-call/source-fragment assumptions,
   - rerun targeted tests before moving to Step 4.
4. **Do not mark Step 3 complete** until the merge poll loop no longer uses blocking file-read/sleep behavior.

## Non-blocking note
- `STATUS.md` currently shows `Current Step: Step 4` while this review request is for Step 3 planning. Keep request/status alignment tight to avoid review ambiguity.
