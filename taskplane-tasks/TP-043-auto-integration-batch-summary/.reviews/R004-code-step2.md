## Code Review: Step 2: Batch Summary Generation

### Verdict: REVISE

### Summary
The summary formatter/file emission work is substantial and generally follows the Step 2 shape (structured markdown, Tier 0 + audit ingestion, and conversation presentation). However, the supervised integration path currently emits the batch summary **before** integration is confirmed/executed, which misses the prompt’s sequencing requirement for non-manual modes. This should be fixed before considering Step 2 complete.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:894-928; extensions/taskplane/extension.ts:1340-1357]** [important] — In `integrationMode === "supervised"`, `presentBatchSummary(...)` is called immediately after posting the integration plan, then the function returns. Since `/orch`/`/orch-resume` terminal callbacks hand control to `triggerSupervisorIntegration(...)` and return, this produces the summary *before* supervised integration happens (or even if operator declines), rather than after integration lifecycle as required.
   - **Why it matters:** Step 2 requires summary generation after integration for supervised/auto flows (manual is the batch-complete exception).
   - **Suggested fix:** Remove eager summary emission from the supervised branch and trigger summary generation after supervised integration actually completes (e.g., add a post-`/orch-integrate` hook/path that calls `presentBatchSummary(...)` and deactivates).

### Pattern Violations
- None blocking.

### Test Gaps
- No tests cover summary sequencing across terminal modes (manual vs supervised vs auto/PR lifecycle), so this regression was not caught.
- No direct tests for `readTier0EventsForBatch` + `formatBatchSummary` composition (empty/malformed events.jsonl, mixed tier0 events, recommendation output branches).

### Suggestions
- Add a focused unit test around supervised flow sequencing: assert no summary emission at plan prompt time, then summary emitted after integration completion path.
- In `presentBatchSummary`, either use the generated markdown snippet in the message or avoid binding it to an unused local (`const summary = ...`).
