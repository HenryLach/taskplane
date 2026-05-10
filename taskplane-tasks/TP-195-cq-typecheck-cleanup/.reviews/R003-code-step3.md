## Code Review: Step 3: Fix runtime-source errors (~69 errors)

### Verdict: REVISE

### Summary
Typecheck now passes and most runtime-source fixes are reasonable, but three of the “preserve-broken” changes are not legitimate end-state fixes: they codify known bad behavior via casts/stubs rather than correcting the underlying runtime logic. That conflicts with the task’s stated no-shortcuts intent for source-side cleanup and leaves important runtime paths intentionally broken. I also ran quality checks: `typecheck` and `lint` passed, while `format:check` failed (reported below).

### Issues Found
1. **[extensions/taskplane/engine.ts:2612] [important]** — Preflight cleanup functions are replaced with `undefined as unknown as (...args) => never` stubs, then called inside a catch-all block. This is a type-level bypass, not a real fix: Layers 2–5 stay permanently non-functional and the code now intentionally throws at runtime. **Fix:** import and call the real functions from `./cleanup.ts` (`sweepStaleArtifacts`, `formatPreflightSweep`, `rotateSupervisorLogs`, `formatLogRotation`) and keep the existing non-fatal error handling around real execution.
2. **[extensions/taskplane/execution.ts:2924] [important]** — `maxWorkerMinutes` is read through a fabricated camelCase alias (`config.failure as unknown as { maxWorkerMinutes?: number }`) that is known not to exist. This locks in the config-ignore bug instead of fixing it. **Fix:** read the real field (`config.failure?.max_worker_minutes ?? 120`) and update/adjust tests for the intended behavior.
3. **[extensions/taskplane/resume.ts:2383] [important]** — `batchState` is cast to a fake `{ tasks?: PersistedTaskRecord[] }` shape to silence TS, even though `OrchBatchRuntimeState` does not own `tasks`. This drops valid segment/task metadata lookup and hides the real bug path. **Fix:** use the already-available lane/task source (`laneForTask?.tasks.find(... )?.task`) for `segmentIds`/`activeSegmentId` as noted in the inline comment.
4. **[npm run format:check] [important]** — Quality check failed. Sample output shows formatter diffs in changed files, including:
   - `extensions/taskplane/execution.ts` (function signature / wrapped expression formatting)
   - `extensions/taskplane/extension.ts` (lane comparison formatting)
   - `extensions/taskplane/persistence.ts` (union formatting)
   Command: `npm run format:check` exited with code 1.

### Pattern Violations
- “Preserve-broken” casts/stubs in runtime source (`undefined as unknown as function`, fake structural casts for non-existent fields) are being used as typecheck silencing mechanisms instead of converging runtime code to real typed contracts.

### Test Gaps
- No targeted regression test was added to prove `max_worker_minutes` is honored in lane execution config.
- No targeted regression test was added to cover resume failure-alert metadata lookup using the correct task source (lane task payload) rather than a non-existent `batchState.tasks` field.

### Suggestions
- If behavior-change escalation is still pending, keep those fixes in a clearly isolated follow-up commit/flag, but don’t land permanent type-bypass constructs in core runtime paths.
