## Code Review: Step 2: Make Engine Non-Blocking

### Verdict: REVISE

### Summary
The step correctly removes `await` from `/orch` and `/orch-resume` and adds a shared async error boundary, which is the right direction. However, the launch helper still invokes the async engine function synchronously, so the handlers remain blocked through the engine’s long pre-`await` planning path. That misses the core outcome of this step: returning control to the pi session immediately.

### Issues Found
1. **[extensions/taskplane/extension.ts:711]** [important] — `startBatchAsync()` calls `engineFn()` inline. In JavaScript/TypeScript, an `async` function executes synchronously until its first `await`, so `/orch` still blocks through planning/discovery/orch-branch setup before returning. This is visible because `executeOrchBatch()`’s first `await` is much later in the function (`extensions/taskplane/engine.ts:803`), and `resumeOrchBatch()` also doesn’t hit `await` until deep in its flow (`extensions/taskplane/resume.ts:1049`). **Fix:** defer launch to the next event-loop tick (e.g., `setImmediate`/`setTimeout(0)`) and run the promise chain there; optionally set a pre-launch phase marker before scheduling to preserve concurrent-start guards.

### Pattern Violations
- Comment/behavior mismatch: the helper claims the command handler “returns immediately,” but current inline invocation does not guarantee that for async functions with heavy synchronous preambles.

### Test Gaps
- Missing regression test that `/orch` handler returns promptly even when `executeOrchBatch()` has expensive synchronous pre-`await` work.
- Missing analogous non-blocking return test for `/orch-resume`.

### Suggestions
- Keep the shared launch helper, but split responsibilities explicitly: (1) schedule detached start, (2) error boundary + terminal widget refresh.
