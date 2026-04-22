## Code Review: Step 1: Remove remaining compatibility paths

### Verdict: APPROVE

### Summary
This revision correctly fixes the blocking issue from R003 by making `/task` config loading rethrow `CONFIG_LEGACY_FIELD` instead of silently falling back to defaults. The targeted tests added in `project-config-loader.test.ts` validate both legacy `worker.spawn_mode: tmux` and legacy user preference ingress (`tmuxPrefix`) through the `task-runner` wrapper path. I did not find any remaining Step 1 blockers in the changes since `30410ea`.

### Issues Found
1. **[N/A] [minor]** — No blocking issues found.

### Pattern Violations
- None.

### Test Gaps
- None blocking. Existing and newly added tests cover the behavioral fix in `/task` config loading.

### Suggestions
- Optional: add one more `taskRunnerLoadConfig()` regression case for project config `tmuxPrefix` alias ingress, for symmetry with the existing `loadProjectConfig()` legacy-field coverage.
