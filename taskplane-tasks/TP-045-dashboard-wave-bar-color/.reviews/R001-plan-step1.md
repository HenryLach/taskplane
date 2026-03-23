## Plan Review: Step 1: Fix Wave Bar Segment Coloring

### Verdict: APPROVE

### Summary
The Step 1 plan is appropriately scoped for this bug and targets the correct outcome: fixing wave segment status-to-color mapping in the dashboard summary bar. The preflight discoveries correctly identify the core mismatch between wave chip phase/index logic and segmented bar completion logic. This plan should achieve the stated behavior without broadening scope beyond the frontend files.

### Issues Found
1. **[Severity: minor]** — No blocking issues found in the current plan.

### Missing Items
- None.

### Suggestions
- Explicitly mirror the segmented bar state rules to the wave chip rules (`completed`/`merging` and prior waves by index) so both UI elements stay consistent.
- During implementation verification, include at least one scenario where tasks are `succeeded` but `statusData` is missing, since that is a likely trigger for dark/uncolored segments.
