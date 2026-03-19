## Code Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The new test suite improves coverage for naming, persistence serialization, and persisted-state validation around partial-progress fields. However, Step 3’s core acceptance behavior (real branch preservation for failed tasks) is still not validated through the production git-path functions. As written, the suite can pass while regressions in `savePartialProgress()` / `preserveFailedLaneProgress()` go undetected.

### Issues Found
1. **[extensions/tests/partial-progress.test.ts:262-266, 268-351] [important]** — The tests explicitly avoid calling `preserveFailedLaneProgress()` and instead assert `applyPartialProgressToOutcomes()` using hand-constructed `PreserveFailedLaneProgressResult` objects. This does not verify actual commit counting, branch creation, lane-to-task mapping, or repo-root/target-branch resolution in the real implementation. **Fix:** add integration tests using disposable git repos that call `savePartialProgress()` and `preserveFailedLaneProgress()` directly for: (a) commits ahead -> saved branch created, (b) zero commits -> no saved branch, (c) workspace naming with repoId.
2. **[extensions/tests/partial-progress.test.ts:615-645] [important]** — “unsafeBranches contract” tests are tautological (constructing a literal object and checking that inserted set members exist). These assertions never execute production logic and cannot catch regressions in unsafe-branch population rules. **Fix:** cover unsafe-branch behavior via real `preserveFailedLaneProgress()` execution where preservation fails with commits (e.g., simulate branch-create failure) and assert `unsafeBranches` output.
3. **[extensions/tests/partial-progress.test.ts:375-389] [minor]** — `"no change when fields are identical"` uses two separate `makeOutcome()` calls, each with `Date.now()` for `startTime/endTime` (lines 98-99), making the equality premise timing-dependent. **Fix:** pin `startTime`/`endTime` explicitly in this test (or make helper deterministic).

### Pattern Violations
- Behavior that depends on git state is being validated mostly through synthetic result objects rather than through the repo’s established temp-repo integration-test pattern (see existing git lifecycle tests).

### Test Gaps
- No direct test of `savePartialProgress()` branch creation/no-op behavior against a real git repo.
- No direct test of `preserveFailedLaneProgress()` lane deduping and failed-preservation `unsafeBranches` signaling.
- No integration assertion that repo/workspace naming differences flow through actual preservation logic (currently only pure naming helper is tested).

### Suggestions
- Keep the current persistence/validation tests; they are useful.
- Add a small focused integration block (3–5 tests) for `savePartialProgress` + `preserveFailedLaneProgress` using temporary repos to close the behavioral gap.
