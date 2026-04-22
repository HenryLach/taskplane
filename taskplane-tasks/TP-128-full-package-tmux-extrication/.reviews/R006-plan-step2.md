## Plan Review: Step 2: Remove TMUX from CLI

### Verdict: APPROVE

### Summary
The updated Step 2 plan now covers the previously missing blocking outcome from R005: removing the `install-tmux` command implementation and dispatch path, not just doctor/help messaging. It also includes CLI-surface validation for the removed command, which is the key risk area for this step. As written, this plan should achieve the step’s stated outcomes.

### Issues Found
1. **[Severity: minor]** — No blocking issues identified.

### Missing Items
- None for Step 2 outcomes.

### Suggestions
- After implementation, run a focused `grep -n "tmux|install-tmux" bin/taskplane.mjs` (or the project audit script) and record the residual references in STATUS notes for traceability.
- Include a short operator-facing note in final delivery indicating that `install-tmux` was removed from the CLI surface.
