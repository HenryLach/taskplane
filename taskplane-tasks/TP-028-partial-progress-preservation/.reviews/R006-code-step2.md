## Code Review: Step 2: Record Partial Progress in Task Outcome

### Verdict: REVISE

### Summary
The Step 2 wiring is mostly in place: partial-progress fields were added to outcome/persisted types, stamped at all preserve call sites, and serialized into batch state. I also ran the test suite (`cd extensions && npx vitest run`), and all tests passed (24 files, 955 tests). However, there is a contract mismatch between outcome typing, serialization, and persisted-state validation that can make a saved state unloadable if `partialProgressBranch` is set to `null`.

### Issues Found
1. **[extensions/taskplane/types.ts:563, extensions/taskplane/persistence.ts:568, extensions/taskplane/persistence.ts:798] [important]** — `LaneTaskOutcome.partialProgressBranch` is typed as `string | null`, but persisted validation only accepts `string | undefined`. `serializeBatchState()` currently writes the field whenever it is not `undefined`, so a `null` value will be serialized and then rejected by `validatePersistedState()` on resume. **Fix:** unify the contract end-to-end: either (a) remove `null` from `LaneTaskOutcome` and normalize to `undefined`, or (b) allow `null` in `PersistedTaskRecord` + validation and handle it consistently during serialization/resume.

### Pattern Violations
- Inconsistent schema contract across in-memory outcome type vs persisted-state validator for the same field (`partialProgressBranch`).

### Test Gaps
- Missing regression test for `LaneTaskOutcome.partialProgressBranch = null` round-trip through `serializeBatchState()` + `validatePersistedState()`.
- Missing persistence/resume round-trip test for both cases: no partial progress (absent/default values) and preserved partial progress (commit count + saved branch present).

### Suggestions
- Consider persisting state immediately after `applyPartialProgressToOutcomes(...)` at inter-wave checkpoints to reduce crash-window loss of these diagnostics.
