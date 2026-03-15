# Plan Review — TP-005 Step 1

## Verdict: REVISE

Step 1 is not yet hydrated enough for implementation. The plan in `STATUS.md` currently lists only two high-level checkboxes, but does not define the concrete model, notification contract, or edge-case behavior needed to implement “explicit partial outcomes” safely.

## What I reviewed

- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/PROMPT.md`
- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/merge-repo-scoped.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Required plan fixes before implementation

1. **Fix Step metadata inconsistency in `STATUS.md`.**
   - Header says `Current Step: Step 1` with `Status: ✅ Complete`, but Step 1 section is `🟨 In Progress` with unchecked items.
   - This should be corrected before coding to avoid automation/review confusion.

2. **Define the Step 1 outcome-model contract explicitly.**
   - Specify what “include repo attribution” means beyond current state (Step 0 already added `repoId` and `repoResults`).
   - Define whether Step 1 adds:
     - new fields to `RepoMergeOutcome`,
     - stricter guarantees for `repoResults` population,
     - or just reporting logic over existing fields.
   - Include backward-compatibility expectations (optional fields, repo-mode behavior).

3. **Define exact partial-summary emission behavior (engine + resume parity).**
   - Today both `engine.ts` and `resume.ts` emit generic `orchMergeFailed(...)` for any non-succeeded merge.
   - Plan must specify:
     - when to emit repo-scoped partial-success summary,
     - notification level (`warning` vs `error`),
     - deterministic ordering of repo lines (repoId sort),
     - fallback when no repo divergence exists.

4. **Handle mixed-outcome-lane partials separately from repo-divergence partials.**
   - Current code can set `mergeResult.status = "partial"` due to mixed succeeded+failed tasks in a lane, even with no meaningful repo divergence summary.
   - Plan must define precedence so operators are not shown misleading “cross-repo divergence” text in this case.

5. **Add concrete test plan (file-level and assertion-level).**
   - Include at least:
     - deterministic repo partial-summary formatting test,
     - execute vs resume message parity test,
     - edge case where `status="partial"` but `repoResults` is empty/mono-repo.
   - If any persisted schema/model fields change, include state validation + fixture updates in `orch-state-persistence.test.ts`.

## Suggested minimal Step 1 implementation shape

- Add a single shared formatter/helper for repo-divergence summaries (used by both `engine.ts` and `resume.ts`).
- Add/extend `ORCH_MESSAGES` template(s) for explicit partial-success, repo-attributed summary lines.
- Emit this summary only when `mergeResult.status === "partial"` and `repoResults` show divergent repo outcomes.
- Keep merge failure policy semantics unchanged in Step 1 (pause/abort behavior belongs to Step 2 hardening).

