# R006 Code Review — Step 2: Execute resumed waves safely

## Verdict
**CHANGES REQUESTED**

## Reviewed diff
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- task artifacts under `taskplane-tasks/TP-007-resume-reconciliation-across-repos/`

## Validation run
- `cd extensions && npx vitest run tests/orch-state-persistence.test.ts tests/orch-direct-implementation.test.ts` ✅

## Blocking findings

### 1) `blockedTasks` can be double-counted when resume starts in a wave that was already entered
- **Severity:** Medium
- **Files:**
  - `extensions/taskplane/resume.ts:629-644`
  - `extensions/taskplane/resume.ts:1025-1031`
  - reference behavior: `extensions/taskplane/engine.ts:204-217`

The new fix assumes persisted blocked IDs in `wave >= resumeWaveIndex` were never counted and adds them up-front:

- init-time add: `for (wi = resumeWaveIndex; ...) { if (persistedBlockedTaskIds.has(taskId)) uncountedBlocked++ }`
- per-wave counting then excludes all persisted IDs.

This is not always true. Counterexample:
1. Wave N was already entered in the prior run (engine increments `blockedTasks` at wave start; see `engine.ts:204-217`).
2. That same wave also has non-blocked tasks that were still running/pending when interruption happened.
3. Resume starts at the same wave (`resumeWaveIndex = N`).
4. New init logic counts persisted blocked tasks in wave N again.

Result: `blockedTasks` is overcounted and operator-visible totals become nondeterministic across pause/resume timing.

**Suggested fix:**
- Don’t infer “already counted” solely from `resumeWaveIndex`.
- Either:
  1. derive last-entered wave from persisted runtime progress and count only truly unvisited waves, or
  2. recompute `blockedTasks` deterministically from a `countedBlockedTaskIds` set during resume reconstruction.

## Non-blocking

### A) Step 2 blocked-counter tests currently encode the same incorrect assumption
- **File:** `extensions/tests/orch-state-persistence.test.ts` (section `2.14`)

The test rationale assumes that if a blocked task was already counted, resume would start at the next wave. That is not guaranteed when the same wave has unfinished non-blocked tasks.

Also, the case title says “uncounted = 0” but assertion expects `1`, which makes intent unclear.

---

Once blocked counter reconstruction is made deterministic for already-entered resume waves, this step is close.
