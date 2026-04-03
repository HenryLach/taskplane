## Code Review: Step 2: Resume reconstruction

### Verdict: REVISE

### Summary
The R004 fixes are partially in place: `.DONE` authority is restored via `collectDoneTaskIdsForResume()`, and `computeResumePoint()` now correctly falls back to task-level logic when a mapped segment record is missing. However, there is still a blocking regression in the actual resume flow: `reconstructSegmentFrontier()` mutates task status to `pending` when segment records are absent, which happens before reconciliation and defeats the intended fallback semantics for partial/legacy state.

### Issues Found
1. **[extensions/taskplane/resume.ts:471-473] [important]** — `reconstructSegmentFrontier()` classifies missing segment records as pending and unconditionally mutates `task.status = "pending"`/`activeSegmentId = nextSegmentId`. In `resumeOrchBatch()`, this runs before `reconcileTaskStates()`, so a persisted terminal task (e.g., `succeeded`) with `segmentIds` but no `segments[]` record is downgraded and can be re-queued.
   - **Why blocking:** This breaks backward/partial-state compatibility and can re-execute already terminal tasks.
   - **Suggested fix:** If a task has no concrete persisted segment records (e.g., none of its `segmentIds` exist in `segments[]`), do not mutate `task.status`/`activeSegmentId`; preserve existing task-level status and let reconciliation + `computeResumePoint()` task-level fallback decide.

### Pattern Violations
- Resume non-regression contract is still violated for partial/legacy segment persistence paths (task-level terminal state should remain authoritative when segment records are unavailable).

### Test Gaps
- `extensions/tests/resume-segment-frontier.test.ts` second case validates `computeResumePoint()` fallback but does **not** call `reconstructSegmentFrontier()` first, so it misses the real `resumeOrchBatch()` ordering where mutation happens before reconciliation.

### Suggestions
- Add an integration-style unit test that runs `reconstructSegmentFrontier()` + `reconcileTaskStates()` in sequence for `segmentIds` present + empty `segments[]`, asserting terminal task status is preserved (no pending downgrade).
