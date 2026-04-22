# Task: TP-062 - Fix STATUS.md Step Display

**Created:** 2026-03-25
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** One-location bug fix in the task-runner's step initialization loop. Low risk, easily reversible.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-062-status-step-display-fix/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix a bug where STATUS.md shows all incomplete steps as "🟨 In Progress" instead of only the current step. The root cause is in `task-runner.ts` around line 2610: a loop marks every non-complete step as "in-progress" at the start of each worker iteration, instead of only marking the first incomplete step.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — around line 2610, the loop that sets step statuses at iteration start

## Environment

- **Workspace:** `extensions/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts`
- `extensions/tests/task-runner-step-status.test.ts` (new, or add to existing)

## Steps

### Step 0: Preflight

- [ ] Read the step status initialization loop at `task-runner.ts` ~line 2608-2617
- [ ] Understand the current behavior: loop iterates ALL steps, marks every non-complete step as "in-progress"
- [ ] Confirm expected behavior: only the FIRST incomplete step should be "in-progress", others stay "not-started"

### Step 1: Fix Step Status Initialization

The current code (approximately):
```typescript
for (const step of task.steps) {
    const ss = currentStatus.steps.find(s => s.number === step.number);
    if (ss?.status === "complete") continue;
    updateStepStatus(statusPath, step.number, "in-progress");
    logExecution(statusPath, `Step ${step.number} started`, step.name);
}
```

Fix: Only mark the **first** incomplete step as "in-progress". All subsequent incomplete steps should remain "not-started" (or be explicitly set to "not-started" if they were previously marked in-progress from an earlier iteration).

```typescript
let foundFirstIncomplete = false;
for (const step of task.steps) {
    const ss = currentStatus.steps.find(s => s.number === step.number);
    if (ss?.status === "complete") continue;
    if (!foundFirstIncomplete) {
        updateStepStatus(statusPath, step.number, "in-progress");
        logExecution(statusPath, `Step ${step.number} started`, step.name);
        foundFirstIncomplete = true;
    } else {
        // Ensure future steps show as not-started, not in-progress
        if (ss?.status === "in-progress") {
            updateStepStatus(statusPath, step.number, "not-started");
        }
    }
}
```

Also check: does the worker set step status to "in-progress" when it enters a step during execution? If so, the initialization loop may not need to set it at all — the worker will set it when it gets there. In that case, the fix might be simpler: just remove the loop entirely and let the worker manage step statuses.

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite.

- [ ] Add source-based test verifying only first incomplete step is marked in-progress
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- None

## Completion Criteria

- [ ] Only the current step shows "🟨 In Progress" in STATUS.md
- [ ] Future steps show "⬜ Not Started"
- [ ] Completed steps still show "✅ Complete"
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-062): complete Step N — description`
- **Bug fixes:** `fix(TP-062): description`
- **Hydration:** `hydrate: TP-062 expand Step N checkboxes`

## Do NOT

- Change the step status emoji/label format
- Modify how the worker updates step status during execution
- Change the STATUS.md parsing logic
- Modify the dashboard's status rendering

---

## Amendments (Added During Execution)

