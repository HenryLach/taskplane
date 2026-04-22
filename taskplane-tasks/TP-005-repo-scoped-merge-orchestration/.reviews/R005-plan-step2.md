# Plan Review — TP-005 Step 2

## Verdict: REVISE

Step 2 is not implementation-ready yet. In `STATUS.md`, Step 2 is still checklist-only and does not define the concrete failure-policy/artifact behaviors needed for repo-scoped merge failures.

## What I reviewed

- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/PROMPT.md`
- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/STATUS.md`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/merge-repo-scoped.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## Required plan fixes before implementation

1. **Hydrate deterministic failure-policy contract (engine + resume).**
   - Specify exact behavior when `mergeResult.status` is `partial`/`failed` in workspace mode with multiple repo failures.
   - Define deterministic failure identity for operator output:
     - lane-level failures (`lane-<n>`)
     - repo setup failures with no failed lane (`repo:<id>` fallback)
   - Ensure `/orch` and `/orch-resume` use the same decision/output rules (currently they differ in detail level).

2. **Hydrate debug artifact preservation contract.**
   - Explicitly state which artifacts must be preserved on merge failure pause/abort and why:
     - `.pi/batch-state.json`
     - merge sidecars (`merge-result-*`, and whether failed `merge-request-*` should be retained)
     - worktrees/branches for manual intervention
   - Define cleanup boundary: what is skipped immediately on pause/abort vs what `/orch-abort` later cleans.

3. **Cover repo-scoped setup-failure edge cases.**
   - `mergeWaveByRepo()` can fail a repo before lane merge (`failedLane=null`), so plan must include handling and messaging for this path.
   - Avoid lane `0`-style ambiguous reporting in plan semantics.

4. **Add targeted tests in the plan (not just broad “run vitest”).**
   - `extensions/tests/orch-state-persistence.test.ts`
     - partial repo failure + `on_merge_failure: pause` ⇒ `phase=paused`, persist reason `merge-failure-pause`, cleanup suppressed
     - repo setup failure (no failed lane) + `abort` ⇒ `phase=stopped`, persist reason `merge-failure-abort`, cleanup suppressed
   - `extensions/tests/*direct-implementation*` or equivalent source-contract assertions
     - engine/resume parity for merge-failure handling branches
   - Optional but recommended: extend `merge-repo-scoped.test.ts` for deterministic failure-label ordering across repos.

## Suggested minimal Step 2 plan shape

- Add a short **Step 2 Contract** block in `STATUS.md` defining:
  - deterministic pause/abort behavior for repo-scoped partials/failures
  - deterministic failed-target labeling (lane and repo fallback)
  - artifact retention guarantees for manual intervention/resume
- List function-level edits (`engine.ts`, `resume.ts`, possibly `messages.ts`/`merge.ts`) and exact tests to add/update.

Once that hydration is added, this step should be ready for implementation review.
