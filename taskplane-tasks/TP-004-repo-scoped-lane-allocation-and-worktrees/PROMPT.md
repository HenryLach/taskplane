# Task: TP-004 - Repo-Scoped Lane Allocation and Worktree Lifecycle

**Created:** 2026-03-15
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Core orchestration mechanics change across lane identity, assignment, and worktree lifecycle. High blast radius requiring full review.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Refactor wave execution to allocate and manage lanes per target repo so a single batch can safely execute tasks across multiple repositories.

## Dependencies

- **Task:** TP-002 (tasks must carry resolved repo IDs before lane allocation)
- **Task:** TP-003 (external task-path handling must be stable before cross-repo lane execution)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/waves.ts` — Current lane assignment and worktree provisioning flow
- `extensions/taskplane/worktree.ts` — Current CRUD assumptions tied to one repo root

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/tests/*waves*`
- `extensions/tests/*worktree*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Refactor lane allocation model

- [ ] Group wave tasks by repoId and allocate lanes per repo group
- [ ] Extend lane identity contracts to include repo dimension (repoId, repo-aware lane IDs)

### Step 1: Make worktree operations repo-scoped

- [ ] Ensure create/reset/remove worktree operations execute against each target repo root
- [ ] Keep deterministic ordering across repo groups and lane numbers

### Step 2: Update execution contracts

- [ ] Thread repo-aware lane contracts through execution engine callbacks and state updates
- [ ] Preserve single-repo behavior when workspace mode is disabled

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
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Document finalized lane identity and repo-scoped worktree rules

**Check If Affected:**
- `extensions/taskplane/messages.ts` — Update user-facing text if lane identifiers change

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-004): description`
- **Bug fixes:** `fix(TP-004): description`
- **Tests:** `test(TP-004): description`
- **Checkpoints:** `checkpoint: TP-004 description`

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
- `allocateLanes()` in `waves.ts` now takes a `baseBranch: string` parameter (last arg)
- `createLaneWorktrees()` and `ensureLaneWorktrees()` in `worktree.ts` now take a `baseBranch: string` parameter (last arg)
- These functions no longer read `config.orchestrator.integration_branch`
- When adding repo-scoped worktree support, pass the appropriate per-repo base branch through these functions
