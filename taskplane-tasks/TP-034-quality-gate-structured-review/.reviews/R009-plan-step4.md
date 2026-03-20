## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist covers the headline scenarios, but it is still too broad to validate the risk-heavy behaviors added in Steps 2–3. In particular, several fail-open and remediation reliability paths implemented in `task-runner.ts` are not explicitly represented in the test plan. Tightening those outcomes now will reduce regression risk around `.DONE` authority and deterministic cycle handling.

### Issues Found
1. **[Severity: important]** — Fail-open coverage is underspecified in the plan. `STATUS.md:68` only calls out malformed verdict handling, but runtime now has three distinct fail-open paths: reviewer non-zero exit and crash (`extensions/task-runner.ts:2686-2709`) plus missing/unreadable verdict file (`extensions/taskplane/quality-gate.ts:618-634`). Add explicit test outcomes for each path so gate bugs/infrastructure failures cannot block completion.
2. **[Severity: important]** — Remediation reliability scenarios added in Step 3 are not explicitly test-planned. Current Step 4 bullets (`STATUS.md:66-67`) do not cover deterministic budget consumption and re-review behavior for fix-agent timeout/non-zero/crash (`extensions/task-runner.ts:1985-1992`, `2853-2904`) or TMUX exit-summary classification (`extensions/task-runner.ts:2871-2885`). Add targeted tests for these paths.
3. **[Severity: important]** — Verdict-rule testing intent is too narrow for current threshold behavior. Step 4 still references only `critical`, `3+ important`, and `status_mismatch` (`STATUS.md:69`), but runtime now has threshold-specific `all_clear` semantics where suggestions are blocking (`extensions/taskplane/quality-gate.ts:149-183`) and failure summaries include suggestion counts (`extensions/task-runner.ts:2014-2016`). Add threshold-matrix coverage including `all_clear`.

### Missing Items
- Explicit assertion that `.DONE` is **not** created on terminal quality-gate failure/exhausted cycles (`extensions/task-runner.ts:2005-2031`).
- Clear split of unit vs integration test intent (pure verdict logic is already covered in `extensions/tests/quality-gate.test.ts:224-309`; Step 4 should add runtime-loop coverage).

### Suggestions
- Keep pure rule/parser tests in `quality-gate.test.ts`, and add focused runtime tests for the execute-task quality-gate loop (including remediation/timeout paths).
- In STATUS, list the exact Step 4 scenarios as outcomes (not implementation details) so completion is auditable.
