## Code Review: Step 2: Make Engine Non-Blocking

### Verdict: REVISE

### Summary
The `/orch` and `/orch-resume` handlers were correctly converted to fire-and-forget launch paths with a shared rejection boundary, and widget updates remain callback-driven. However, the current launcher still invokes the engine synchronously, so command handlers continue to block during the engine’s synchronous planning phase. This means the step’s core “returns immediately / session stays interactive” outcome is not fully achieved yet.

### Issues Found
1. **[extension.ts:711] [important]** — `startBatchAsync()` calls `engineFn()` immediately on the command handler stack. Since `executeOrchBatch()` performs substantial synchronous work before its first `await` (planning/discovery/wave setup in `engine.ts:532-803`), `/orch` still blocks until that point. **Fix:** detach engine start to the next tick/microtask (e.g., `setImmediate`, `setTimeout(..., 0)`, or `Promise.resolve().then(engineFn)`), then keep the existing `.then/.catch` finalization boundary.

### Pattern Violations
- None observed.

### Test Gaps
- Missing a behavior test that asserts `/orch` handler returns before planning work begins (or within a strict latency budget) to prove true non-blocking launch semantics.

### Suggestions
- Consider renaming `startBatchAsync` to `startEngineAsync` since it is now used for both fresh runs and resume.
- I ran targeted checks: `cd extensions && npx vitest run tests/workspace-config.test.ts tests/orch-direct-implementation.test.ts` (pass).
