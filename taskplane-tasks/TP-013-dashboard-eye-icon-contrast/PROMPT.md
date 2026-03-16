# Task: TP-013 - Fix Dashboard Eye Icon Low Contrast

**Created:** 2026-03-16
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Single CSS change in dashboard stylesheet. No logic, no tests, no security impact.
**Score:** 1/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder
```
taskplane-tasks/TP-013-dashboard-eye-icon-contrast/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix the STATUS.md eye (👁) toggle icon in the dashboard lane view so it is clearly visible in both its off and on states against the dark background.

## GitHub Issue

Closes [#16](https://github.com/HenryLach/taskplane/issues/16)

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

## Environment

- **Workspace:** Dashboard frontend
- **Services required:** None

## File Scope

- `dashboard/public/style.css`
- `dashboard/public/app.js`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Fix eye icon visibility

- [ ] Increase the eye icon opacity/brightness in its off state so it's clearly visible against the dark background
- [ ] Make the on state visually distinct from the off state (e.g., solid white or accent color)
- [ ] Verify the fix looks correct by inspecting the dashboard CSS

### Step 1: Documentation & Delivery

- [ ] `.DONE` created in this folder
- [ ] Task archived (auto — handled by task-runner extension)

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] Eye icon clearly visible in both states
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `fix(TP-013): description`
- **Checkpoints:** `checkpoint: TP-013 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Change any dashboard functionality — this is purely a visual fix
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
