## Plan Review: Step 3 — Thread mailbox-dir through spawn paths

### Verdict: APPROVE

### Summary
This Step 3 plan now closes the prior blocking gaps and is implementation-ready.

What’s now correct:
- `task-runner` pathing uses `getSidecarDir()` (which is already `.pi/`) + `mailbox/{batchId}/{sessionName}`, avoiding the prior `.pi/.pi/...` nesting risk.
- `spawnMergeAgent()` is planned to receive `batchId` explicitly (correct; merge session names do not encode batchId).
- `--mailbox-dir` injection is planned in both spawn paths before wrapper passthrough handling.
- Pre-spawn mailbox directory creation is included (`mkdirSync(.../inbox, { recursive: true })`).
- `ORCH_BATCH_ID` propagation is explicitly covered for Tier-0 retry/model-fallback `executeLane(...)` callsites in `engine.ts`, which was the remaining functional gap from R012.

This is sufficient to proceed.

### Notes (non-blocking)
- While touching merge spawn plumbing, consider also passing the explicit `batchId` into merge telemetry path generation (currently fallback-to-timestamp behavior can reduce traceability).
- Expect a few source-inspection tests to need string/signature updates after parameter and arg-list changes (not a design blocker).
