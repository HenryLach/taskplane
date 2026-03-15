# Code Review — TP-005 Step 0

## Verdict: REVISE

Step 0 is close, but there are correctness issues in repo-scoped merge result propagation and status aggregation that should be fixed before approval.

## What I reviewed

- Diff range: `git diff 42aa159..HEAD`
- Changed files:
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/merge.ts`
  - `extensions/taskplane/messages.ts`
  - `extensions/taskplane/resume.ts`
  - `extensions/taskplane/types.ts`
  - `extensions/tests/merge-repo-scoped.test.ts`
- Neighboring consistency checks:
  - `extensions/taskplane/waves.ts` (repo root/base branch resolution helpers)
  - `extensions/taskplane/index.ts` and `extensions/task-orchestrator.ts` (exports)
  - `extensions/tests/waves-repo-scoped.test.ts` (test style and scope)

## Findings

### 1) Missing `repoId` propagation in `MergeLaneResult` breaks per-repo cleanup routing
**Severity:** High

`engine.ts` and `resume.ts` now resolve cleanup repo roots from `lr.repoId`:
- `extensions/taskplane/engine.ts:726`
- `extensions/taskplane/resume.ts:705`
- `extensions/taskplane/resume.ts:1034`

But `mergeWave()` never sets `repoId` when pushing lane results:
- `extensions/taskplane/merge.ts:643`
- `extensions/taskplane/merge.ts:711`

So in workspace mode, aggregated lane results from `mergeWaveByRepo()` carry `repoId = undefined`, and cleanup falls back to default `repoRoot` instead of each lane’s owning repo. This causes incorrect/ineffective branch cleanup and can produce misleading ancestor checks.

**Recommended fix:** Ensure `repoId` is populated on every `MergeLaneResult` (either directly in `mergeWave()` via `repoId: lane.repoId`, or patched in `mergeWaveByRepo()` before aggregation).

---

### 2) Aggregate wave status misclassifies “all repos partial” as `failed`
**Severity:** Medium

In `mergeWaveByRepo()`, status rollup logic treats only `status === "succeeded"` as success:
- `extensions/taskplane/merge.ts:988-997`

Current logic:
- `anyRepoSucceeded = repoOutcomes.some(r => r.status === "succeeded")`
- `anyRepoFailed = repoOutcomes.some(r => r.status === "failed" || r.status === "partial")`

If every repo is `partial` (i.e., some merges succeeded in each repo but each had a failure), aggregate status becomes `failed`, not `partial`.

That conflicts with the Step 0 contract in `STATUS.md` (“if SOME fail → `partial`; if ALL fail → `failed`”).

**Recommended fix:** Base aggregate status on global merge success/failure evidence (e.g., any merged lanes vs any failures), or treat per-repo `partial` as both success and failure for rollup purposes.

---

### 3) Test coverage does not validate the new multi-repo merge aggregator behavior
**Severity:** Medium

`extensions/tests/merge-repo-scoped.test.ts` only exercises `groupLanesByRepo()` + `determineMergeOrder()`. It does not test:
- `mergeWaveByRepo()` aggregation behavior
- failure rollup edge cases (including all-partial)
- propagation of `repoId` into merged lane outputs used by cleanup

Given the above defects slipped through, targeted tests for `mergeWaveByRepo` rollup semantics are needed.

## Validation run

- `cd extensions && npx vitest run` ✅ (207/207 passed)

Passing tests are good, but they currently miss critical Step 0 merge aggregation semantics.
