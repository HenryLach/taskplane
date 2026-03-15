# R009 — Plan Review (Step 4: Documentation & Delivery)

## Verdict
**CHANGES REQUESTED**

## Reviewed artifacts
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/PROMPT.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/STATUS.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/.reviews/R006-code-step2.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/.reviews/R008-code-step3.md`
- `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md`
- `docs/explanation/persistence-and-resume.md`

## Blocking findings

### 1) Step 4 plan is not hydrated
Step 4 in `STATUS.md` is still coarse checkbox-only, with no file-level substeps, no acceptance evidence format, and no gating order. For a review-level-3 resume task, this is not implementation-ready.

### 2) Prompt-required “Must Update” doc change is not operationalized
`PROMPT.md` requires updating `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md`, but Step 4 does not define what TP-007 outcomes must be documented.

At minimum the plan should explicitly cover:
- repo-aware resume reconciliation and v1 fallback,
- continuation semantics finalized in Step 1 (`pending`, `skipped`, terminal handling),
- blocked propagation/counting behavior across resume boundaries,
- checkpoint metadata preservation (`repoId`, `resolvedRepoId`, lane/task carry-forward),
- repo-root coverage in resume cleanup/reset (persisted + newly encountered repos).

### 3) “Check If Affected” doc review has no decision protocol
`PROMPT.md` requires review of `docs/explanation/persistence-and-resume.md`, but Step 4 does not require a deterministic outcome (`updated` vs `not updated`) with rationale in `STATUS.md`.

### 4) Pre-`.DONE` gate is missing while blocking reviews remain unresolved
`R006` and `R008` are still `CHANGES REQUESTED` artifacts. Step 4 currently lacks an explicit rule to disposition/close blockers before `.DONE`.

`STATUS.md` also has inconsistent delivery metadata (header says complete while Step 4 section is in progress, and review table rows remain `UNKNOWN`), which should be resolved before closeout.

### 5) Step 4 includes out-of-contract delivery item
Step 4 includes `Archive and push`, but the prompt states archive is auto-handled and does not require push for this step. Keep Step 4 aligned to prompt completion criteria.

## Required updates before approval
1. Expand Step 4 into concrete substeps with explicit target files and expected evidence.
2. Add a section-scoped update checklist for `C:/dev/taskplane/.pi/local/docs/taskplane/polyrepo-support-spec.md` tied to finalized TP-007 behavior.
3. Add explicit decision logging for `docs/explanation/persistence-and-resume.md` (`updated` or `not updated`) with reason.
4. Add pre-`.DONE` gate: all blocking reviews dispositioned; `STATUS.md` metadata/review table consistent.
5. Remove/replace `Archive and push` with prompt-aligned completion items only.
6. Since the must-update spec file is outside this worktree, specify in Step 4 how that edit will be evidenced in `STATUS.md`.

## Non-blocking note
- While editing Step 4, deduplicate repeated review/execution-log rows in `STATUS.md` for operator clarity.
