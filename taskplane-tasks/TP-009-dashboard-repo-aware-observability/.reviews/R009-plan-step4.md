# R009 — Plan Review (Step 4: Documentation & Delivery)

## Verdict
**REVISE**

Step 4 is not execution-ready yet.

## What I reviewed
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/PROMPT.md`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.reviews/R006-code-step2.md`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.reviews/R008-code-step3.md`
- `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-implementation-plan.md`
- `docs/tutorials/use-the-dashboard.md`
- `dashboard/public/app.js` (for current repo-filter behavior claims)

## Blocking findings

### 1) Step 4 is still checklist-only (not hydrated)
In `STATUS.md`, Step 4 remains five coarse checkboxes with no concrete substeps, no file-level action list, and no evidence contract. For review-level-2 delivery, it needs explicit 4.1/4.2/4.3 execution items.

### 2) Prompt-required "Must Update" doc is not operationalized
`PROMPT.md` requires updating `.pi/local/docs/taskplane/polyrepo-implementation-plan.md`, but Step 4 does not specify:
- which section(s) will be edited,
- which TP-009 outcomes will be documented,
- what completion evidence is required in `STATUS.md`.

Current implementation-plan WS-G text is still generic; it does not capture the delivered TP-009 dashboard contracts (repo-aware payload fields, mode-gated repo UI, merge repo grouping/fallback behavior, monorepo-default clarity guarantees).

### 3) "Check If Affected" doc review has no deterministic decision record
`PROMPT.md` requires reviewing `docs/tutorials/use-the-dashboard.md`. Step 4 must require an explicit outcome:
- **updated** or **not updated**, and
- rationale logged in `STATUS.md`.

Right now there is no decision protocol.

### 4) Delivery gate is missing while blocking code-review findings are unresolved
`R006` and `R008` both record `Verdict: REVISE`, including an open repo-filter UI/state sync defect (`updateRepoFilter()` hide→show path in `dashboard/public/app.js`). Step 4 currently allows `.DONE` without requiring blocker disposition.

### 5) Step metadata/closeout criteria are inconsistent with prompt contract
- `STATUS.md` header currently says overall **Complete** while Step 4 section is still in progress.
- Step 4 includes `Archive and push`, but prompt says archive is auto-handled by task-runner and does not require push in this step.

### 6) Required doc path location is not called out
The required must-update doc currently exists at `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-implementation-plan.md` (outside this worktree path). Step 4 should explicitly state where edits happen and how evidence is logged.

## Required updates before approval
1. Hydrate Step 4 into concrete substeps (e.g., 4.1/4.2/4.3/4.4) with file targets and acceptance evidence.
2. Add a section-level update plan for `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-implementation-plan.md` covering final TP-009 behavior:
   - backend payload repo attribution (`mode`, lane/task repo fields, merge `repoResults`),
   - frontend repo filter/badges/grouping semantics,
   - mode gating (`workspace` + 2+ repos) and monorepo no-regression behavior.
3. Add explicit review decision logging for `docs/tutorials/use-the-dashboard.md` (`updated` vs `not updated`) with rationale.
4. Add pre-`.DONE` quality gate: unresolved review findings dispositioned (fix + reverify, or explicitly logged blocker/deferral rationale).
5. Replace `Archive and push` with prompt-aligned closeout items only (`discoveries logged`, `.DONE` created, archive auto).
6. Normalize delivery metadata in `STATUS.md` (step status vs header status, review table consistency) before closeout.

## Non-blocking note
- While editing Step 4, clean duplicate review rows / trailing separator artifacts in the `STATUS.md` Reviews table for audit clarity.
