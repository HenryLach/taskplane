# Task: TP-012 - Polyrepo Integration Fixtures and Regression Test Suite

**Created:** 2026-03-15
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Establishes end-to-end confidence for high-risk multi-repo orchestration and resume paths.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 3

## Canonical Task Folder
```
taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Build an integration-grade polyrepo fixture and automated regression suite that validates workspace-mode orchestration while guaranteeing monorepo behavior remains stable.

## Dependencies

- **Task:** TP-007 (resume behavior must be finalized before end-to-end validation)
- **Task:** TP-008 (doctor diagnostics must be testable in workspace topology)
- **Task:** TP-009 (dashboard payload contracts should be stable before fixture assertions)
- **Task:** TP-010 (team-scale naming must be represented in fixtures)
- **Task:** TP-011 (routing policy enforcement scenarios must be covered)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Milestone and acceptance mapping for polyrepo v1

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/tests/fixtures/*`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `extensions/tests/task-runner-orchestration.test.ts`
- `extensions/tests/orch-pure-functions.test.ts`
- `docs/maintainers/testing.md`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Build polyrepo fixture workspace

- [ ] Create fixture with non-git workspace root, docs repo task root, and multiple service repos
- [ ] Add representative task packets and dependency graph spanning repos

### Step 1: Add end-to-end polyrepo regression tests

- [ ] Cover /task routing, /orch-plan, /orch execution, per-repo merge outcomes, and resume
- [ ] Assert collision-safe naming artifacts and repo-aware persisted state fields

### Step 2: Protect monorepo compatibility

- [ ] Add/expand assertions ensuring existing monorepo behavior is unchanged
- [ ] Document fixture usage and limitations for maintainers

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
- `docs/maintainers/testing.md` — Document how to run polyrepo fixture tests
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` — Record validated rollout completion criteria

**Check If Affected:**
- `docs/maintainers/repository-governance.md` — Update CI gating recommendations if integration tests added to required checks

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-012): description`
- **Bug fixes:** `fix(TP-012): description`
- **Tests:** `test(TP-012): description`
- **Checkpoints:** `checkpoint: TP-012 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
