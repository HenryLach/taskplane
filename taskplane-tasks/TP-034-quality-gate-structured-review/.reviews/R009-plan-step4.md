## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist covers the core happy/negative paths, but it is still missing explicit coverage for several high-risk behaviors implemented in Steps 2–3. In particular, fail-open resilience and deterministic remediation failure handling are broader in code than the current test plan text. Tightening those outcomes in the plan will reduce regression risk around `.DONE` gating and review/fix cycle control.

### Issues Found
1. **[Severity: important]** — Fail-open test intent is incomplete. `STATUS.md:68` only names malformed verdict handling, but runtime now has distinct fail-open paths for reviewer non-zero exit and reviewer crash (`extensions/task-runner.ts:2686-2709`), plus missing/unreadable verdict file (`extensions/taskplane/quality-gate.ts:618-634`). Add explicit Step 4 outcomes for each fail-open path.
2. **[Severity: important]** — Remediation reliability scenarios from Step 3 are not explicitly planned for verification. Current bullets (`STATUS.md:66-67`) do not call out fix-agent timeout/non-zero/crash budget consumption and re-review behavior (`extensions/task-runner.ts:2853-2904`) or TMUX exit-summary classification (`extensions/task-runner.ts:2871-2885`). Add these as explicit test outcomes.
3. **[Severity: important]** — Verdict-rule coverage is underspecified for threshold-specific behavior. The plan’s generic “Verdict rules tests” (`STATUS.md:69`) should explicitly include `all_clear` suggestion-blocking and terminal summary behavior (`extensions/taskplane/quality-gate.ts:149-183`, `extensions/task-runner.ts:2014-2016`) to protect the recent R008 fixes.

### Missing Items
- Explicit assertion that terminal quality-gate failure/exhausted cycles leaves `.DONE` absent (`extensions/task-runner.ts:2005-2031`).
- Clear split of unit vs runtime integration coverage (pure rule/parser logic already exists in `extensions/tests/quality-gate.test.ts`; Step 4 should ensure loop-level behavior is exercised too).

### Suggestions
- Keep Step 4 checklist outcome-oriented, but add one line per high-risk branch (fail-open variants, fix-agent abnormal exits, `.DONE` absence on failure) so completion is auditable.
- After adding these scenarios, run targeted tests first, then full suite (`cd extensions && npx vitest run`) to speed iteration.
