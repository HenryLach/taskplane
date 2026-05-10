# TP-190: Runtime V2 spawn-failure visibility — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-09
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Order of Operations rule (live in worker prompt):** do NOT mark a step
> `Complete` until that step's code review has returned APPROVE. This task
> is Review Level 2 — per-step plan + code reviews fire automatically.
>
> **Review structure:** per-step reviews. Expected: ~5 plan + ~5 code = ~10
> reviews total (with Steps 0/6/7 being lighter).

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree, fresh from PR #556 merge if applicable)
- [ ] Baseline test count recorded (target: 3587 passing / 1 skipped / 0 failed post-PR-#556)
- [ ] `gh issue view 561` read in full
- [ ] All Tier 3 context files read (execution.ts ~1855-1875 + ~2715-2735, engine.ts call sites, types.ts ExitCategory enum, extension.ts ~3088-3140 alert pattern, supervisor-recovery-flows.test.ts harness)
- [ ] Decision: where to wrap `executeLaneV2` — engine.ts caller, execution.ts internal, both, or NOT (if existing catch suffices and bug is downstream)

---

### Step 1: Plan all four parts of the fix
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [ ] Part 1 design (state-transition wiring): document the existing flow trace and the chosen wrap location
- [ ] Part 2 design (no-retry policy): identify the retry classification site and the additive change
- [ ] Part 3 design (phase transition): define the trigger condition (all lanes spawn-fail → phase=failed) and the wiring point
- [ ] Part 4 design (regression test): outline the harness — mock target, assertion shape, IPC alert capture
- [ ] Drafts in Discoveries section below

---

### Step 2: Implement Part 1 — state-transition + IPC alert
**Status:** ⬜ Not Started

> Plan-reviewer must have APPROVED Step 1 before proceeding.
> ⚠️ Code-review fires after this step.

- [ ] `"spawn-failure"` added to `ExitCategory` enum in `types.ts`
- [ ] `task-failure` IPC alert payload extended to carry the new category
- [ ] Verified `lane.status` and `task.status` transition to `failed` via existing serialization paths
- [ ] Targeted tests pass (existing supervisor-recovery-flows + any directly-affected tests)

---

### Step 3: Implement Part 2 — no-retry for spawn failures
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Retry classification site located (likely `TIER0_RETRY_BUDGETS` in `types.ts`)
- [ ] `"spawn-failure"` added to non-retryable set with inline rationale comment
- [ ] Targeted tests pass

---

### Step 4: Implement Part 3 — phase transition when all lanes spawn-fail
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Wave/phase decision site located in engine.ts (executeWave post-allocation OR monitorLanes)
- [ ] Transition wired: all lanes failed with `spawn-failure` → `batchState.phase = "failed"`
- [ ] `orch_status()` text confirms the phase change is operator-visible
- [ ] Targeted tests pass

---

### Step 5: Add behavioral regression test
**Status:** ⬜ Not Started

> ⚠️ Final code-review checkpoint after this step.

- [ ] NEW `extensions/tests/spawn-failure-visibility.test.ts` created
- [ ] Test 1: single-task spawn failure → lane/task failed, failedTasks===1, IPC alert fires with category="spawn-failure", phase !== "executing"
- [ ] Test 2: multi-task all-fail-spawn → batchState.phase === "failed"
- [ ] Test 3: spawn failure does NOT retry (mock called exactly once per task)
- [ ] Run new test in isolation, then full fast suite

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passing (target: 3590+ passing / 1 skipped / 0 failed)
- [ ] FULL integration suite passing
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor` clean
- [ ] No circular imports

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry added under [Unreleased] → Fixed (per the wording in PROMPT.md Step 7)
- [ ] Discoveries logged below
- [ ] All commits include `TP-190` prefix; step boundaries clean

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
| 2026-05-09 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

**Critical observation from issue #561 repro:** the existing per-task try/catch
inside `executeLaneV2` (execution.ts line ~2724) IS already producing the
"failed" outcome with the spawn error message. The user's stderr log shows
`Runtime V2 execution error: ...` lines — those come from THAT catch. So the
bug is NOT "no try/catch around spawn" — it's "the lane state machine and
monitor don't propagate the failed outcome upward into operator-visible state."

The Step 1 plan must investigate this gap specifically before writing new
try/catch code. The fix may be entirely in the consumer of those outcomes
(engine.ts / monitorLanes / lane state serialization), not in adding new
catches.

**Cross-reference:** `list_active_agents()` correctly reports the registry as
empty when spawns fail. So the registry knows. The bug is that the lane state
machine and the registry are out of sync today — fixing this task should
bring them back into sync (or at least surface the discrepancy as a failure).
