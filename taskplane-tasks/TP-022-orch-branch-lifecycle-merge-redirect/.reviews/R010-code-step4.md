## Code Review: Step 4: Auto-Integration and Cleanup

### Verdict: REVISE

### Summary
The Step 4 implementation is close: auto-integration logic is wired in both `engine.ts` and `resume.ts`, orch branch preservation messaging is added, and targeted tests pass (`npx vitest run tests/orch-direct-implementation.test.ts`). However, there is an important control-flow gap: integration/messaging can still run when a batch ends in non-terminal execution states (`paused`/`stopped`). That can mutate refs and emit “Batch complete” guidance when completion is explicitly suppressed.

### Issues Found
1. **[extensions/taskplane/engine.ts:781-798, 803-807] [important]** — Auto-integration and manual integration guidance run without checking terminal phase. If a batch is `paused`/`stopped` with prior successful waves, this block can still advance `baseBranch` (auto mode) or emit `orchIntegrationManual` (“Batch complete...”) even though the code immediately treats the batch as non-terminal and suppresses completion messaging.  
   **Fix:** Gate the Step 4 integration block to terminal outcomes only (e.g., `batchState.phase === "completed" || batchState.phase === "failed"`), or at minimum explicitly exclude `paused`/`stopped` before attempting integration and before emitting manual guidance.

2. **[extensions/taskplane/resume.ts:1360-1376, 1380-1382] [important]** — Same phase-gating issue exists in resume parity path. A resumed batch ending in `paused`/`stopped` can still run auto-integration/manual guidance before non-terminal suppression.  
   **Fix:** Apply the same terminal-phase gate in `resume.ts` for parity with `engine.ts`.

### Pattern Violations
- Non-terminal state handling is inconsistent: completion messaging is correctly suppressed for `paused`/`stopped`, but integration side-effects/messages are not.

### Test Gaps
- Missing regression tests asserting **no** auto-integration and **no** manual completion guidance when final phase is `paused` or `stopped` (for both engine and resume flows).

### Suggestions
- Optional maintainability improvement: deduplicate `attemptAutoIntegration` / `attemptAutoIntegrationResume` into a shared helper to reduce drift risk.
