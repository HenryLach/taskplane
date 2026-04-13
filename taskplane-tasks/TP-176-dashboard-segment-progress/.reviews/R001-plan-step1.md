## Plan Review: Step 1: Segment-Scoped STATUS.md Viewer

### Verdict: REVISE

### Summary
The plan is close to the required behavior and correctly targets client-side filtering plus single-segment fallback. However, it does not explicitly scope the extraction to the **current step + current segment**; it only mentions filtering by active `repoId`, which can produce incorrect output when the same repo appears in multiple steps. Tightening that outcome in the plan is necessary to reliably meet the Step 1 requirement.

### Issues Found
1. **[Severity: important]** — The plan item “determine active repoId … and filter STATUS.md to segment blocks” (STATUS.md:22) is under-specified versus the requirement to show only the **current segment’s checkbox block** (PROMPT.md:61). Filtering by repo alone can include the wrong block(s) if `#### Segment: <repoId>` appears in multiple steps. Suggested fix: explicitly scope extraction to the task’s current step section (e.g., from `statusData.currentStep`) and then select only that step’s active segment block.

### Missing Items
- Explicit fallback behavior when a multi-segment task is detected but the targeted segment block cannot be resolved in the current STATUS.md (e.g., render full STATUS.md or a clear fallback message rather than empty/incorrect content).

### Suggestions
- Reuse existing segment helpers (`taskSegmentProgress`, `segmentProgressText`) to keep viewer title context and block selection logic consistent.
- Keep filtering logic isolated in a small helper (input: raw STATUS.md + current step + active repoId; output: scoped markdown) to simplify Step 3 manual verification.
