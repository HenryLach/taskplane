## Plan Review: Step 1: Plan the API + visual design

### Verdict: REVISE

### Summary
The plan is strong on API verification and overall UX direction: it correctly identifies that `batch.segments[]`, `task.segmentIds`, and `runtimeLaneSnapshots[*].segmentId` already provide the needed data, and the pill-row concept is a good fit for the operator visibility gap in #464. However, the responsive behavior section conflicts with current dashboard CSS, so the proposed placement would not satisfy the step’s narrow-viewport requirement as written. Resolve that layout mismatch before implementation.

### Issues Found
1. **[Severity: important]** — The plan places the new segment pills inside `.task-step` (STATUS.md Design Plan §2), but the current responsive rule hides that entire cell at narrow widths: `.task-row .task-step { display: none; }` under `@media (max-width: 900px)` (`dashboard/public/style.css:1240`). That means the indicators disappear entirely on mobile/narrow viewports, contradicting §5’s “wrap/degrade gracefully” intent and the Step 1 requirement to account for responsive behavior. **Suggested fix:** choose a render location that remains visible at narrow widths (e.g., subtitle-style row spanning cols 3–6), or explicitly update responsive CSS so the segment row remains visible with truncation/wrapping.

### Missing Items
- An explicit responsive contract for `<=900px` (what exactly stays visible, what wraps, what can be truncated/hidden) that aligns with existing media-query behavior.

### Suggestions
- Since Step 0 already confirmed no server/API changes are needed, tighten Step 2 wording to “verify and consume existing API segment fields” to avoid implying backend edits.
