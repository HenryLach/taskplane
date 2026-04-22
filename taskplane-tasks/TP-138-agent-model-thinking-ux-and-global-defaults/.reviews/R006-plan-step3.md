## Plan Review: Step 3: Thinking picker in /taskplane-settings

### Verdict: APPROVE

### Summary
The updated Step 3 plan now covers the required outcomes from `PROMPT.md`, including picker-based thinking selection, fixed options (`inherit`/`on`/`off`), reuse of existing picker UX, current-value marking, and save-destination handling. It also addresses the prior R005 gap by explicitly adding the model-change suggestion behavior for thinking-capable models. This is sufficient to achieve the step outcome without rework.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- During implementation, base “thinking-capable model” detection on model-registry metadata (if available) rather than provider-name heuristics.
- Keep the persist/clear behavior explicit: selecting `inherit` should write/normalize to `""`, not a literal label string.
