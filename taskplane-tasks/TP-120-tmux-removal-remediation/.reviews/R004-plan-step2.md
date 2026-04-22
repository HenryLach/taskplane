## Plan Review: Step 2: Remove merge health monitor TMUX polling

### Verdict: REVISE

### Summary
The Step 2 plan is directionally aligned with the task goal, but it is stale relative to the current code after Step 1 and risks missing remaining functional TMUX paths in `merge.ts`. In particular, the checklist references symbols that no longer exist while the real TMUX execution path (`capture-pane` helpers) is still present. The plan also needs an explicit strategy for preserving/correctly adjusting health-monitor behavior once pane-capture polling is removed.

### Issues Found
1. **[Severity: important]** — The plan targets outdated symbols (`tmuxHasSessionAsync` import, `captureTmuxPaneTail*`) instead of the actual remaining TMUX code in `merge.ts` (`captureMergePaneOutput`, `captureMergePaneOutputAsync`, `runMergeTmuxCommandAsync`, and `spawn("tmux", ...)` / `spawnSync("tmux", ...)`). As written, Step 2 can complete checklist items yet still leave functional TMUX code behind, violating the task mission. **Suggested fix:** rewrite Step 2 outcomes to explicitly remove/replace these current helpers and all functional TMUX invocations in merge monitoring.
2. **[Severity: important]** — The plan does not address health-state semantics after removing pane-output polling. Today `classifyMergeHealth()` uses output-change timestamps for warning/stuck detection; if output capture is removed without redesign, live sessions can be misclassified as warning/stuck over time. **Suggested fix:** explicitly choose one of: (a) remove monitor/activity statuses entirely if no longer needed, or (b) replace activity signal with a V2-native source and adjust classification/event emission accordingly.

### Missing Items
- Explicit test coverage intent for the Step 2 behavior change (at minimum: `MergeHealthMonitor.poll()` behavior and `supervisor-merge-monitoring.test.ts` expectations after TMUX capture removal).
- If the monitor is removed as dead code, include corresponding `engine.ts` integration cleanup as a stated outcome.

### Suggestions
- Carry forward the Step 1 fix pattern: keep V2 liveness cache seed/clear around poll cycles if the monitor remains.
- Update Step 2 checklist wording to reflect current symbols/code paths, so completion criteria are unambiguous.