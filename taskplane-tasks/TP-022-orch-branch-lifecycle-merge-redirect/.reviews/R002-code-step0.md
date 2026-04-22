## Code Review: Step 0: Preflight

### Verdict: REVISE

### Summary
Step 0 captures the right preflight scope expansion from R001 (notably `resume.ts` and `messages.ts`) and logs a thorough branch-routing discovery inventory. However, the recorded "Impacted Test Files" section is incomplete because file identifiers are missing, which weakens the Step 5 handoff this preflight was supposed to establish. A small STATUS cleanup is needed before this step is fully review-ready.

### Issues Found
1. **[taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:151-157] [important]** — The "Impacted Test Files" bullets are blank (`-  — ...`) and do not identify actual test files/paths. This does not satisfy the explicit Step 0 objective to inventory impacted resumed-batch and merge test coverage. **Fix:** replace each blank bullet with concrete suites (e.g., `extensions/tests/orch-state-persistence.test.ts`, `merge-repo-scoped.test.ts`, `monorepo-compat-regression.test.ts`, `worktree-lifecycle.test.ts`, `orch-pure-functions.test.ts`, and any additional impacted files).
2. **[taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:87-90,131-137] [minor]** — Duplicate review/log rows reduce audit clarity (`R001` appears twice; "Task started"/"Step 0 started" also duplicated). **Fix:** de-duplicate repeated rows when updating STATUS so step history remains clean and unambiguous.

### Pattern Violations
- STATUS handoff notes are expected to contain concrete artifact references; this step’s impacted-test inventory currently omits file names.

### Test Gaps
- Missing explicit mapping from each intended behavior change area (resume routing, merge update-ref behavior, persistence defaults) to exact existing test files/suites.

### Suggestions
- In the impacted-test list, add one short rationale per file (what assertion area will need updates) to make Step 5 execution faster.
