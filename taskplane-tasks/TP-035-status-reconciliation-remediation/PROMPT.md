# Task: TP-035 — STATUS.md Reconciliation & Artifact Staging Scope

**Created:** 2026-03-19
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Focused cleanup: reconcile STATUS.md mismatches from review verdicts and tighten artifact staging scope. Low risk, follows existing patterns.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-035-status-reconciliation-remediation/
├── PROMPT.md ├── STATUS.md ├── .reviews/ └── .DONE
```

## Mission

Implement STATUS.md reconciliation after quality gate review: automatically
correct checkboxes that don't match the review's `statusReconciliation` findings.
Also tighten post-task artifact staging to only allow task-owned paths (`.DONE`,
`STATUS.md`, `REVIEW_VERDICT.json`) and explicitly exclude arbitrary untracked
files. Remove system-owned checklist items from task templates that workers are
asked to check but don't own.

## Dependencies

- **Task:** TP-034 (quality gate must produce structured review with statusReconciliation findings)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 5 sections 5b, 5e
- `extensions/taskplane/quality-gate.ts` — Review verdict structure (from TP-034)
- `extensions/taskplane/merge.ts` — Artifact staging code
- `templates/` — Task templates

## Environment

- **Workspace:** `extensions/`, `templates/`
- **Services required:** None

## File Scope

- `extensions/taskplane/quality-gate.ts`
- `extensions/taskplane/merge.ts`
- `extensions/task-runner.ts`
- `templates/tasks/EXAMPLE-001-hello-world/PROMPT.md`
- `templates/tasks/EXAMPLE-002-parallel-smoke/PROMPT.md`
- `templates/agents/task-worker.md`
- `extensions/tests/status-reconciliation.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read quality gate verdict structure from TP-034
- [ ] Read current artifact staging in merge.ts
- [ ] Read current task templates for system-owned checkboxes
- [ ] Read roadmap Phase 5 sections 5b, 5e

### Step 1: STATUS.md Reconciliation

- [ ] After quality gate review, apply `statusReconciliation` findings to STATUS.md
- [ ] Boxes checked but work not done → uncheck
- [ ] Work done but box not checked → check
- [ ] Record reconciliation actions in diagnostic report
- [ ] Only reconcile when quality gate is enabled and review produced reconciliation findings

**Artifacts:**
- `extensions/taskplane/quality-gate.ts` (modified)

### Step 2: Tighten Artifact Staging Scope

- [ ] In merge.ts artifact staging, explicitly allowlist: `<taskFolder>/.DONE`, `<taskFolder>/STATUS.md`, `<taskFolder>/REVIEW_VERDICT.json`
- [ ] Reject files outside task folder scope
- [ ] Reject arbitrary untracked files at worktree root (`.worktrees/` exclusion already exists from v0.5.12; extend to general policy)

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 3: Clean Up System-Owned Template Items

- [ ] Audit task templates for checkboxes that workers are asked to check but don't own (e.g., "Archive and push")
- [ ] Remove or reword system-owned items
- [ ] Ensure template checkboxes represent worker-actionable outcomes only

**Artifacts:**
- `templates/tasks/` (modified)
- `templates/agents/task-worker.md` (modified if needed)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: reconciliation corrects mismatched checkboxes
- [ ] Test: reconciliation only runs when quality gate enabled
- [ ] Test: artifact staging accepts task-owned files only
- [ ] Test: artifact staging rejects non-task files
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal behavior change)

**Check If Affected:**
- `docs/reference/task-format.md` — if template structure changes
- `docs/reference/status-format.md` — if reconciliation behavior documented

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] STATUS.md reconciliation works with quality gate
- [ ] Artifact staging restricted to task-owned paths
- [ ] Templates cleaned of system-owned checkboxes
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-035): complete Step N — description`
- **Bug fixes:** `fix(TP-035): description`
- **Tests:** `test(TP-035): description`
- **Hydration:** `hydrate: TP-035 expand Step N checkboxes`

## Do NOT

- Change reconciliation behavior when quality gate is disabled
- Remove checkboxes that ARE worker-actionable
- Expand task scope to quality gate logic changes (that's TP-034)

---

## Amendments (Added During Execution)
