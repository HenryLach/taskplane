# R008 Code Review — TP-009 Step 3 (Testing & Verification)

## Verdict: **REVISE**

Step 3 is not yet verifiable as complete.

## What I reviewed
- Diff range required by prompt:
  - `git diff ffeff62..HEAD --name-only` → **no files changed**
  - `git diff ffeff62..HEAD` → **empty diff**
- Neighboring/related files checked for consistency:
  - `dashboard/public/app.js`
  - `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
- Validation commands executed:
  - `cd extensions && npx vitest run` → ✅ 12 files, 290/290 tests pass
  - `cd extensions && npx vitest run tests/orch-state-persistence.test.ts tests/merge-repo-scoped.test.ts tests/waves-repo-scoped.test.ts tests/workspace-config.test.ts` → ✅ 4 files, 67/67 tests pass
  - `node bin/taskplane.mjs help` → ✅ exits 0
  - `node bin/taskplane.mjs doctor` → ❌ exits 1 (5 config issues reported)

---

## Findings

### 1) Step 3 has no committed artifacts in the requested review range
**Severity:** Medium  
**Evidence:** `ffeff62..HEAD` is empty.

For this step review, there are no committed changes to inspect. If Step 3 is intended to be “verification-only,” the evidence must still be committed (typically STATUS updates and/or new regression tests) so the step is auditable from the baseline range.

---

### 2) STATUS claims repo-filter disappearance handling is verified, but implementation still has UI/state desync
**Severity:** **High**  
**Files:**
- `dashboard/public/app.js` (around lines 187–222)
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md` (scenario matrix row at line ~125)

`STATUS.md` says:
- repo filter disappearing repo case is verified (`updateRepoFilter()` resets selection to “All”).

But `updateRepoFilter()` still only resets internal `selectedRepo` on hide (`!shouldShow`) and returns early without synchronizing `$repoFilter.value`. On hide→show with unchanged options, UI value can remain stale while logic uses `selectedRepo = ""`.

Repro (logic-equivalent) still yields mismatch:
- `{ selectedRepo: '', uiValue: 'B' }`

So the “Repo filter → disappearing repo” verification claim is currently not correct.

---

### 3) STATUS marks doctor smoke check as passing, but command currently exits non-zero
**Severity:** Low  
**File:** `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md` (lines ~117, ~139)

Current run:
- `node bin/taskplane.mjs doctor` exits with code **1** and reports missing project config files.

If this is expected in this worktree, wording should be explicit (e.g., “command executes and fails as expected in uninitialized worktree”) rather than “passing.”

---

## Required before approval
1. Commit Step 3 artifacts (at minimum updated `STATUS.md`; ideally regression test coverage for the repo-filter hide→show sync path).
2. Fix repo-filter UI/state synchronization in `updateRepoFilter()` (sync DOM value when hiding and after reconciliation).
3. Re-run verification and update STATUS evidence to match actual command outcomes (including `doctor` semantics).

