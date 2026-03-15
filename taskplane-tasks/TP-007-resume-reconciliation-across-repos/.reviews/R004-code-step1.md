# R004 Code Review — Step 1: Compute repo-aware resume point

## Verdict
**CHANGES REQUESTED**

## Findings

### 1) `blockedTasks` can be undercounted after resume when blocked IDs were persisted but not yet encountered
- **Severity:** Medium
- **File:** `extensions/taskplane/resume.ts` (lines ~524, ~881-886)

`resumeOrchBatch()` now excludes all `persistedBlockedTaskIds` when incrementing `batchState.blockedTasks`:

- `const persistedBlockedTaskIds = new Set(persistedState.blockedTaskIds)`
- `blockedInWave` counts only IDs not in that set

This avoids one double-count path, but it introduces an undercount path:
- If a prior run persisted `blockedTaskIds` for future waves (common with `skip-dependents`) and paused before those waves were reached, those tasks were **not** yet counted in `blockedTasks`.
- On resume, they are filtered out forever by `!persistedBlockedTaskIds.has(taskId)`, so they never contribute to `blockedTasks`.

This breaks the engine parity implied by current counter semantics (count blocked tasks when their wave is processed) and reduces operator-visible accuracy.

---

### 2) `orch-state-persistence` reimplementation no longer matches source behavior for wave-skip terminal logic
- **Severity:** Medium
- **Files:**
  - `extensions/taskplane/resume.ts` (line ~341)
  - `extensions/tests/orch-state-persistence.test.ts` (lines ~2578, ~2631+)

Source `computeResumePoint()` now treats `mark-failed` as terminal for wave-skip:
- `reconciled.action === "mark-complete" || reconciled.action === "mark-failed"`

But the test file’s “mirrors source exactly” reimplementation explicitly **does not** include `mark-failed` in `allDone`, and assertions were updated around that divergent behavior.

Result: this suite can pass while asserting semantics different from production code, which weakens confidence in resume-point correctness.

## Notes
- I ran: `cd extensions && npx vitest run tests/orch-direct-implementation.test.ts tests/orch-state-persistence.test.ts` (passes), but finding #2 remains because the test uses a local reimplementation path that currently diverges from source logic.
