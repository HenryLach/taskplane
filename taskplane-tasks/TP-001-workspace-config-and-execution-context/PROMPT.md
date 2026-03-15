# Task: TP-001 - Workspace Config and Execution Context Foundations

**Created:** 2026-03-15
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Introduces a new runtime mode and shared context contracts spanning orchestrator startup and execution paths.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder
```
taskplane-tasks/TP-001-workspace-config-and-execution-context/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Add workspace-mode foundations so Taskplane can run from a non-git workspace root while preserving existing monorepo behavior. Define and validate a canonical execution context consumed by orchestrator modules.

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/config.ts` — Current config loading behavior

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/types.ts`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/config.ts`
- `extensions/tests/*workspace*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Define workspace/runtime contracts

- [ ] Add workspace-mode types (WorkspaceConfig, repo/routing structures, execution context) in types.ts
- [ ] Define clear validation/error surfaces for invalid workspace configuration

### Step 1: Implement workspace config loading

- [ ] Create extensions/taskplane/workspace.ts loader/validator for .pi/taskplane-workspace.yaml
- [ ] Resolve canonical workspace/task roots and repo map with normalized absolute paths

### Step 2: Wire orchestrator startup context

- [ ] Load execution context during session start in extension.ts
- [ ] Thread execution context into engine entry points without changing repo-mode defaults

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
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Record schema or mode-contract adjustments
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` — Keep notes aligned with delivered foundations

**Check If Affected:**
- `docs/reference/commands.md` — Update only if new user-visible commands/options introduced

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-001): description`
- **Bug fixes:** `fix(TP-001): description`
- **Tests:** `test(TP-001): description`
- **Checkpoints:** `checkpoint: TP-001 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
