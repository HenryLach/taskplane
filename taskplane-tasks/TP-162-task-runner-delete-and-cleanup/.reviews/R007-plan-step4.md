## Plan Review: Step 4: Update docs and templates

### Verdict: APPROVE

### Summary
This Step 4 plan is now outcome-complete for the prompt’s documentation/reference cleanup scope. It covers all explicitly required files and incorporates the previously missing root-level and non-doc cleanups (`CONTRIBUTING.md`, `extensions/tsconfig.json`, template updates, and residual sweeps in `STATUS.md:56-68`). With the final maintained-files reference sweep, the step should reliably prevent stale `task-runner.ts` guidance from remaining after deletion.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- For execution clarity, record the exact command/glob used for the final residual sweep (`STATUS.md:68`) and explicitly note intentional exclusions (historical/spec/task-artifact files) in Discoveries.
