# TP-048: Persistent Worker Context Per Task — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-23
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Understand current step loop structure (line ~2080-2190 in task-runner.ts)
- [ ] Understand runWorker() and worker prompt construction
- [ ] Understand worker agent template expectations
- [ ] Identify all step-scoped instructions in prompts

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
