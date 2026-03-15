# Task: TP-011 - Routing Ownership Enforcement and Strict Workspace Policy

**Created:** 2026-03-15
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds governance controls for large teams with moderate parser/config impacts and straightforward reversibility.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder
```
taskplane-tasks/TP-011-routing-ownership-enforcement/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Add policy controls to enforce task ownership clarity in workspace mode, reducing accidental misrouting in large multi-team environments.

## Dependencies

- **Task:** TP-002 (base routing and execution-target parsing must be complete first)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Ticket TP-POLY-012 ownership enforcement requirements

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/*routing*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Add strict-routing policy controls

- [ ] Introduce config option(s) for requiring explicit execution target metadata
- [ ] Define warning/error behavior for missing ownership declarations

### Step 1: Enforce policy during discovery

- [ ] Apply strict mode validation in workspace-mode discovery pipeline
- [ ] Emit clear errors with remediation instructions for contributors

### Step 2: Cover governance scenarios

- [ ] Add tests for permissive vs strict routing behavior
- [ ] Ensure repo-mode defaults remain unaffected

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
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Document strict-mode behavior and recommended team policies

**Check If Affected:**
- `docs/reference/configuration/task-orchestrator.yaml.md` — Update if policy controls become public config

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-011): description`
- **Bug fixes:** `fix(TP-011): description`
- **Tests:** `test(TP-011): description`
- **Checkpoints:** `checkpoint: TP-011 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
