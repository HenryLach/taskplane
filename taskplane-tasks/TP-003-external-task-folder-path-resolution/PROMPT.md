# Task: TP-003 - External Task Folder .DONE and STATUS Path Resolution

**Created:** 2026-03-15
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes correctness-critical path translation where task folders live outside execution repos.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-003-external-task-folder-path-resolution/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Make orchestrator monitoring and completion detection robust when canonical task packets live in a docs repo while execution occurs in service-repo worktrees.

## Dependencies

- **Task:** TP-001 (workspace context is required to distinguish canonical task roots from execution repo roots)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/execution.ts` — Current resolveTaskDonePath and monitoring logic

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/execution.ts`
- `extensions/tests/*execution*`
- `extensions/tests/*orchestration*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Introduce canonical task-path resolver

- [ ] Add helper(s) to resolve canonical task folder paths in workspace mode
- [ ] Retain existing repo-relative fallback behavior for monorepo mode

### Step 1: Fix completion probing

- [ ] Update .DONE resolution logic to probe correct canonical locations
- [ ] Update STATUS probing/monitor paths for external task roots

### Step 2: Add regression coverage

- [ ] Add tests for external task folders outside repo root
- [ ] Verify no monorepo regressions in completion detection

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
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` — Record final path-resolution strategy and fallback behavior

**Check If Affected:**
- `docs/explanation/waves-lanes-and-worktrees.md` — Update if implementation meaningfully changes operator expectations

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-003): description`
- **Bug fixes:** `fix(TP-003): description`
- **Tests:** `test(TP-003): description`
- **Checkpoints:** `checkpoint: TP-003 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
