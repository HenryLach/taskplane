## Code Review: Step 2: Implement Segment Parsing

### Verdict: REVISE

### Summary
The segment parsing scaffolding is now integrated end-to-end (parser, routing-time validation, and discovery diagnostics), and it addresses the previously flagged fallback/unknown-repo handling gaps. However, one correctness issue remains in step-boundary parsing: the parser currently reads past the `## Steps` section and can attribute unrelated checklist items to the final step. That can produce incorrect `stepSegmentMap` data and mis-scope worker-visible checkboxes.

### Issues Found
1. **[extensions/taskplane/discovery.ts:418-444] [important]** — `parseStepSegmentMapping()` comments that it should parse from `## Steps` “to next ## ... or end”, but `stepsBody` is sliced to end-of-file and the last step uses `stepsBody.length` as its boundary. In task prompts that include post-steps sections with checkboxes (e.g., `## Completion Criteria`), those checkboxes are incorrectly captured under the final step segment group. This violates the Step 2/spec parsing contract and can leak non-step work into segment-scoped execution.
   **Fix:** Bound the parsed steps body to the next top-level section/divider (e.g., same section-slicing approach used elsewhere in discovery parsing), then split step sections only within that bounded block.

### Pattern Violations
- None.

### Test Gaps
- No new tests cover `stepSegmentMap` parsing behavior in this change.
- Missing regression for “post-`## Steps` checklist items are NOT included in last step mapping”.

### Suggestions
- Consider de-duplicating duplicate-segment error emission across `resolveTaskRouting()` and the post-normalization pass in `runDiscovery()` to avoid repeated diagnostics for the same step.
