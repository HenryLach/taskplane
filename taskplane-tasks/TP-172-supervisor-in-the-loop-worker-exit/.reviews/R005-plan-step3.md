## Plan Review: Step 3: Add Escalation Handler to Supervisor

### Verdict: APPROVE

### Summary
The Step 3 plan is aligned with the current implementation state: the `worker-exit-intercept` alert category and escalation/reply wire-up were already established in Step 2, and this step focuses on supervisor-side handling/presentation. The planned work (event visibility + supervisor guidance + targeted tests) is sufficient to make the supervisor actionable when these intercept alerts arrive.

### Issues Found
1. **[Severity: minor]** — The checkbox wording references the supervisor **event tailer** significant-events list, but `worker-exit-intercept` currently travels through the supervisor-alert IPC path rather than `events.jsonl`. Suggested adjustment: ensure Step 3 explicitly validates/implements formatting on the alert-injection path (the message the supervisor agent actually receives), not only tailer formatting.

### Missing Items
- None blocking.

### Suggestions
- Add/extend a supervisor-focused test that asserts `worker-exit-intercept` alerts are rendered with the key fields (lane, task, step, unchecked items, truncated worker message, iteration, noProgressCount) in the supervisor-facing text.
- Update `extensions/tests/supervisor-alerts.test.ts` category coverage to include `worker-exit-intercept` so the new alert type remains protected against regressions.
