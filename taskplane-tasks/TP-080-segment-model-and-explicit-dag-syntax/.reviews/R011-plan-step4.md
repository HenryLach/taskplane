# Plan Review — TP-080 Step 4 (Testing & Verification)

## Verdict: APPROVE

Step 4 in `STATUS.md` is now implementation-ready and addresses the blockers from R010.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`

## Why this is approved

1. **Required Step 4 artifact is now explicit**
   - Plan includes creation of `extensions/tests/segment-model.test.ts` with behavioral contract checks.

2. **Coverage matrix is concrete and file-mapped**
   - Parser/validation behavior is assigned to `discovery-routing.test.ts`.
   - Inference/planner mechanics are assigned to `waves-repo-scoped.test.ts`.
   - Cross-flow non-regression is assigned to `polyrepo-regression.test.ts`.
   - Cross-contract shape/ordering/error-path assertions are assigned to `segment-model.test.ts`.

3. **Critical TP-080 contracts are explicitly covered**
   - Segment ID contract (`<taskId>::<repoId>`).
   - Deterministic segment/edge ordering.
   - Explicit DAG authority in mixed explicit/inferred batches.
   - Backward compatibility when `## Segment DAG` is absent.
   - Repo-singleton fallback guard for noisy file-scope inputs.
   - `computeWaveAssignments()` segment-plan behavior on success and error paths.

4. **Execution command matches prompt requirement**
   - Plan now includes the exact full-suite command required by `PROMPT.md` and an explicit “fix all failures” step.

## Non-blocking guidance

- Keep new assertions black-box/contract-oriented (input/output), not implementation-detail-dependent.
- When asserting deterministic maps, compare key order and serialized value structure to guard against insertion-order regressions.
