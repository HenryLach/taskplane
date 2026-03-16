# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**REVISE**

## Reviewed artifacts
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/PROMPT.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`
- `docs/maintainers/testing.md`
- `extensions/tests/polyrepo-fixture.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/monorepo-compat-regression.test.ts`

## Blocking findings

### 1) Step 3 is not hydrated into an execution-ready verification plan
`STATUS.md` still lists only generic prompt bullets for Step 3 (unit run, targeted run, fix failures, CLI smoke). For a Level 3 task, this is too coarse to execute/audit reliably.

### 2) No targeted test matrix tied to changed scope
The plan does not specify which files/suites must run as “targeted tests for changed modules.”

Given Steps 0–2 added/changed polyrepo + compat coverage, Step 3 should explicitly include at least:
- `tests/polyrepo-fixture.test.ts`
- `tests/polyrepo-regression.test.ts`
- `tests/monorepo-compat-regression.test.ts`
- plus impacted existing guards from prompt file scope:
  - `tests/orch-state-persistence.test.ts`
  - `tests/orch-direct-implementation.test.ts`
  - `tests/task-runner-orchestration.test.ts`
  - `tests/orch-pure-functions.test.ts`

Without this mapping, “targeted tests passed” is not verifiable.

### 3) “Fix all failures” has no triage/closure criteria
The plan has no rule for handling failures (test failure vs flaky infra vs fixture issue), no rerun policy, and no requirement to record fixes and rerun evidence in `STATUS.md`.

This conflicts with Step 3’s explicit requirement: **zero test failures allowed**.

### 4) CLI smoke check is underspecified operationally
Prompt requires `node bin/taskplane.mjs help`, but the plan does not define execution context (repo root), success criterion (exit code/output), or where to log evidence.

### 5) Status traceability cleanup is not included in Step 3 verification
`STATUS.md` still contains duplicated review/log rows and prior count inconsistencies. Step 3 is the validation gate; plan should include normalization so final delivery is auditable.

## Required updates before approval
1. Hydrate Step 3 into concrete outcome-level checklist items (3–5 items) with explicit commands and expected pass criteria.
2. Add a targeted-suite command matrix mapped to changed modules/files.
3. Add failure triage + rerun policy (what gets fixed, what gets rerun, what is recorded).
4. Specify CLI smoke command context and acceptance signal (exit code 0 + expected help output header).
5. Add a Step 3 evidence logging format in `STATUS.md` (commands run, pass/fail counts, timestamp), including cleanup of duplicate rows.

## Suggested command set (example)
- `cd extensions && npx vitest run tests/polyrepo-fixture.test.ts tests/polyrepo-regression.test.ts tests/monorepo-compat-regression.test.ts`
- `cd extensions && npx vitest run tests/orch-state-persistence.test.ts tests/orch-direct-implementation.test.ts tests/task-runner-orchestration.test.ts tests/orch-pure-functions.test.ts`
- `cd extensions && npx vitest run`
- `node bin/taskplane.mjs help`

