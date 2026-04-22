## Plan Review: Step 4: Fix wave indicators flashing green during merge (#493)

### Verdict: APPROVE

### Summary
The Step 4 plan is aligned with the required behavior change for #493 and correctly identifies the root cause in `dashboard/public/app.js` (`isDone` treating all waves as done during `merging`). The proposed logic shift (`i < currentWaveIndex` for done waves during merge) plus a dedicated merging state for the active wave is sufficient to stop the all-green flash and preserve accurate wave status. This remains scoped to dashboard rendering only, consistent with the task constraints.

### Issues Found
1. **[Severity: minor]** The plan should explicitly call out styling behavior for the new merging indicator (e.g., `.wave-chip.merging` color/animation) so the UI does not silently fall back to plain gray for the active merging wave.

### Missing Items
- None blocking.

### Suggestions
- Add a short verification note in STATUS.md for the exact merge-phase scenario: one completed wave (green), one active merging wave (merging style), and future waves gray.
- If feasible, include a quick regression check that `executing` phase behavior for current wave chips is unchanged after the conditional logic update.
