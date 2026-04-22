## Plan Review: Step 2: Rename in production code

### Verdict: REVISE

### Summary
The current Step 2 checklist is directionally correct, but it is too narrow to satisfy the task’s stated outcome of renaming `tmuxSessionName` throughout production code. There are still active runtime modules outside the listed files that use `tmuxSessionName`, so this plan is likely to leave stragglers and force rework later (or fail once aliases are removed in Step 4). Expand Step 2 to include a repo-wide production sweep criterion, not just a fixed file subset.

### Issues Found
1. **[Severity: important]** — Step 2 currently scopes production rename to a limited file list (`STATUS.md:26-31`), but additional production modules still reference `tmuxSessionName` (e.g., `extensions/taskplane/abort.ts:58,85`, `extensions/taskplane/formatting.ts:404`, `extensions/taskplane/diagnostic-reports.ts:414`, `extensions/taskplane/sessions.ts:51`). If these are not included, the “rename in production code” outcome will be incomplete. Suggested fix: add an explicit Step 2 outcome to rename all remaining production/runtime references (except intentional compatibility handling), validated via grep.

### Missing Items
- Add a Step 2 completion criterion like: “All non-test production references to `tmuxSessionName` are removed or intentionally compatibility-scoped (documented exceptions only).”
- Include non-listed runtime modules in-scope for Step 2 (or explicitly defer them with rationale), especially `abort.ts`, `formatting.ts`, `diagnostic-reports.ts`, and `sessions.ts`.

### Suggestions
- Add a short “allowed leftovers” note for Step 2 (e.g., compatibility normalization in persistence/resume only) to avoid accidental over/under-renaming.
- Record post-step grep counts split by production/tests/docs so progress is measurable before Step 3.
