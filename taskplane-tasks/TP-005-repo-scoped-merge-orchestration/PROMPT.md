# Task: TP-005 - Repo-Scoped Merge Orchestration with Explicit Partial Outcomes

**Created:** 2026-03-15
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Alters merge semantics and user-visible outcome reporting across multiple repos. High orchestration impact.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-005-repo-scoped-merge-orchestration/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement repo-scoped merge sequencing so completed lanes are merged in their owning repositories while clearly reporting non-atomic cross-repo outcomes.

## Dependencies

- **Task:** TP-004 (repo-scoped lane/worktree contracts are required before merge can be partitioned by repo)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/merge.ts` — Current single-repo merge-worktree flow

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/*state-persistence*`
- `extensions/tests/*direct-implementation*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Partition merge flow by repo

- [ ] Group mergeable lanes by repoId before merge execution
- [ ] Run per-repo merge loops with correct repo roots and integration branches

### Step 1: Update outcome modeling

- [ ] Extend merge result models to include repo attribution
- [ ] Emit explicit partial-success summaries when repos diverge in outcome

### Step 2: Harden failure behavior

- [ ] Ensure pause/abort policies remain deterministic with repo-scoped failures
- [ ] Preserve debug artifacts needed for manual intervention

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
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Document per-repo merge semantics and non-atomic policy

**Check If Affected:**
- `docs/reference/commands.md` — Update if merge status output format changes for operators

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-005): description`
- **Bug fixes:** `fix(TP-005): description`
- **Tests:** `test(TP-005): description`
- **Checkpoints:** `checkpoint: TP-005 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

### Amendment 1: integration_branch removed — baseBranch is now runtime state

The `integration_branch` config setting has been removed from `OrchestratorConfig`.
The orchestrator now captures the current branch at `/orch` start via `getCurrentBranch()`
(in `git.ts`) and stores it as `baseBranch` on `OrchBatchRuntimeState` and `PersistedBatchState`.

**Impact on this task:**
- `mergeWave()` in `merge.ts` now takes a `baseBranch: string` parameter (last arg) instead of reading `config.orchestrator.integration_branch`
- The step "Run per-repo merge loops with correct repo roots and integration branches" refers to per-repo target branches from the workspace config — not the removed global setting
- When implementing repo-scoped merge, resolve per-repo base branches from workspace config and pass them to `mergeWave()`
