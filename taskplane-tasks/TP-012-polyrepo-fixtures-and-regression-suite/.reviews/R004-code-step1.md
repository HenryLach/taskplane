# R004 — Code Review (Step 1: Add end-to-end polyrepo regression tests)

## Verdict
**APPROVE**

Step 1 adds substantial deterministic regression coverage and the suite passes both targeted and full runs.

## Scope reviewed
Diff range: `9cc1c0b..HEAD`

Changed files:
- `extensions/tests/polyrepo-regression.test.ts`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`

Neighboring consistency checks:
- `extensions/tests/polyrepo-fixture.test.ts`
- `extensions/tests/naming-collision.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## Validation performed
- `git diff 9cc1c0b..HEAD --name-only` ✅
- `git diff 9cc1c0b..HEAD` ✅
- `cd extensions && npx vitest run tests/polyrepo-regression.test.ts` ✅ (47 passed)
- `cd extensions && npx vitest run` ✅ (369 passed)

## Findings
No blocking issues found.

## Non-blocking suggestions
1. **Tighten branch naming assertion in `6.3`**
   - `extensions/tests/polyrepo-regression.test.ts` currently synthesizes branch strings instead of asserting through production branch naming/allocation paths.
   - Suggestion: use `generateBranchName()` and/or allocated lane outputs directly so the test fails on real branch-naming regressions.

2. **Trim unused imports/helpers in `polyrepo-regression.test.ts`**
   - There are multiple unused imports and helper stubs, which add noise and make maintenance harder.

3. **STATUS hygiene**
   - `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md` still contains duplicate review/log rows; consider deduplicating for cleaner traceability.
