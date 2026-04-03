## Plan Review: Step 1: Fix the stale snapshot check

### Verdict: APPROVE

### Summary
The Step 1 plan is correctly scoped to the root cause described in PROMPT.md: stale lane snapshots from a prior task causing false `sessionAlive = false` at wave transitions. It explicitly covers the key behavioral change (taskId match check) and the likely supporting type update in `readLaneSnapshot`. This is sufficient to achieve the stated Step 1 outcome without unnecessary surface-area changes.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for this step; planned actions align with the required fix.

### Missing Items
- None.

### Suggestions
- When implementing the mismatch guard, treat missing/undefined `snap.taskId` as stale as well (same behavior as mismatch) to preserve startup-grace semantics for any older or malformed snapshot payloads.
- Add a brief inline comment in `resolveTaskMonitorState` explaining this wave-transition race, so future refactors don’t regress the logic.
