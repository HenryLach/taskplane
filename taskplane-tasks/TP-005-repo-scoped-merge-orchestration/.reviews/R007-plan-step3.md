# Plan Review — TP-005 Step 3

## Verdict: REVISE

Step 3 is still too generic in `STATUS.md` (checklist-only). It does not yet define a concrete verification matrix for the Step 0–2 behavior that was added (repo-scoped merge sequencing, partial repo summaries, deterministic merge-failure policy/parity).

## What I reviewed

- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/PROMPT.md`
- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/STATUS.md`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/merge-repo-scoped.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `docs/maintainers/testing.md`

## Required plan fixes before execution

1. **Hydrate Step 3 with explicit command plan (targeted first, then full).**
   - Add concrete commands, e.g.:
     - `cd extensions && npx vitest run tests/merge-repo-scoped.test.ts tests/orch-state-persistence.test.ts tests/orch-direct-implementation.test.ts`
     - `cd extensions && npx vitest run`
   - Keep `node bin/taskplane.mjs help` as explicit repo-root smoke check.

2. **Map verification to Step 0–2 contracts (not just “run tests”).**
   - Step 0: repo grouping determinism + status rollup correctness
   - Step 1: repo-divergence partial summary formatting + mono-repo no-summary behavior
   - Step 2: `computeMergeFailurePolicy()` pause/abort transitions, repo fallback labeling, engine/resume parity, preserve-worktrees contract
   - Reference the existing sections in `merge-repo-scoped.test.ts` so the plan proves each contract is being re-validated.

3. **Add failure triage/re-run policy.**
   - If targeted suite fails: fix, rerun impacted files, then rerun full suite.
   - Do not mark Step 3 complete until full suite is green.

4. **Define evidence required in STATUS updates.**
   - Record exact commands run + pass counts in Execution Log.
   - Mark Step 3 checkboxes only after command outputs are confirmed (no failed tests, no unresolved errors).

## Suggested minimal Step 3 block

- Targeted verification commands (named files)
- Full regression command
- CLI smoke command
- Triage + rerun gate
- Evidence logging requirement

Once those details are added to `STATUS.md`, Step 3 will be implementation-ready.
