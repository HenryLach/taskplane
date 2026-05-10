# TP-190: Runtime V2 spawn-failure visibility — Status

**Current Step:** Step 4: Implement Part 3 — phase transition when all lanes spawn-fail
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 1
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
**Status:** ✅ Complete

- [x] On `main` (lane worktree, fresh from PR #556 merge if applicable)
- [x] Baseline test count recorded (3587 passing / 1 skipped / 0 failed — confirmed post-PR-#556)
- [x] `gh issue view 561` read in full
- [x] All Tier 3 context files read (execution.ts ~1855-1925 + ~2715-2735 + ~2573 executeLaneV2 head + ~807 resolveTaskMonitorState, engine.ts ~3050-3140 task-failure alert site + ~2531 executeWave call site, types.ts LaneTaskOutcome ~819 + ExitClassification import, diagnostics.ts ExitClassification ~37-79 + EXIT_CLASSIFICATIONS, extension.ts ~3088 supervisor recovery, supervisor-recovery-flows.test.ts + conversation-event-fidelity.test.ts mock.module pattern, process-registry.ts writeLaneSnapshot/readLaneSnapshot)
- [x] Decision: NOT a new try/catch — the existing one at execution.ts:2724 already produces a failed outcome. The bug is downstream: `monitorLanes` blocks `executeWave` from returning because no lane snapshot is ever written, so `resolveTaskMonitorState` keeps `sessionAlive=true` indefinitely (snap==null branch defaults to alive without time-based fallback). Fix the catch to (a) write a synthetic terminal lane snapshot via `writeLaneSnapshot()` so the monitor exits, (b) tag the outcome with `exitDiagnostic.classification = "spawn_failure"` so downstream consumers (retry, IPC alert, phase transition) can distinguish.

---

### Step 1: Plan all four parts of the fix
**Status:** ✅ Complete

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [x] Part 1 design (state-transition wiring): see Discoveries → "Part 1 design"
- [x] Part 2 design (no-retry policy): see Discoveries → "Part 2 design"
- [x] Part 3 design (phase transition): see Discoveries → "Part 3 design"
- [x] Part 4 design (regression test): see Discoveries → "Part 4 design"
- [x] Drafts in Discoveries section below

---

### Step 2: Implement Part 1 — state-transition + IPC alert
**Status:** ✅ Complete

> Plan-reviewer must have APPROVED Step 1 before proceeding.
> ⚠️ Code-review fires after this step.

- [x] `"spawn_failure"` added to `ExitClassification` enum in `diagnostics.ts` (and `EXIT_CLASSIFICATIONS` array; doc comment updated). `TIER0_RETRYABLE_CLASSIFICATIONS` doc note added in `types.ts` calling out the deliberate exclusion.
- [x] `task-failure` IPC alert payload extended to carry the new category (added `exitCategory?: ExitClassification` to `SupervisorAlertContext`; populated in `engine.ts` and mirrored in `resume.ts`; alert summary now includes a "Spawn failure: … escalate immediately" line when applicable).
- [x] Verified `lane.status` and `task.status` transition to `failed` via existing serialization paths — `executeLaneV2`'s catch now (a) populates `exitDiagnostic.classification = "spawn_failure"` on the failed `LaneTaskOutcome`, (b) writes a synthetic terminal `RuntimeLaneSnapshot` with `status: "failed"` so `monitorLanes` exits via Priority 3, unblocking `executeWave` and the existing engine.ts failedTaskIds aggregation. No new persistence schema changes needed.
- [x] Targeted tests pass: 129/129 across `supervisor-recovery-flows.test.ts`, `diagnostic-reports.test.ts`, `lane-runner-v2.test.ts`.

---

### Step 3: Implement Part 2 — no-retry for spawn failures
**Status:** ✅ Complete

> ⚠️ Code-review fires after this step.

- [x] Retry classification sites audited — four exist: (a) `attemptWorkerCrashRetry` (engine.ts:1276) gates on `TIER0_RETRYABLE_CLASSIFICATIONS.has(classification)`; (b) `attemptModelFallbackRetry` (engine.ts:1564) only triggers on `classification === "model_access_error"`; (c) `attemptStaleWorktreeRecovery` (engine.ts:1797) only triggers on `ALLOC_WORKTREE_FAILED` (not on lane outcomes); (d) `cleanup_gate` retry (engine.ts:3915) only triggers on stale worktrees detected at the merge gate. All four correctly exclude `spawn_failure` because it is NOT in the retryable set.
- [x] `spawn_failure` is intentionally NOT added to `TIER0_RETRYABLE_CLASSIFICATIONS` (Step 2 added the inline doc note explaining why). Defense-in-depth: added an explicit early-return for `classification === "spawn_failure"` at the top of `attemptWorkerCrashRetry`'s per-task gate (engine.ts:1276) with operator-friendly log message `tier0: task <id> spawn_failure — operator action required, NOT auto-retrying (TP-190)`.
- [x] Targeted tests pass: 144/144 across `tier0-watchdog.test.ts`, `runtime-model-fallback.test.ts`. (Bumped pre-existing `EXIT_CLASSIFICATIONS` length assertion from 10 → 11 to account for `spawn_failure`.)

---

### Step 4: Implement Part 3 — phase transition when all lanes spawn-fail
**Status:** 🟨 In Progress

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
| R001 | plan | 1 | APPROVE | .reviews/R001-plan-step1.md |
| R002 | code | 2 | APPROVE | .reviews/R002-code-step2.md |
| R003 | code | 3 | APPROVE | .reviews/R003-code-step3.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Existing catch at execution.ts:2724 already produces a failed `LaneTaskOutcome` for spawn errors — the issue body's repro stderr line `Runtime V2 execution error: …` comes from this catch. So Part 1 is NOT about adding a new catch; it's about fixing the downstream consumers that don't see the failure. | Confirms PROMPT "Do NOT" guidance. | execution.ts:2722-2734 |
| Root cause of the silent hang: `monitorLanes()` blocks `executeWave` on `await monitorPromise`. The monitor reads lane snapshot files via `readLaneSnapshot()`. Spawn-stage failures never write a snapshot (spawnAgent throws before registering), and `resolveTaskMonitorState` treats `snap == null` as startup grace (`sessionAlive = true`) forever — there is no time-based fallback when a snapshot is *never* written. Because `executeWave` never returns, the engine's `failedTaskIds` aggregation, `task-failure` IPC alert emission (engine.ts:3088), and phase-transition logic never execute. | Drives Part 1 fix design. | execution.ts:826-849 (snap==null branch); execution.ts:2008 (`await monitorPromise`) |
| `LaneTaskOutcome` has `exitDiagnostic?: TaskExitDiagnostic` (types.ts:861) carrying a `classification: ExitClassification`. Today the spawn-failure outcome leaves `exitDiagnostic` undefined. Adding a new `"spawn_failure"` value to `ExitClassification` (diagnostics.ts) and populating `exitDiagnostic` in the catch lets the existing retry classifier (`TIER0_RETRYABLE_CLASSIFICATIONS`) and supervisor playbook branch on it deterministically — no new top-level field is needed on `LaneTaskOutcome`. | Drives Part 1 + Part 2 design. | diagnostics.ts:60-79; types.ts:1818 |
| `writeLaneSnapshot(stateRoot, batchId, laneNumber, snapshot)` is exported from process-registry.ts. The catch in `executeLaneV2` already has all the inputs it needs (stateRoot, batchId, laneNumber, taskId, segmentId, sessionName/agentId) to write a synthetic terminal snapshot with `status: "failed"` so that `resolveTaskMonitorState`'s `snap.taskId === taskId` branch sets `sessionAlive = false` (line 882: `sessionAlive = snap.status === "running";`) and Priority 3 returns status `failed`. Monitor exits, executeWave returns. | Implements Part 1 with minimal API surface. | process-registry.ts:336; execution.ts:881-884 |
| **Part 1 design** (state-transition + IPC alert): (a) Add `"spawn_failure"` to `ExitClassification` union and `EXIT_CLASSIFICATIONS` array in diagnostics.ts. (b) In `executeLaneV2`'s catch, build a `TaskExitDiagnostic` with `classification: "spawn_failure"`, attach it to the failed outcome's `exitDiagnostic`, and set `exitReason: "spawn failure: <message>"` (matches PROMPT wording). (c) After pushing the failed outcome, write a synthetic terminal lane snapshot using `writeLaneSnapshot()` so the monitor exits cleanly. (d) Extend `SupervisorAlertContext` (types.ts) with an optional `exitCategory?: ExitClassification` field. (e) In engine.ts:3088 task-failure alert emission, populate `context.exitCategory` from `outcome.exitDiagnostic?.classification` so the supervisor playbook can branch on it (esp. for the spawn-failure category). | Plan. | execution.ts:2722-2734; engine.ts:3088-3115; diagnostics.ts:60-79; types.ts:2120-2150 |
| **Part 2 design** (no-retry for spawn failures): `TIER0_RETRYABLE_CLASSIFICATIONS` (types.ts:1818) is the gate — a classification must be explicitly listed there to be retried. `"spawn_failure"` is NOT added to the set. Add an inline comment under the set documenting that `spawn_failure` is intentionally excluded because spawn-stage failures (Pi CLI not findable, worktree provisioning, branch collision) are never transient — retrying without operator action just burns budget. The engine's retry sites (engine.ts:1286, 1543, 1797) already gate on `TIER0_RETRYABLE_CLASSIFICATIONS.has(classification)`, so no logic changes needed in engine.ts for retry behavior. | Plan. | types.ts:1818 |
| **Part 3 design** (phase transition): Today, default policy `skip-dependents` lets a wave complete with `failedTaskIds.length > 0` while leaving `batchState.phase` at `"executing"`. After `executeWave` returns in engine.ts (around line 2531), and after the existing `task-failure` alert emission loop, add a check: if `succeededTaskIds.length === 0` AND `failedTaskIds.length > 0` AND **every** failed outcome has `exitDiagnostic?.classification === "spawn_failure"`, transition `batchState.phase` from `"executing"` → `"failed"`. Persist the state. This is independent of `policyApplied` — spawn-failures are unrecoverable without operator action, so the operator must see `phase=failed` in `orch_status()`. (Choosing `"failed"` over `"paused"` per PROMPT guidance: "NOT paused — the operator can't unstick this without changing something.") | Plan. | engine.ts:2531-2600 (post-executeWave); engine.ts:3088 (after alert loop) |
| **Part 4 design** (regression test): New `extensions/tests/spawn-failure-visibility.test.ts`. Use `mock.module("../taskplane/path-resolver.ts", { namedExports: { resolvePiCliPath: () => { throw new Error("Cannot find Pi CLI entrypoint (pi-coding-agent/dist/cli.js) under any known npm scope"); } } })` to make every spawn fail deterministically. Then call `executeLaneV2()` directly with a fabricated `AllocatedLane` (single task, single lane) and a temp `stateRoot`. Assertions: (1) the returned `LaneExecutionResult` has `overallStatus === "failed"` and the task outcome has `status === "failed"`, `exitDiagnostic?.classification === "spawn_failure"`, and `exitReason` includes the spawn error message. (2) The synthetic lane snapshot file exists at `<stateRoot>/.pi/runtime/<batchId>/lanes/lane-1.json` with `status: "failed"`. (3) Capture `onSupervisorAlert` callback firings via a mock; assert the engine.ts alert emission fires with `category: "task-failure"` and `context.exitCategory === "spawn_failure"` — this requires a higher-level test that invokes engine.ts's wave loop, OR a unit test that directly calls the alert-emission helper. (4) For the no-retry test, count how many times the mocked `resolvePiCliPath` is invoked — should be exactly once per task per lane (no retry). (5) For the multi-lane phase-transition test, run `executeWave` (or directly invoke the engine.ts post-wave logic) with all lanes failing-spawn and assert `batchState.phase === "failed"`. The test harness reuses the `mkTmpRoot` + `mock.module` patterns from `supervisor-recovery-flows.test.ts` and `conversation-event-fidelity.test.ts`. | Plan. | new file extensions/tests/spawn-failure-visibility.test.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-09 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 03:31 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 03:31 | Step 0 started | Preflight |
| 2026-05-10 | Step 0 complete | Baseline 3587/1/0 recorded; root-cause traced (monitor blocks on missing snapshot); decision: fix downstream of existing catch (no new try/catch) |
| 2026-05-10 | Step 1 hydrated | Plan drafted in Discoveries — see Part 1/2/3/4 entries |

---

## Blockers

*None*

---

## Notes

**R001 (plan, Step 1) suggestions** — advisory only, but adopted in this task:
- Use the full `RuntimeLaneSnapshot` shape (not a minimal stub) when writing the synthetic terminal snapshot in the catch, for dashboard schema-consistency.
- Mirror the new `context.exitCategory` field into resume.ts's `task-failure` emission for parity across /orch and /orch-resume.

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
| 2026-05-10 03:42 | Review R001 | plan Step 1: APPROVE |
| 2026-05-10 03:48 | Review R002 | code Step 2: APPROVE |
| 2026-05-10 03:51 | Review R003 | code Step 3: APPROVE |
