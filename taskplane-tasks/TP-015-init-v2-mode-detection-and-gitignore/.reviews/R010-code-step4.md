## Code Review: Step 4: Workspace Mode Init (Scenario C)

### Verdict: REVISE

### Summary
Workspace-mode scaffolding is mostly in place (config repo selection, `.taskplane/` creation, pointer creation, and guidance), but the gitignore/artifact-cleanup behavior is not correctly scoped for workspace layout. As implemented, the code still targets root-level `.pi/` paths in the config repo, which conflicts with the new `.taskplane/` placement and leaves workspace runtime artifacts uncovered.

### Issues Found
1. **[bin/taskplane.mjs:1206-1210, bin/taskplane.mjs:1533-1535] [important]** — Workspace gitignore enforcement does not apply the `.taskplane/` prefix despite comments stating that intent. `ensureGitignoreEntries()` is called without `prefix`, so generated entries are `.pi/...` and `.worktrees/` at repo root instead of workspace-scoped `.taskplane/.pi/...` where applicable. This mismatches the Scenario C spec requirement to scope entries for config-in-`.taskplane/` layouts. **Fix:** pass a workspace prefix in workspace mode and update `ensureGitignoreEntries()` to prefix only applicable patterns (e.g., `.pi/*`) while keeping non-prefixed entries (like `.worktrees/`) where required.
2. **[bin/taskplane.mjs:665-690, bin/taskplane.mjs:1220-1222] [important]** — Tracked-artifact detection is still hardcoded to `git ls-files .pi/ .worktrees/` with unprefixed matching patterns. In workspace mode this misses tracked files under `.taskplane/.pi/*` (e.g., `.taskplane/.pi/batch-state.json`), so init does not offer cleanup for the files it is supposed to protect against. **Fix:** add workspace-aware scan roots/patterns (or a prefix option) to `detectAndOfferUntrackArtifacts()` and use it from the workspace branch.

### Pattern Violations
- Inline comments and step status claim `.taskplane/`-scoped gitignore behavior, but runtime behavior currently writes/validates root-scoped `.pi/*` entries.

### Test Gaps
- No tests for workspace `init` gitignore output (dry-run and real run) asserting `.taskplane/`-scoped entries.
- No tests for workspace tracked-artifact detection/untrack prompts against `.taskplane/.pi/*` files.

### Suggestions
- Consider including config-repo `.gitignore` in the workspace auto-commit flow so users do not end with partially committed init output.
