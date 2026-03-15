# Task: TP-007 - Resume Reconciliation and Continuation Across Repos

**Created:** 2026-03-15
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Resume logic is failure-path critical and now must reconcile multi-repo lane/session/worktree state.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-007-resume-reconciliation-across-repos/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Extend /orch-resume to reconstruct and continue polyrepo batches using repo-aware persisted state, lane ownership, and merge progression.

## Dependencies

- **Task:** TP-005 (resume must align with final repo-scoped merge semantics)
- **Task:** TP-006 (resume requires schema-v2 repo-aware persisted records)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/resume.ts` — Current single-repo reconciliation and continuation flow

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Implement repo-aware reconciliation

- [ ] Match persisted tasks/lanes to live sessions using repo-aware identifiers
- [ ] Resolve alive/dead/.DONE states correctly across repo-specific worktrees

### Step 1: Compute repo-aware resume point

- [ ] Update wave/task continuation logic for mixed repo outcomes
- [ ] Ensure blocked/skipped semantics remain deterministic

### Step 2: Execute resumed waves safely

- [ ] Run resumed allocation/execution/merge using repo-scoped context
- [ ] Persist reconciliation and continuation checkpoints with repo attribution

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
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Document resume guarantees and limitations in workspace mode

**Check If Affected:**
- `docs/explanation/persistence-and-resume.md` — Update public docs after behavior is finalized and stable

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-007): description`
- **Bug fixes:** `fix(TP-007): description`
- **Tests:** `test(TP-007): description`
- **Checkpoints:** `checkpoint: TP-007 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

### Amendment 1: integration_branch removed — baseBranch is now runtime state

The `integration_branch` config setting has been removed. `resume.ts` now reads
`baseBranch` from `persistedState.baseBranch` (with `""` fallback for older state files)
and stores it on `batchState.baseBranch`.

**Impact on this task:**
- All resume code already uses `batchState.baseBranch` instead of `orchConfig.orchestrator.integration_branch`
- When extending for polyrepo, per-repo base branches should be resolved from workspace config, not from the removed global setting
