# Task: TP-010 - Team-Scale Session and Worktree Naming Hardening

**Created:** 2026-03-15
**Size:** M

## Review Level: 3 (Full)

**Assessment:** Naming contracts affect every runtime artifact and are critical for avoiding collisions in large-team parallel usage.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-010-team-scale-session-and-worktree-naming/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement collision-resistant lane/session/worktree naming that remains deterministic and traceable across repos, operators, and concurrent batches.

## Dependencies

- **Task:** TP-004 (repo-scoped lane model must exist before naming contracts can be hardened)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/execution.ts` — Current session naming and sidecar naming behavior

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/waves.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/sessions.ts`
- `extensions/tests/*orchestration*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Define naming contract

- [ ] Design deterministic naming including repo slug + operator identifier + batch components
- [ ] Document fallback rules when operator metadata is unavailable

### Step 1: Apply naming contract consistently

- [ ] Update lane TMUX sessions, worker/reviewer prefixes, merge sessions, and worktree prefixes
- [ ] Ensure log/sidecar file naming aligns with new identifiers

### Step 2: Validate collision resistance

- [ ] Add tests/smoke scenarios for concurrent runs in shared environments
- [ ] Confirm naming remains human-readable for debugging and lane-agent-style supervision views

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
- `.pi/local/docs/taskplane/lane-agent-design.md` — Align naming assumptions with lane-supervision observability patterns
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Document finalized naming contract

**Check If Affected:**
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Adjust hardening backlog if implementation scope shifts

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-010): description`
- **Bug fixes:** `fix(TP-010): description`
- **Tests:** `test(TP-010): description`
- **Checkpoints:** `checkpoint: TP-010 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
