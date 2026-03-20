## Code Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The new TP-031 tests are a good start and they run green, but Step 4 still has important coverage gaps against the prompt requirements. In particular, force-resume diagnostics flow is not tested at runtime, and one merge-parity test does not actually assert the ordering guarantee it describes. Please tighten these cases before marking Step 4 complete.

### Issues Found
1. **[extensions/tests/merge-failure-phase.test.ts:124-128] [important]** — The resume parity test calculates `preCleanupIdx` and `cleanupIdx` but never asserts ordering.
   - Impact: the test passes even if pre-cleanup preservation logic is moved past destructive cleanup logic.
   - Fix: assert ordering against a real cleanup-action anchor (e.g., first `removeAllWorktrees(` / `preserveFailedLaneProgress(` occurrence), not just presence.

2. **[extensions/tests/force-resume.test.ts:4-7,95-192] [important]** — Coverage only validates `parseResumeArgs()` and `checkResumeEligibility()`; it does not test the real `resumeOrchBatch()` force flow.
   - Impact: TP-031’s required behavior (force resume from `failed`/`stopped` gated by diagnostics, plus `resilience.resumeForced` mutation) can regress without detection.
   - Fix: add runtime-path tests for `resumeOrchBatch()` that cover diagnostics pass/fail and verify `resumeForced` is set only after successful forced resume.

3. **[extensions/tests/merge-failure-phase.test.ts:5-7,157-164] [important]** — The file claims to verify `failedTasks === 0 -> phase = "completed"`, but no test actually validates that engine/resume finalization transition.
   - Impact: success-path phase regression could slip through while tests still pass.
   - Fix: add explicit assertions for the completed branch in both engine and resume finalization logic (source-parity or behavior-level test).

### Pattern Violations
- `taskplane-tasks/TP-031-force-resume-and-diagnostics/STATUS.md` still contains duplicated review rows/log entries.

### Test Gaps
- Missing forced-resume diagnostics gate tests (pass/fail) on `resumeOrchBatch`.
- Missing assertion that force intent (`resilience.resumeForced`) is persisted only on successful forced resume.
- Missing explicit test for finalization success path (`failedTasks===0` => `completed`) parity in engine + resume.

### Suggestions
- Keep the deterministic report assertions; those are solid.
- Add one compact integration-style test per critical TP-031 contract to reduce reliance on source-string pattern checks.
