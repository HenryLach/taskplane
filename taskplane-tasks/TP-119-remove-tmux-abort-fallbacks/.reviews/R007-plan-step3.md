## Plan Review: Step 3: Remove dead TMUX helpers

### Verdict: APPROVE

### Summary
The Step 3 plan now covers the previously blocking dependency gaps and is aligned with the task’s stated outcome of removing dead TMUX helper paths. In particular, it explicitly handles non-abort consumers (`engine.ts`, `extension.ts`) and `tmuxAsync` consumers before deleting shared helpers, which was the key risk in the prior revision. With Step 4 test execution already planned, this is sufficient to proceed.

### Issues Found
1. None.

### Missing Items
- None identified.

### Suggestions
- After implementation, run a repo-wide grep for `tmuxHasSession|tmuxKillSession|tmuxAsync` to confirm only intentional TMUX pathways remain (or all are removed, if that’s the final intent).
- When migrating `/orch-sessions` status decoration away from `tmuxHasSession`, keep status semantics explicit (e.g., registry-backed alive/dead vs unknown) to avoid operator ambiguity.
