## Plan Review: Step 4: tmux Availability vs spawn_mode Check

### Verdict: APPROVE

### Summary
The Step 4 plan is appropriately scoped and aligned with the task prompt and spec mapping captured in STATUS.md. It targets the required outcome: fail when `spawn_mode: "tmux"` is configured but tmux is unavailable, with clear remediation (`taskplane install-tmux`). The approach fits existing `cmdDoctor()` behavior and preserves the read-only diagnostics contract.

### Issues Found
1. **[Severity: minor]** — The step text in STATUS is concise but does not explicitly call out non-tmux modes (e.g., ensure no new error when `spawn_mode` is unset or not `tmux`). Suggested fix: add one outcome bullet clarifying this guard condition.

### Missing Items
- Explicit testing intent for this specific step in plan form (at least: `spawn_mode=tmux + tmux missing` => FAIL, and `spawn_mode!=tmux` => no tmux-config mismatch error).

### Suggestions
- Reuse existing doctor symbol formatting (`FAIL` plus actionable suggestion line) to keep output consistent with prior checks.
- Keep this check colocated with existing tmux prerequisite logic to avoid duplicate or contradictory diagnostics.
