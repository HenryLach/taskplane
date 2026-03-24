# TP-048: Persistent Worker Context Per Task — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Understand current step loop structure (line ~2080-2190 in task-runner.ts)
- [x] Understand runWorker() and worker prompt construction
- [x] Understand worker agent template expectations
- [x] Identify all step-scoped instructions in prompts

---

### Step 1: Restructure the step loop to spawn worker once per task
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on exact loop structure found in Step 0

- [ ] Refactor outer loop: iterate on worker iterations, not steps
- [ ] Worker receives all remaining steps in prompt, not single step
- [ ] After worker exits, determine which steps were completed
- [ ] Preserve wrap-up signal and kill mechanics across the new loop

---

### Step 2: Update worker prompt for multi-step execution
**Status:** ⬜ Not Started

- [ ] Change worker prompt from "Execute Step N only" to "Execute all remaining steps"
- [ ] Include list of remaining steps with completion status
- [ ] Add per-step commit and wrap-up check instructions
- [ ] Update task-worker.md and local/task-worker.md templates

---

### Step 3: Update progress tracking and stall detection
**Status:** ⬜ Not Started

- [ ] Track total checkboxes across all steps before/after each iteration
- [ ] noProgressCount applies per iteration (not per step)
- [ ] Log which steps completed in each iteration

---

### Step 4: Integrate reviews with the new loop
**Status:** ⬜ Not Started

- [ ] After worker exits, run reviews for each newly completed step
- [ ] REVISE verdict marks step incomplete for rework in next iteration
- [ ] Plan and code reviews still respect review level and low-risk skip logic

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for single-spawn-per-task behavior
- [ ] Tests for multi-step progress tracking
- [ ] Tests for stall detection across iterations
- [ ] Tests for review timing (after worker exit, per completed step)
- [ ] Tests for REVISE → rework in next iteration
- [ ] Tests for context limit → recovery on next iteration

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Worker agent templates updated
- [ ] Check affected docs (execution-model.md, review-loop.md)
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-23 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 00:39 | Task started | Extension-driven execution |
| 2026-03-24 00:39 | Step 0 started | Preflight |
| 2026-03-24 00:39 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-24 00:39 | Task started | Extension-driven execution |
| 2026-03-24 00:39 | Step 0 started | Preflight |
| 2026-03-24 00:39 | Skip plan review | Step 0 (Preflight) — low-risk |

---

## Blockers

*None*

---

## Notes

### Step 0 Preflight Findings

**Current step loop architecture:**
- `executeTask()` (line ~1940) iterates `task.steps[]`, calling `executeStep(step, ctx)` for each
- `executeStep()` (line ~2130) has inner worker loop: up to `max_worker_iterations` per step
- Each iteration calls `runWorker(step, ctx)` which spawns a FRESH agent context
- Progress tracked per-step: checkbox count before/after each iteration
- Plan review runs BEFORE worker loop; code review runs AFTER worker loop
- REVISE verdict triggers one extra `runWorker(step, ctx)` call

**`runWorker()` structure (line ~2225):**
- Loads agent def via `loadAgentDef(ctx.cwd, "task-worker")`
- System prompt = base template + `buildProjectContext(config, task.taskFolder)`
- User prompt built at line 2274: `Execute Step N: name`, `Work ONLY on Step N`
- Supports both tmux and subprocess spawn modes
- Wall-clock timeout + context-% based wrap-up/kill safety nets
- Wrap-up signal files: `.task-wrap-up` (primary), `.wiggum-wrap-up` (legacy)

**Step-scoped instruction injection points (must change for multi-step):**
1. `task-runner.ts:2274` — `Execute Step ${step.number}: ${step.name}`
2. `task-runner.ts:2283` — `Work ONLY on Step ${step.number}. Do not proceed to other steps.`
3. `task-worker.md:14` — "Find the step you have been assigned (specified in your prompt)"
4. `task-worker.md:97` — "Read the PROMPT.md step details for your assigned step"
5. `task-worker.md:152` — "Work ONLY on the step assigned in your prompt"
6. `task-worker.md:153` — "Do NOT proceed to other steps"

**Key refactoring observations:**
- `executeStep()` currently owns both the worker loop AND review orchestration — these need to be separated
- `runWorker()` takes a single `step: StepInfo` — signature needs to change to accept remaining steps
- The `doReview()` call at line 2550 takes `step: StepInfo` — can still be called per-step after worker exits
- `stepBaselineCommit` captured at start of `executeStep()` — need equivalent for per-step git diffs in new model
