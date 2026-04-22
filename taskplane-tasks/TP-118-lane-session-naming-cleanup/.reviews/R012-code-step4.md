## Code Review: Step 4: Remove aliases

### Verdict: REVISE

### Summary
The Step 4 refactor is mostly clean: aliases were removed from core types and runtime code, and persistence ingress normalization now canonicalizes to `laneSessionId` while dropping `tmuxSessionName`. However, one compatibility path was dropped too aggressively: the dashboard reads `.pi/batch-state.json` directly (without `validatePersistedState()` normalization) and now no longer tolerates tmux-only lane records. That violates the task’s backward-compatibility requirement for legacy persisted state files.

### Issues Found
1. **[dashboard/server.cjs:71-74, 524-526, 1023-1026; dashboard/public/app.js:520-524] [important]** — Legacy `tmuxSessionName` compatibility is broken in dashboard ingress paths. `loadBatchState()` returns raw JSON, but downstream code now uses only `lane.laneSessionId` (no fallback), so tmux-only lane records from older `batch-state.json` files yield missing/undefined lane session keys. This breaks lane-state/telemetry attribution and can render invalid attach/view targets in the UI. **Fix:** normalize lane records at dashboard ingress (`loadBatchState`) by mapping `tmuxSessionName -> laneSessionId` (canonical shape), or keep a narrowly-scoped fallback in dashboard-only ingest/render paths.

### Pattern Violations
- Compatibility is intended to be ingress-only normalization. Dashboard is an ingress path for persisted state but currently bypasses normalization and assumes canonical fields.

### Test Gaps
- No dashboard regression coverage for legacy state files where lane records include only `tmuxSessionName`.
- Add a server-side test (or lightweight fixture-driven check) ensuring dashboard state payload always has canonical `laneSessionId` after loading old state JSON.

### Suggestions
- After fixing dashboard ingress normalization, add a one-line status note with post-step grep counts and explicitly note that dashboard legacy ingest is covered, to make Step 4 completion auditable.