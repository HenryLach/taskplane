## Plan Review: Step 3: Wire extensions into all three spawn points

### Verdict: REVISE

### Summary
The step plan is mostly aligned with TP-180’s core outcome (forwarding extensions across worker/reviewer/merge spawn paths while keeping `--no-extensions`). However, there is one important gap in how reviewer-side project settings are resolved in orchestrated worktree runs. Without addressing that, reviewer agents will miss project-level forwarded extensions.

### Issues Found
1. **[Severity: important]** — Reviewer package loading is planned from `cwd`, but reviewer subprocesses run from lane worktrees where `.pi/settings.json` is typically absent (the `.pi/` directory is gitignored and not replicated into new worktrees). This means project-level extension forwarding will fail for reviewer agents in orchestrated runs. **Suggested fix:** thread the canonical project/state root into `agent-bridge-extension.ts` via env (e.g., `TASKPLANE_STATE_ROOT` / workspace root signal) and call `loadPiSettingsPackages()` from that root, with `cwd` only as fallback.

### Missing Items
- Explicit plan item to propagate project/state root into reviewer spawn context and use it for settings lookup.

### Suggestions
- For reviewer exclusions env transport, prefer a JSON array string over comma-separated parsing to avoid delimiter edge cases.
- In Step 5 tests, include a reviewer-forwarding case where `cwd` lacks `.pi/settings.json` but state root has it, to lock in this behavior.
