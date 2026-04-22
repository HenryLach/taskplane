## Code Review: Step 1: Segment-Scoped Iteration Prompt

### Verdict: REVISE

### Summary
The prompt-scoping additions are close to the Step 1 goals (repo-filtered remaining steps, segment context block, and "NOT yours" guardrail copy), and the branch is green on the current test suite. However, the current gating logic enables repo-step filtering whenever `stepSegmentMap` exists, which breaks the required legacy fallback for multi-segment tasks without explicit `#### Segment:` markers. There is also a contract violation around parsing opaque segment IDs by string splitting.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:353-365] [important]** Segment filtering is activated whenever `stepSegmentMap` exists, but discovery populates `stepSegmentMap` even when a step has no segment markers (fallback repo assignment in `extensions/taskplane/discovery.ts:465-468`). For non-packet segments in legacy multi-segment tasks, `repoStepNumbers` becomes an empty set, `remainingSteps` becomes empty, the loop exits early, and the task then fails post-loop as incomplete (`extensions/taskplane/lane-runner.ts:909-920`). This violates the Phase A legacy behavior requirement for multi-segment tasks without markers. **Fix:** gate segment filtering/prompt scoping on explicit segment-marker presence (or at minimum disable filtering when `repoStepNumbers.size === 0` and fall back to legacy unfiltered behavior).
2. **[extensions/taskplane/lane-runner.ts:82-85] [minor]** `getRepoIdFromSegmentId()` parses `segmentId` via string splitting. This conflicts with the project’s own contract that segment IDs are opaque (`extensions/taskplane/types.ts:146`). **Fix:** use structured repo identity already available on the execution unit/config (e.g., `unit.executionRepoId` / `config.repoId`) instead of parsing `segmentId`.

### Pattern Violations
- Opaque ID contract drift: `segmentId` is parsed by delimiter in lane-runner, despite the `types.ts` guidance that segment IDs should not be string-parsed.

### Test Gaps
- No targeted lane-runner test was added for the required regression case: **multi-segment task without `#### Segment:` markers** should preserve legacy behavior instead of repo-filtering to an empty step set.
- No targeted test was added asserting segment-scoped prompt content (current-segment checkboxes + "Other segments in this step (NOT yours — do not attempt)").

### Suggestions
- Add a focused unit/integration test around `remainingSteps` computation for three cases: explicit markers, no markers (legacy), and whole-task execution (`segmentId=null`).
