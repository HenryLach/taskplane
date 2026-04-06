## Code Review: Step 1: Rename user preferences → global preferences

### Verdict: APPROVE

### Summary
The Step 1 rename is functionally complete and coherent: core schema/type names, loader APIs, TUI write-path functions, CLI helpers, and call sites were updated to `Global*` terminology while preserving the same on-disk preferences path. I also ran the targeted suite for the touched areas, and it passed cleanly (263/263). This is ready to proceed to Step 2.

### Issues Found
1. **[N/A] [none]** — No blocking correctness issues found for Step 1.

### Pattern Violations
- None identified.

### Test Gaps
- No blocking test gaps for this step’s stated rename outcome.

### Suggestions
- As a follow-through on the R001 suggestion to grep for stale naming, clean up a few remaining non-functional wording leftovers:
  - `extensions/taskplane/settings-tui.ts` header comments still mention “user preferences” and “user chooses destination” (terminology only).
  - `extensions/taskplane/settings-tui.ts` source-detection comment still says “check user prefs first”.
  - `extensions/tests/global-preferences.test.ts` file header still shows the old run command path `tests/user-preferences.test.ts`.
- Optional consistency polish: consider renaming `extensions/tests/user-preferences-init-defaults.test.ts` to `global-preferences-init-defaults.test.ts` to match the new naming across the suite.
