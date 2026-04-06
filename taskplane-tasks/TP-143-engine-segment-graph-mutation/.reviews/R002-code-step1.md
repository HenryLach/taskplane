## Code Review: Step 1: Outbox consumption at segment boundaries

### Verdict: REVISE

### Summary
The implementation adds the right boundary hooks for scanning agent outboxes and handling malformed/discard flows, but two core Step 1 outcomes are not fully met yet. In particular, valid requests are only logged (not actually consumed/handed off for boundary processing), and failed-segment discard currently targets all matching files in the lane outbox without scoping to the originating task/segment. These gaps can cause incorrect behavior as soon as multiple tasks/segments share the same lane agent outbox.

### Issues Found
1. **[extensions/taskplane/engine.ts:1987-1997] [important]** — Valid requests are sorted but only logged as "queued for processing"; no processing handoff is performed at the segment boundary. This means Step 1’s "process valid requests in requestId order" outcome is not actually implemented yet, and `.json` requests can remain pending indefinitely. **Fix:** invoke a real per-request boundary processing path (even if mutation logic is still a stub), or at minimum mark this step incomplete until the sorted iteration performs concrete request handling.
2. **[extensions/taskplane/engine.ts:2030-2035] [important]** — Failed-segment handling renames *all* `segment-expansion-*.json` files in the worker outbox to `.discarded` without checking request ownership (`taskId` / `fromSegmentId`). Because worker agent IDs are lane-scoped, this can discard unrelated pending requests from another task/segment executed on the same lane. **Fix:** parse and scope discard to requests whose `taskId` and `fromSegmentId` match the failing boundary; leave unrelated requests untouched.
3. **[extensions/taskplane/engine.ts:194] [minor]** — Parser accepts `requestedRepoIds: []`, but spec/schema marks it as required non-empty. This should be treated as malformed and renamed `.invalid`. **Fix:** require `candidate.requestedRepoIds.length > 0` in `parseSegmentExpansionRequestPayload`.

### Pattern Violations
- None beyond the correctness issues above.

### Test Gaps
- No Step 1-focused tests were added for:
  - malformed request rename to `.invalid`
  - failed-segment discard behavior + alert emission
  - deterministic `requestId` ordering
  - outbox scoping by originating task/segment

### Suggestions
- Consider splitting boundary logic into a dedicated helper (e.g., `consumeSegmentExpansionOutboxAtBoundary`) to keep lifecycle loop readability and make stepwise test coverage easier.
