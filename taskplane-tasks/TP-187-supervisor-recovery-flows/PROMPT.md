# Task: TP-187 - Supervisor recovery flows: drain alerts, reattach after abort, surface worker reasons

**Created:** 2026-05-06
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Three interconnected bug fixes touching the orchestrator engine (mailbox event drain, abort/resume state reconstruction), the agent-bridge tool surface (new `supervisor_takeover` tool), the worker prompt (require non-empty exit-no-progress reasons), and the supervisor prompt (document text-reply parser semantics). Multi-file behavioral change across the critical recovery path, with state-handling changes in the orchestrator engine. Plan + code + test review all needed because the fixes span unfamiliar territory (mailbox internals, on-disk state reconstruction) where small mistakes can leak silent regressions.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-187-supervisor-recovery-flows/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix three interrelated supervisor-recovery UX bugs that activate when a batch fails (especially via the death-spiral that TP-186 addresses upstream):

- **[#538](https://github.com/HenryLach/taskplane/issues/538) — Zombie alerts after lane termination** (P1): the supervisor receives 3–5 buffered "wants to exit" alerts AFTER a lane is killed. None of the documented operator responses (`steer`, `skip`, `let it fail`, `orch_abort`, `orch_skip_task`) reliably drain the queue. The supervisor experience during recovery is degraded — every zombie alert looks like a fresh interrupt.
- **[#539](https://github.com/HenryLach/taskplane/issues/539) — `orch_resume(force=true)` cannot reattach after `orch_abort()`** (P1): forces ~15 minutes of manual git surgery (fast-forward feature branches, push, remove worktrees, edit STATUS, re-orch_start) just to do what `orch_resume(force=true)` should have done.
- **[#540](https://github.com/HenryLach/taskplane/issues/540) — `Worker said:` is empty in early no-progress alerts** (P2): supervisor has no signal about *why* the worker is stuck on the iterations where intervention could still help. By the time the field has content, the worker is already at no-progress count 3 (kill threshold).

All three were observed in production batch `20260506T105850` (emailgistics-astro) following the death-spiral that TP-186 addresses. They cluster: when #537 fires, the operator hits #540 (can't diagnose), then #538 (alert spam), then often resorts to `orch_abort()` out of frustration, then hits #539 (can't recover cleanly).

## Dependencies

- **Soft dependency on TP-186** — this task fixes the recovery flows that activate when the death-spiral fires; TP-186 fixes the death-spiral itself. Either order works; recommended order is TP-186 first so this task can be validated against batches where the death-spiral is no longer triggering. If TP-186 has already shipped when this runs, that's optimal.

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- Issue #538, #539, #540 bodies in full — concrete repro evidence, hypotheses, and proposed fixes
- `extensions/taskplane/engine.ts` — where lane termination decisions are made (no-progress kill, hard-fail). Find the termination code path; the mailbox drain hook goes there.
- `extensions/taskplane/agent-bridge-extension.ts` — current tool registrations (`notify_supervisor` line ~137, `escalate_to_supervisor` line ~180, `request_segment_expansion` line ~230, `review_step` line ~599). New `supervisor_takeover` tool registration goes alongside these. Add the new tool's name to `agent-host.ts` `ENGINE_BRIDGE_TOOLS` (since it's another engine-internal coordination tool and must be in the worker allowlist — although wait, `supervisor_takeover` is a *supervisor* tool, not a worker tool; verify which agent surface registers it).
- `extensions/taskplane/agent-host.ts` — `ENGINE_BRIDGE_TOOLS` constant. Determine whether `supervisor_takeover` belongs here (worker bridge tools) or in a separate constant for supervisor-only tools.
- `extensions/taskplane/resume.ts` — current `resumeOrchBatch` implementation. The `force=true` path needs to be extended to reconstruct from disk when in-memory state is empty.
- `extensions/taskplane/persistence.ts` — `batch-state.json` schema; `.pi/runtime/<batch-id>/` directory layout. The reconstruction path reads from here.
- `extensions/taskplane/types.ts` — `WorkspaceConfigErrorCode`, batch state types. May need a new state for "stopped-but-resumable" vs "stopped-no-state".
- `templates/agents/task-worker.md` — find the section where the worker requests exit-with-no-progress. Add the requirement for a non-empty reason.
- `templates/agents/supervisor.md` (or `.pi/agents/supervisor.md` for project overrides) — where to add the documented text-reply parser semantics. The supervisor primer has "Project-Specific Rules" section — global rules go in the template.
- `extensions/taskplane/lane-runner.ts` — for the `Worker said:` payload extraction. The current logic surfaces the explicit reason; need to add the "fall back to most recent assistant_message from events.jsonl" behavior.
- `extensions/tests/orch-supervisor-tools.test.ts`, `extensions/tests/orch-supervisor-recovery-tools.test.ts`, `extensions/tests/supervisor-recovery-tools.test.ts` — existing supervisor tool test patterns. Model new tests on these.

## Environment

- **Workspace:** `extensions/taskplane/` + `templates/agents/` + `extensions/tests/`
- **Services required:** None

## File Scope

### Issue #538 — drain mailbox + supervisor_takeover tool
- `extensions/taskplane/engine.ts` — synchronously drain pending mailbox events for an agent's outbox before marking lane terminal (no-progress kill path AND hard-fail path)
- `extensions/taskplane/agent-bridge-extension.ts` — register new `supervisor_takeover(reason: string)` tool (supervisor-side). On invocation: pause current wave, drain all per-agent alert queues, preserve worktrees + state for manual recovery. Distinct from `orch_abort`.
- `extensions/taskplane/agent-host.ts` — possibly add `supervisor_takeover` to a NEW supervisor-bridge-tools constant (NOT to `ENGINE_BRIDGE_TOOLS` which is worker-only). Determine the correct surface based on how supervisor agents currently get their tool allowlist.
- `templates/agents/supervisor.md` — document the `supervisor_takeover` tool and the text-reply parser semantics (`skip` and `let it fail` must be standalone literal replies, not embedded in longer text). Match style of existing supervisor protocol sections.

### Issue #539 — reconstruct batch state from disk on `orch_resume(force=true)`
- `extensions/taskplane/resume.ts` — extend `resumeOrchBatch` (or whichever function `orch_resume` invokes): when `force=true` and in-memory batch state is empty, attempt to read the most recent batch from `.pi/runtime/<batch-id>/` and reconstruct enough state to relaunch (read STATUS.md, `.reviews/`, recent commits in worktree). Fall back to the existing "no batch found" only if disk state is also gone.
- `extensions/taskplane/persistence.ts` — possibly add a `loadBatchStateFromDisk(batchId)` helper if the reconstruction logic gets hairy.
- `extensions/taskplane/types.ts` — possibly distinguish `stopped-no-state` from `stopped-resumable` if needed for clear error messages.

### Issue #540 — surface worker reasons
- `templates/agents/task-worker.md` — when the worker requests exit-with-no-progress, the worker MUST include a one-sentence reason. Add this as a hard requirement, similar to other "MUST" rules.
- `extensions/taskplane/lane-runner.ts` (or wherever the `Worker said:` payload is constructed) — if the reason is empty, fall back to surfacing the **most recent `assistant_message` event** from the worker's `events.jsonl`. This gives the supervisor signal even when explicit articulation is missing.
- (Optional, if budget allows) `extensions/taskplane/lane-runner.ts` — also include the last 2–3 tool-call summaries in the alert payload, per #540 fix proposal C.

### Tests (across all three sub-fixes)
- `extensions/tests/supervisor-recovery-flows.test.ts` (NEW) — at minimum:
  - Mailbox drain: simulate a no-progress kill, assert no further "wants to exit" alerts arrive after termination
  - `supervisor_takeover` tool: assert it pauses the wave, drains alerts, preserves worktrees
  - Resume after abort: simulate abort then resume(force=true), assert reconstruction succeeds OR fails with the documented error message recommending `orch_start`
  - Worker said fallback: simulate worker requesting exit with empty reason, assert the alert payload contains the most-recent assistant_message instead of `""`

### Documentation
- `CHANGELOG.md` — Unreleased / Fixed entry covering all three issues

## Steps

> **Hydration:** STATUS.md tracks outcomes. Workers expand steps when runtime
> discoveries warrant it.
>
> **⚠️ Per TP-186's Order of Operations rule (which should already be in the
> worker prompt by the time this task runs):** do NOT mark a step `Complete`
> until that step's code review has returned APPROVE.

### Step 0: Preflight

- [ ] On `main` (lane worktree), TP-186 already merged (verify by grepping `templates/agents/task-worker.md` for "Order of operations")
- [ ] Baseline test count recorded
- [ ] All Tier 3 context files read
- [ ] Issues #538, #539, #540 bodies read in full
- [ ] Decision recorded in Discoveries: which optional sub-features (e.g., #540C tool-call summaries) to include based on time budget

### Step 1: Plan all three sub-fix designs

> ⚠️ Plan-review checkpoint. The reviewer evaluates the architectural choices
> for each sub-fix BEFORE implementation. Specifically: where mailbox drain
> hooks into engine.ts, what `supervisor_takeover` does vs. `orch_abort`,
> how state reconstruction handles partial / corrupt on-disk state, where
> the empty-reason fallback reads from.

- [ ] **Sub-fix #538 design**: identify the exact engine.ts function(s) where lane termination is decided. Sketch the drain logic (synchronous purge of pending events for the agent's outbox). Sketch `supervisor_takeover` semantics (pause wave + drain + preserve, returning a structured result the supervisor can act on).
- [ ] **Sub-fix #539 design**: identify the `orch_resume(force=true)` entry point. Sketch the disk-reconstruction logic (read batch-history.json or batch-state.json, scan worktrees, validate STATUS.md). Decide on the partial-state policy: best-effort reconstruct vs. fail loudly with recommended `orch_start`.
- [ ] **Sub-fix #540 design**: locate the alert-payload construction in lane-runner.ts. Sketch the fallback logic. Decide whether to also include tool-call summaries (#540C) — if yes, define the format.
- [ ] Drafts written to STATUS.md Discoveries for plan review

**Artifacts:**
- (no source changes yet — designs only)

### Step 2: Implement #538 — mailbox drain + supervisor_takeover

- [ ] Add the synchronous mailbox drain at lane termination decision point(s) in `engine.ts`
- [ ] Register the new `supervisor_takeover(reason: string)` tool in `agent-bridge-extension.ts`
- [ ] If supervisor tools have their own allowlist constant, add `supervisor_takeover` to it. Do NOT add to `ENGINE_BRIDGE_TOOLS` (which is worker-only)
- [ ] Document the new tool in `templates/agents/supervisor.md` along with text-reply parser semantics
- [ ] Targeted test pass on the new behaviors

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/agent-bridge-extension.ts` (modified — new tool)
- `extensions/taskplane/agent-host.ts` (possibly modified — supervisor tool list)
- `templates/agents/supervisor.md` (modified)

### Step 3: Implement #539 — resume reconstruction from disk

- [ ] Implement disk-state reconstruction in `resume.ts` for the `force=true` path when in-memory state is empty
- [ ] If reconstruction fails (no on-disk state either), fail loudly with a clear error message: "No resumable batch found. To start fresh from preserved worktree state, run `orch_start <PROMPT.md>`."
- [ ] Targeted integration test: simulate abort, then force-resume, assert successful reconstruction
- [ ] Edge case: what if multiple batch directories exist? Most recent wins; document the heuristic.

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)
- `extensions/taskplane/persistence.ts` (possibly modified — helper)
- `extensions/taskplane/types.ts` (possibly modified — state distinctions)

### Step 4: Implement #540 — non-empty reason requirement + fallback

- [ ] Update `templates/agents/task-worker.md` to require a one-sentence reason when calling exit-with-no-progress
- [ ] Update lane-runner.ts (or wherever the alert payload is built) to fall back to the most recent `assistant_message` from `events.jsonl` when the explicit reason is empty
- [ ] (Optional) Include last 2–3 tool-call summaries in the alert payload
- [ ] Targeted test: simulate exit-no-progress with empty reason, assert payload contains the assistant message

**Artifacts:**
- `templates/agents/task-worker.md` (modified — small addition near the existing exit-handling guidance)
- `extensions/taskplane/lane-runner.ts` (modified)

### Step 5: Add tests

- [ ] Create `extensions/tests/supervisor-recovery-flows.test.ts`
- [ ] Tests covering: mailbox drain, supervisor_takeover semantics, resume-after-abort reconstruction, worker-said fallback
- [ ] Run targeted: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/supervisor-recovery-flows.test.ts`

**Artifacts:**
- `extensions/tests/supervisor-recovery-flows.test.ts` (new)

### Step 6: Testing & Verification

> ZERO test failures allowed. Full quality gate.

- [ ] Run FULL fast suite: `cd extensions && npm run test:fast`
- [ ] Run integration suite
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] **Code review checkpoint**: `review_step(step=6, type='code', baseline=<sha-before-step-2>)`
- [ ] **Test review checkpoint**: `review_step(step=6, type='test', baseline=<same-sha>)` — this task is Review Level 3 (Full), so the test review fires too
- [ ] Per TP-186's rule: do NOT mark Step 2 / 3 / 4 / 5 Complete until reviews APPROVE

### Step 7: Documentation & Delivery

- [ ] Update `CHANGELOG.md` Unreleased / Fixed with three entries (one per issue) crediting #538, #539, #540
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — three entries
- `templates/agents/supervisor.md` — `supervisor_takeover` tool + text-reply parser semantics
- `templates/agents/task-worker.md` — non-empty exit-no-progress reason rule

**Check If Affected:**
- `docs/reference/commands.md` — if it documents `orch_resume`, update to describe the abort/resume reconstruction behavior
- `docs/explanation/persistence-and-resume.md` — likely needs an update if the resume path is widened
- `docs/how-to/configure-task-orchestrator.md` — verify nothing contradicts new behavior

## Completion Criteria

- [ ] Mailbox drains synchronously on lane termination — no zombie alerts arrive after the lane is killed
- [ ] `supervisor_takeover(reason)` tool exists and functions per spec (pause + drain + preserve)
- [ ] `orch_resume(force=true)` after `orch_abort()` either reconstructs from disk OR fails with the documented error message
- [ ] Worker exit-with-no-progress requires a non-empty reason; alert payload is never empty (fallback to most recent assistant_message)
- [ ] All new tests pass
- [ ] Full test suite passing
- [ ] CHANGELOG entries added for #538, #539, #540

## Git Commit Convention

- **Step completion:** `fix(TP-187): complete Step N — description`
- **Tests:** `test(TP-187): add supervisor recovery flow tests`
- **Docs:** `docs(TP-187): CHANGELOG entries for #538 #539 #540`
- **Hydration:** `hydrate: TP-187 expand Step N checkboxes`

## Do NOT

- **Do not** add `supervisor_takeover` to `ENGINE_BRIDGE_TOOLS` — that constant is worker-only. Supervisor tools are a different surface.
- **Do not** make `orch_abort` resumable as a side effect — keep it semantically destructive. The reconstruction is `orch_resume(force=true)`'s responsibility, not `orch_abort`'s.
- **Do not** drain the mailbox aggressively during normal lane execution — only at termination decision points. Aggressive drain would lose legitimate in-flight alerts.
- **Do not** widen scope to address other issues from the same dump (#537, #542, #541, #543) — those are TP-186 and TP-188 separately.
- **Do not** push directly to `main` — branch + PR per AGENTS.md branching policy.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
