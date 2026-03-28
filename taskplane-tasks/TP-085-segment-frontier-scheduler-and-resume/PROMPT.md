# Task: TP-085 - Segment Frontier Scheduler and Resume Reconstruction

**Created:** 2026-03-28
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Moves runtime planning/execution from task-level to segment-level frontier with resume parity guarantees. High blast radius in engine/resume flows.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-085-segment-frontier-scheduler-and-resume/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement segment-level frontier scheduling and resume reconstruction using schema v4 state. Enforce one active segment per task, preserve cross-task lane parallelism, and guarantee deterministic replay after interruption.

## Dependencies

- **Task:** TP-081 (schema v4 persistence foundation)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — segment scheduling + resume requirements
- `extensions/taskplane/engine.ts` — wave loop and merge transitions
- `extensions/taskplane/resume.ts` — reconstruction and reconciliation
- `extensions/taskplane/waves.ts` — lane assignment and base branch resolution
- `extensions/taskplane/types.ts` — v4 runtime/persisted contracts

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/orch-direct-implementation.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/orch-state-persistence.test.ts` (as needed)

## Steps

### Step 0: Preflight

- [ ] Trace current task-level frontier lifecycle in engine/resume
- [ ] Map exact insertion points for segment-level runnable frontier
- [ ] Identify invariants to keep deterministic ordering stable across restarts

### Step 1: Segment frontier runtime integration

- [ ] Replace/augment task-level frontier with segment-level runnable frontier
- [ ] Enforce one active segment per task at any time
- [ ] Preserve lane parallelism across tasks/segments when dependencies allow
- [ ] Keep deterministic tie-breaking and stable ordering

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/waves.ts` (modified)

### Step 2: Resume reconstruction parity

- [ ] Reconstruct frontier from persisted segment records (not fresh rediscovery)
- [ ] Preserve completed/blocked/failed counters with segment granularity
- [ ] Verify merge and cleanup transitions remain consistent after resume

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)
- `extensions/taskplane/engine.ts` (modified as needed for parity)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust direct-implementation tests for segment frontier routing
- [ ] Add/adjust polyrepo regressions for deterministic ordering and resume parity
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update docs if runtime behavior wording changed
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — if runtime ordering/edge behavior differs from planned wording

**Check If Affected:**
- `docs/explanation/waves-lanes-and-worktrees.md`
- `docs/explanation/persistence-and-resume.md`

## Completion Criteria

- [ ] Segment frontier scheduler is deterministic
- [ ] One active segment per task invariant is enforced
- [ ] Resume reconstructs exact frontier from persisted state
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-085): complete Step N — description`
- **Bug fixes:** `fix(TP-085): description`
- **Tests:** `test(TP-085): description`
- **Hydration:** `hydrate: TP-085 expand Step N checkboxes`

## Do NOT

- Implement packet-path env contract here (TP-082)
- Implement dynamic segment expansion mutation here (TP-086)
- Add supervisor policy surface changes beyond parity needs
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
