## Code Review: Step 2: Expand global preferences schema

### Verdict: REVISE

### Summary
The Step 2 implementation achieves the main architecture goals: `GlobalPreferences` is now config-shaped via deep partial sections, legacy flat aliases are still supported, and preferences-only fields are preserved. The new tests also cover nested parsing, merge precedence, and end-to-end loading behavior. However, the new nested override path introduces a regression in legacy spawn mode migration (`tmux` can now leak back into runtime config), which is a blocking compatibility/correctness issue.

### Issues Found
1. **[extensions/taskplane/config-loader.ts:881-893, 1017-1018] [important]** — Nested config-shaped overrides can reintroduce deprecated `"tmux"` spawn modes, bypassing migration safeguards.
   - `applyGlobalPreferences()` deep-merges `prefs.taskRunner` / `prefs.orchestrator` directly into runtime config.
   - `migrateGlobalPreferences()` only migrates top-level legacy `spawnMode`, not nested `taskRunner.worker.spawnMode` or `orchestrator.orchestrator.spawnMode`.
   - Result: `loadProjectConfig()` can return `spawnMode: "tmux"` when preferences use nested shape, despite runtime v2 expecting subprocess-only.
   - Repro (verified): preferences `{ "orchestrator": { "orchestrator": { "spawnMode": "tmux" } } }` yields `config.orchestrator.orchestrator.spawnMode === "tmux"`.
   - **Suggested fix:** normalize legacy `tmux` values in nested overrides (both worker + orchestrator paths) before/while applying preferences, and/or run a non-persisting runtime migration pass after Layer 2 merge. Also update the stale comment at lines 1017-1018 (it is no longer true).

### Pattern Violations
- None beyond the migration invariant regression above.

### Test Gaps
- Missing regression test for nested legacy spawn mode migration:
  - `prefs.orchestrator.orchestrator.spawnMode = "tmux"` should end as `"subprocess"`.
  - `prefs.taskRunner.worker.spawnMode = "tmux"` should end as `"subprocess"`.

### Suggestions
- Optional hardening: consider normalizing/allowlisting nested override fields more explicitly (or validating against config schema) to avoid silently introducing unsupported nested keys/values.
