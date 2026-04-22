## Plan Review: Step 3: Load and expose merge snapshots in dashboard server

### Verdict: APPROVE

### Summary
The Step 3 plan covers the key required outcomes from the prompt: loading `merge-N.json` snapshots, exposing active merger sessions via runtime registry, wiring merge telemetry into the dashboard state, and returning merge snapshots for client use. The scope is appropriately focused on `dashboard/server.cjs` and aligns with the Runtime V2 snapshot pattern already established for lanes. I also checked this against prior review context (R003/R004), and there are no carry-over blockers affecting this step’s plan.

### Issues Found
1. **[Severity: minor]** — No blocking issues found in the proposed Step 3 approach.

### Missing Items
- None.

### Suggestions
- When merging snapshot-derived telemetry into `buildDashboardState().telemetry`, prefer “fill missing or stale entries” behavior rather than unconditional overwrite, so richer live telemetry fields (if present from JSONL tailing) are not accidentally discarded.
- In `getActiveSessions()`, keep the active filter explicitly aligned to non-terminal statuses (`spawning`, `running`, `wrapping_up`) for clarity and future maintainability.
