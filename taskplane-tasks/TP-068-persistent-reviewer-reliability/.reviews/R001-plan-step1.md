## Plan Review: Step 1 — Fix Reviewer Template Prompting

### Verdict: APPROVE

### Summary
The Step 1 plan is correctly scoped to the stated TP-068 objective: eliminate ambiguity around `wait_for_review` tool usage so persistent reviewers stop attempting shell execution. It covers all required artifacts for this step (`templates/agents/task-reviewer.md`, `templates/agents/local/task-reviewer.md`, and the inline spawn prompt in `extensions/task-runner.ts`). The approach is low-risk, reversible, and aligned with existing prompt/template patterns.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for Step 1 planning scope.

### Missing Items
- None required for Step 1.

### Suggestions
- Optional hardening: add the same “registered tool, not bash” reminder to `extensions/reviewer-extension.ts` `promptGuidelines` so the guidance is reinforced at tool-registration level as well.
- In Step 4 tests, include a direct assertion that all persistent-mode `wait_for_review` instruction points in the template include the non-shell warning text (helps prevent regressions).