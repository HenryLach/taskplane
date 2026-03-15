# Plan Review — TP-005 Step 0

## Verdict: REVISE

The current step plan is not sufficiently hydrated for implementation review yet. In `STATUS.md`, Step 0 is still only checklist-level and does not define the concrete code-path changes needed to safely partition merge flow by repo.

## What I reviewed

- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/PROMPT.md`
- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/STATUS.md`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/waves.ts` (existing repo-root/base-branch resolution patterns)
- `extensions/tests/waves-repo-scoped.test.ts`

## Required plan fixes before implementation

1. **Add function-level change plan (currently missing).**
   - Specify exactly where repo partitioning happens (`engine.ts` vs `merge.ts`).
   - Specify new/updated helper functions and return contracts.

2. **Define repo context resolution explicitly.**
   - Plan must state how each repo group gets:
     - `repoRoot` (from workspace config)
     - `baseBranch` (per-repo `defaultBranch` fallback chain)
   - Reuse established patterns from `waves.ts` (`resolveRepoRoot`, `resolveBaseBranch`) to avoid divergence.

3. **Define deterministic per-repo merge sequencing and aggregation.**
   - Repo groups should run in deterministic order (sorted repo key; repo-mode default group stable).
   - Plan must define how per-repo `mergeWave()` results roll up into one wave-level result used by failure policy handling.

4. **Address post-merge cleanup implications.**
   - Current cleanup in `engine.ts` deletes merged branches using a single `repoRoot` + `baseBranch`.
   - With repo-scoped merge, plan must at least account for non-default repo branches (implement now or explicitly stage as a follow-up with guardrails).

5. **Add targeted tests in the plan.**
   - Include at least one deterministic grouping test and one per-repo root/branch resolution test for Step 0 behavior.
   - Identify exact test files to modify/add (likely `extensions/tests/*state-persistence*` and/or `*direct-implementation*` per task scope).

## Suggested minimal Step 0 implementation shape

- In `engine.ts`, derive mergeable lanes, then group by `lane.repoId`.
- For each repo group:
  - resolve repo root + base branch
  - call `mergeWave()` with that repo context
- Aggregate group results into one wave-level merge decision for existing failure-policy path.
- Preserve repo-mode behavior as a no-op regression case (single group).

## Notes

- `messages.ts` currently hardcodes “into develop” in merge start text. Not blocking Step 0 mechanics, but this should be updated when Step 1 outcome/reporting changes land.
