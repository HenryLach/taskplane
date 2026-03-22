## Plan Review: Step 2: Dashboard Frontend — Supervisor Panel

### Verdict: REVISE

### Summary
The Step 2 plan now covers the core frontend surfaces (status, conversation, summary, styling, render wiring, and graceful degradation) and is close to complete. However, the recovery timeline outcome is currently scoped to `actions` only, which does not fully meet the stated requirement to show both Tier 0 and supervisor actions. Without adding Tier 0 entries, the timeline will omit part of the required recovery visibility.

### Issues Found
1. **Severity: important** — Recovery timeline plan excludes Tier 0 actions.
   - Evidence: `PROMPT.md:84` requires a chronological timeline of **Tier 0 and supervisor actions**. Current plan item is “chronological list from actions array” (`STATUS.md:36`), while Step 1 already provides Tier 0 events from `events.jsonl` (`STATUS.md:25`; server payload includes `supervisor.events` in `dashboard/server.cjs:687-688`).
   - Suggested fix: Update Step 2 outcome to build the timeline from both sources (e.g., merge `supervisor.actions` + Tier 0 recovery events from `supervisor.events`), normalize timestamp/outcome fields, and sort chronologically.

### Missing Items
- Explicit Step 2 outcome to include Tier 0 recovery events in the recovery timeline (not just supervisor actions).

### Suggestions
- Consider surfacing “current activity” in the status area using the latest merged timeline/event entry to align with the mission-level visibility goal.
