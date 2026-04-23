# Task: TP-040 — Non-Blocking Engine Refactor

**Created:** 2026-03-21
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Major refactor of the engine's execution model. Changes how /orch interacts with the pi session. High blast radius — must preserve all existing behavior while making execution async.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 3 (capped)

## Canonical Task Folder

```
taskplane-tasks/TP-040-non-blocking-engine/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Refactor the `/orch` command handler from blocking (`await runOrchBatch()` which
doesn't return until batch completes) to non-blocking (start engine async,
return control to the pi session). This is the critical architecture change that
enables the supervisor agent — the pi session must be free for the operator to
converse with the supervisor while the batch runs in the background.

The engine runs its wave loop via event-driven callbacks. State transitions emit
structured events to `.pi/supervisor/events.jsonl`. The existing batch behavior
(waves, lanes, merges, cleanup) must be completely preserved — only the control
flow changes.

## Dependencies

- **Task:** TP-039 (Tier 0 must be wired in — the non-blocking engine needs event emission infrastructure that TP-039 establishes)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Sections 4.1, 7.1-7.3
- `extensions/taskplane/extension.ts` — `/orch` command handler, `runOrchBatch()`
- `extensions/taskplane/engine.ts` — `executeOrchBatch()` wave loop

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** tmux


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/non-blocking-engine.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Map the full control flow: `/orch` handler → `runOrchBatch()` → `executeOrchBatch()` → wave loop → merge → cleanup → return
- [ ] Identify all `await` points that block the command handler
- [ ] Read spec Sections 4.1 and 7.1-7.3 for the target architecture
- [ ] Identify how the dashboard widget updates currently work (they must continue working)

### Step 1: Engine Event Infrastructure

- [ ] Define engine event types: `wave_start`, `task_complete`, `task_failed`, `merge_start`, `merge_success`, `merge_failed`, `batch_complete`, `batch_paused`, `tier0_recovery`, `tier0_escalation`
- [ ] Add an event callback interface that the command handler can subscribe to
- [ ] Engine emits events at each state transition via the callback
- [ ] Events also written to `.pi/supervisor/events.jsonl` (extending TP-039's logging)

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Make Engine Non-Blocking

- [ ] Refactor `executeOrchBatch()` to run its wave loop without blocking the caller — use `setImmediate`/`setTimeout` or a detached async flow that the caller doesn't `await`
- [ ] The `/orch` command handler starts the engine and returns immediately
- [ ] Engine state transitions are communicated via the event callback, not via return value
- [ ] Batch completion/failure is an event, not a return value
- [ ] Dashboard widget updates continue to work via the existing polling mechanism

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/extension.ts` (modified)

### Step 3: Preserve Existing Behavior

- [ ] `/orch all` still works — starts batch, but now returns to prompt
- [ ] `/orch-status` still works — reads batch state from disk
- [ ] `/orch-pause` still works — writes pause signal
- [ ] `/orch-resume` still works — restarts engine async
- [ ] `/orch-abort` still works — writes abort signal
- [ ] Dashboard still shows live progress
- [ ] All existing tests pass without modification (or with minimal adaptation for the async change)

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: /orch starts engine and returns control (handler completes quickly)
- [ ] Test: engine events emitted at correct state transitions
- [ ] Test: batch completion emits batch_complete event
- [ ] Test: batch failure emits batch_paused event
- [ ] Test: /orch-pause, /orch-resume, /orch-abort work with non-blocking engine
- [ ] Test: events written to .pi/supervisor/events.jsonl
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update `docs/explanation/architecture.md` — note that /orch is non-blocking
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/explanation/architecture.md` — non-blocking /orch description

**Check If Affected:**
- `docs/reference/commands.md` — /orch behavior description
- `docs/explanation/waves-lanes-and-worktrees.md` — if execution flow description changes

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] /orch returns immediately after starting batch
- [ ] Engine runs in background, emits events
- [ ] All existing commands still work
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-040): complete Step N — description`
- **Bug fixes:** `fix(TP-040): description`
- **Tests:** `test(TP-040): description`
- **Hydration:** `hydrate: TP-040 expand Step N checkboxes`

## Do NOT

- Implement the supervisor agent (that's TP-041)
- Change wave planning, lane assignment, or merge logic
- Change how workers or reviewers are spawned
- Break any existing /orch-* command

---

## Amendments (Added During Execution)
