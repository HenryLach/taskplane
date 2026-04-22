## Plan Review: Step 2 — Fix task startedAt to use actual execution start

### Verdict: APPROVE

### Summary
The Step 2 plan is correctly targeted.

From the current code paths:
- `executeLane()` already captures task start with `Date.now()` at execution begin.
- The incorrect timestamp source is in `syncTaskOutcomesFromMonitor()` (`persistence.ts`), where `startTime` falls back to `snap.lastHeartbeat` (STATUS.md mtime).
- Those synced outcomes are what flow into persisted task records used by dashboard state and batch history serialization.

So the plan to fix the monitor-sync path (not lane execution) is the right approach.

### Non-blocking guardrails to keep in implementation
1. **Preserve precedence of existing startTime**  
   Keep `existing?.startTime` as the first source so we don’t overwrite a real execution start once captured.

2. **Do not reuse STATUS.md mtime for startedAt**  
   Use monitor observation time (`snap.observedAt`) as fallback, not `snap.lastHeartbeat`.

3. **Do not alter stall detection behavior**  
   `lastHeartbeat` should remain for stall logic only; this fix should not change monitoring semantics.

4. **Add focused regression tests**  
   - first-seen running task uses observation timestamp, not mtime
   - existing startTime remains stable across later monitor polls
   - pre-seeded executeLane startTime is preserved

### Conclusion
Plan is sound and aligned with TP-051 requirements for Step 2. Proceed.