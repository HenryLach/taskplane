# R009 — Plan Review (Step 4: Documentation & Delivery)

## Verdict
**REVISE**

## Reviewed artifacts
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/PROMPT.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`
- `docs/maintainers/testing.md`
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md`
- `docs/maintainers/repository-governance.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/.reviews/R008-code-step3.md`

## Blocking findings

### 1) Step 4 in `STATUS.md` is still checklist-level, not execution-ready
For a Level 3 task, Step 4 needs hydrated outcomes with concrete artifacts, acceptance criteria, and closure order. Current bullets are still generic:
- Must Update docs modified
- Check If Affected docs reviewed
- Discoveries logged
- `.DONE` created
- Archive and push

This is not sufficiently auditable for final task closure.

### 2) Required doc updates are not mapped to specific acceptance evidence
Prompt requires:
- `docs/maintainers/testing.md`
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md`

The plan does not specify exactly what must be present in each doc at completion (section names/content expectations), nor how this is recorded in `STATUS.md` evidence.

### 3) “Check If Affected” governance review has no explicit decision record
`docs/maintainers/repository-governance.md` must be reviewed for required-check gating implications. The plan does not include a required outcome like:
- changed vs unchanged decision
- rationale
- where that decision is logged in `STATUS.md`

Without this, the check is not reviewable.

### 4) Step 4 does not gate on unresolved review findings from Step 3
`R008` is still `REVISE`. Finalization should explicitly require resolving open review findings (or documenting disposition) before `.DONE`.

### 5) Finalization sequence includes out-of-contract wording
Step 4 currently includes `Archive and push`, but prompt contract says archive is auto-handled by task-runner and explicitly requires `.DONE` creation in-task. The plan should be aligned to contract:
- docs/discoveries complete
- review table updated with verdicts
- `.DONE` created
- archive auto

## Required updates before approval
1. Hydrate Step 4 into 3–5 concrete, artifact-specific outcomes.
2. Add explicit completion criteria per must-update doc (what section/content proves completion).
3. Add a recorded decision for `repository-governance.md` (changed/not changed + rationale).
4. Add a pre-`.DONE` gate to close/resolve open review findings (including `R008`).
5. Replace `Archive and push` with contract-accurate closure steps and evidence logging expectations.

## Suggested Step 4 outcome shape
- **Docs closure:** finalize required docs and record exact sections updated.
- **Governance review decision:** record affected/not affected with rationale.
- **Status auditability:** dedupe review/log rows as needed; add clear evidence entries.
- **Review closure gate:** all open review findings resolved or dispositioned.
- **Completion marker:** create `.DONE` only after above are satisfied.
