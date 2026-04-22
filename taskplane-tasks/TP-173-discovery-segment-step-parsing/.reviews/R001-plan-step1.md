## Plan Review: Step 1: Add Types

### Verdict: APPROVE

### Summary
The Step 1 plan directly covers all required outcomes from PROMPT.md for the type-layer change: introducing `SegmentCheckboxGroup`, `StepSegmentMapping`, and the optional `stepSegmentMap` on `ParsedTask` for backward compatibility. The scope is appropriately narrow for this step and aligns with spec A.1/A.10 without overreaching into parser behavior (Step 2). This plan should successfully enable downstream implementation work.

### Issues Found
1. **[Severity: minor]** None blocking.

### Missing Items
- None.

### Suggestions
- When implementing, keep the new interfaces exported in `types.ts` near `ParsedTask` so discovery/lane-runner consumers can import consistently.
- In the targeted test run, include at least one discovery test file to catch any accidental type-contract regressions in `ParsedTask` usage.
