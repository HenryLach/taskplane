## Code Review: Step 2: Add Size Cap and Batch-Start Cleanup

### Verdict: APPROVE

### Summary
The Step 2 implementation delivers the required behavior: a named 500MB telemetry size cap with oldest-first eviction, and batch-start cleanup of prior-batch artifacts wired into the `/orch` preflight path. The integration remains non-fatal and user-visible via formatted notifications, which matches the resiliency requirements. I did not find blocking correctness issues in the new logic.

### Issues Found
None.

### Pattern Violations
- None blocking. (Note: `runPreflightCleanup`/`formatPreflightCleanup` remain stale/unused relative to the new layered flow, but this is pre-existing architectural drift and not a Step 2 correctness blocker.)

### Test Gaps
- No direct unit tests were added for `enforceTelemetrySizeCap` (especially oldest-first eviction order and partial-delete warning behavior).
- No direct unit tests were added for `cleanupPriorBatchArtifacts` (batch-ID protection and cleanup scope across telemetry/merge/sidecar/batch-dir artifacts).

### Suggestions
- Add focused unit tests for the two new cleanup helpers to lock in eviction order and current-batch protection semantics.
- Consider consolidating preflight cleanup calls through `runPreflightCleanup` (or removing stale helpers) so cleanup layering is represented in one canonical orchestration path.
