## Plan Review: Step 3: Convert mergeWave and Callers to Async

### Verdict: APPROVE

### Summary
The updated Step 3 plan now covers the required async propagation path end-to-end: `spawnMergeAgent`, `mergeWave`, `mergeWaveByRepo`, and upstream callers in `engine.ts` and `resume.ts`. It also explicitly includes converting the remaining merge cleanup delays from `sleepSync(500)` to async waits, which was the key missing requirement previously. This scope is sufficient to achieve the step outcomes without introducing unnecessary implementation-level micromanagement.

### Issues Found
1. **[Severity: minor]** — No blocking issues found in the current Step 3 plan.

### Missing Items
- None.

### Suggestions
- Keep the “stale synchronous comments” cleanup item in scope before closing Step 3 so code intent matches the new async behavior.
- As a quick guardrail during implementation, run a targeted grep for remaining `sleepSync(` in `extensions/taskplane/merge.ts` after edits.
