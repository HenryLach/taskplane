## Code Review: Step 4: Persistence and supervisor alerts

### Verdict: REVISE

### Summary
This step closes the R010 plan gaps around crash-safe ordering and alert payloads: persistence/idempotency now happens before `.processed` rename, and approval alerts include before/after segment lists. However, there is a blocking persistence correctness gap for multi-request boundaries: only newly inserted segment records are synced, so rewired dependencies on previously persisted pending segments can be left stale in `segments[]`. That breaks the spec’s replay-safe persistence intent for sequential request processing at the same boundary.

### Issues Found
1. **[extensions/taskplane/engine.ts:673-738,2544-2552] [important]** — `upsertPendingExpandedSegmentRecords(...)` only updates records for `mutation.insertedSegmentIds`. With multiple approved requests on the same boundary, later rewires can change dependencies of segments persisted by earlier requests, but those existing records are never refreshed. Example: request1 inserts `X` (`X <- A`) and persists it; request2 (also `after-current` on `A`) rewires `X` to depend on `Y`, but persisted `X.dependsOnSegmentIds` remains `['A']`. Suggested fix: after each approved mutation, resync persisted dependency/state fields for all affected task segment records (at minimum existing pending records whose deps changed), not only newly inserted IDs.

### Pattern Violations
- None observed.

### Test Gaps
- Missing behavioral test for **multiple approved requests at the same boundary** asserting persisted `segments[].dependsOnSegmentIds` reflects cumulative rewiring after each sequential mutation.
- Current new tests are source-text assertions; they do not validate runtime persistence correctness for the above scenario.

### Suggestions
- Keep the crash-safe ordering implemented here (persist + request-id audit before rename); that part is solid and aligns with R010 feedback.
