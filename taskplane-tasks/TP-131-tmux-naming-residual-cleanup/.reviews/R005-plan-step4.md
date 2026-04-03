## Plan Review: Step 4: Audit script expansion

### Verdict: APPROVE

### Summary
The Step 4 plan is aligned with the PROMPT requirements for audit coverage expansion and includes both required outcomes: adding `skills/` to scan roots and adjusting the guard test. This is a low-risk, deterministic change that fits the current task scope and should integrate cleanly with the existing audit contract. The plan granularity is appropriate for this small step.

### Issues Found
1. **[Severity: minor]** — The checklist says “Update guard test if needed,” but in the current code it is needed: `extensions/tests/tmux-reference-guard.test.ts` asserts an exact root array (`["extensions", "bin", "templates", "dashboard"]`), so adding `skills/` to `SCAN_ROOTS` will require updating this expectation.

### Missing Items
- None blocking for Step 4 outcomes.

### Suggestions
- After updating `SCAN_ROOTS` (`scripts/tmux-reference-audit.mjs`), keep the new root ordering stable and mirror that exact order in the test assertion to preserve deterministic output checks.
- Run the targeted guard test immediately after this step to confirm the audit contract remains parseable and deterministic.