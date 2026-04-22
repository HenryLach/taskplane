## Plan Review: Step 3: Remediation Cycle

### Verdict: REVISE

### Summary
The Step 3 plan captures the core loop (feedback file, fix pass, and re-review), but it still misses key outcome and risk details needed for deterministic behavior. In particular, failure reporting, fix-cycle/error semantics, and artifact-scope handling are underspecified for this codebase’s current commit behavior. Tighten those outcomes before implementation to avoid contract drift and recovery ambiguity.

### Issues Found
1. **[Severity: important]** — `STATUS.md:53` says only “Max cycles exhaustion → fail,” but the task requirement is stronger: terminal failure must be recorded **with review findings** (`PROMPT.md:90`). Suggested fix: add an explicit Step 3 outcome for persisting blocking findings (summary + critical/important findings + cycle counts) in task artifacts/logs on gate failure.
2. **[Severity: important]** — The checklist drops the “same worktree” execution constraint from the task requirements (`PROMPT.md:88`; reduced to generic “Spawn fix agent” at `STATUS.md:51`). Suggested fix: explicitly require remediation to run in the same repo/worktree context as the review evidence to prevent cross-repo drift.
3. **[Severity: important]** — The plan does not define deterministic handling for fix-agent abnormal exits (non-zero, timeout, crash, no-op) or how those outcomes consume `max_fix_cycles` vs `max_review_cycles`. Existing loop scaffolding already separates these budgets (`extensions/task-runner.ts:1921-1954`), so undefined behavior here will cause inconsistent retries. Suggested fix: add explicit policy for each failure path and budget consumption.
4. **[Severity: important]** — `REVIEW_FEEDBACK.md` lifecycle is unspecified (`STATUS.md:50`) even though orchestrator post-task commits currently stage everything with `git add -A` (`extensions/taskplane/execution.ts:785-787`). This conflicts with roadmap Phase 5e artifact-scope intent (allowlist excludes feedback scratch files). Suggested fix: define whether `REVIEW_FEEDBACK.md` is intentionally committed or explicitly cleaned/ignored before artifact commit.

### Missing Items
- Step-level test intent for remediation edge cases: fix-agent crash/non-zero/no-op, budget exhaustion ordering (`maxReviewCycles` + `maxFixCycles`), and `.DONE` remaining absent on terminal gate failure.
- Explicit validation of same-worktree remediation behavior (especially in orchestrated/TMUX mode).

### Suggestions
- Use a stable `REVIEW_FEEDBACK.md` template (cycle number, blocking findings only, concrete remediation actions).
- Log each remediation cycle outcome in `STATUS.md` execution log for operator visibility and postmortem clarity.
