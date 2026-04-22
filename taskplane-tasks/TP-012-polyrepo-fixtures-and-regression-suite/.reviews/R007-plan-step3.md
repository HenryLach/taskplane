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
- `extensions/taskplane/waves.ts`

## Blocking findings

### 1) Step 3 is still too generic for a Level 3 verification gate
`STATUS.md` lists prompt-level bullets only. For this task size/risk, Step 3 needs an execution-ready command plan with explicit pass criteria and evidence capture.

### 2) “Targeted tests” are not mapped to changed scope
The plan does not define which suites constitute targeted verification for Steps 0–2 changes.

Minimum targeted matrix should include:
- `tests/polyrepo-fixture.test.ts`
- `tests/polyrepo-regression.test.ts`
- `tests/monorepo-compat-regression.test.ts`
- plus impacted baseline guards from task file scope:
  - `tests/orch-state-persistence.test.ts`
  - `tests/orch-direct-implementation.test.ts`
  - `tests/task-runner-orchestration.test.ts`
  - `tests/orch-pure-functions.test.ts`

### 3) Step 3 does not include closure of outstanding review defects
There is still an open code-quality issue from Step 2 (`buildDependencyGraph(pending)` used with missing `completed` arg in `monorepo-compat-regression.test.ts`, while signature is `(pending, completed)`).

Step 3 plan must explicitly require resolving open review findings before final verification runs, not only reacting to test failures.

### 4) CLI smoke check is underspecified
Prompt requires `node bin/taskplane.mjs help`, but the plan does not define execution context (repo root), acceptance signal (exit code 0 + help header), or logging format in `STATUS.md`.

### 5) Auditability controls are missing from the plan
`STATUS.md` already shows duplicated review/log rows and prior count drift. Step 3 should include a normalization step so final verification is traceable and reproducible.

## Required updates before approval
1. Hydrate Step 3 into 3–5 concrete outcomes with exact commands.
2. Add targeted test matrix mapped to changed files/modules.
3. Add explicit “close outstanding review findings” gate before final full-suite run.
4. Define CLI smoke execution context + success criteria.
5. Define evidence logging format in `STATUS.md` (timestamp, command, file/test counts, result) and clean duplicate rows.

## Suggested command set
- `cd extensions && npx vitest run tests/polyrepo-fixture.test.ts tests/polyrepo-regression.test.ts tests/monorepo-compat-regression.test.ts`
- `cd extensions && npx vitest run tests/orch-state-persistence.test.ts tests/orch-direct-implementation.test.ts tests/task-runner-orchestration.test.ts tests/orch-pure-functions.test.ts`
- `cd extensions && npx vitest run`
- `cd . && node bin/taskplane.mjs help`
