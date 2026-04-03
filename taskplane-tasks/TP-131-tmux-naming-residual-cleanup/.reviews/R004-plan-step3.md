## Plan Review: Step 3: Templates and other shipped files

### Verdict: APPROVE

### Summary
The Step 3 plan is aligned with the PROMPT scope and covers all required outcomes for this phase: template comment cleanup, `rpc-wrapper` wording cleanup, and orchestrator top-level comment cleanup. This is a low-risk, behavior-preserving step, and the plan granularity is appropriate for an S-sized cosmetic pass. Given Step 2 already addressed the earlier compatibility concern, this step should complete cleanly as planned.

### Issues Found
1. **[Severity: minor]** — The checklist item for `bin/rpc-wrapper.mjs` is broad; to avoid partial cleanup, ensure all TMUX wording instances in that file are included in scope (header, progress-display comment, and Windows shell-expansion note).

### Missing Items
- None blocking for Step 3 outcomes.

### Suggestions
- After completing Step 3, run a targeted grep over these three files to confirm no residual `tmux` wording remains except intentional legacy-compat references.
- In `templates/config/task-runner.yaml`, make sure both `spawn_mode` and any “used only in tmux mode” comments are updated/removed together so template guidance stays internally consistent.
