## Plan Review: Step 3: Dashboard server — include reviewer in laneStates synthesis

### Verdict: APPROVE

### Summary
The Step 3 plan covers the required outcome: it explicitly maps `snap.reviewer` into the legacy `laneStates` reviewer fields that the dashboard UI already consumes. This is the key integration point currently missing in `dashboard/server.cjs` (V2 synthesis sets `reviewerStatus: "idle"` unconditionally), so the proposed change is correctly targeted. Given Step 2 is already approved, this plan should restore reviewer sub-row visibility during active reviews.

### Issues Found
1. **[Severity: minor]** — No blocking gaps found for this step’s stated outcomes.

### Missing Items
- None.

### Suggestions
- When `snap.reviewer` is null, explicitly set reviewer fields to neutral defaults (`reviewerStatus: "idle"`, zeroed numeric fields, empty last tool) to avoid stale values if synthesis logic later reuses existing objects.
- Keep the mapping additive and legacy-compatible (do not change existing worker field keys), since `app.js` currently keys off `reviewerStatus === "running"` and `taskId` matching.