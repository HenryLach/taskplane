## Plan Review: Step 4: Expand audit script scope

### Verdict: APPROVE

### Summary
The updated Step 4 plan now covers the previously missing blocking outcome: strict functional TMUX detection for non-TS package files (JS/CJS/MJS), not just broader file discovery. It also includes guard-test updates for expanded scope and deterministic ordering, which gives a clear validation path for this step. Based on the PROMPT requirements, this plan is sufficient to achieve Step 4 outcomes.

### Issues Found
1. **[Severity: minor]** — No blocking issues found; the prior R011 gap is explicitly addressed by the new strict-detection checklist item.

### Missing Items
- None.

### Suggestions
- When implementing, keep strict-mode exclusions explicit for allowed residual references (migration comments and `tmux-compat.ts`) so expanded scanning does not create false failures.
- In guard assertions, prefer stable sorted path output across all scanned roots (`extensions/`, `bin/`, `templates/`, `dashboard/`) to avoid cross-platform nondeterminism.
