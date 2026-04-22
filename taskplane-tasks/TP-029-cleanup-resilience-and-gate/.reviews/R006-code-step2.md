## Code Review: Step 2: Post-Merge Cleanup Gate

### Verdict: REVISE

### Summary
The new cleanup-gate policy extraction in `messages.ts` is a good direction, and parity between `engine.ts` and `resume.ts` is implemented consistently. However, the current gate condition is wired to fail whenever normal inter-wave reset leaves reusable worktrees in place, which can pause otherwise healthy multi-wave batches. There is also a naming mismatch with the requested `cleanup_post_merge_failed` classification.

### Issues Found
1. **[extensions/taskplane/engine.ts:656-676, extensions/taskplane/resume.ts:1430-1452] [critical]** — The cleanup gate treats any remaining registered worktree after inter-wave reset as a failure. But inter-wave flow currently uses `safeResetWorktree()` (not removal), so successful/resettable lane worktrees still remain registered by design (`extensions/taskplane/worktree.ts:1833-1841`). This means multi-wave batches can be paused even when cleanup actually succeeded.  
   **Fix:** Either (a) perform per-wave removal before gating (per Phase 2c intent), or (b) redefine gate criteria to detect only true stale/unhealthy leftovers (e.g., reset/remove failures), not all surviving reusable worktrees.

2. **[extensions/taskplane/messages.ts:387,460] [important]** — The step requirement/spec calls out `cleanup_post_merge_failed` classification, but the implementation uses `cleanup-post-merge-failed` as the persisted trigger string. This can break downstream classification matching and makes the contract ambiguous.  
   **Fix:** Align on one canonical token (`cleanup_post_merge_failed`) or add an explicit classification field separate from persistence trigger naming.

### Pattern Violations
- `extensions/tests/cleanup-resilience.test.ts` validates helper/policy behavior, but does not verify the real `executeOrchBatch`/`resumeOrchBatch` control flow outcome for multi-wave progression after successful reset.

### Test Gaps
- Missing regression test: successful wave-1 merge + reset in a 2-wave run should **not** pause and should start wave 2.
- Missing regression test: pause should happen only when cleanup leaves unrecoverable stale state (not when normal reusable worktrees remain).
- Missing assertion for canonical failure classification token in persisted state/error surface.

### Suggestions
- Add a focused integration-style test around the wave loop (engine + resume parity) to assert: `phase` transition, `persistRuntimeState` trigger, and next-wave start behavior under both pass/fail cleanup conditions.
