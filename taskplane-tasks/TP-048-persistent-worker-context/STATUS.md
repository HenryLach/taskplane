# TP-048: Persistent Worker Context Per Task — Status

**Current Step:** Step 6: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 10
**Iteration:** 7
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
**Status:** ✅ Complete

> ⚠️ Hydrate: Expand based on exact loop structure found in Step 0

- [x] Refactor `executeTask()` to replace per-step loop with per-iteration loop that spawns worker for all remaining steps
- [x] Refactor `runWorker()` signature to accept remaining steps array instead of single step
- [x] Build multi-step worker prompt (all remaining steps, iteration info, per-step commit instructions)
- [x] After worker exits, determine which steps were newly completed and run reviews for each
- [x] Integrate plan reviews into the new loop (run before first worker iteration for non-low-risk steps)
- [x] Preserve wrap-up signal, kill mechanics, progress tracking, and stall detection
- [x] R002: Fix REVISE rework bypass — make completion checks respect explicit rework state (needsRework set or status === "in-progress" as authoritative) in remainingSteps, completedBefore, newlyCompleted, and allComplete

---

### Step 2: Update worker prompt for multi-step execution
**Status:** ✅ Complete

- [x] Change worker prompt from "Execute Step N only" to "Execute all remaining steps"
- [x] Include list of remaining steps with completion status
- [x] Add per-step commit and wrap-up check instructions
- [x] Update task-worker.md and local/task-worker.md templates
- [x] R004: Verify all Step 2 deliverables are committed (not just STATUS.md) and document that implementation was delivered in Step 1 commits

---

### Step 3: Update progress tracking and stall detection
**Status:** ✅ Complete

- [x] Track total checkboxes across all steps before/after each iteration
- [x] noProgressCount applies per iteration (not per step)
- [x] Log which steps completed in each iteration

---

### Step 4: Integrate reviews with the new loop
**Status:** ✅ Complete

- [x] R007: Remove up-front plan review sweep; make all reviews transition-based (run when step newly completes after worker exits)
- [x] After worker exits, run plan review (level ≥ 1) then code review (level ≥ 2) for each newly completed step; track planReviewedSteps so plan review only runs on first completion (not rework)
- [x] REVISE verdict marks step incomplete for rework in next iteration (already implemented — verify preserved)
- [x] Plan and code reviews still respect review level and low-risk skip logic (already implemented — verify preserved)
- [x] R008: Fix pause-flow review gap — allow post-worker transition reviews to run when paused (gate on `phase !== "error"` instead of `phase === "running"`), then honor pause by returning before launching next iteration

---

### Step 5: Testing & Verification
**Status:** ✅ Complete

- [x] All existing tests pass
- [x] Tests for single-spawn-per-task behavior
- [x] Tests for multi-step progress tracking
- [x] Tests for stall detection across iterations
- [x] Tests for review timing (after worker exit, per completed step)
- [x] Tests for REVISE → rework in next iteration
- [x] Tests for context limit → recovery on next iteration

---

### Step 6: Documentation & Delivery
**Status:** 🟨 In Progress

- [x] Worker agent templates updated
- [x] Check affected docs (execution-model.md, review-loop.md)
- [x] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R003 | plan | Step 2 | APPROVE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | APPROVE | .reviews/R003-plan-step2.md |
| R004 | code | Step 2 | REVISE | .reviews/R004-code-step2.md |
| R004 | code | Step 2 | APPROVE | .reviews/R004-code-step2.md |
| R005 | plan | Step 3 | APPROVE | .reviews/R005-plan-step3.md |
| R005 | plan | Step 3 | APPROVE | .reviews/R005-plan-step3.md |
| R006 | code | Step 3 | APPROVE | .reviews/R006-code-step3.md |
| R007 | plan | Step 4 | REVISE | .reviews/R007-plan-step4.md |
| R006 | code | Step 3 | APPROVE | .reviews/R006-code-step3.md |
| R007 | plan | Step 4 | REVISE | .reviews/R007-plan-step4.md |
| R008 | code | Step 4 | APPROVE | .reviews/R008-code-step4.md |
| R009 | plan | Step 5 | APPROVE | .reviews/R009-plan-step5.md |
| R008 | code | Step 4 | REVISE | .reviews/R008-code-step4.md |
| R009 | plan | Step 5 | APPROVE | .reviews/R009-plan-step5.md |
| R010 | code | Step 5 | APPROVE | .reviews/R010-code-step5.md |
| R010 | code | Step 5 | APPROVE | .reviews/R010-code-step5.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Worker prompt + template changes were inseparable from Step 1 loop refactoring — couldn't implement Step 2 independently | Noted in STATUS.md Notes | N/A |
| Pause-flow review gap: reviews gated on `phase === "running"` blocked post-worker reviews when paused | Fixed in Step 4 (R008) | `extensions/task-runner.ts` |
| Plan reviews should only run on first completion, not rework cycles (tracked via `planReviewedSteps`) | Implemented in Step 4 | `extensions/task-runner.ts` |

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
| 2026-03-24 00:41 | Worker iter 1 | done in 112s, ctx: 15%, tools: 22 |
| 2026-03-24 00:41 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-24 00:41 | Step 0 complete | Preflight |
| 2026-03-24 00:41 | Step 1 started | Restructure the step loop to spawn worker once per task |
| 2026-03-24 00:42 | Worker iter 2 | done in 128s, ctx: 16%, tools: 26 |
| 2026-03-24 00:42 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-24 00:42 | Step 0 complete | Preflight |
| 2026-03-24 00:42 | Step 1 started | Restructure the step loop to spawn worker once per task |
| 2026-03-24 00:42 | Review R001 | plan Step 1: APPROVE |
| 2026-03-24 00:42 | Review R001 | plan Step 1: APPROVE |
| 2026-03-24 00:53 | Worker iter 2 | done in 622s, ctx: 34%, tools: 50 |
| 2026-03-24 00:54 | Worker iter 3 | done in 689s, ctx: 33%, tools: 66 |
| 2026-03-24 00:56 | Review R002 | code Step 1: REVISE |
| 2026-03-24 00:57 | Review R002 | code Step 1: REVISE |
| 2026-03-24 01:01 | Worker iter 2 | done in 283s, ctx: 14%, tools: 24 |
| 2026-03-24 01:01 | Step 1 complete | Restructure the step loop to spawn worker once per task |
| 2026-03-24 01:01 | Step 2 started | Update worker prompt for multi-step execution |
| 2026-03-24 01:03 | Review R003 | plan Step 2: APPROVE |
| 2026-03-24 01:10 | Worker iter 3 | done in 778s, ctx: 26%, tools: 52 |
| 2026-03-24 01:10 | Step 1 complete | Restructure the step loop to spawn worker once per task |
| 2026-03-24 01:10 | Step 2 started | Update worker prompt for multi-step execution |
| 2026-03-24 01:11 | Review R003 | plan Step 2: APPROVE |
| 2026-03-24 01:11 | Worker iter 3 | done in 511s, ctx: 19%, tools: 45 |
| 2026-03-24 01:14 | Review R004 | code Step 2: REVISE |
| 2026-03-24 01:15 | Review R004 | code Step 2: APPROVE |
| 2026-03-24 01:15 | Step 2 complete | Update worker prompt for multi-step execution |
| 2026-03-24 01:15 | Step 3 started | Update progress tracking and stall detection |
| 2026-03-24 01:16 | Review R005 | plan Step 3: APPROVE |
| 2026-03-24 01:17 | Worker iter 3 | done in 190s, ctx: 18%, tools: 30 |
| 2026-03-24 01:17 | Step 2 complete | Update worker prompt for multi-step execution |
| 2026-03-24 01:17 | Step 3 started | Update progress tracking and stall detection |
| 2026-03-24 01:18 | Review R005 | plan Step 3: APPROVE |
| 2026-03-24 01:25 | Worker iter 4 | done in 490s, ctx: 26%, tools: 25 |
| 2026-03-24 01:27 | Worker iter 4 | done in 532s, ctx: 16%, tools: 23 |
| 2026-03-24 01:27 | Review R006 | code Step 3: APPROVE |
| 2026-03-24 01:27 | Step 3 complete | Update progress tracking and stall detection |
| 2026-03-24 01:27 | Step 4 started | Integrate reviews with the new loop |
| 2026-03-24 01:29 | Review R007 | plan Step 4: REVISE |
| 2026-03-24 01:29 | Review R006 | code Step 3: APPROVE |
| 2026-03-24 01:29 | Step 3 complete | Update progress tracking and stall detection |
| 2026-03-24 01:29 | Step 4 started | Integrate reviews with the new loop |
| 2026-03-24 01:30 | Review R007 | plan Step 4: REVISE |
| 2026-03-24 01:41 | Worker iter 5 | done in 687s, ctx: 16%, tools: 27 |
| 2026-03-24 01:42 | Worker iter 5 | done in 809s, ctx: 22%, tools: 41 |
| 2026-03-24 01:44 | Review R008 | code Step 4: APPROVE |
| 2026-03-24 01:44 | Step 4 complete | Integrate reviews with the new loop |
| 2026-03-24 01:44 | Step 5 started | Testing & Verification |
| 2026-03-24 01:46 | Review R009 | plan Step 5: APPROVE |
| 2026-03-24 01:47 | Review R008 | code Step 4: REVISE |
| 2026-03-24 01:54 | Worker iter 5 | done in 384s, ctx: 17%, tools: 20 |
| 2026-03-24 01:54 | Step 4 complete | Integrate reviews with the new loop |
| 2026-03-24 01:54 | Step 5 started | Testing & Verification |
| 2026-03-24 01:56 | Review R009 | plan Step 5: APPROVE |
| 2026-03-24 02:02 | Worker iter 6 | done in 977s, ctx: 67%, tools: 59 |
| 2026-03-24 02:02 | Worker iter 6 | done in 393s, ctx: 17%, tools: 19 |
| 2026-03-24 02:06 | Review R010 | code Step 5: APPROVE |
| 2026-03-24 02:06 | Step 5 complete | Testing & Verification |
| 2026-03-24 02:06 | Step 6 started | Documentation & Delivery |
| 2026-03-24 02:06 | Skip plan review | Step 6 (final step) — low-risk |
| 2026-03-24 02:06 | Review R010 | code Step 5: APPROVE |
| 2026-03-24 02:06 | Step 5 complete | Testing & Verification |
| 2026-03-24 02:06 | Step 6 started | Documentation & Delivery |
| 2026-03-24 02:06 | Skip plan review | Step 6 (final step) — low-risk |

---

## Blockers

*None*

---

## Notes

### Step 2 R004 Revision Note

Step 2 deliverables (worker prompt multi-step format, template updates) were all implemented
during Step 1 commits. Specifically:
- `extensions/task-runner.ts` — worker prompt changed to "Execute all remaining steps" with step listing, per-step commit/wrap-up instructions (commits `602146d` through `a8d6892`)
- `templates/agents/task-worker.md` — rewritten for multi-step awareness (same commits)
- `templates/agents/local/task-worker.md` — updated comments to describe multi-step composition (same commits)

The Step 1 refactoring necessarily included the prompt/template changes because the worker
prompt construction is integral to the `runWorker()` function that was restructured. Separating
them would have left the worker broken between Step 1 and Step 2.

Verified in this iteration: all four Step 2 requirements are confirmed present in the committed code.

### Step 4 R007 Revision Note

R007 plan review requested transition-based reviews only (no up-front plan sweep). Implementation:
- Remove the up-front plan review block
- Add plan reviews to the post-worker newly-completed-step loop
- Track `planReviewedSteps` to avoid re-running plan review on rework cycles (suggestion from R007)

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
