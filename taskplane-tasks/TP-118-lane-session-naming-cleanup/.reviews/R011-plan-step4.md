## Plan Review: Step 4: Remove aliases

### Verdict: APPROVE

### Summary
This revised Step 4 plan addresses the blockers from R010 and is now outcome-complete for alias removal. It explicitly scopes legacy `tmuxSessionName` handling to ingress-only compatibility paths while requiring canonical runtime shape to be `laneSessionId` (`STATUS.md:49-51`), which aligns with the prompt’s backward-compat requirement (`PROMPT.md:94`). It also adds a concrete cleanup gate for remaining production references (`STATUS.md:50`), reducing the risk of partial/ambiguous rename completion.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- Consider naming the exact targeted validation suites in the Step 4 execution log (e.g., persistence/resume compatibility tests) in addition to the full-suite run, to make the ingress-compat guarantee easier to audit.
- When recording Step 4 completion, include post-step grep counts split by production/tests/docs (as already suggested in notes) to provide a clear “alias removal done” signal.
