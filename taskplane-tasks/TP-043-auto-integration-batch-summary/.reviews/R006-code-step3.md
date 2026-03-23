## Code Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The new `auto-integration.test.ts` suite is extensive and all tests pass locally (`49 files / 2109 tests`). However, several Step 3 outcomes from `PROMPT.md` are not actually verified by deterministic behavior tests yet. As written, this can report Step 3 complete while missing required coverage for core integration paths.

### Issues Found
1. **[extensions/tests/auto-integration.test.ts:169-190] [important]** — `buildIntegrationPlan` “coverage” does not test planning logic (protected/unknown → PR, linear → ff, diverged → merge); it only validates null guards and a hand-constructed object shape.  
   **Fix:** Add deterministic tests that exercise real `buildIntegrationPlan` branches (e.g., temp git repo for merge-base cases + controlled/mocked branch-protection responses).

2. **[extensions/tests/auto-integration.test.ts:497-533] [important]** — Auto-mode tests are non-deterministic/vacuous for the main requirement “integration executed without asking.” `12.2` accepts multiple unrelated outcomes, and `12.3` only asserts deactivation, so they can pass even when integration is never executed.  
   **Fix:** Force a known non-null plan path and assert executor call order, sent message type/content, and no confirmation prompt (`triggerTurn: false`) for auto mode.

3. **[taskplane-tasks/TP-043-auto-integration-batch-summary/STATUS.md:47-54] [important]** — Step 3 is marked complete, but required PROMPT outcomes are still missing from verified tests (manual-mode `/orch-integrate` guidance and branch-protection-detected default-to-PR behavior).  
   **Fix:** Add explicit tests for those two outcomes, then keep Step 3 marked complete.

### Pattern Violations
- Heavy reliance on source-string assertions for behavior-critical paths that are testable via dependency control; this reduces regression detection quality for runtime behavior.

### Test Gaps
- `batch_complete` in **manual** mode → operator is told to run `/orch-integrate`.
- Branch protection detected (or unknown protection fallback) → integration defaults to **PR** mode.
- Deterministic auto-mode execution path asserting integration runs (not just supervisor deactivation).

### Suggestions
- Consider extracting a small planning dependency layer (or injectable shell runner) so `detectBranchProtection`/`buildIntegrationPlan` can be tested without brittle source inspection.
