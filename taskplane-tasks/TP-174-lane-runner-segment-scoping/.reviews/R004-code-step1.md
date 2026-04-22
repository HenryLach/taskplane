## Code Review: Step 1: Segment-Scoped Iteration Prompt

### Verdict: APPROVE

### Summary
The Step 1 implementation now addresses the previously blocking issues: repo identity is taken from structured config (`config.repoId`) instead of parsing opaque `segmentId`, remaining-step filtering correctly falls back when no repo-scoped steps are found, and segment-scoped prompt injection is gated to cases where the current step contains the active repo segment. I also ran the extensions test suite locally (`node --test tests/*.test.ts` with project flags), and it passes. The current changes are sufficient to achieve Step 1 outcomes without blocking defects.

### Issues Found
1. **None blocking.**

### Pattern Violations
- None observed in this diff.

### Test Gaps
- No new targeted lane-runner assertions were added for this behavior in this step. Consider adding explicit tests for: (a) segment-scoped prompt injection when `mySegment` exists, and (b) legacy fallback when `repoStepNumbers` is empty.

### Suggestions
- `extensions/taskplane/lane-runner.ts` currently computes `totalStepsForRepo` in the segment prompt block but does not use it; removing or using it would reduce dead locals/noise.
- If desired for readability, prefix listed segment checkboxes with `- [ ]` in prompt text to mirror STATUS/PROMPT conventions.
