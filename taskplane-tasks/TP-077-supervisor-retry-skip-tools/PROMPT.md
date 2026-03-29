# Task: TP-077 - Supervisor Recovery Tools: orch_retry_task and orch_skip_task

**Created:** 2026-03-27
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds two new supervisor tools that modify batch state and task lifecycle. Touches extension command registration, batch state persistence, and the dependency graph.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-077-supervisor-retry-skip-tools/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Give the autonomous supervisor the ability to retry individual failed tasks and skip tasks to unblock dependents. Today the supervisor can only resume the entire batch (`orch_resume`) or abort it (`orch_abort`). After this task, it can surgically recover from failures:

- `orch_retry_task(taskId)` — re-queue a specific failed task for re-execution
- `orch_skip_task(taskId)` — mark a task as skipped and unblock its dependents

These are Phase 2 tools from the autonomous supervisor spec (`docs/specifications/taskplane/autonomous-supervisor.md`).

## Dependencies

- **Task:** TP-076 (autonomous supervisor alerts must exist for the supervisor to receive failure notifications and act on them)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/autonomous-supervisor.md` — Phase 2 section
- `extensions/taskplane/extension.ts` — existing supervisor tool registration pattern (search for `orch_status`, `orch_resume` to see how tools are registered)
- `extensions/taskplane/types.ts` — `OrchBatchRuntimeState`, `AllocatedTask` types, task status values
- `extensions/taskplane/persistence.ts` — `persistBatchState` for saving state changes
- `extensions/taskplane/engine-worker.ts` — IPC message types for forwarding tool actions to engine

## Environment

- **Workspace:** extensions/taskplane
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/engine-worker.ts`
- `extensions/tests/supervisor-recovery-tools.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read autonomous supervisor spec Phase 2 section
- [ ] Read extension.ts supervisor tool registration pattern (how orch_status, orch_resume are registered)
- [ ] Read types.ts for task status values and batch state structure
- [ ] Understand how tools communicate with the engine child process (IPC or direct state mutation)

### Step 1: Implement orch_retry_task

- [ ] Register `orch_retry_task` tool in extension.ts with parameter: `taskId` (string, required)
- [ ] Validation: task exists in batch, task status is "failed" (reject if running/succeeded/pending)
- [ ] Update batch state: reset task status to "pending", clear exit reason, clear doneFileFound
- [ ] Decrement failedTasks counter, adjust batch phase if needed (failed → executing)
- [ ] Persist updated state
- [ ] Return confirmation message with task ID and new status
- [ ] If engine is running (active child process), forward retry signal via IPC so the engine can re-queue the task in the current wave

### Step 2: Implement orch_skip_task

- [ ] Register `orch_skip_task` tool in extension.ts with parameter: `taskId` (string, required)
- [ ] Validation: task exists in batch, task is "failed" or "pending" (reject if running/succeeded)
- [ ] Update batch state: set task status to "skipped", set exit reason to "Skipped by supervisor"
- [ ] Increment skippedTasks counter, decrement failedTasks if was failed
- [ ] Unblock dependents: any task whose only remaining blocker was this task should become unblocked
- [ ] Persist updated state
- [ ] Return confirmation message listing the task skipped and any tasks unblocked

### Step 3: Testing & Verification

- [ ] Create `extensions/tests/supervisor-recovery-tools.test.ts`
- [ ] Test: orch_retry_task resets failed task to pending
- [ ] Test: orch_retry_task rejects non-failed task (running, succeeded)
- [ ] Test: orch_retry_task rejects unknown taskId
- [ ] Test: orch_skip_task marks task as skipped
- [ ] Test: orch_skip_task unblocks dependent tasks
- [ ] Test: orch_skip_task rejects running/succeeded tasks
- [ ] Test: counter adjustments are correct after retry and skip
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update `docs/specifications/taskplane/autonomous-supervisor.md` — mark retry/skip as implemented
- [ ] Update `docs/reference/commands.md` — add orch_retry_task and orch_skip_task
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/autonomous-supervisor.md` — mark Phase 2 tools as implemented
- `docs/reference/commands.md` — add new tool descriptions

**Check If Affected:**
- `extensions/taskplane/supervisor-primer.md` — may need recovery playbook updates referencing the new tools

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] orch_retry_task resets a failed task for re-execution
- [ ] orch_skip_task marks a task as skipped and unblocks dependents
- [ ] Both tools validate inputs and reject invalid operations
- [ ] Batch state counters stay consistent after operations

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-077): complete Step N — description`
- **Bug fixes:** `fix(TP-077): description`
- **Tests:** `test(TP-077): description`
- **Hydration:** `hydrate: TP-077 expand Step N checkboxes`

## Do NOT

- Implement orch_force_merge — that's TP-078
- Implement the feedback loop (GitHub issue creation) — that's Phase 3
- Modify the engine execution loop — these tools modify STATE, the engine picks up changes on next poll
- Add timer-based polling
- Expand task scope — add tech debt to CONTEXT.md instead
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
