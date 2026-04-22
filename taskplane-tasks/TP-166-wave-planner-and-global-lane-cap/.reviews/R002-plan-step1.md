## Plan Review: Step 1: Fix Excessive Wave Generation

### Verdict: REVISE

### Summary
The updated plan is much stronger than R001: it now preserves execution-round behavior and introduces task-level display metadata, which is the right direction for avoiding state-model breakage. However, it still leaves a critical gap around resume/runtime mutation paths where wave progress is rendered from segment-round indexes. Without explicitly covering those paths, phantom wave numbering can still appear after pause/resume or continuation-round insertion.

### Issues Found
1. **[Severity: important]** — The plan scopes display mapping to engine start/progress (`STATUS.md:29-30`) but does not explicitly include resume flow updates. `resume.ts` currently renders wave progress directly from `waveIdx + 1` and `wavePlan.length` (e.g., `resume.ts:1958`, `resume.ts:2067`), so resumed batches can still show inflated/contradictory wave counts.
2. **[Severity: important]** — The plan introduces `roundToTaskWave` metadata (`STATUS.md:28`) but does not state how that mapping is maintained when runtime continuation rounds are inserted (e.g., via `scheduleContinuationSegmentRound`). If mapping is not updated/persisted with wave-plan mutation, displayed wave numbers can drift or exceed `taskLevelWaveCount`.

### Missing Items
- Explicit Step 1 item to apply task-wave display mapping in **resume** progress/wave-start output, not only initial engine execution path.
- Explicit handling for mapping updates when continuation rounds are inserted dynamically during execution.
- A targeted verification scenario for pause/resume on a multi-segment task to ensure task-level wave counts remain correct after resume.

### Suggestions
- Add a small helper for "display wave index" resolution (segment round -> task wave) and use it in both `engine.ts` and `resume.ts` to prevent divergence.
- Keep Step 3 regression tests as planned, but include one resume-specific assertion for wave numbering consistency.
