# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-011-routing-ownership-enforcement/PROMPT.md`
- `taskplane-tasks/TP-011-routing-ownership-enforcement/STATUS.md`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/workspace-config.test.ts`
- Prior review: `.reviews/R006-code-step2.md`

## Validation performed
- `cd extensions && npx vitest run tests/discovery-routing.test.ts tests/workspace-config.test.ts` ✅ (145/145)
- `cd extensions && npx vitest run` ❌ (4 failed files, 3 failed tests, 1 failed suite)
- `node bin/taskplane.mjs help` ✅

## Blocking findings

### 1) Step 3 is not hydrated into executable plan items
`STATUS.md` Step 3 currently has only four prompt-level checkboxes (unit, targeted, failures, CLI).

For Review Level 2, Step 3 needs concrete checklist items with exact commands, expected outputs, and failure-handling steps (similar hydration quality used in earlier steps).

### 2) Plan does not resolve the prompt’s zero-failure contract
`PROMPT.md` Step 3 explicitly requires:
- “ZERO test failures allowed”
- “Fix all failures”

Current repo run is red (`npx vitest run` fails in 4 files):
- `tests/orch-direct-implementation.test.ts` (no suite)
- `tests/orch-pure-functions.test.ts`
- `tests/orch-state-persistence.test.ts`
- `tests/task-runner-orchestration.test.ts`

The current Step 3 plan does not define how this will be resolved (fix now vs explicit blocker/escalation). Without that, Step 3 completion criteria are non-deterministic.

### 3) Missing targeted verification matrix for TP-011 changed surface
TP-011 touched routing strict behavior across discovery/workspace and command-surface hints. Step 3 should explicitly list targeted verification commands and scope mapping (not just “targeted tests passing”).

At minimum, plan should include:
- `tests/discovery-routing.test.ts` (strict/permissive + pipeline + command-surface hint assertions)
- `tests/workspace-config.test.ts` (routing.strict type/null schema validation)

## Required updates before approval
1. Hydrate Step 3 in `STATUS.md` into concrete sub-steps (command-level granularity).
2. Add explicit pass/fail policy aligned to prompt contract:
   - either make full suite green,
   - or mark Step 3 blocked and capture required external decision (do not mark complete while red).
3. Add a compact Step 3 verification matrix mapping TP-011 acceptance bullets to exact test sections/commands.
4. Add evidence-capture fields in Step 3 results for each command:
   - command run,
   - exit code,
   - counts,
   - disposition if failed.

## Non-blocking note
The “pre-existing failures” discovery entry should be refreshed with exact current failure shape (failed files/tests/suite), since current full-run output differs from earlier shorthand.
