## Plan Review: Step 3: Remove abort.ts TMUX code

### Verdict: REVISE

### Summary
The Step 3 checklist is directionally correct for `abort.ts`, but it is not sufficient to achieve the stated outcome “Ensure V2 abort path is the only path.” The active `/orch-abort` runtime path still uses TMUX directly in `extension.ts`, so completing only the current Step 3 items can leave functional TMUX abort behavior in place. The plan also needs a clearer non-TMUX session-discovery outcome so abort does not silently become a no-op.

### Issues Found
1. **[Severity: important]** — The plan scopes Step 3 to `abort.ts`, but `/orch-abort` currently performs TMUX list/kill directly in `extensions/taskplane/extension.ts:2283-2325` (`execSync('tmux list-sessions ...')` and `tmux kill-session ...`). If this path is not included, Step 3 can complete while TMUX remains the functional abort backend. **Suggested fix:** add an explicit Step 3 outcome to remove/replace this `doOrchAbort` TMUX path (or route it through a V2-only abort implementation).
2. **[Severity: important]** — “Replace with V2 registry-based session discovery or remove if redundant” is too ambiguous for correctness. In `abort.ts`, target selection depends on discovered session names; if discovery is just removed, `selectAbortTargetSessions(...)` can return empty and skip wrap-up/kill entirely. **Suggested fix:** require a concrete non-TMUX discovery source (runtime lanes + persisted lane/task mappings and/or V2 process registry) and preserve abort behavior when only persisted state exists.

### Missing Items
- Explicit integration outcome for the command surface (`extension.ts`) so `/orch-abort` no longer depends on TMUX.
- Explicit test coverage intent for abort behavior after TMUX removal (at minimum: graceful/hard abort still targets V2 lane+merge agents, and no-batch/no-session handling remains correct).

### Suggestions
- After removing TMUX discovery, consider renaming TMUX-specific abort error codes/messages (e.g., `ABORT_TMUX_LIST_FAILED`) to backend-neutral terms for clarity.
