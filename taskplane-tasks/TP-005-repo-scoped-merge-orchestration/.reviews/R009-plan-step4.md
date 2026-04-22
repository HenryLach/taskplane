# Plan Review — TP-005 Step 4 (Documentation & Delivery)

## Verdict: REVISE

Step 4 is not execution-ready yet.

## What I reviewed

- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/PROMPT.md`
- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/STATUS.md`
- `taskplane-tasks/TP-005-repo-scoped-merge-orchestration/.reviews/R008-code-step3.md`
- `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md`
- `docs/reference/commands.md`

## Blocking findings

1. **Step 4 is still checklist-only, not hydrated.**
   In `STATUS.md`, Step 4 remains five coarse items only. For this task/review level, Step 4 needs concrete substeps (4.1/4.2/4.3...), explicit files, exact acceptance checks, and evidence logging requirements.

2. **Prompt-required doc update is not operationalized.**
   `PROMPT.md` requires updating `.pi/local/docs/taskplane/polyrepo-support-spec.md` with TP-005 merge semantics and non-atomic policy. Current Step 4 plan does not define:
   - which sections will be edited,
   - which delivered TP-005 behaviors must be recorded (repo-grouped merge execution, deterministic ordering, partial/failed rollup, repo-attributed outcomes),
   - what evidence will be logged in `STATUS.md`.

3. **“Check If Affected” doc review has no decision contract.**
   `PROMPT.md` requires reviewing `docs/reference/commands.md` if operator-facing merge output changed. Step 4 must include an explicit decision record: `updated` or `not updated`, with rationale.

4. **Delivery gate is missing review-resolution criteria.**
   Step 4 currently allows moving to `.DONE` while `R008-code-step3.md` still has `Verdict: REVISE` recorded in artifacts. Add a hard pre-`.DONE` gate requiring review disposition cleanup (approved follow-up or explicit blocker disposition in STATUS).

5. **Step 4 has a prompt mismatch item.**
   `STATUS.md` includes `Archive and push`, but `PROMPT.md` says archive is auto-handled by task-runner. Replace this with prompt-aligned closeout checks only.

## Required plan updates before approval

1. Hydrate Step 4 into concrete substeps with explicit file targets and evidence format.
2. Add a section-level update plan for `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md` covering TP-005 delivered merge behavior and explicit non-atomic semantics.
3. Add a `docs/reference/commands.md` decision item with required rationale logging (`updated` vs `not updated`).
4. Add a pre-`.DONE` quality gate that resolves outstanding review-state ambiguity (R008 revise record).
5. Remove/replace `Archive and push` with prompt-aligned completion items.

## Note

The required spec doc is outside the worktree (`C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md`), so Step 4 should explicitly state that external path will be edited and how that change will be evidenced in `STATUS.md`.
