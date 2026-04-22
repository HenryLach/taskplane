## Code Review: Step 1: Segment-Scoped Iteration Prompt

### Verdict: REVISE

### Summary
The Step 1 changes are close: remaining-step filtering now correctly falls back when `repoStepNumbers` is empty, and the prompt includes the required segment context / guardrail wording for explicit segment steps. However, segment-scoped prompt injection is still enabled in fallback scenarios where the active repo has no segment block for the current step, which breaks the stated legacy behavior for tasks without markers. There is also a lingering opaque-ID contract drift via the new `getRepoIdFromSegmentId()` helper.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:435-487] [important]** Segment-scoped prompt text is still emitted whenever `stepSegmentMap` exists, even when this repo has no segment in the current step (`mySegment` is undefined). In legacy no-marker flows, discovery still creates `stepSegmentMap` with fallback repo segments (`extensions/taskplane/discovery.ts:465-468`), so non-owning repos get "NOT yours" instructions and "When all YOUR checkboxes..." despite having no listed checkbox block. This is not legacy-equivalent behavior and can drive premature no-work exits/stalls. **Fix:** only inject the segment-scoped prompt block when the current step has an explicit segment for `currentRepoId` (e.g., require `mySegment`), otherwise skip this block and keep legacy prompt behavior.
2. **[extensions/taskplane/lane-runner.ts:82-85] [minor]** `getRepoIdFromSegmentId()` string-splits `segmentId`, which conflicts with the `SegmentId` opaque-ID contract (`extensions/taskplane/types.ts:68-70`, `146-149`). It is currently unused, but keeping it invites future misuse. **Fix:** remove this helper or replace with structured-source access only.

### Pattern Violations
- Opaque segment ID contract drift (introducing a parsing helper that splits `segmentId` by delimiter).

### Test Gaps
- Missing regression test for **multi-segment task without `#### Segment:` markers** ensuring prompt content remains legacy (no segment-scoped "NOT yours" block when repo has no mapped segment).
- Missing test that segment-scoped prompt block appears only when current step contains the active repo segment.

### Suggestions
- Add a small prompt-construction helper that returns `{ mySegment, otherSegments, shouldScope }` to centralize gating logic and avoid future regressions.
