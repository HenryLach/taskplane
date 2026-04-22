## Plan Review: Step 4: Tests and verification

### Verdict: APPROVE

### Summary
The Step 4 plan is aligned with PROMPT.md and covers the key verification outcomes for this task’s highest-risk operator surfaces: dashboard rendering, supervisor alert context, and singleton-noise handling. For a small, low-risk task, this is a sufficient and appropriately scoped test plan. The final “run full suite” item provides a reasonable regression backstop.

### Issues Found
1. **[Severity: minor]** — The plan does not explicitly call out assertions for Step 3 outputs (`/orch-status`, batch summary, `read_agent_status`) in this verification step. Suggested improvement: include at least one focused assertion path for segment text rendering in CLI/status formatting to prevent regressions across output surfaces.

### Missing Items
- None blocking.

### Suggestions
- Reuse fixtures that include both multi-segment and repo-singleton tasks so all three checks can validate “shows segment context when present, stays quiet when absent.”
- When running the full suite, pay extra attention to snapshot/string-format tests in `extensions/tests/*` where segment label wording drift is most likely.
