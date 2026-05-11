## Code Review: Step 5: Implement #503 prompt-injection regression tests

### Verdict: REVISE

### Summary
The new `segment-scope-mode-prompt.test.ts` suite is a strong start and correctly validates most FULL_TASK/SEGMENT_SCOPED prompt, env, and system-prompt contracts. Static quality checks were run (`npm run typecheck`, `npm run lint`, `npm run format:check`) and all exited successfully in this tree. However, one blocking gap remains: the polyrepo single-segment regression case does not actually verify the "proceeds beyond Step 0" behavior it claims to cover.

### Issues Found
1. **[extensions/tests/segment-scope-mode-prompt.test.ts:629-700] [important]** — Test `3.1` is intended to prove the worker advances past Step 0, but its assertions only check that the first prompt contains `Active segment ID`. Because the spawn mock globally flips **all** unchecked boxes (`content.replace(/- \[ \]/g, "- [x]")` at lines 71-78), the test can pass even if execution regresses to Step-0-only behavior.  
   **Fix:** make the mock complete only the current step’s checkbox (or otherwise force a second iteration), then assert a true beyond-step-0 signal (e.g., `capturedSpawns.length >= 2`, second prompt references Step 1 segment scope/checkboxes, or an intermediate STATUS snapshot shows Step 1 still pending after iteration 1).

### Pattern Violations
- None blocking.

### Test Gaps
- Polyrepo single-segment regression is not yet behaviorally pinned to multi-step progression.

### Suggestions
- Non-blocking style cleanup: line 71 can use optional chaining (`hostOpts.env?.TASKPLANE_STATUS_PATH`) to satisfy Biome’s `useOptionalChain` warning for this file.
