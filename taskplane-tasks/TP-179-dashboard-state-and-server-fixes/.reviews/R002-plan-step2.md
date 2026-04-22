## Plan Review: Step 2: Add description column to supervisor recovery actions (#497)

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the stated outcome for #497: surfacing `context`/`detail` so recovery actions are no longer just short action labels. It correctly scopes work to the dashboard server/client path and includes truncation + full-text visibility behavior, which addresses usability without changing JSONL format contracts. I don’t see any blocking gaps that would prevent this step from succeeding.

### Issues Found
1. **[Severity: minor]** — In current code, recovery actions render as a timeline (`renderSupervisorActions` in `dashboard/public/app.js`), not a table. Keep the plan’s intent (show description field), but implement it in the existing timeline UI unless there is explicit product intent to switch to a table layout.

### Missing Items
- None that block Step 2 outcomes.

### Suggestions
- The server already appears to return raw supervisor action objects from `actions.jsonl`; confirm before adding redundant mapping logic in `dashboard/server.cjs`.
- Use a clear precedence for description text (e.g., `context` → `detail` → existing `reason/message`) so both supervisor actions and Tier 0-derived timeline entries remain informative.
- Ensure description text is escaped and full text is accessible via `title` (or expand affordance) when truncated.
