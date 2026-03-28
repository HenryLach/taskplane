# Task: TP-088 - Engine/Resume Packet-Path Threading and Reconciliation

**Created:** 2026-03-28
**Size:** M

## Review Level: 3 (Full)

**Assessment:** Threads packet-path authority through engine/resume runtime and reconciliation paths. High correctness impact with focused scope on orchestration modules.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-088-engine-resume-packet-path-threading/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Thread packet-path contract through orchestrator runtime and resume flows so completion/reconciliation always consult authoritative packet-home locations in segment execution mode.

## Dependencies

- **Task:** TP-082 (packet-path env contract + task-runner authority)
- **Task:** TP-085 (segment frontier scheduler + resume parity)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — packet authority requirements
- `extensions/taskplane/engine.ts` — segment execution launch + completion handling
- `extensions/taskplane/resume.ts` — reconciliation and re-execution paths
- `extensions/taskplane/execution.ts` — env threading interface used by engine/resume

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/execution.ts` (as needed for API signature updates)
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `extensions/tests/orch-state-persistence.test.ts` (as needed)

## Steps

### Step 0: Preflight

- [ ] Trace engine/resume task launch and completion detection paths
- [ ] Identify all `.DONE`/packet path checks that still rely on cwd assumptions
- [ ] Define minimal API contract between engine/resume and execution layer

### Step 1: Engine packet-path threading

- [ ] Ensure engine passes authoritative packet paths for each active segment execution
- [ ] Ensure post-execution completion checks read authoritative packet `.DONE` path
- [ ] Preserve mono-repo backward behavior

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/execution.ts` (modified as needed)

### Step 2: Resume/reconciliation packet-path threading

- [ ] Ensure resume re-execution paths pass authoritative packet paths
- [ ] Ensure reconciliation checks use authoritative packet `.DONE` path candidates
- [ ] Validate archive-path fallback remains correct for packet-home repo

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust tests for engine/resume packet-path propagation
- [ ] Add/adjust tests for cross-repo completion/reconciliation correctness
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update docs if orchestrator runtime behavior wording changed
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — if runtime threading details differ from planned wording

**Check If Affected:**
- `docs/explanation/execution-model.md`
- `docs/explanation/persistence-and-resume.md`

## Completion Criteria

- [ ] Engine uses authoritative packet paths for segment execution and completion checks
- [ ] Resume/reconciliation uses authoritative packet paths consistently
- [ ] Backward compatibility remains intact
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-088): complete Step N — description`
- **Bug fixes:** `fix(TP-088): description`
- **Tests:** `test(TP-088): description`
- **Hydration:** `hydrate: TP-088 expand Step N checkboxes`

## Do NOT

- Re-implement packet-path env contract in task-runner (TP-082 owns that)
- Add supervisor policy/reorder behavior here
- Introduce path fallback ambiguity
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
