# Task: TP-190 - Surface Runtime V2 spawn-failure errors so the dashboard doesn't silently hang

**Created:** 2026-05-09
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Touches the engine's lane state machine + IPC alert pipeline. New exit category (`spawn-failure`) becomes part of the public exit contract. Wiring must interact correctly with the existing retry/recovery logic without accidentally retrying spawn failures (which are not transient). Plan review catches the architectural choices (where to wrap, how to classify, retry policy); code review catches the actual state-transition correctness and alert delivery. Both warranted.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-190-runtime-v2-spawn-failure-visibility/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix [#561](https://github.com/HenryLach/taskplane/issues/561): when a Runtime V2 lane spawn fails (e.g., Pi CLI not findable, worktree provisioning error, branch collision), the lane is **not** transitioned to `failed`. The engine continues polling indefinitely, the dashboard shows green/running lanes that have no actual worker process, `orch_status()` reports `running`, and no supervisor alert fires. Recovery requires the operator to manually `tail` engine-worker stderr — which is not in any of the documented diagnostic places.

This bug **masked** the impact of #559 (orchestrator crash on first IPC) and #560 (`@earendil-works` rename), making both look like "the orchestrator is hung" rather than "spawn errored 3× immediately." Fixing it converts every future spawn-stage breakage into a visible, actionable failure instead of a silent hang.

The fix has four parts (per the issue body's suggested outline):

1. **Wrap `executeLaneV2` per-lane in the engine** so any thrown error from spawn:
   - Sets `lane.status = "failed"` with the error message in `lane.lastError`.
   - Sets each task on that lane to `failed` with `exitReason = "spawn failure: <message>"` and a NEW `exitCategory = "spawn-failure"` (alongside existing categories like `crashed`, `stalled`).
   - Decrements active-lane counter.
   - Emits an IPC supervisor alert (`task-failure`) so the supervisor can react via the existing playbook. The summary should include the underlying error message verbatim — for spawn failures, the message itself is usually the diagnosis (e.g., "Cannot find Pi CLI entrypoint").

2. **Don't retry spawn failures.** Existing recovery playbooks treat `task-failure` as "retry once or twice, then escalate." For spawn failures that's wrong — none of them are transient. The new `spawn-failure` category lets the engine (and supervisor playbook) escalate immediately rather than retry-and-fail-N-times.

3. **Surface in `orch_status` / `list_active_agents`.** When all lanes in a wave fail to spawn, `phase` should NOT stay `executing` — it should transition to `paused` or `failed` so the operator's first instinct ("how's it going?") gives them a meaningful answer instead of "running". Cross-check with `list_active_agents()` which already reports the registry as empty.

4. **Add a behavioral regression test.** Mock `resolvePiCliPath()` (or the spawn helper) to throw, run a one-task batch, assert: lane status becomes `failed`, task status becomes `failed`, `failedTasks === 1`, an IPC alert fires, and `phase !== "executing"` after the poll loop next ticks.

## Dependencies

**None** — all referenced predecessor tasks are already merged. The following are informational cross-references for context, NOT runtime dependencies (the discovery parser skips dep extraction when this section starts with **None**):

- TP-187 (shipped via PR #556): introduced `task-failure` IPC alert pipeline and supervisor-side handlers. This task extends that pipeline to spawn-stage failures.
- TP-188 (shipped v0.28.8): no relationship beyond shared error-classification patterns.
- Issue #560 (fixed in PR #556 commit `34b303a`): the rename bug was the most recent trigger for #561's silent-failure symptom. Fixing #560 narrows the failure surface but does NOT address visibility — that's this task's job.
- Issue #559 (fixed in PR #556 commit `ff02265`): the IPC closure crash was an earlier trigger for the same silent-failure symptom.

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- Issue body for #561: `gh issue view 561` — has the full operator-side symptom, repro, and suggested fix outline.
- `extensions/taskplane/execution.ts` — lines ~1855-1875 (`executeLaneV2` orchestration in `executeWave`), lines ~2715-2735 (per-task try/catch inside `executeLaneV2` itself; note this catches some spawn errors at task level but the LANE-level state machine doesn't react).
- `extensions/taskplane/engine.ts` — search for `executeWave` / `monitorLanes` call sites to find where lane outcomes are read and where `task-failure` alerts are emitted today.
- `extensions/taskplane/types.ts` — find the existing `LaneTaskStatus` or `ExitCategory` enums; note where `crashed`, `stalled`, etc. are declared so the new `spawn-failure` category lands in the canonical place.
- `extensions/taskplane/extension.ts` lines ~3088-3140 (the existing hard-fail `task-failure` alert emission in TP-187's supervisor recovery flows) — model the spawn-failure alert on the same shape.
- `extensions/tests/supervisor-recovery-flows.test.ts` — existing test pattern for IPC alert assertions; reuse the harness if possible.
- `.pi/runtime/<batchId>/registry.json` semantics: workers register on spawn; if spawn fails, the registry is empty (this is what `list_active_agents()` correctly reports). The lane-state machine and the registry are out of sync today — that's part of what's broken.

## Environment

- **Workspace:** `extensions/taskplane/` (engine + execution + IPC layer)
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel. List the files and
> directories this task will create or modify. Use wildcards for directories.

- `extensions/taskplane/engine.ts` (the lane orchestration site that reads outcomes from `executeWave`)
- `extensions/taskplane/execution.ts` (the per-task try/catch inside `executeLaneV2` — may need to either propagate up or supplement)
- `extensions/taskplane/types.ts` (new `spawn-failure` exit category; possibly new `lane.lastError` field)
- `extensions/taskplane/persistence.ts` (if `spawn-failure` needs to serialize differently from existing categories — likely just additive)
- `extensions/taskplane/extension.ts` (supervisor-side alert handling — should already accept `task-failure` alerts; verify it routes spawn-failure specifically without retry)
- `extensions/tests/spawn-failure-visibility.test.ts` (NEW — behavioral regression test)
- `CHANGELOG.md` (Fixed entry under [Unreleased])

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] On `main` (lane worktree)
- [ ] Baseline test count recorded (post-PR-#556: should be 3587 passing / 1 skipped / 0 failed)
- [ ] `gh issue view 561` read in full
- [ ] Tier 3 context files read per scope
- [ ] Decision recorded: where to wrap `executeLaneV2` (engine.ts caller vs. execution.ts internal vs. both layers)

### Step 1: Plan all four parts of the fix

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [ ] **Part 1 design** (state-transition wiring): document where the new try/catch lives. Trace the existing flow: `executeWave` → `lanePromises` → `executeLaneV2` (which has its own per-task try/catch around line ~2715-2735). Decide whether the lane-level wrap is needed in `executeWave`, or whether `executeLaneV2`'s existing catch is sufficient and the bug is elsewhere (e.g., monitor not reacting to the failed outcome). The user's repro shows the existing catch at line 2724 IS firing (the stderr line `Runtime V2 execution error: ...` comes from there) — but the lane-state machine and monitor still report "running". So the bug is likely downstream of `executeLaneV2`'s catch, NOT in adding a new catch around it.
- [ ] **Part 2 design** (no-retry policy for spawn failures): document where the new `spawn-failure` category is checked. Existing retry budgets (`TIER0_RETRY_BUDGETS`) classify retryable failures; spawn failures must be excluded.
- [ ] **Part 3 design** (orch_status / phase transition): when all active lanes in a wave fail to spawn, what should `phase` become? `paused`? `failed`? Document the choice and the trigger condition.
- [ ] **Part 4 design** (regression test): outline the test harness — how to mock the spawn helper to throw, how to assert the lane state, how to assert the IPC alert fires.
- [ ] Drafts in Discoveries section of STATUS.md.

### Step 2: Implement Part 1 — state-transition + IPC alert

> Plan-reviewer must have APPROVED Step 1 before proceeding.

- [ ] Add `"spawn-failure"` to the `ExitCategory` enum (or equivalent) in `types.ts`.
- [ ] Wire the new category into the `task-failure` IPC alert payload so the supervisor can route it specifically.
- [ ] Verify `lane.status` transitions to `failed` and `task.status` transitions to `failed` via existing serialization paths (probably no new code in `persistence.ts`).
- [ ] Run targeted tests: existing supervisor-recovery-flows tests should still pass; no new tests yet.

### Step 3: Implement Part 2 — no-retry for spawn failures

- [ ] Locate retry classification (likely `TIER0_RETRY_BUDGETS` in `types.ts` or a sibling helper).
- [ ] Add `"spawn-failure"` to the non-retryable set; document inline.
- [ ] Run targeted tests.

### Step 4: Implement Part 3 — phase transition when all lanes spawn-fail

- [ ] Determine where the wave/phase decision happens in `engine.ts` (likely in `executeWave`'s post-allocation logic or in `monitorLanes`).
- [ ] Add the transition: when every lane in a wave has `status === "failed"` with `exitCategory === "spawn-failure"`, transition `batchState.phase` from `"executing"` to `"failed"` (NOT `"paused"` — the operator can't unstick this without changing something).
- [ ] Verify `orch_status` text reflects the new phase.
- [ ] Run targeted tests.

### Step 5: Add behavioral regression test

> Code-review checkpoint after this step (plan reviewer should be satisfied with the architecture; code reviewer evaluates the actual implementation).

- [ ] Create NEW `extensions/tests/spawn-failure-visibility.test.ts`.
- [ ] Test cases (each uses a mocked `resolvePiCliPath` or spawn helper that throws):
  - Single-task batch: spawn fails → lane.status === "failed", task.status === "failed", failedTasks === 1, an IPC alert fires with category="spawn-failure", phase !== "executing".
  - Multi-task batch where ALL lanes fail to spawn → batchState.phase === "failed".
  - Spawn failure does NOT trigger retry: the same task is not re-spawned (assert mock called exactly once per task, not twice or three times).
- [ ] Run the new test in isolation; then run the full fast suite.

### Step 6: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL fast suite: `cd extensions && npm run test:fast` — should pass with the new test included (target: 3590+ passing, +3 from this task).
- [ ] Run integration suite: `cd extensions && npm run test` — full suite must pass.
- [ ] CLI smoke clean: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor` work.
- [ ] No circular imports introduced (probe `types.ts` ↔ new code).

### Step 7: Documentation & Delivery

- [ ] CHANGELOG entry under [Unreleased] → Fixed:
  - Title: `**Runtime V2 spawn failures now visible (TP-190, #561)**`
  - Body: 1-2 paragraph summary covering: symptom (silent hang on dashboard), root cause (lane state machine didn't react to spawn-time errors), fix (new `spawn-failure` exit category + state transition + IPC alert + no-retry policy + phase=failed when all lanes spawn-fail), validation (regression test + cross-platform Node 24 CI).
- [ ] Discoveries logged in STATUS.md.
- [ ] Step boundaries committed with `feat(TP-190): ...` / `test(TP-190): ...` / `docs(TP-190): ...` prefixes.

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — add Fixed entry per Step 7

**Check If Affected:**
- `docs/explanation/architecture.md` — if it documents the lane state machine, may need a brief mention of the new `spawn-failure` exit category
- `docs/reference/commands.md` — if `orch_status` output formatting documentation describes the `phase` values, ensure `failed` is mentioned (probably already is)

## Completion Criteria

- [ ] All 4 parts of the fix implemented (state-transition, no-retry, phase transition, behavioral test)
- [ ] All tests passing (target: 3590+ passing / 1 skipped / 0 failed)
- [ ] CHANGELOG entry added
- [ ] Per-step plan + code reviews completed and APPROVE'd

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-190): complete Step N — description`
- **Bug fixes:** `fix(TP-190): description`
- **Tests:** `test(TP-190): description`
- **Hydration:** `hydrate: TP-190 expand Step N checkboxes`

## Do NOT

- **Don't add a new try/catch in `executeWave` if the existing one in `executeLaneV2` (line ~2724) already produces the failed outcome.** The bug is downstream of that catch — likely in how the lane state machine and monitor consume the failed outcomes. Verify this in Step 1's discovery before writing new try/catch code.
- **Don't retry spawn failures.** The whole point of the new category is to escalate immediately. Adding it to retry budgets defeats the purpose.
- **Don't expand task scope** — if Step 1 discovery reveals a deeper architectural issue (e.g., lane state machine and Runtime V2 registry are fundamentally out of sync), document in Discoveries and stop. Add tech debt to CONTEXT.md instead of expanding this task.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-190` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
