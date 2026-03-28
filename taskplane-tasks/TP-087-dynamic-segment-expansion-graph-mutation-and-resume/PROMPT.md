# Task: TP-087 - Dynamic Segment Expansion Graph Mutation and Resume

**Created:** 2026-03-28
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Applies approved expansion decisions to live graph/frontier and persists revisioned state with resume parity. High correctness risk and recoverability impact.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-087-dynamic-segment-expansion-graph-mutation-and-resume/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement deterministic application of approved dynamic segment expansion decisions: mutate segment graph/frontier at runtime, persist graph revisions and audit trail, and ensure resume reconstruction from expanded state is exact and deterministic.

## Dependencies

- **Task:** TP-086 (expansion request + supervisor decision protocol)
- **Task:** TP-088 (engine/resume packet-path threading)
- **Task:** TP-085 (segment frontier scheduler + resume parity)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — scheduler behavior after expansion approval
- `extensions/taskplane/engine.ts` — frontier selection/mutation points
- `extensions/taskplane/resume.ts` — reconstruction from persisted frontier
- `extensions/taskplane/persistence.ts` — schema and audit persistence
- `extensions/taskplane/types.ts` — graph revision contracts

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## Steps

### Step 0: Preflight

- [ ] Identify exact frontier mutation points for approved decisions
- [ ] Define deterministic update order for added nodes/edges
- [ ] Define persistence shape for graph revisions and audit records

### Step 1: Runtime graph mutation

- [ ] Apply approved expansion decisions to in-memory segment graph
- [ ] Validate edge additions and reject cycles deterministically
- [ ] Update runnable frontier without violating one-active-segment-per-task invariant

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/types.ts` (modified)

### Step 2: Persisted revision + audit trail

- [ ] Persist graph revision metadata and before/after frontier snapshots (as designed)
- [ ] Persist decision audit details (`who/when/why/decision`)
- [ ] Ensure serialization/validation supports revised state shape

**Artifacts:**
- `extensions/taskplane/persistence.ts` (modified)
- `extensions/taskplane/types.ts` (modified)

### Step 3: Resume reconstruction for expanded graph

- [ ] Reconstruct expanded graph/frontier from persisted state
- [ ] Ensure no rediscovery ambiguity after restart
- [ ] Preserve deterministic scheduling order after expansion across resume boundary

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust tests for approved expansion mutation behavior
- [ ] Add/adjust tests for cycle rejection and frontier consistency
- [ ] Add/adjust tests for expanded-graph resume reconstruction
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update spec/docs if revision schema details differ from planned wording
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — finalize expansion mutation/revision details

**Check If Affected:**
- `docs/specifications/taskplane/autonomous-supervisor.md`
- `docs/explanation/persistence-and-resume.md`

## Completion Criteria

- [ ] Approved expansion decisions mutate graph/frontier deterministically
- [ ] Graph revisions and audit trail are persisted and validated
- [ ] Resume reconstructs expanded graph without rediscovery drift
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-087): complete Step N — description`
- **Bug fixes:** `fix(TP-087): description`
- **Tests:** `test(TP-087): description`
- **Hydration:** `hydrate: TP-087 expand Step N checkboxes`

## Do NOT

- Add segment-bundle runtime support in this task
- Bypass cycle checks or dependency guards for convenience
- Accept non-deterministic mutation ordering
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
