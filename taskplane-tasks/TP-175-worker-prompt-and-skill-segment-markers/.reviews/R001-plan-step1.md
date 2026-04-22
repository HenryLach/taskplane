## Plan Review: Step 1: Update Worker Prompt

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the task requirements and spec section A.6: it adds the required multi-segment guidance, places it in the intended location, and includes a verification pass. For a template-only change, this is sufficient to achieve the stated outcome without runtime impact. I do not see any blocking gaps that would require rework before implementation.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for this step.

### Missing Items
- None.

### Suggestions
- When drafting the new section, explicitly phrase it as an exception/override for multi-segment runs so it cannot be misread against the existing global "keep working until all steps are complete" guidance.
- If no prompt-specific automated tests exist, document that explicitly in STATUS.md and perform an end-to-end manual wording pass for internal consistency.
