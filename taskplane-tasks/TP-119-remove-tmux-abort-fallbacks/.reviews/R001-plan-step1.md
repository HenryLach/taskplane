## Plan Review: Step 1: Remove abort TMUX fallbacks

### Verdict: REVISE

### Summary
The Step 1 plan covers the main target files and correctly calls out stop-all/stall and merge dual-kill cleanup paths. However, it currently omits one abort fallback already identified in your own preflight inventory: TMUX liveness polling in `abort.ts`. If that path is left in place, Step 1 will not fully remove abort TMUX fallback behavior and Step 3 helper removal will likely be blocked.

### Issues Found
1. **[Severity: important]** — `abort.ts` still has a TMUX-based graceful wait fallback (`waitForSessionExit` using `tmuxHasSession`, around `extensions/taskplane/abort.ts:222`), but Step 1 only mentions "TMUX kill paths". Add this to Step 1 scope so abort no longer depends on TMUX session liveness checks.

### Missing Items
- Explicit Step 1 outcome for removing/replacing TMUX graceful-exit polling in `abort.ts` (not just kill calls).

### Suggestions
- In Step 1 implementation notes, explicitly require a grep-based sweep after edits (e.g., remaining `tmuxHasSession|tmuxKillSession` in `abort.ts|execution.ts|merge.ts`) to ensure no abort cleanup fallback branches remain.
- Call out at least one targeted test intent for Step 1 (graceful + hard abort paths) so fallback-removal regressions are caught before Step 3 helper deletion.
