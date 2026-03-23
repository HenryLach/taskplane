## Plan Review: Step 1: Dashboard Server — Serve Supervisor Data

### Verdict: REVISE

### Summary
The Step 1 checklist captures most server-side outcomes (lockfile/actions/events/summary + SSE + graceful degradation), but it misses one mission-critical data path and has one unresolved data-contract gap. As written, the plan can complete Step 1 checkboxes yet still fail to support the supervisor panel requirements without follow-up rework.

### Issues Found
1. **Severity: important** — Missing explicit plan outcome for supervisor conversation history serving.
   - Evidence: Mission requires conversation history in the panel (`taskplane-tasks/TP-044-dashboard-supervisor-panel/PROMPT.md:23-33`), but Step 1 plan in `STATUS.md` only covers lock/actions/events/summary (`STATUS.md:21-28`).
   - Suggested fix: Add a Step 1 outcome to expose supervisor conversation data (SSE field or dedicated API) from the supervisor conversation source, with empty/missing-file fallback.

2. **Severity: important** — The plan assumes autonomy level is available from lockfile, but current lockfile schema does not contain autonomy.
   - Evidence: Step 1 says “Read lockfile for status (active/inactive, autonomy level)” (`PROMPT.md:71`, mirrored in `STATUS.md:23`), while actual `SupervisorLockfile` fields are only `pid/sessionId/batchId/startedAt/heartbeat` (`extensions/taskplane/supervisor.ts:886-896`).
   - Suggested fix: Add an explicit outcome defining autonomy source/fallback (e.g., resolved config value, or `unknown` when not available) so the server contract is implementable and deterministic.

### Missing Items
- Explicit Step 1 outcome for serving supervisor conversation history data to the frontend.
- Explicit Step 1 outcome defining autonomy-level derivation contract (source + fallback behavior).

### Suggestions
- Consider bounding SSE supervisor timeline payloads (e.g., tail last N actions/events) to avoid unbounded payload growth during long batches.
