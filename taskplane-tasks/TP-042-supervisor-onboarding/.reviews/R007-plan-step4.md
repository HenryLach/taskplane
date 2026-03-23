## Plan Review: Step 4: Testing & Verification

### Verdict: APPROVE

### Summary
The Step 4 plan is outcome-aligned with the required verification goals in `PROMPT.md` (routing behavior for `/orch` no-args states, no regression for args, and full-suite pass). The proposed coverage in `STATUS.md` (state detection matrix, routing-prompt mapping, and args-preservation tests) is sufficient to validate the TP-042 behavior changes without over-specifying implementation details. I do not see blocking gaps that would force rework later.

### Issues Found
1. **[Severity: minor]** — No blocking plan-level issues identified.

### Missing Items
- None.

### Suggestions
- In the “/orch with args” regression tests (`STATUS.md:60`), include one explicit `/orch all` assertion so the PROMPT’s dedicated `/orch all` requirement is visibly covered.
- Add one focused handler-level assertion around the no-args active-batch path (`extensions/taskplane/extension.ts:1046-1054`) to ensure it reports status and does not activate routing-mode supervisor flow.
- Keep one test that protects the completed-batch → Script 8 guidance mapping (`extensions/taskplane/supervisor.ts:644-659`) since that was a key Step 3 contract.
