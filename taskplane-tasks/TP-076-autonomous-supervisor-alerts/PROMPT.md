# Task: TP-076 - Autonomous Supervisor Alerts (Phase 1)

**Created:** 2026-03-27
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Touches engine IPC, extension message handling, and supervisor prompt — multiple components with cross-cutting concern. No security or data model risk.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-076-autonomous-supervisor-alerts/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Make the supervisor agent truly autonomous by enabling the engine to alert it when failures occur, without requiring user interaction. Today the supervisor only acts when the user sends a message. After this task, the engine sends structured alerts via IPC to the main thread, which injects them as user messages via pi's `sendUserMessage` API, waking the supervisor to investigate and act.

This is Phase 1 of the autonomous supervisor spec (`docs/specifications/taskplane/autonomous-supervisor.md`). It covers the plumbing (IPC message type, emission points, handler, template) — not the recovery tools (Phase 2).

## Dependencies

- **None**

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/autonomous-supervisor.md` — the full spec; sections on Phase 1, alert categories, event flow, and supervisor response protocol are essential
- `extensions/taskplane/engine-worker.ts` — IPC message types and serialization between engine child process and main thread
- `extensions/taskplane/extension.ts` — main thread IPC handler (search for `child.on("message"`) and supervisor state management
- `extensions/taskplane/engine.ts` — engine execution flow, where task failures and merge failures are detected
- `extensions/taskplane/supervisor.ts` — supervisor activation, primer injection, existing notification patterns
- `extensions/taskplane/supervisor-primer.md` — supervisor system prompt that needs alert handling instructions

## Environment

- **Workspace:** extensions/taskplane
- **Services required:** None

## File Scope

- `extensions/taskplane/engine-worker.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/taskplane/types.ts`
- `extensions/tests/supervisor-alerts.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read the autonomous supervisor spec (sections: Phase 1, Alert Categories, Event Flow, Supervisor Response Protocol)
- [ ] Read engine-worker.ts to understand existing IPC message types
- [ ] Read extension.ts IPC handler (`child.on("message"`) to understand existing message routing
- [ ] Read engine.ts to identify task failure and merge failure emission points

### Step 1: Define Alert IPC Message Type

- [ ] Add `supervisor-alert` to `WorkerToMainMessage` union type in `engine-worker.ts`
- [ ] Define `SupervisorAlert` interface in `types.ts` with fields: `category` (task-failure | merge-failure | stall | batch-complete), `summary` (human-readable string), `context` (structured data: taskId, laneId, waveIndex, exitReason, batchState snapshot, etc.)
- [ ] Add serialization for the alert payload (must be IPC-safe — no functions, no circular refs)

### Step 2: Emit Alerts from Engine

- [ ] **Task failure alert:** In `engine.ts` or `execution.ts`, after a task is marked as failed (and deterministic recovery has been attempted), emit a `supervisor-alert` IPC message with category `task-failure`. Include: taskId, laneId, exitReason, STATUS.md tail, batch progress summary.
- [ ] **Merge failure alert:** In `engine.ts` or `merge.ts`, when merge fails and batch pauses, emit a `supervisor-alert` with category `merge-failure`. Include: waveIndex, failed lanes, merge error, batch progress.
- [ ] **Batch complete notification:** In `engine.ts`, when the batch completes (all waves done), emit a `supervisor-alert` with category `batch-complete`. Include: final stats (succeeded/failed/skipped counts, duration).
- [ ] Ensure alerts are only emitted when the supervisor is active (check supervisor state or emit unconditionally — the handler can gate on supervisor activation)

### Step 3: Handle Alerts on Main Thread

- [ ] In `extension.ts`, add `supervisor-alert` case to the `child.on("message")` handler
- [ ] When a supervisor alert arrives: format the alert as a user-readable message string
- [ ] Call `ctx.sendUserMessage(alertText, { deliverAs: "followUp" })` to wake the supervisor
- [ ] If the supervisor is not active (no batch running, or supervisor not initialized), log the alert but don't send (avoid orphaned messages)
- [ ] Also handle the engine child process `exit` event — if the engine dies unexpectedly, send a critical alert to the supervisor

### Step 4: Update Supervisor Primer

- [ ] Add an "Autonomous Alert Handling" section to `supervisor-primer.md`
- [ ] Document the alert format the supervisor will receive
- [ ] Include the response protocol: Acknowledge → Diagnose (orch_status, read logs) → Decide → Act → Report → Learn
- [ ] Instruct the supervisor NOT to ask the user for permission on routine recovery (retry, skip-dependents)
- [ ] Instruct the supervisor to escalate to the user only for genuinely ambiguous situations (repeated failures, unknown errors)
- [ ] Note that the supervisor has these tools available: `orch_status`, `orch_resume`, `orch_pause`, `orch_abort`, `orch_integrate`, `orch_start`

### Step 5: Testing & Verification

- [ ] Create `extensions/tests/supervisor-alerts.test.ts`
- [ ] Test: `SupervisorAlert` type has required fields (category, summary, context)
- [ ] Test: alert message formatting produces readable, actionable text
- [ ] Test: task-failure alert includes taskId, laneId, exitReason
- [ ] Test: merge-failure alert includes waveIndex and failed lanes
- [ ] Test: batch-complete alert includes final stats
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] Update `docs/specifications/taskplane/autonomous-supervisor.md` — mark Phase 1 items as complete
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/autonomous-supervisor.md` — mark Phase 1 as implemented

**Check If Affected:**
- `docs/reference/commands.md` — if any new commands or flags are added (unlikely for Phase 1)
- `docs/explanation/architecture.md` — if the IPC message flow description needs updating

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Engine emits alerts for task failure, merge failure, and batch completion
- [ ] Main thread receives alerts and calls `sendUserMessage` to wake supervisor
- [ ] Supervisor primer includes alert handling instructions
- [ ] A simulated failure triggers the alert → supervisor LLM receives it as a conversation message

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-076): complete Step N — description`
- **Bug fixes:** `fix(TP-076): description`
- **Tests:** `test(TP-076): description`
- **Hydration:** `hydrate: TP-076 expand Step N checkboxes`

## Do NOT

- Add recovery tools (orch_retry_task, orch_skip_task) — that's Phase 2
- Implement stall detection (requires last-activity tracking not yet built)
- Implement the feedback loop (GitHub issue creation) — that's Phase 3
- Add timer-based polling — alerts are event-driven only
- Modify the supervisor's existing tools (orch_status, etc.) — they already work
- Expand task scope — add tech debt to CONTEXT.md instead
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
