## Code Review: Step 1: Add merge snapshot infrastructure

### Verdict: APPROVE

### Summary
`git diff 7230c325d0af1ac763e5cba7f6cb1f5347e07796..HEAD` is empty (HEAD equals the provided baseline), so there are no new changes in this review range. I still spot-checked the target files and confirmed Step 1 outcomes are present in the current code: `RuntimeMergeSnapshot` + `runtimeMergeSnapshotPath()` in `extensions/taskplane/types.ts`, and `writeMergeSnapshot()`/`readMergeSnapshot()` in `extensions/taskplane/process-registry.ts`. The infrastructure requested by Step 1 is implemented and aligned with the task prompt.

### Issues Found
1. **None blocking.**

### Pattern Violations
- None identified.

### Test Gaps
- No Step 1-specific tests were added for merge snapshot read/write helpers. This is not blocking for this step, but direct unit coverage would improve regression resistance.

### Suggestions
- For future reviews, use a baseline commit before Step 1 (e.g. `7230c325^`) so the code delta for this step is visible in the requested diff range.
