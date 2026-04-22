## Code Review: Step 1: Add Types

### Verdict: APPROVE

### Summary
The Step 1 code changes correctly add the new segment-step typing contracts from the specification: `SegmentCheckboxGroup`, `StepSegmentMapping`, and optional `ParsedTask.stepSegmentMap` for backward compatibility. The additions are additive and do not alter existing runtime behavior or break existing contracts. I also ran targeted discovery tests, and they pass.

### Issues Found
1. None.

### Pattern Violations
- None observed.

### Test Gaps
- None blocking for this step (type-only additive change).
- Validation run: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/discovery*.test.ts` (pass).

### Suggestions
- Optional: when implementing Step 2, include at least one focused unit test that asserts `stepSegmentMap` shape directly to lock the new contract.
