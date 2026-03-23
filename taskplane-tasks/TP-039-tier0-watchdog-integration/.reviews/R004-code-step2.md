## Code Review: Step 2: Tier 0 Event Logging

### Verdict: REVISE

### Summary
The Step 2 implementation adds a solid event-writing utility and broad instrumentation across worker-crash, stale-worktree, cleanup-gate, and merge retry paths. However, the emitted schema and merge-attempt logging behavior do not fully match the PROMPT requirements, so the resulting event stream is incomplete/inaccurate for supervisor consumption. A small follow-up pass on payload shape and merge attempt emission logic is needed before this step can be considered complete.

### Issues Found
1. **[extensions/taskplane/persistence.ts:1648] [important]** `Tier0Event` does not include required `repoId` (and no attempt-time timeout/cooldown field), so events cannot satisfy the Step 2 schema requirement.
   - Requirement mismatch: `PROMPT.md:82-85` requires attempt events to include timeout and all events to include `timestamp, batchId, waveIndex, laneNumber, repoId`.
   - Current shape has optional `laneNumber` and no `repoId`/timeout field.
   - **Fix:** Extend `Tier0Event` with `repoId` and `timeoutMs` (or `cooldownMs`) fields, then populate them at all emit sites. For wave-scoped events, use explicit `null` values if needed to keep schema stable.

2. **[extensions/taskplane/engine.ts:1098-1108] [important]** Merge retry `tier0_recovery_attempt` is emitted before retry eligibility is computed, with hardcoded/incorrect metadata (`attempt: 1`, `maxAttempts: 2`, `classification: mergeResult.status`).
   - This logs an "attempt" even when `applyMergeRetryLoop()` returns `no_retry`, and uses `failed|partial` instead of retry classification (`git_lock_file`, etc.).
   - **Fix:** Emit merge attempt events only when a retry is actually performed, and source `attempt/maxAttempts/classification/timeout` from the retry decision used by `applyMergeRetryLoop` (e.g., via callback hooks or returned telemetry).

### Pattern Violations
- Step outcome contract drift from `PROMPT.md:82-85`: required per-event context (`repoId`, timeout/cooldown on attempts) is not consistently represented in the serialized event payload.

### Test Gaps
- No tests currently validate `.pi/supervisor/events.jsonl` creation, JSONL append behavior, or event schema fields for each Tier 0 pattern.
- No test covers the merge `no_retry` path to ensure no false `tier0_recovery_attempt` event is emitted.

### Suggestions
- `affectedTaskIds` is populated with worktree paths in cleanup-gate exhaustion (`extensions/taskplane/engine.ts:1510`, `:1538`), which is semantically confusing; consider a separate `affectedWorktreePaths` field or map paths back to task IDs when possible.
- Add a focused `extensions/tests/tier0-watchdog.test.ts` with fixture-level assertions for attempt/success/exhausted event payloads and ordering.
