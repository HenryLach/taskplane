## Plan Review: Step 1: Segment-Scoped STATUS.md Viewer

### Verdict: REVISE

### Summary
The plan improved from R001 by adding explicit fallback behavior and segment-context labeling, and it keeps single-segment behavior unchanged. However, the core extraction is still scoped by repo across step sections rather than explicitly to the **current step + current segment block**. As written, it can still show extra segment blocks and miss the Step 1 requirement to show only the current segment block.

### Issues Found
1. **[Severity: important]** — The main plan item still says to keep the active repo's segment block "within each step section" (STATUS.md:22), which is broader than the required outcome in PROMPT.md:61 (only the current segment's block). This should be tightened to: resolve the active step first (from task status/telemetry), then extract only that step's matching `#### Segment: <repoId>` block.

### Missing Items
- Explicit outcome for identifying and using the **current step** when selecting the segment block (not just active `repoId`).

### Suggestions
- Keep the current fallback in place (STATUS.md:23), and include current-step parse failure in that fallback path.
- Since this directly addresses R001, note in STATUS.md that the plan now enforces current-step + repo scoping to close that loop clearly.
