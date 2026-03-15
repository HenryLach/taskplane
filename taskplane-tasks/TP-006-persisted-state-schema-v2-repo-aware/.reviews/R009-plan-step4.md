# Plan Review — TP-006 Step 4 (Documentation & Delivery)

## Verdict: REVISE

Step 4 is not execution-ready yet.

## What I reviewed

- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/PROMPT.md`
- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/STATUS.md`
- `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-implementation-plan.md`
- `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md`

## Blocking findings

1. **Step 4 is still coarse, not hydrated.**
   In `STATUS.md`, Step 4 is still the 5 top-level checklist items only. For this review level, it needs concrete 4.1/4.2/4.3 substeps with explicit file actions and evidence requirements.

2. **Prompt-required “Must Update” doc is not operationalized.**
   `PROMPT.md` requires updating:
   - `.pi/local/docs/taskplane/polyrepo-implementation-plan.md`

   Current Step 4 plan does not define what exact TP-006 outcomes will be documented (final v2 schema contract + migration policy). The implementation-plan doc currently still has generic WS-F language and does not yet reflect the delivered specifics (`mode`, `repoId`/`resolvedRepoId`, v1 in-memory upconversion/no-rewrite policy, v2 write-on-save).

3. **“Check If Affected” doc review has no decision contract.**
   `PROMPT.md` requires reviewing:
   - `.pi/local/docs/taskplane/polyrepo-support-spec.md`

   Step 4 needs an explicit decision record: **updated** or **not updated**, with rationale. This matters because current spec text in persistence sections appears broader/different than delivered TP-006 behavior (e.g., migration semantics and persisted-field set).

4. **Delivery item drifts from prompt contract.**
   `STATUS.md` includes `Archive and push`, but prompt says archive is auto-handled by task-runner and does not require push in this step. Replace with prompt-aligned closeout checks only.

5. **External local-doc path handling is not called out.**
   Required docs are under `C:/dev/taskplane/.pi/local/docs/taskplane/` (outside this worktree). Step 4 should explicitly state this location and how completion evidence will be logged in `STATUS.md`.

## Required plan updates before approval

1. Hydrate Step 4 into concrete substeps (4.1+), including exact target files and expected evidence.
2. Add a specific update plan for `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-implementation-plan.md` covering:
   - final v2 persisted schema fields,
   - v1→v2 compatibility policy,
   - save/load behavior contract.
3. Add an explicit review decision item for `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md` (`updated` vs `not updated`) with rationale.
4. Replace `Archive and push` with prompt-aligned closeout items.
5. Add explicit logging requirements in `STATUS.md` for doc updates/review outcomes and discoveries before `.DONE`.

## Non-blocking note

- Consider cleaning duplicate review rows in the `STATUS.md` Reviews table while touching Step 4 for operator clarity.
