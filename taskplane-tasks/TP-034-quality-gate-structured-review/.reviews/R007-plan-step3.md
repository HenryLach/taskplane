## Plan Review: Step 3: Remediation Cycle

### Verdict: REVISE

### Summary
The plan captures the high-level remediation loop (feedback file, fix pass, re-review, and `.DONE` gating), but it is currently too thin on failure semantics and artifact-scope constraints to be safely implementable. In particular, it does not yet define how to preserve actionable findings on terminal failure or how to handle fix-agent failure paths deterministically. Add those outcomes and explicit edge-case test intent before implementation.

### Issues Found
1. **[Severity: important]** — `STATUS.md:50-54` does not explicitly cover the required outcome from roadmap 5c to **mark failure with review findings**, only “Max cycles exhaustion → fail.” Suggested fix: add a plan item to persist blocking findings (summary + critical/important items + cycle count) into task artifacts/logs when the gate fails (roadmap `resilience-and-diagnostics-roadmap.md:712`).
2. **[Severity: important]** — The plan does not define remediation risk handling for fix-agent abnormal exits (crash/non-zero/timeout/no-op), which can lead to ambiguous looping behavior. Suggested fix: add explicit policy for these paths (e.g., consume fix budget, log reason, and either re-review or fail deterministically based on remaining `max_fix_cycles` / `max_review_cycles`).
3. **[Severity: important]** — The plan adds `REVIEW_FEEDBACK.md` (`STATUS.md:50`) but does not address artifact-scope expectations from roadmap 5e. Current orchestrator post-task commit path stages everything (`extensions/taskplane/execution.ts:785-787`), so this file may be unintentionally committed unless lifecycle/staging behavior is specified. Suggested fix: clarify whether `REVIEW_FEEDBACK.md` is ephemeral (cleaned up) or intentionally staged, and align with 5e scope (`resilience-and-diagnostics-roadmap.md:745-753`).

### Missing Items
- Explicit test coverage intent for remediation edge cases: fix-agent failure path and budget interplay (`maxReviewCycles` vs `maxFixCycles`, including exhaustion ordering).
- Explicit note that remediation must run in the same worktree/repo context as the review cycle (roadmap `resilience-and-diagnostics-roadmap.md:709,739`).

### Suggestions
- Define a deterministic `REVIEW_FEEDBACK.md` template (cycle number, blocking findings only, concrete remediation actions) so fix-agent prompts are stable across runs.
- Log per-cycle remediation outcomes in `STATUS.md` execution log for operator visibility (attempted fix, review rerun result, terminal reason).
