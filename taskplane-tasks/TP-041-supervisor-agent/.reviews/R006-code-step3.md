## Code Review: Step 3: Engine Event Consumption + Notifications

### Verdict: APPROVE

### Summary
The Step 3 implementation delivers the core outcomes: it introduces a batch-scoped JSONL tailer, ties tailer lifecycle to supervisor activation/deactivation, and formats proactive notifications for significant engine/tier0 events with digest coalescing for task-level noise. The cursor/partial-line handling and batch filtering are solid for the append-only event stream model used in this project. I found no blocking correctness issues for this step.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:1336] [minor]** — In `autonomous` mode, completion digests are still emitted on the same cadence as other modes (`TASK_DIGEST_INTERVAL_MS`), which can remain chatty during high-throughput waves. Consider suppressing completion-only digest lines in autonomous mode (keep failed/exhausted signals), or using a longer digest interval for autonomous.

### Pattern Violations
- None identified.

### Test Gaps
- No automated coverage yet for event tailer cursor behavior (`byteOffset` + `partialLine`) across incremental reads.
- No coverage yet for batch-scoped filtering when foreign-batch events are interleaved in `.pi/supervisor/events.jsonl`.
- No coverage yet for autonomy-specific notification volume (interactive/supervised/autonomous).

### Suggestions
- Add focused unit tests for `readNewBytes`, `parseJsonlLines`, and `processEvents` as pure functions to lock in edge-case behavior.
- Add an integration-style supervisor test for lifecycle idempotency: activate → deactivate → activate (plus takeover) should produce a single active tailer and no duplicate notifications.
