# Code Review — TP-005 Step 0

## Verdict: REVISE

Repo-scoped merge partitioning is largely in place, but there is still a correctness gap in aggregate failure detection for repo-level setup failures.

## What I reviewed

- Diff range: `git diff 42aa159..HEAD`
- Changed code files:
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/merge.ts`
  - `extensions/taskplane/messages.ts`
  - `extensions/taskplane/resume.ts`
  - `extensions/taskplane/types.ts`
  - `extensions/tests/merge-repo-scoped.test.ts`
- Neighboring consistency check:
  - `extensions/taskplane/waves.ts` (`resolveRepoRoot`, `resolveBaseBranch` patterns)

## Findings

### 1) Repo-level merge setup failures can be misclassified as global `succeeded`
**Severity:** High

`mergeWaveByRepo()` determines aggregate failure via `firstFailedLane !== null`:
- `extensions/taskplane/merge.ts:995`

But `mergeWave()` can return `status: "failed"` with `failedLane: null` for pre-lane setup failures:
- temp branch creation failure: `extensions/taskplane/merge.ts:566-570`
- merge worktree creation failure: `extensions/taskplane/merge.ts:578-582`

In that case, `mergeWaveByRepo()` currently does **not** record failure (`firstFailedLane` stays `null`), so aggregate status can incorrectly become `"succeeded"` even when a repo failed before lane merges.

**Impact:** Wrong wave status, incorrect failure-policy routing in engine/resume, and misleading operator output.

**Recommended fix:** Track failure independently of `failedLane` (e.g., `groupResult.status !== "succeeded"` or explicit `anyFailure` flag). Keep lane-level success detection for partial-vs-failed, but include repo setup failures in failure evidence and first failure reason attribution.

---

### 2) Tests still do not exercise `mergeWaveByRepo()` real behavior
**Severity:** Medium

`extensions/tests/merge-repo-scoped.test.ts` validates grouping and a simulated rollup helper, but it does not execute `mergeWaveByRepo()` itself (`extensions/tests/merge-repo-scoped.test.ts:242-254`).

Because of that, the setup-failure misclassification above is not caught.

**Recommended fix:** Add focused tests around `mergeWaveByRepo()` aggregation paths, especially:
- repo setup failure with no lane-level failed lane
- mixed success + repo setup failure => `partial`
- all repos setup-fail => `failed`

## Validation

- `cd extensions && npx vitest run tests/merge-repo-scoped.test.ts` ✅
- `cd extensions && npx vitest run` ✅ (207 passed)

