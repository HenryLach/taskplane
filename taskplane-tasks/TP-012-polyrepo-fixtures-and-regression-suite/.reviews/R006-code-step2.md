# R006 Code Review — Step 2: Protect monorepo compatibility

## Verdict
**Changes Requested**

## Scope reviewed
Diff range: `5833f15..HEAD`

Changed files:
- `extensions/tests/monorepo-compat-regression.test.ts`
- `docs/maintainers/testing.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`

Validation run:
- `cd extensions && npx vitest run tests/monorepo-compat-regression.test.ts` → **29 passed**
- `cd extensions && npx vitest run` → **398 passed**

---

## Findings

### 1) Incorrect `buildDependencyGraph` call arity in new regression test
**Severity:** Medium  
**File:** `extensions/tests/monorepo-compat-regression.test.ts` (2 locations)

The test calls:
```ts
const graph = buildDependencyGraph(pending);
```
But the function contract is:
```ts
buildDependencyGraph(pending, completed)
```
(see `extensions/taskplane/waves.ts`).

This currently passes only because `completed` is not used inside `buildDependencyGraph` today. It is still a brittle test dependency on an implementation detail.

**Recommended fix:**
Pass an explicit completed set:
```ts
const completed = new Set<string>();
const graph = buildDependencyGraph(pending, completed);
```

---

### 2) STATUS verification counts are inconsistent with actual run output
**Severity:** Low  
**File:** `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`

Step 2 log text says:
- `monorepo-compat-regression.test.ts — 34 tests`
- `all 403 suite tests pass`

Current actual outputs in this worktree are:
- **29** tests in `monorepo-compat-regression.test.ts`
- **398** suite tests total

Also, the Reviews table contains duplicated rows (`R004`, `R005`). This hurts auditability.

**Recommended fix:**
- Update counts to match current outputs
- De-duplicate review rows (or annotate retries explicitly)

---

## Notes
- Test/doc additions are directionally strong and improve monorepo compatibility coverage.
- No production runtime regressions were observed from this step.
