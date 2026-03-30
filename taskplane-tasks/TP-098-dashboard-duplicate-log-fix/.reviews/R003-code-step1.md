# R003 — Code Review (Step 1: Fix duplicate execution log #348)

## Verdict
**CHANGES REQUESTED**

## Scope Reviewed
Diff range: `b0c64a76760169e79bfaefa89774b7157e7ffe28..HEAD`

Primary code changes:
- `extensions/task-runner.ts`
- `extensions/tests/task-runner-duplicate-log.test.ts`

Context checked:
- `extensions/tests/persistent-worker-context.test.ts`
- `dashboard/public/app.js`
- `dashboard/server.cjs`

## What looks good
- Root-cause direction is reasonable: duplication originates in task-runner lifecycle logging, not dashboard render/parser.
- `executeTask` now differentiates startup vs resume (`Task started` vs `Task resumed`).
- Step-start logging guard (`ss?.status !== "in-progress"`) is a good idempotency improvement.
- Iteration log labels switched to `state.totalIterations`, which addresses restart label collisions.
- Added targeted TP-098 tests that pass in isolation.

## Findings

### 1) Full test suite regression introduced (blocking)
- **Severity:** High
- **Files:**
  - `extensions/tests/persistent-worker-context.test.ts:234-240`
  - `extensions/tests/persistent-worker-context.test.ts:368-376`
- **Evidence:**
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/persistent-worker-context.test.ts`
  - Failing tests:
    - `3.4: stall detection logs iteration number and progress info`
    - `6.3: after worker exits, remaining steps are recomputed from STATUS.md`
- **Why this matters:**
  - Branch is not green after Step 1 changes. Existing source-pattern tests are now stale/brittle relative to the new behavior.
- **Required fix:**
  - Update `persistent-worker-context.test.ts` expectations to match the new semantics (`state.totalIterations`), and make the `6.3` assertion robust against nearby comment growth (avoid fixed `slice(..., +500)` fragility).

### 2) Accidental probe artifact committed
- **Severity:** Medium
- **File:** `tmp/_probe.txt`
- **Issue:** Non-functional scratch file included in step diff.
- **Why this matters:** Adds repo noise and is outside task scope.
- **Required fix:** Remove `tmp/_probe.txt` from this task changeset.

## Validation Notes
Commands run:
- `git diff b0c64a76760169e79bfaefa89774b7157e7ffe28..HEAD --name-only`
- `git diff b0c64a76760169e79bfaefa89774b7157e7ffe28..HEAD`
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/task-runner-duplicate-log.test.ts` ✅
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/persistent-worker-context.test.ts` ❌ (2 failures)
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts` ❌ (same 2 failures)
