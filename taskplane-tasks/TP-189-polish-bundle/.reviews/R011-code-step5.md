## Code Review: Step 5: Cluster E — Worker prompt + skill reconciliation

### Verdict: REVISE

### Summary
The `SKILL.md` addition is solid and matches the requested per-step vs. consolidated review clarification, and the `task-worker.md` commit-section rewrite usefully aligns commit wording with TP-186. However, the Step 5 reconciliation is incomplete: the Resume Algorithm still contains the old “checkboxes done → next step” instruction without Level 2/3 review-gating context. No typecheck/lint/format-check commands were configured in `.pi/taskplane-config.json` (not present) or available `package.json` scripts, so quality checks were skipped per policy.

### Issues Found
1. **[templates/agents/task-worker.md:36] [important]** — The previously identified conflict in Resume Algorithm step 6 is still present verbatim: “When a step's items are all checked, proceed to the next incomplete step.” This contradicts the code-review-gated completion contract for Review Level ≥2 and leaves exactly the ambiguity this step was supposed to reconcile. **Fix:** rewrite this line to be level-aware (0/1 can proceed; 2/3 must commit implementation + run `review_step(type="code")` + only proceed after APPROVE), or add an explicit cross-reference to the Order-of-Operations section before advancing.

### Pattern Violations
- None.

### Test Gaps
- No automated assertion currently guards the Resume Algorithm wording against drifting back into pre-TP-186 semantics; consider extending existing prompt-template text assertions to cover this clause after the fix.

### Suggestions
- After applying the missing Resume Algorithm edit, update the Step 5 STATUS entry so the “2 surgical edits applied” note exactly matches what is on disk.
