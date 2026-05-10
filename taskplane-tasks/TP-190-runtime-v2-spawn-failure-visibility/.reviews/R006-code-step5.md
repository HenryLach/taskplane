## Code Review: Step 5: Add behavioral regression test

### Verdict: REVISE

### Summary
The new test file is thorough for `executeLaneV2` catch behavior and correctly updates exit-classification coverage, and the isolated test suite passes locally. However, the step’s required regression coverage is still not met at the engine/batch level: key assertions for retry-guard wiring, alert emission, and phase transition are implemented as source-text checks or helper-only simulations rather than runtime orchestration behavior. This leaves the original #561 failure surface only partially protected.

### Issues Found
1. **[extensions/tests/spawn-failure-visibility.test.ts:25-34, 481-570] [important]** — The test explicitly relies on “Source-string + structural coverage” for core requirements (retry guard, `task-failure` payload wiring, phase transition), then validates via `readFileSync(...engine.ts/resume.ts/execution.ts)` + `toContain(...)`. This can pass even if runtime code paths regress (dead branch, changed call-site, unreachable logic). **Fix:** replace these checks with at least one runtime orchestration-path test that executes wave/batch flow and asserts emitted behavior, not source text.
2. **[extensions/tests/spawn-failure-visibility.test.ts:596-663] [important]** — The “integrated” scenario still bypasses engine execution: it runs `executeLaneV2` directly, fabricates `waveResult`, and manually applies helper functions. It does not prove the required one-task batch behavior (`failedTasks === 1`, `task-failure` IPC alert emission, and `phase !== "executing"` after poll loop) through actual engine control flow. **Fix:** add a focused engine-level regression test (mocking spawn helper/runner) that drives real post-wave handling and asserts failure aggregation + alert callback payload + terminal phase.

### Pattern Violations
- Overuse of source-string assertions for behavior that should be runtime-asserted.

### Test Gaps
- Missing runtime assertion that `executeOrchBatch`/wave handling emits `task-failure` IPC alert with `context.exitCategory === "spawn_failure"`.
- Missing runtime assertion that a single-task spawn failure increments failed-task aggregation (`failedTasks === 1`) in engine-level results.
- Missing runtime assertion that batch phase exits `"executing"` via actual engine wave loop, not helper simulation.

### Suggestions
- Keep the current `executeLaneV2` behavioral checks; they are valuable and can remain as lower-level regression guards once engine-level behavioral coverage is added.
- Quality-check pipeline discovery: no `.pi/taskplane-config.json` (or legacy task-runner config) was present in this worktree, and root `package.json` has no `typecheck`/`lint`/`format:check` scripts, so no static quality commands were runnable.
