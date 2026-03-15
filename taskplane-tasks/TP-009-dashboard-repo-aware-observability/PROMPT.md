# Task: TP-009 - Dashboard Repo-Aware Lanes, Tasks, and Merge Panels

**Created:** 2026-03-15
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Improves observability contracts across server/frontend with moderate blast radius and low security risk.
**Score:** 5/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-009-dashboard-repo-aware-observability/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Make orchestrator observability repo-aware so operators in large teams can quickly isolate failures and progress by repository.

## Dependencies

- **Task:** TP-006 (repo-aware state fields are required for dashboard payloads)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `.pi/local/docs/taskplane/lane-agent-design.md` — Use lane observability hierarchy concepts for UI grouping decisions

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/index.html`
- `extensions/taskplane/formatting.ts`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Extend dashboard data model

- [ ] Include repo attribution in lane/task/merge payloads served by dashboard backend
- [ ] Maintain backward compatibility for repo-mode payload consumers

### Step 1: Implement repo-aware UI

- [ ] Add repo labels and filters in dashboard frontend
- [ ] Group merge outcomes by repo for clear partial-result visibility

### Step 2: Preserve existing UX guarantees

- [ ] Ensure monorepo views remain clear and unchanged by default
- [ ] Verify no regressions in conversation/sidecar panels

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit/regression tests: `cd extensions && npx vitest run`
- [ ] Run targeted tests for changed modules
- [ ] Fix all failures
- [ ] CLI smoke checks pass: `node bin/taskplane.mjs help`

### Step 4: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder
- [ ] Task archived (auto — handled by task-runner extension)

## Documentation Requirements

**Must Update:**
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` — Document final dashboard repo-grouping behavior

**Check If Affected:**
- `docs/tutorials/use-the-dashboard.md` — Update once repo-aware UI ships publicly

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-009): description`
- **Bug fixes:** `fix(TP-009): description`
- **Tests:** `test(TP-009): description`
- **Checkpoints:** `checkpoint: TP-009 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
