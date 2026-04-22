## Code Review: Step 1: Fix Excessive Wave Generation

### Verdict: REVISE

### Summary
The TP-166 metadata plumbing is mostly solid: `taskLevelWaveCount` and `roundToTaskWave` are now produced, persisted, resumed, and used across wave-start/merge/summary messaging. The previous legacy-fallback issue is addressed via `fallbackTotal` and resume-time normalization. However, wave-complete notifications still use raw segment-round indexes, so phantom wave numbering remains visible during execution/resume.

### Issues Found
1. **[extensions/taskplane/engine.ts:3052, extensions/taskplane/resume.ts:2104] [important]** — `ORCH_MESSAGES.orchWaveComplete(...)` is still called with `waveIdx + 1` (segment-round index), not task-level display wave. For multi-segment waves this produces outputs like `Wave 4 complete` even when total task-level waves are only 3, which directly preserves the phantom-wave symptom TP-166 is trying to remove. **Fix:** resolve display wave before notify (same pattern as wave-start/merge), e.g. `const { displayWave } = resolveDisplayWaveNumber(...)` and pass `displayWave` to `orchWaveComplete` in both engine and resume flows.

### Pattern Violations
- TP-166 display-wave mapping is applied inconsistently across operator-facing messages (wave-start and merge are mapped; wave-complete is not).

### Test Gaps
- No regression test verifies wave-complete numbering under segment-frontier expansion (new execution + resume paths).
- No assertion ensures all operator wave notifications for a mapped frontier use task-level numbering consistently.

### Suggestions
- Do a quick sweep for remaining operator-facing `waveIdx + 1` message paths and either intentionally keep them internal or map them to task-level wave numbers for consistency.
