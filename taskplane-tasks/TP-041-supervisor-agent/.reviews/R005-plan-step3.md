## Plan Review: Step 3: Engine Event Consumption + Notifications

### Verdict: REVISE

### Summary
The current Step 3 plan captures the high-level outcomes, but it is missing two operational safeguards that are required for correct behavior in this codebase. Because supervisor events are append-only and reused across runs, the plan needs explicit handling for batch-scoped incremental consumption. It also needs explicit tailer lifecycle handling to avoid duplicate notifications after takeover/reactivation.

### Issues Found
1. **Severity: important** — The plan does not include a batch-scoped cursor/dedup outcome for event consumption (`STATUS.md:51-53`). In this repo, events are appended to `.pi/supervisor/events.jsonl` (`extensions/taskplane/persistence.ts:1733-1735,1779-1781`) and are not cleaned during normal sidecar cleanup (`extensions/taskplane/engine.ts:1839-1843`). Without an explicit “consume only new events for the active batch” outcome, the supervisor can replay stale events from previous batches and produce incorrect proactive notifications.
2. **Severity: important** — The plan does not include event-tailer lifecycle ownership (start once on activation, stop on deactivation/yield/takeover). Step 2 introduced multiple activation paths (`/orch`, `/orch-resume`, startup takeover, `/orch-takeover`), so missing this outcome risks multiple concurrent tailers and duplicate operator notifications.

### Missing Items
- Explicit outcome: event consumer tracks last processed position (or equivalent) and filters to active `batchId` so only fresh current-batch events generate notifications.
- Explicit outcome: event tailing loop/timer is tied to supervisor lifecycle (activate/deactivate/yield) with idempotent start/stop semantics.

### Suggestions
- Add a non-blocking coalescing strategy for `task_complete` (e.g., periodic digest or wave summary), then vary digest cadence by autonomy level to satisfy “interactive more, autonomous less” without turn spam.
- Treat malformed/partial JSONL lines as best-effort (skip + continue) so notification flow cannot crash on log corruption.
