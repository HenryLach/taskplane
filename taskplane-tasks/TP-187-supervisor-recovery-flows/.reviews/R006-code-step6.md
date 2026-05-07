## Code Review: Step 6: Testing & Verification

### Verdict: REVISE

### Summary
The callback-threading defects called out in R005 appear to be addressed (lane-terminated/lane-respawned are now wired through engine-worker, execute/resume paths, and extension suppression handling), and the targeted TP-187 test set I ran passes. However, one blocking requirement from the task scope is still missing: the hard-fail termination path in `engine.ts` does not perform the synchronous outbox drain. Without that drain, stale mailbox artifacts from hard-failed lanes can remain pending and be rediscovered later.

### Issues Found
1. **[extensions/taskplane/engine.ts:3061-3125] [important]** — The hard-fail lane-termination path emits `task-failure` and `emitLaneTerminated(...)`, but never calls `drainAgentOutbox(...)`. TP-187 explicitly requires synchronous drain at **both** termination decision points (no-progress kill in lane-runner and hard-fail in engine). As implemented, hard-failed lanes can leave pending outbox files behind, which undermines the recovery-flow guarantee.  
   **Fix:** import/use `drainAgentOutbox` in `engine.ts` and invoke it in this hard-fail block (best-effort, non-throwing), keyed by the resolved worker agent id for the failed task, before final termination signaling.

### Pattern Violations
- None.

### Test Gaps
- `supervisor-recovery-flows.test.ts` validates no-progress drain and callback wiring, but there is no behavioral test asserting that a **hard-fail** lane in `engine.ts` drains its outbox.

### Suggestions
- Add one focused test that simulates a hard-fail outcome and asserts pending outbox artifacts are moved/marked drained.
- Quality-check pipeline note: no project-configured `typecheck`/`lint`/`format:check` commands were found (`.pi/taskplane-config.json` absent, no relevant `package.json` scripts), so static quality gates were not runnable in this review.
