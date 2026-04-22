# Task: TP-048 - Persistent Worker Context Per Task

**Created:** 2026-03-23
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Core execution model change. Modifies the main step loop, worker prompt construction, and progress tracking. High blast radius across task execution, moderate pattern novelty (changing from per-step to per-task spawning). Easy to revert (loop structure change, no data model migration).
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-048-persistent-worker-context/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Change the task-runner's worker execution model from **one worker per step** to
**one worker per task**. Currently, the step loop spawns a fresh worker context
for every step, losing all accumulated context and paying full re-hydration cost
each time. With modern 1M context windows, most tasks (even L-sized) fit in a
single context.

The worker should be spawned once and told to "work through all remaining steps
in order, committing at each step boundary." If the context limit is hit mid-task,
the worker exits and the next iteration picks up from the last completed step via
STATUS.md — same recovery mechanism as today, just triggered far less often.

**Issue:** #140

## Dependencies

- **Task:** TP-047 (context window auto-detect must be in place — worker needs correct context window to know when it's approaching limits)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — primary file: step loop (~line 2080-2190), `runWorker()` (~line 2195), worker prompt construction (~line 2230), progress tracking
- `templates/agents/task-worker.md` — worker system prompt (needs update for multi-step awareness)
- `templates/agents/local/task-worker.md` — local worker template (needs same update)

## Environment

- **Workspace:** `extensions/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts`
- `templates/agents/task-worker.md`
- `templates/agents/local/task-worker.md`
- `extensions/tests/*` (new or modified test files)

## Steps

### Step 0: Preflight

- [ ] Read the current step loop in `task-runner.ts` (around line 2080-2190) — understand how steps are iterated, how workers are spawned per step, and how progress is tracked
- [ ] Read `runWorker()` and the worker prompt construction to understand what the worker is told
- [ ] Read the worker agent template (`templates/agents/task-worker.md`) to understand what behavior the worker expects
- [ ] Identify all places where "Work ONLY on Step N" or step-scoped instructions are injected

### Step 1: Restructure the step loop to spawn worker once per task

The current structure (simplified):
```
for each step:
    plan review (if applicable)
    for iter in max_worker_iterations:
        runWorker(step)  ← fresh context each call
        check progress
    code review (if applicable)
```

Change to:
```
for iter in max_worker_iterations:
    runWorker(allRemainingSteps)  ← one worker handles all steps
    check which steps completed
    run reviews for newly completed steps
    if all steps complete: break
```

Key design decisions:
- The worker is prompted with ALL remaining unchecked steps, not just one
- The worker is instructed to work through them in order, committing at each step boundary
- After the worker exits (naturally or via wrap-up/kill), the outer loop checks what was completed
- Reviews for completed steps are run before the next iteration (if any)
- If all steps are complete, the task is done
- If the worker exited due to context limit, the next iteration picks up from the first incomplete step

### Step 2: Update worker prompt for multi-step execution

Change the worker prompt from:
```
Execute Step {N}: {name}
...
Work ONLY on Step {N}. Do not proceed to other steps.
```

To something like:
```
Execute all remaining steps for task {taskId}.
...
Steps remaining: Step 1 (name), Step 3 (name), Step 4 (name)
[Step 2 already complete — skip]

Work through these steps in order. For each step:
1. Read STATUS.md to find unchecked items
2. Complete all items for the step
3. Update STATUS.md step status to "complete"
4. Commit your changes: feat({taskId}): complete Step N — description
5. Check for wrap-up signal files before starting the next step
6. Proceed to the next incomplete step

If you receive a wrap-up signal, finish your current checkpoint and stop.
```

Also update the worker agent templates (`task-worker.md` and `local/task-worker.md`)
to reflect multi-step awareness in the system prompt.

### Step 3: Update progress tracking and stall detection

Current progress tracking checks `afterChecked <= prevChecked` per iteration per step.
With the new model:

- Progress is checked **per iteration** (after the worker exits), not per step
- Count total checkboxes checked across ALL steps before and after the iteration
- If no new checkboxes were checked in the entire iteration → increment `noProgressCount`
- `no_progress_limit` (default 3) still applies: 3 full iterations with zero progress → blocked
- Log which steps were completed in each iteration for operator visibility

### Step 4: Integrate reviews with the new loop

Reviews still happen per-step, but now they run after the worker exits, for each
step that was completed during that iteration:

```
After worker exits:
    for each step that changed from incomplete → complete during this iteration:
        run plan review (if level ≥ 1 and not low-risk)
        run code review (if level ≥ 2 and not low-risk)
        if code review verdict is REVISE:
            mark step as needing rework
            (next iteration will re-process it)
```

If a code review returns REVISE, the step is marked incomplete again and the next
worker iteration will address the reviewer's feedback. This preserves the current
REVISE → rework behavior.

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Verify all existing tests pass (many tests reference the step loop behavior)
- [ ] Add tests for: worker spawned once per task (not per step)
- [ ] Add tests for: progress tracking across multiple steps in one iteration
- [ ] Add tests for: stall detection (no progress across full iterations)
- [ ] Add tests for: reviews run for completed steps after worker exits
- [ ] Add tests for: REVISE verdict triggers rework in next iteration
- [ ] Add tests for: context limit mid-task → next iteration picks up from incomplete step

### Step 6: Documentation & Delivery

- [ ] Update worker agent templates with multi-step awareness
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `templates/agents/task-worker.md` — multi-step execution awareness
- `templates/agents/local/task-worker.md` — same

**Check If Affected:**
- `docs/explanation/execution-model.md` — describes step loop behavior
- `docs/explanation/review-loop.md` — describes review timing relative to steps

## Completion Criteria

- [ ] Worker spawns once per task, handles all remaining steps in a single context
- [ ] Worker commits at each step boundary
- [ ] Worker checks for wrap-up signals between steps
- [ ] Reviews run per-step after worker exits (not during)
- [ ] REVISE verdict triggers rework in next iteration
- [ ] Progress tracking works across multi-step iterations
- [ ] Stall detection (no_progress_limit) still functional
- [ ] Context limit mid-task → clean recovery on next iteration
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-048): complete Step N — description`
- **Bug fixes:** `fix(TP-048): description`
- **Tests:** `test(TP-048): description`
- **Hydration:** `hydrate: TP-048 expand Step N checkboxes`

## Do NOT

- Change reviewer agent spawn behavior (that's issue #146)
- Change merge agent behavior
- Remove the iteration mechanism — it's the safety net for context overflow
- Change STATUS.md format or checkpoint conventions
- Modify orchestrator code (execution.ts, engine.ts, etc.)
- Remove `max_worker_iterations` or `no_progress_limit` config options

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
