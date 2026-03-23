## Plan Review: Step 4: Testing & Verification

### Verdict: APPROVE

### Summary
The Step 4 plan is appropriately outcome-focused and maps to the required testing goals in `PROMPT.md` (`PROMPT.md:112-119`). The three checklist items in `STATUS.md` (`STATUS.md:58-60`) are broad, but they are sufficient to cover routing-state validation, no-regression behavior for `/orch` with args, and full-suite verification. I do not see blocking gaps that would force rework if implementation follows this plan.

### Issues Found
1. **[Severity: minor]** — No blocking plan-level issues identified.

### Missing Items
- None.

### Suggestions
- When implementing "Routing tests for all project states" (`STATUS.md:58`), make sure the matrix explicitly includes the **completed-batch needing integration** path (from Step 1 outcomes) in addition to no-config/pending/no-tasks/active-batch.
- Add one regression case for the previously fixed root-resolution edge case (pointer `configRoot` vs repo root) so `/orch` no-args detection remains correct in workspace/pointer setups.
- Consider one focused assertion that routing state → primer script guidance remains wired for returning-user flows (especially completed-batch → Script 8) to protect Step 3 behavior.
