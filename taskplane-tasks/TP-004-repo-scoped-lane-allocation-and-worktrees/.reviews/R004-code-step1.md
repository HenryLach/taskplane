# R004 Code Review — TP-004 Step 1

## Verdict
**changes-requested**

## Scope Reviewed
Baseline: `c8a0e3f` → `HEAD`  
Step: **Step 1: Make worktree operations repo-scoped**

Changed files:
- `extensions/taskplane/waves.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`

## Findings

### 1) Cross-repo rollback removes reused (pre-existing) worktrees, not just newly created ones
**Severity:** High  
**Files:**
- `extensions/taskplane/waves.ts:998-1007, 1045-1048`
- `extensions/taskplane/worktree.ts:1213, 1267`

`allocateLanes()` stores `worktreeResult.worktrees` for successful repo groups in `allWorktrees`, then on a later group failure it calls `removeWorktree()` for all prior group lanes.

However, `ensureLaneWorktrees()` returns `worktrees: selected`, and `selected` contains **both**:
- reused existing worktrees (`selected.push(reused)`), and
- newly created worktrees (`selected.push(wt)` after `createdNow.push(wt)`).

So rollback currently deletes reused/pre-existing worktrees too. That contradicts the intended contract for Step 1 (“roll back previously-created lanes from this wave”) and can unexpectedly tear down stable lanes from earlier waves.

**Recommendation:** Track and roll back only worktrees created in this allocation attempt (per repo group). Options:
- extend `ensureLaneWorktrees()` result with `createdNow`, or
- pre-snapshot existing lanes and compute created delta before rollback.

---

### 2) `rolledBack` is hard-coded to `true` even when rollback errors occur
**Severity:** Medium  
**File:** `extensions/taskplane/waves.ts:1039`

On group failure, return payload sets `rolledBack: true` unconditionally, even when:
- `worktreeResult.rolledBack === false`, or
- `worktreeResult.rollbackErrors.length > 0`, or
- cross-repo rollback produced `rollbackErrors`.

This regresses observability/contract accuracy and may mislead resume/ops decisions.

**Recommendation:** Compute `rolledBack` from actual outcomes, e.g.:
- `worktreeResult.rolledBack && rollbackErrors.length === 0`.

## Validation Notes
- Ran targeted tests:
  - `cd extensions && npx vitest run tests/waves-repo-scoped.test.ts` ✅ (19 passed)
- Ran full suite:
  - `cd extensions && npx vitest run` ❌ (contains pre-existing unrelated failures; no direct new failure signal for this step)

