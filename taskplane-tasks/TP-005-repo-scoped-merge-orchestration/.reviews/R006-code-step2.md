# Code Review — TP-005 Step 2 (Harden failure behavior)

## Verdict: APPROVE

I reviewed the Step 2 changes in `87d736a..HEAD` and did not find blocking issues.

## What I reviewed

- Diff range: `git diff 87d736a..HEAD`
- Changed implementation files:
  - `extensions/taskplane/messages.ts`
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/resume.ts`
  - `extensions/tests/merge-repo-scoped.test.ts`
- Neighboring consistency checks:
  - `extensions/taskplane/merge.ts` (repo ordering/failure attribution assumptions)
  - `extensions/taskplane/index.ts` / `extensions/task-orchestrator.ts` (exports)
  - `extensions/taskplane/types.ts` (policy/config/result contracts)

## Validation

- `cd extensions && npx vitest run tests/merge-repo-scoped.test.ts` ✅
- `cd extensions && npx vitest run` ✅ (11 files, 207 tests)

## Assessment

### ✅ Deterministic failure-policy handling is now centralized

- `computeMergeFailurePolicy()` in `messages.ts` cleanly centralizes:
  - pause vs abort phase transition
  - persisted trigger reason
  - error message text
  - notification text/level
  - failed target attribution (`lane-*` with repo fallback)
- `engine.ts` and `resume.ts` both call the same helper, removing prior behavior drift risk.

### ✅ Repo-scoped setup-failure attribution is covered

- For `failedLane=null` paths (e.g., setup failures), helper now falls back to repo labels via `repoResults`.
- This avoids ambiguous/no-target reporting in workspace-mode failures.

### ✅ Cleanup-preservation contract remains intact

- Both engine and resume still set `preserveWorktreesForResume = true` on merge failure and break the wave loop.
- Persist-before-cleanup decision remains explicit via `persistRuntimeState(policyResult.persistTrigger, ...)`.

### ✅ Test coverage is strong for this step

- Added targeted coverage for:
  - pause and abort policy outputs
  - setup-failure (`failedLane=null`) behavior
  - multi-lane attribution
  - deterministic output/parity behavior
  - reason truncation behavior
  - repo fallback + lane-priority precedence

## Non-blocking note

- `computeMergeFailurePolicy()` assumes deterministic `repoResults` ordering from upstream producers (`mergeWaveByRepo`). That is true today. If future callers can provide unsorted `repoResults`, consider defensive sorting inside the helper to preserve deterministic output at the function boundary.
