## Plan Review: Step 2: Remove dead execution functions

### Verdict: APPROVE

### Summary
The Step 2 plan covers the key required outcomes from PROMPT.md: removing legacy TMUX lane/merge execution functions and updating dependent imports/call sites. The scope is appropriately outcome-focused and aligns with the Step 0 inventory that identified these paths as unreachable under always-`"v2"` backend selection. I don’t see blocking gaps that would prevent successful implementation.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for this step plan.

### Missing Items
- None identified.

### Suggestions
- When applying “update other import sites,” explicitly include `resume.ts` and the runtime-branch call sites in `engine.ts`/`merge.ts` so removed legacy symbols are not left behind in unreachable branches.
- As part of this step, verify the explicit keep-list from PROMPT (`tmuxHasSession`, `tmuxKillSession`, `tmuxAsync`, `tmuxSessionName`, and TMUX abort/cleanup shims) remains intact to avoid regressions deferred to TP-118/TP-119.
- After edits, run a quick symbol grep for removed APIs (`executeLane`, `spawnLaneSession`, `buildTmuxSpawnArgs`, legacy `spawnMergeAgent`) to confirm there are no stale references before Step 4 testing.
