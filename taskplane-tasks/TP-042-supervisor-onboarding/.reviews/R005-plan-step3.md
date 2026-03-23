## Plan Review: Step 3: Returning User Flows (Scripts 6-8)

### Verdict: REVISE

### Summary
The Step 3 plan is currently too thin to reliably deliver the required Script 6/7/8 behaviors. The three checklist items in `STATUS.md` are directionally correct, but they do not yet capture key required outcomes from `PROMPT.md`, especially Script 8 trigger semantics. Tightening the plan now should prevent partial implementation and rework in code review.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include the required Script 6 and Script 7 outcome details from the task prompt (`PROMPT.md:101-103`), and currently only states broad labels (`STATUS.md:47-49`). As written, this can be "done" without guaranteeing the required checks/sources (pending tasks + tech debt + GitHub issues for Script 6; config validity + git state + stale worktrees + task inventory for Script 7).
   **Suggested fix:** Expand Step 3 outcome wording so each script includes its required evidence/outputs (not implementation-level substeps, just required end-state behavior).

2. **[Severity: important]** — Script 8 requires a retrospective trigger after integration (`PROMPT.md:103`), but the plan does not state how that trigger will occur. Current `/orch-integrate` flow emits UI notifications but does not explicitly hand off to supervisor routing/retrospective flow (`extensions/taskplane/extension.ts:1868-2072`).
   **Suggested fix:** Add an explicit Step 3 outcome for retrospective trigger strategy (e.g., post-integration supervisor prompt handoff or equivalent deterministic trigger) plus the required summary inputs (batch diagnostics + audit trail).

3. **[Severity: important]** — Test coverage intent for Step 3 outcomes is missing. Current Step 4 checklist is routing-focused and does not explicitly validate Script 6/7/8 flow behavior (`STATUS.md:55-57`).
   **Suggested fix:** Add explicit test intent for returning-user flows (at least one scenario each for batch-planning guidance, health-check report content, and retrospective trigger/summary behavior).

### Missing Items
- Explicit Script 6 acceptance outcome: pending-tasks path vs no-tasks path, including tech-debt and GitHub issue surfacing.
- Explicit Script 7 acceptance outcome: required health checks + inventory-style report output.
- Explicit Script 8 trigger and data-source outcome for post-integration retrospective.
- Step 3-focused test coverage intent.

### Suggestions
- Reuse `supervisor-primer.md` Section 16 as the single source of script wording to avoid drift between primer guidance and routing prompt instructions.
- Define graceful fallback behavior when `gh` CLI or doctor checks are unavailable (continue with partial health/planning report instead of failing the flow).
