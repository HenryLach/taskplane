# Task: TP-002 - Task-to-Repo Routing and Execution Target Parsing

**Created:** 2026-03-15
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds routing semantics that directly control where code executes. Medium blast radius with clear reversibility.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder
```
taskplane-tasks/TP-002-task-repo-routing-and-execution-target-parsing/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Enable deterministic task-to-repo routing in workspace mode by parsing execution targets from PROMPT metadata and applying fallback routing rules from workspace configuration.

## Dependencies

- **Task:** TP-001 (workspace execution context must exist before routing can resolve repo targets)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Primary architecture and constraints for polyrepo support
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Concrete ticket decomposition and dependencies
- `.pi/local/docs/taskplane/lane-agent-design.md` — Lane/session supervision and team-scale observability patterns
- `extensions/taskplane/discovery.ts` — Current argument resolution and PROMPT parser implementation

## Environment

- **Workspace:** Taskplane extension and dashboard codebase
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/messages.ts`
- `extensions/tests/*discovery*`
- `extensions/tests/*routing*`

## Steps

> **Hydration:** STATUS.md checkboxes must match the granularity below.
> See task-worker agent for full hydration rules.

### Step 0: Parse execution target metadata

- [ ] Extend PROMPT parser to read ## Execution Target / Repo: metadata
- [ ] Preserve backward compatibility for prompts that omit execution target

### Step 1: Implement routing precedence chain

- [ ] Resolve repo using: prompt repo -> area map -> workspace default repo
- [ ] Emit explicit errors for unresolved or unknown repo IDs (TASK_REPO_UNRESOLVED, TASK_REPO_UNKNOWN)

### Step 2: Annotate discovery outputs

- [ ] Attach resolved repoId to parsed tasks before planning
- [ ] Ensure routing errors fail planning with actionable messages

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
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` — Reflect final routing precedence and error semantics

**Check If Affected:**
- `.pi/local/docs/taskplane/polyrepo-execution-backlog.md` — Update ticket sequencing if implementation order changes

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-002): description`
- **Bug fixes:** `fix(TP-002): description`
- **Tests:** `test(TP-002): description`
- **Checkpoints:** `checkpoint: TP-002 description`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
