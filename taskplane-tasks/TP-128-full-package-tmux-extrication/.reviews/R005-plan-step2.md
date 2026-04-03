## Plan Review: Step 2: Remove TMUX from CLI

### Verdict: REVISE

### Summary
The current Step 2 plan covers doctor messaging cleanup, but it does not explicitly remove the core `install-tmux` command implementation from `bin/taskplane.mjs`. That leaves substantial functional TMUX code in a published package file, which conflicts with the task mission (“no functional TMUX code” outside allowed migration references/shim). The step should be expanded to include command-surface and behavior validation outcomes, not just message edits.

### Issues Found
1. **[Severity: important]** — The plan omits removal of the actual CLI TMUX functionality (`install-tmux` command implementation, command dispatch case, and supporting helpers/constants). In `bin/taskplane.mjs`, this is a large executable block (e.g., `cmdInstallTmux`, `TMUX_PACKAGES`, and `case "install-tmux"`) and is still functional TMUX code. **Suggested fix:** add an explicit Step 2 outcome to remove/decommission the `install-tmux` command path and related TMUX installer logic, not only doctor/help guidance.

### Missing Items
- Explicit outcome to remove `install-tmux` from CLI command routing and help output (not just guidance strings).
- Validation intent for CLI surface change (e.g., `taskplane help` no longer lists `install-tmux`; invoking `taskplane install-tmux` behaves as removed/unsupported in the intended way).

### Suggestions
- After removing the command, run a targeted grep/audit on `bin/taskplane.mjs` to ensure only allowed migration comments (if any) remain.
- If command removal is user-facing, include a brief migration note in final delivery notes so operators understand the new path.