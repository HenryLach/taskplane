# TP-040: Non-Blocking Engine Refactor — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Map full control flow from /orch to wave loop
- [x] Identify all blocking await points
- [x] Read spec target architecture
- [x] Understand dashboard widget update mechanism

---

### Step 1: Engine Event Infrastructure
**Status:** ⬜ Not Started
- [ ] Define engine event types
- [ ] Add event callback interface
- [ ] Engine emits events at state transitions
- [ ] Events written to supervisor events JSONL

---

### Step 2: Make Engine Non-Blocking
**Status:** ⬜ Not Started
- [ ] Refactor wave loop to not block caller
- [ ] Command handler starts engine and returns
- [ ] State communicated via events, not return value
- [ ] Dashboard updates continue working

---

### Step 3: Preserve Existing Behavior
**Status:** ⬜ Not Started
- [ ] /orch all still works
- [ ] /orch-status, /orch-pause, /orch-resume, /orch-abort still work
- [ ] Dashboard shows live progress
- [ ] Existing tests pass

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Non-blocking handler test
- [ ] Event emission tests
- [ ] Completion/failure event tests
- [ ] Command compatibility tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Architecture docs updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-21 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-22 19:21 | Task started | Extension-driven execution |
| 2026-03-22 19:21 | Step 0 started | Preflight |
| 2026-03-22 19:21 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 19:21 | Task started | Extension-driven execution |
| 2026-03-22 19:21 | Step 0 started | Preflight |
| 2026-03-22 19:21 | Skip plan review | Step 0 (Preflight) — low-risk |

## Blockers

*None*

## Notes

### Preflight Findings (Step 0)

**Control Flow:**
1. `/orch` handler (extension.ts ~L404) → `await executeOrchBatch()` — THE blocking call
2. `executeOrchBatch()` (engine.ts ~L323): Planning → Wave Loop → Merge → Cleanup → return
3. `/orch-resume` handler → `await resumeOrchBatch()` — second blocking call

**Blocking `await` Points:**
- `extension.ts` `/orch` handler: `await executeOrchBatch(...)` — blocks entire batch
- `extension.ts` `/orch-resume` handler: `await resumeOrchBatch(...)` — blocks entire resume
- Inside engine: `await executeWave(...)`, `await attemptStaleWorktreeRecovery(...)`, `await attemptWorkerCrashRetry(...)`, `await executeLane(...)`

**Spec Architecture (Sections 4.1, 7.1-7.3):**
- `/orch all` starts engine async, returns immediately
- Engine runs via event-driven callbacks (not blocking await)
- Events emitted: wave_start, task_complete, task_failed, merge_start, merge_success, merge_failed, batch_complete, batch_paused, tier0_recovery, tier0_escalation
- Events written to `.pi/supervisor/events.jsonl`

**Dashboard Widget Mechanism:**
- `createOrchWidget()` (formatting.ts) reads in-memory closures on each `render()` call
- `updateOrchWidget()` calls `ctx.ui.setWidget()` to re-register with updated state
- Widget updates triggered by callbacks (onNotify, onMonitorUpdate) — NOT dependent on blocking await
- **Key**: Widget works as long as `orchBatchState` and `latestMonitorState` are updated via callbacks. Non-blocking refactor needs to keep these callbacks working.

**Architecture for Non-Blocking Refactor:**
- The engine already communicates state via callbacks (onNotify, onMonitorUpdate). The core change is removing the `await` from the command handlers.
- `executeOrchBatch()` can be called without `await` — it's an async function that updates state via callbacks and in-memory mutation.
- `/orch-resume` needs the same treatment.
- The onNotify and onMonitorUpdate callbacks will continue to fire correctly since they run within the same event loop.
