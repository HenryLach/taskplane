## Code Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The new test file adds useful coverage for naming and persistence/validation of the new partial-progress fields. However, the step’s primary behavioral requirements (actual branch preservation on failed lanes, no-commit skip behavior, and unsafe-branch handling) are not being exercised through the production branch-preservation functions. There is also a nondeterministic test that flakes due to timestamp drift.

### Issues Found
1. **[extensions/tests/partial-progress.test.ts:375-389] [important]** — The test `"no change when fields are identical"` is flaky because both objects are built via `makeOutcome()`, which uses `Date.now()` for `startTime/endTime` (lines 98-99). On repeated runs this intermittently fails (`expected false, got true`) when timestamps differ by 1+ ms. **Fix:** use fixed timestamps in this test (override `startTime/endTime` explicitly), or make `makeOutcome` deterministic by default.
2. **[extensions/tests/partial-progress.test.ts:262-266, 268-351, 615-645] [important]** — Core Step 3 acceptance behavior is not actually tested. The suite explicitly avoids calling `preserveFailedLaneProgress` and instead asserts on hand-constructed `PreserveFailedLaneProgressResult` objects, which cannot catch regressions in `savePartialProgress()` / `preserveFailedLaneProgress()` logic (commit counting, branch creation, collision handling, unsafe branch population). **Fix:** add integration tests with disposable git repos (pattern already used in `extensions/tests/worktree-lifecycle.test.ts`) that invoke real functions and assert saved branch creation / no-commit no-op / unsafeBranches population.
3. **[taskplane-tasks/TP-028-partial-progress-preservation/STATUS.md:62] [minor]** — Step 3 status claims full suite `990/990` tests, but current run in this worktree is `986/986` tests across 25 files. **Fix:** update STATUS evidence to reflect actual command output.

### Pattern Violations
- Tests in sections “preserveFailedLaneProgress Behavior” and “unsafeBranches contract” validate manually created data structures rather than behavior of production functions, which is inconsistent with this repo’s existing temp-repo integration testing pattern for git workflows.

### Test Gaps
- No direct test of `savePartialProgress()` for:
  - failed lane with commits → saved branch created with expected name
  - failed lane with 0 commits → no saved branch
  - collision handling end-to-end (same SHA idempotency, different SHA suffixed name)
- No direct test of `preserveFailedLaneProgress()` for:
  - mapping failed/stalled tasks to lane branches
  - `unsafeBranches` population when save fails with commits
  - single processing per lane branch when multiple tasks share a lane

### Suggestions
- Keep the strong state-contract tests, but add a small integration block (3-5 tests) using disposable repos so branch-preservation behavior is validated at the real git boundary.
