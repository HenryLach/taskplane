## Plan Review: Step 1: Plan the cleanup strategy per error category

### Verdict: APPROVE

### Summary
This revised Step 1 plan is strong and now addresses the blocking gap from R001: behavior-affecting fixes are explicitly tagged, documented in an escalation register, and gated pending operator response. The per-category strategy is concrete, anti-shortcut policy is clear, and the source-first/test-second sequencing is justified by dependency flow. The helper-factory decision for config mocks is also sufficiently specific to guide consistent Step 4 execution.

### Issues Found
1. **[Severity: minor]** — No blocking issues identified for this step.

### Missing Items
- None.

### Suggestions
- When Step 3 starts, keep the `behavior-affecting (escalate)` tags mirrored in hydrated checkboxes so code reviews can trivially verify gated items were not applied prematurely.
- In the helper implementation, add a short comment referencing the canonical config type/default source to reduce future drift.
