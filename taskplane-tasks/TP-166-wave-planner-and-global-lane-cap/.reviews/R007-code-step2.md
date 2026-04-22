## Code Review: Step 2: Fix Global Lane Cap Enforcement

### Verdict: APPROVE

### Summary
The Step 2 changes add targeted regression coverage for the reported global lane-cap scenario and confirm current behavior of `enforceGlobalLaneCap` under both workspace-style and single-repo inputs. I also verified the enforcement hook is present in the allocation path (`waves.ts:1295`), so the immediate Step 2 outcome is satisfied. No blocking correctness issues were found in the submitted diff.

### Issues Found
1. **None blocking.**

### Pattern Violations
- None observed.

### Test Gaps
- `extensions/tests/waves-repo-scoped.test.ts:469` exercises `enforceGlobalLaneCap` directly, but does not assert the `allocateLanes()` wiring path itself. This is acceptable for this step, but an integration-level check would better guard against future accidental removal of the `waves.ts:1295` call.

### Suggestions
- In `extensions/tests/waves-repo-scoped.test.ts:508` and `:543`, consider asserting exact task ID sets (or uniqueness) rather than only `length`, so a duplicate/missing-ID regression cannot pass undetected.
