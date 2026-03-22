## Code Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The new test file is comprehensive in breadth and the suite is currently green (`cd extensions && npx vitest run` passes), but several Step 4 outcomes are validated only via source-string inspection rather than executable behavior. For this refactor, that leaves key non-blocking and event-sequencing guarantees under-tested and vulnerable to regressions that keep the same strings in source.

### Issues Found
1. **[extensions/tests/non-blocking-engine.test.ts:59-129, 464-623] [important]** — The Step 4 checks for “handler returns control quickly” and launch-window command compatibility are implemented as `readSource(...).toContain(...)` assertions on `extension.ts`, not behavioral tests. This can pass even if runtime behavior regresses (e.g., blocking synchronous work added before detach, or phase-guard logic changed but strings still present). **Fix:** add executable tests that invoke the `/orch`, `/orch-pause`, `/orch-resume`, and `/orch-abort` command handlers (or extracted testable helpers) with mocked context + fake timers, and assert actual runtime outcomes.
2. **[extensions/tests/non-blocking-engine.test.ts:362-457] [important]** — Engine transition/terminal-event coverage is also source-text based (`toContain("batch_complete")`, `toContain("wave_start")`, etc.) instead of asserting emitted events from runtime execution. This does not verify event ordering/timing or one-shot terminal semantics under real control flow. **Fix:** add behavior-level tests that run engine paths in a controlled fixture (or extracted pure helper) and assert callback/event-log sequences for wave, merge, and terminal transitions.

### Pattern Violations
- Heavy dependence on source-fragment matching for runtime behavior in Step 4’s highest-risk paths increases brittleness and weakens regression detection.

### Test Gaps
- No executable assertion that `/orch` returns before engine completion (non-blocking timing contract).
- No executable assertion that launch-window command behavior (`launching` phase) works end-to-end.
- No executable assertion of emitted engine event sequence from engine execution paths.

### Suggestions
- Keep the current source-shape assertions as secondary guardrails, but pair them with behavior tests for the contracts above.
- Use `vi.useFakeTimers()`/`advanceTimersByTimeAsync` for deterministic non-blocking timing checks.
