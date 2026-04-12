# Task: TP-171 - Skip Progress Preservation and Batch History Gap

**Created:** 2026-04-12
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Changes to merge/skip semantics and batch history are high-risk — incorrect merge of partial work can corrupt the integration branch; missing history entries affect audit trails.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-171-skip-progress-preservation-and-history/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix two related batch outcome bugs: (1) skipped tasks lose all worker progress — STATUS.md updates and commits are not preserved through merge/integration (#453) because skipped lane branches are excluded from merge by design, and (2) tasks can be missing from batch history (#455) — TP-006 was in the wave plan but absent from the `tasks` array in batch-history.json.

## Dependencies

- **Task:** TP-165 (segment lifecycle fixes stabilize the engine outcome paths)
- **Task:** TP-169 (resume/expansion fixes affect how tasks reach skip/completion state)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/explanation/architecture.md` — merge and integration flow

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/merge*.test.ts`
- `extensions/tests/persistence*.test.ts`

## Steps

### Step 0: Preflight and Analysis

- [ ] Read merge.ts — how lanes are selected for merge (succeeded-only filter)
- [ ] Read engine.ts — how skip decisions propagate to lane state
- [ ] Read persistence.ts — how batch history `tasks` array is populated (`saveBatchHistory`)
- [ ] Identify the code path that excludes skipped lanes from merge
- [ ] Identify why tasks can be missing from batch history
- [ ] Document findings in STATUS.md

### Step 1: Preserve Skipped Task Progress

- [ ] When a task is skipped, cherry-pick or merge its STATUS.md and worker commits to the orch branch
- [ ] Or: create a "partial progress" merge path that preserves STATUS.md without full lane merge
- [ ] Ensure skipped task STATUS.md reflects the actual progress (not reset to pre-batch state)
- [ ] Verify the safety-net auto-commit captures partial work before skip
- [ ] Run targeted tests: `tests/merge*.test.ts`

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)
- `extensions/taskplane/engine.ts` (modified if skip logic needs changes)

### Step 2: Fix Batch History Task Gap

- [ ] Ensure all tasks in the wave plan are recorded in batch history `tasks` array
- [ ] Include skipped and failed tasks (not just succeeded ones)
- [ ] Verify task outcomes are recorded even for tasks that never started execution
- [ ] Run targeted tests: `tests/persistence*.test.ts`

**Artifacts:**
- `extensions/taskplane/persistence.ts` (modified)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add regression test: skipped task with partial progress — STATUS.md preserved after integration
- [ ] Add regression test: all wave-planned tasks appear in batch history

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None expected (internal behavior)

**Check If Affected:**
- `docs/explanation/architecture.md` — merge/skip behavior if documented

## Completion Criteria

- [ ] All steps complete
- [ ] Skipped tasks with worker progress retain STATUS.md updates after integration
- [ ] All wave-planned tasks appear in batch-history.json
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-171): complete Step N — description`
- **Bug fixes:** `fix(TP-171): description`
- **Tests:** `test(TP-171): description`
- **Hydration:** `hydrate: TP-171 expand Step N checkboxes`

## Do NOT

- Change the merge behavior for succeeded tasks
- Include skipped lane branches in the full merge path (that would merge incomplete work)
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

