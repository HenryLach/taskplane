# Code Review — TP-005 Step 1 (Update outcome modeling)

## Verdict: APPROVE

Step 1 requirements are met, and I did not find blocking issues.

## What I reviewed

- Diff range: `git diff e205796..HEAD`
- Changed code files:
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/merge.ts`
  - `extensions/taskplane/messages.ts`
  - `extensions/taskplane/resume.ts`
  - `extensions/tests/merge-repo-scoped.test.ts`
- Neighboring consistency checks:
  - `extensions/taskplane/types.ts` (merge outcome contracts)
  - `extensions/taskplane/index.ts` / `extensions/task-orchestrator.ts` (exports)

## Validation

- `cd extensions && npx vitest run tests/merge-repo-scoped.test.ts` ✅
- `cd extensions && npx vitest run` ✅ (11 files, 207 tests)

## Assessment

### ✅ Correctness

- `mergeWaveByRepo()` now correctly treats repo setup failures (`status: "failed"` with `failedLane: null`) as failures via `anyRepoFailed`, fixing prior misclassification risk.
- Aggregate status logic now uses both repo-level failure evidence and lane-level success evidence, which matches expected partial/failed semantics.

### ✅ Step 1 behavior delivered

- Added shared formatter: `formatRepoMergeSummary()` in `messages.ts`.
- Added user-facing template: `ORCH_MESSAGES.orchMergePartialRepoSummary`.
- Wired identical partial-summary emission in both:
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/resume.ts`
- Summary only emits for partial merges with actual repo-status divergence, avoiding misleading output for mono-repo or same-status repo outcomes.

### ✅ Test coverage

- Added targeted assertions for:
  - repo-divergence summary generation
  - mono-repo / undefined repoResults no-op
  - same-status repo outcomes no-op
  - deterministic output ordering
  - ORCH template integration
  - mixed-outcome-lane partials without repo divergence

## Non-blocking note

- `formatRepoMergeSummary()` currently relies on upstream `repoResults` ordering for deterministic output (which is true today via `groupLanesByRepo`). If this helper is reused from other producers in future, consider a defensive in-function sort by `repoId`.
