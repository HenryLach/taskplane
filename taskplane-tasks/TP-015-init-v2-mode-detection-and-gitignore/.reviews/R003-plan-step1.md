## Plan Review: Step 1: Mode Auto-Detection

### Verdict: REVISE

### Summary
The Step 1 plan is directionally correct, but it is missing one required outcome from the task prompt and does not yet cover key compatibility risk for `cmdInit()` interaction flow. Because this step changes control-flow at the top of `init`, those gaps could cause behavior regressions before later steps begin.

### Issues Found
1. **[Severity: important]** — The plan omits the required error-path outcome for “not a git repo and no git repos in subdirectories.” `PROMPT.md` explicitly requires this in Step 1 (`PROMPT.md:58-61`), but Step 1 in status tracks only detection, ambiguous prompt, and Scenario B (`STATUS.md:34-37`). Add an explicit outcome for the hard error message/exit behavior.
2. **[Severity: important]** — The plan does not call out compatibility handling for non-interactive and existing flag behavior when ambiguity requires prompting. Current `cmdInit()` uses preset mode to avoid prompts (`bin/taskplane.mjs:625-633`) and has a dry-run early return (`bin/taskplane.mjs:638-641`), while task constraints require preserving preset behavior (`PROMPT.md:128`). Add a risk-mitigation outcome describing how ambiguous-mode prompting will behave with `--preset`, `--dry-run`, and `--force`.

### Missing Items
- A small validation-intent note for Step 1 branch coverage (repo mode, workspace mode, ambiguous prompt path, and no-repo error path) before moving to Step 2.

### Suggestions
- Keep the plan outcome-level, but add one short note defining detection precedence (existing-config check vs. topology detection) so Scenario B messaging is deterministic.
