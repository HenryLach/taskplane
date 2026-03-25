## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 direction is close, but it currently misses required test maintenance needed to satisfy the task’s **zero-failure** bar. I ran the targeted suite and it fails in existing assertions that were not updated for TP-068 wording/flow changes, so the current plan is not yet sufficient to complete Step 4 successfully.

### Issues Found
1. **[Severity: important]** Existing assertions in `persistent-reviewer-context.test.ts` are stale and currently fail, so Step 4 cannot pass as written.
   - Evidence from run: `cd extensions && npx vitest run tests/persistent-reviewer-context.test.ts` → **5 failing tests**.
   - Specific stale/brittle spots:
     - `5.8` still expects old strings (`"both persistent and fallback failed"`, `"UNAVAILABLE — reviewer error"`) that no longer exist (around line 305).
     - `12.3` uses a too-small `sourceRegion(..., 0, 600)` and misses `"Persistent reviewer session died while waiting for verdict"` (lines ~587-589).
     - `15.3` / `15.4` use `sourceRegion(..., 0, 800)` that truncates before `writeFileSync` / `UNAVAILABLE` in the double-failure branch (lines ~692, ~698).
   - Suggested fix: explicitly include updating these pre-existing assertions/window sizes as part of Step 4, not only adding new TP-068 sections.

### Missing Items
- Add a checklist item to reconcile **all affected existing tests** in `persistent-reviewer-context.test.ts` (not just add new TP-068 tests), then re-run targeted tests until green.

### Suggestions
- Reduce brittleness by matching stable substrings/regex around behavior intent rather than exact legacy phrases.
- After targeted tests pass, run full suite and then CLI smoke (`node bin/taskplane.mjs help`) from repo root and record outcomes in STATUS execution log.
