## Plan Review: Step 2: Engine validation

### Verdict: REVISE

### Summary
The Step 2 plan captures the five core validation checks, but it currently omits two required Step 2 outcomes from the task prompt: explicit rejection handling and explicit success handoff to mutation. As written in `STATUS.md`, the step could finish with checks implemented but without the required `.rejected` lifecycle + supervisor alert path.

### Issues Found
1. **[Severity: important]** — `STATUS.md` Step 2 only lists validation predicates (`Repo existence`, `Cycle detection`, `Task not terminal`, `Placement valid`, `Idempotency guard`) and does not include the required failure/success outcomes from `PROMPT.md` Step 2: on validation failure rename request to `.rejected` and emit `segment-expansion-rejected`, and on validation success proceed to graph mutation (`PROMPT.md:86-88`, `STATUS.md:34-38`). Suggested fix: add explicit Step 2 outcome items for both failure and success paths so this step is complete against prompt requirements.

### Missing Items
- Add explicit Step 2 outcome: **validation failure → rename file to `.rejected` + emit `segment-expansion-rejected` alert**.
- Add explicit Step 2 outcome: **validation success → invoke/continue graph-mutation path**.
- Add explicit Step 2 test intent for validation branches (at least one reject-path and one accept-path smoke for boundary processor).

### Suggestions
- Keep the Step 2 implementation centered in the existing `processSegmentExpansionRequestAtBoundary(...)` handoff path added in Step 1, so ordering/scoping guarantees from R003 remain intact.
- Consider validating that request `edges` are consistent with requested repos before cycle checks, to produce clearer rejection reasons and avoid ambiguous mutation-time failures.
