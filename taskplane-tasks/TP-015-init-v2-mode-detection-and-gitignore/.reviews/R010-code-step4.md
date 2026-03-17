## Code Review: Step 4: Workspace Mode Init (Scenario C)

### Verdict: REVISE

### Summary
The workspace-mode scaffolding is largely in place (config-repo selection, `.taskplane/` generation, pointer creation, and guidance), but there are two correctness gaps around gitignore handling that can break the core runtime-artifact safety guarantees. I also found an overwrite-flow inconsistency where confirming overwrite does not actually overwrite existing files unless `--force` is used.

### Issues Found
1. **[bin/taskplane.mjs:1206-1222, 1533-1537] [important]** — Workspace gitignore handling is not scoped to `.taskplane/` even though the code comment says it should be. `ensureGitignoreEntries(configRepoRoot, ...)` is called without `prefix: ".taskplane/"`, so entries written are `.pi/...` and `.worktrees/` at repo root, not `.taskplane/.pi/...` (per Scenario C spec). The tracked-artifact check also scans only root `.pi/`/`.worktrees/` paths, so it will miss `.taskplane/.pi/*` artifacts. **Fix:** pass `prefix: ".taskplane/"` in workspace init/dry-run and add a workspace-aware tracked-artifact detection path (or extend `detectAndOfferUntrackArtifacts` with prefix-aware scanning).
2. **[bin/taskplane.mjs:1236-1243, 1261] [important]** — Required `.gitignore` changes in the config repo are not staged/committed by the workspace auto-commit flow. `autoCommitTaskFiles()` stages only the task directory, and the second commit stages only `.taskplane/`; `.gitignore` remains untracked (reproducible), but post-init instructions suggest a plain `git push`. This can ship workspace config without the required ignore rules. **Fix:** include `.gitignore` in staging/commit (or explicitly instruct user to `git add .gitignore` before push).
3. **[bin/taskplane.mjs:1062-1068, 1106] [minor]** — The overwrite confirmation is misleading: after user confirms “Overwrite existing files?”, scaffolding still uses `const skipIfExists = !force`, so existing files are skipped unless `--force` is set. **Fix:** track confirmation result and set `skipIfExists` accordingly (or change prompt text to “continue without overwriting”).

### Pattern Violations
- Comment/behavior mismatch in workspace gitignore block (`"Use .taskplane/ prefix"` comment, but no prefix is applied in code).

### Test Gaps
- No automated coverage for workspace-mode gitignore prefixing (`.taskplane/.pi/*` vs `.pi/*`).
- No test ensuring workspace init commits/stages `.gitignore` alongside generated config.
- No test for overwrite-confirmation behavior in workspace mode (confirm yes should overwrite or messaging should reflect skip behavior).

### Suggestions
- Add a focused workspace-init test matrix for `--dry-run`, `--preset full`, and re-init flows (`existing .taskplane/`, with/without `--force`) validating file paths and git staging outcomes.
