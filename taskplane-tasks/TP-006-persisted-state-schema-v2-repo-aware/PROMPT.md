# Task: TP-006 - Persisted State Schema v2 with Repo-Aware Records

**Created:** 2026-03-15
**Size:** M

## Review Level: 3 (Full)

**Assessment:** State schema migration impacts resume reliability and backward compatibility. High correctness requirement.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Add repo identity to persisted orchestrator state and implement schema-v1 compatibility handling so resume can operate safely in multi-repo batches.

## Dependencies

- **Task:** TP-004 (repo-aware lane/task runtime contracts must exist before persistence can serialize them)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/persistence.ts` — Current schema v1 serialization/validation logic

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/fixtures/*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Define schema v2

- [ ] Bump batch-state schema version and add repo-aware fields on lane/task records
- [ ] Document field contracts and compatibility expectations

### Step 1: Implement serialization and validation

- [ ] Persist repo-aware fields at all state transition checkpoints
- [ ] Validate schema v2 with explicit errors for malformed records

### Step 2: Handle schema v1 compatibility

- [ ] Add v1->v2 up-conversion or explicit migration guardrails
- [ ] Add regression tests covering v1 and v2 loading paths

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
- `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` — Capture final persistence schema and migration strategy

**Check If Affected:**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Adjust acceptance criteria if migration policy differs

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-006): description`
- **Bug fixes:** `fix(TP-006): description`
- **Tests:** `test(TP-006): description`
- **Checkpoints:** `checkpoint: TP-006 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

### Amendment 1: baseBranch already added to persisted state schema

The `baseBranch` field has already been added to both `OrchBatchRuntimeState` and
`PersistedBatchState` in `types.ts`. It is serialized in `persistence.ts` and validated
with backward compatibility (defaults to `""` if missing from older state files).

**Impact on this task:**
- When bumping to schema v2, `baseBranch` is already present — account for it in the v1→v2 migration path
- The old `integration_branch` config field no longer exists — do not reference it in schema design
