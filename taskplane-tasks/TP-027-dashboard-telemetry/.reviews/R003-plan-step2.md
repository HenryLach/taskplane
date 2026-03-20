## Plan Review: Step 2: Dashboard Frontend — Display Telemetry

### Verdict: REVISE

### Summary
The Step 2 checklist captures the required UI outcomes at a high level, but it is still underspecified on key merge/accuracy behaviors that were introduced in Step 1. In particular, the plan does not yet lock in how frontend rendering should combine `laneStates` and `telemetry`, and it does not define scenario-level verification for retry/compaction transitions. Tightening these outcome-level items will make implementation deterministic and avoid telemetry regressions.

### Issues Found
1. **[Severity: important]** — Metric source precedence is not explicit in the Step 2 plan. `STATUS.md:39-43` lists UI goals, but does not define merge rules between existing lane-state stats and new telemetry payloads, even though prior findings call this out (`STATUS.md:84-86`) and the frontend currently reads only lane-state (`dashboard/public/app.js:388,436`). Add an explicit outcome: lane-state remains primary for existing metrics, telemetry supplements retries/compactions and acts as fallback only when lane-state is missing.
2. **[Severity: important]** — Batch cost display behavior is underspecified relative to Step 1 server contract. The server now publishes `batchTotalCost` (`dashboard/server.cjs:493-496,513-514`), while frontend summary currently recomputes cost from `laneStates` only (`dashboard/public/app.js:344-352`). Add a plan outcome to render batch cost from `currentData.batchTotalCost` (with backward-compatible fallback) so Step 2 reflects telemetry-inclusive totals required by `PROMPT.md:78`.
3. **[Severity: important]** — Verification intent is too generic for the new dynamic indicators. Step 3 currently has broad checks (`STATUS.md:50-53`) but no explicit scenarios for `retryActive` on/off transitions, compaction badge threshold (`>0`), and lanes with no telemetry (`"—"` fallback from `PROMPT.md:79-82`). Add scenario-level test intent so Step 2 behavior can be confidently validated.

### Missing Items
- Explicit UI placement/visibility rule for retry + compaction indicators (e.g., lane header vs worker-stats row, running-only vs persisted after completion).
- Backward-compatibility note that dashboard should continue working when `telemetry`/`batchTotalCost` are absent (older server payloads).

### Suggestions
- Keep telemetry styling additive to the existing `worker-stats` pattern in `dashboard/public/style.css` instead of introducing a new dominant row.
- Document the frontend merge contract briefly in `STATUS.md` Notes before implementation so Step 2 and Step 3 stay aligned.
