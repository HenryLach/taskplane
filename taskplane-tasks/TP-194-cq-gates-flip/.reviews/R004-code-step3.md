## Code Review: Step 3: Implement Part 2 — activate reviewer downgrade rule

### Verdict: APPROVE

### Summary
The Step 3 change cleanly removes only the temporary TP-191 activation override note from `templates/agents/task-reviewer.md`, restoring the TP-188 section to fully active behavior without altering the underlying downgrade-rule text. This matches the step requirement in `PROMPT.md` to reactivate unconditional APPROVE→REVISE downgrades when quality checks fail. Quality checks were executed from `package.json` fallback (`npm run typecheck`, `npm run lint`, `npm run format:check`) and all exited 0 in this tree.

### Issues Found
1. **None.**

### Pattern Violations
- None identified in the Step 3 diff.

### Test Gaps
- None blocking for this documentation/prompt-template-only change.

### Suggestions
- Optional: in a later cleanup task, consider reducing existing Biome lint warnings currently reported by `npm run lint` (command exits 0 today, but output is noisy).
