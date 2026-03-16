# R005 — Plan Review (Step 2: Protect monorepo compatibility)

## Verdict
**REVISE**

## Reviewed artifacts
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/PROMPT.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-pure-functions.test.ts`
- `extensions/tests/task-runner-orchestration.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `docs/maintainers/testing.md`

## Blocking findings

### 1) Step 2 is still not implementation-ready in `STATUS.md`
Step 2 currently has only two prompt-level bullets and no concrete outcome-level plan (no per-file intent, no assertion targets, no acceptance checkpoints). For a Level 3 review task, this is too coarse to execute/review safely.

### 2) No explicit monorepo compatibility contract matrix
The plan does not enumerate the monorepo behaviors that must remain unchanged and where each one will be asserted.

A minimal matrix is needed (contract → file → assertion), e.g.:
- repo-mode state invariants and v1→v2 defaults (`mode: repo`, optional repo fields absent)
- repo-mode discovery/routing remains unrouted
- repo-mode naming/session/lane behavior remains unscoped
- non-orchestrated task-runner archival semantics remain unchanged

### 3) No delta against already-existing back-compat coverage
There is already meaningful monorepo/back-compat signal in existing tests (for example repo-mode checks in `polyrepo-regression.test.ts`, multiple repo-mode sections in `discovery-routing.test.ts`, and repo-mode persistence checks in `orch-state-persistence.test.ts`).

The Step 2 plan must state what is **new** vs what is already covered, otherwise implementation risks duplication without increasing regression protection.

### 4) Documentation deliverable is underspecified
Step 2 requires maintainer documentation for fixture usage/limitations, but no target sections are identified.

`docs/maintainers/testing.md` currently has no polyrepo-vs-monorepo guidance, no fixture-selection guidance, and no explicit limitations section. Plan should define exact section additions.

### 5) Step 2 verification commands are missing
No targeted command set is listed for Step 2-only changes. Add file-scoped vitest commands for touched suites, with full-suite execution deferred to Step 3.

## Required updates before approval
1. Hydrate Step 2 in `STATUS.md` into 3–5 concrete outcomes with target files.
2. Add a monorepo compatibility matrix (contract → assertion location).
3. Identify Step 2 deltas vs existing baseline coverage.
4. Define exact additions to `docs/maintainers/testing.md` (section names + scope).
5. Add targeted Step 2 verification commands.

## Non-blocking note
`STATUS.md` still contains duplicate rows in review/execution tables; optional cleanup would improve traceability.
