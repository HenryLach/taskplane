# Task: TP-008 - Workspace-Aware Doctor Diagnostics and Validation

**Created:** 2026-03-15
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** CLI diagnostics change is medium scope but important for operator confidence and onboarding across large teams.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-008-workspace-aware-doctor-diagnostics/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Upgrade taskplane doctor to validate workspace-mode topology (non-git root, mapped repos, routing completeness) with actionable guidance.

## Dependencies

- **Task:** TP-001 (workspace config/schema definitions are required before doctor can validate them)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `bin/taskplane.mjs` — Current doctor checks and output model

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `bin/taskplane.mjs`
- `docs/tutorials/install.md`
- `docs/reference/commands.md`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Detect workspace mode in doctor

- [ ] Load workspace config when present and branch diagnostics accordingly
- [ ] Avoid false negatives when workspace root is intentionally non-git

### Step 1: Validate repo and routing topology

- [ ] Check each configured repo path exists and is a git repo
- [ ] Validate area/default routing targets reference known repos

### Step 2: Improve operator guidance

- [ ] Emit actionable remediation hints for missing repos/mappings
- [ ] Keep existing repo-mode doctor output unchanged

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
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Mark diagnostics acceptance criteria and any sequencing updates

**Check If Affected:**
- `docs/reference/commands.md` — Document doctor behavior differences in workspace mode

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-008): description`
- **Bug fixes:** `fix(TP-008): description`
- **Tests:** `test(TP-008): description`
- **Checkpoints:** `checkpoint: TP-008 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
