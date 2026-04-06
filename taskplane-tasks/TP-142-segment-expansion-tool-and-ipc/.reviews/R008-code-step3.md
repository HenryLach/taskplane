## Code Review: Step 3: Request file writing

### Verdict: APPROVE

### Summary
Step 3’s code changes satisfy the requested outcomes: request files are written atomically and the outbox path resolution now aligns with the mailbox contract (`.pi/mailbox/{batchId}/{agentId}/outbox`) when batch/agent env context is available. The new targeted test covers the accepted path end-to-end (ack response, file presence, schema fields, and no leftover `.tmp` file). I also re-ran the targeted test file successfully.

### Issues Found
1. **None (blocking)** — I did not find correctness issues that would prevent Step 3 outcomes from being achieved.

### Pattern Violations
- None identified.

### Test Gaps
- No explicit test currently exercises the ORCH-derived mailbox path fallback (`ORCH_BATCH_ID` + `TASKPLANE_AGENT_ID`) when `TASKPLANE_OUTBOX_DIR` is unset.
- No explicit failure-path test forces write/rename failure to verify temp-file cleanup behavior under I/O error conditions.

### Suggestions
- Add one focused unit test for path derivation precedence: `TASKPLANE_OUTBOX_DIR` override vs mailbox fallback from batch/agent env.
- Add one failure-injection test around `writeSegmentExpansionRequest()` (or equivalent seam) to confirm `.tmp` cleanup on exceptions.