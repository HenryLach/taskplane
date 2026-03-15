# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**CHANGES REQUESTED**

## Reviewed artifacts
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/PROMPT.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/STATUS.md`
- `.reviews/R006-code-step2.md`
- `extensions/taskplane/resume.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Blocking findings

### 1) Step 3 plan is not hydrated yet
`STATUS.md` Step 3 is still only prompt-level checkboxes (`STATUS.md:152-155`).

For this task size/risk (resume + persistence failure path), Step 3 needs concrete, executable verification items (exact commands, gating order, and required pass criteria), not only generic outcomes.

### 2) Step 3 does not include validation for an outstanding blocking defect from Step 2 review
R006 flagged a blocking counter drift bug (double-count risk) and requested a specific pause/resume-mid-wave regression.

Relevant current logic still shows the risky pattern:
- pre-count persisted blocked IDs from `resumeWaveIndex` onward (`resume.ts:632-643`)
- then exclude all persisted blocked IDs in per-wave counting (`resume.ts:1025-1027`)

This exact scenario must be explicitly included in Step 3 verification before sign-off.

### 3) “Targeted tests for changed modules” is undefined
Step 3 requires targeted tests, but no concrete suite/command list is present (`STATUS.md:153`).

Given Step 0-2 touched resume/persistence semantics, targeted validation must at minimum name the exact files/suites and run commands (not just a generic bullet), especially:
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Required plan updates before implementation
1. Expand Step 3 in `STATUS.md` into command-level checklist items, including:
   - targeted tests command(s),
   - full regression command (`cd extensions && npx vitest run`),
   - CLI smoke command (`node bin/taskplane.mjs help`).
2. Add an explicit “resolve R006 blocker first” item, including the regression test case for pause/crash mid-wave blocked-counter stability across resume.
3. Add pass/fail gate criteria in Step 3 (e.g., do not mark complete until targeted + full suite + CLI smoke all pass after fixes).
4. Update `Blockers` from `None` while R006 blocking issue remains open.

## Non-blocking note
- For consistency with project guidance, consider adding `node bin/taskplane.mjs doctor` as an extra smoke check if any CLI-adjacent behavior is touched while fixing Step 2 fallout.
