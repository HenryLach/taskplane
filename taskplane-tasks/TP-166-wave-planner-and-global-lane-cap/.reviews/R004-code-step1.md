## Code Review: Step 1: Fix Excessive Wave Generation

### Verdict: REVISE

### Summary
The implementation correctly introduces task-level wave metadata (`taskLevelWaveCount` + `roundToTaskWave`) and wires it through most engine/resume notifications, which addresses the main phantom-wave display problem for newly started batches. Persistence updates and continuation-round mapping maintenance are also in place. However, there is a backward-compatibility regression in display-total fallback logic for resumed pre-TP-166 state files.

### Issues Found
1. **[extensions/taskplane/engine.ts:1125] [important]** — `resolveDisplayWaveNumber()` computes `displayTotal` as `taskLevelWaveCount ?? (roundToTaskWave?.length ?? roundIdx + 1)`. For legacy resumed batches (no `taskLevelWaveCount`, no `roundToTaskWave`), this makes totals drift as `1,2,3...` instead of using persisted `totalWaves`. It also uses `roundToTaskWave.length` when `taskLevelWaveCount` is missing, which is segment-round count, not task-wave count. **Fix:** add an explicit fallback total parameter (or pass `batchState.totalWaves` from callers), and compute mapping fallback as `max(roundToTaskWave)+1` if needed.

### Pattern Violations
- Backward-compatibility intent documented in type comments (`taskLevelWaveCount` falls back to `totalWaves`) is not fully honored by the helper fallback behavior.

### Test Gaps
- Missing regression test for legacy resume display behavior where persisted state has only `totalWaves` (no TP-166 fields). This would catch the drifting total bug.
- Missing unit test coverage for `resolveDisplayWaveNumber()` fallback cases (`undefined` metadata and mapping-without-count cases).

### Suggestions
- In `resume.ts` initialization, consider normalizing once: `batchState.taskLevelWaveCount = persistedState.taskLevelWaveCount ?? persistedState.totalWaves` to keep downstream display logic simple and stable.
