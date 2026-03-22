# TP-040: Non-Blocking Engine Refactor — Status

**Current Step:** Step 1: Engine Event Infrastructure
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 3
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
**Status:** 🟡 In Progress (R002 REVISE)
- [x] Define engine event types in types.ts (extend existing Tier0EventType with engine lifecycle events: wave_start, task_complete, task_failed, merge_start, merge_success, merge_failed, batch_complete, batch_paused)
- [x] Add EngineEvent interface and EngineEventCallback type in types.ts with shared base payload (timestamp, batchId, waveIndex)
- [x] Extend emitTier0Event in persistence.ts to emit engine events (or add unified emitEngineEvent)
- [x] Add event emission calls at state transitions in engine.ts (wave start/end, task transitions, merge phases, batch completion/pause)
- [x] Add event callback parameter to executeOrchBatch signature and wire callback invocations
- [ ] R002-1: Route all early-return paths (detached HEAD, preflight failure, fatal discovery, no pending tasks, graph validation, wave computation, orch branch creation) through terminal event emission before returning
- [ ] R002-2: Emit merge_failed event in the mixedOutcomeLanes branch (mergeableLaneCount === 0 && mixedOutcomeLanes.length > 0)
- [ ] R002-3: Deduplicate batch_paused emissions for stop policies to ensure one-transition/one-event semantics

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
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
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
| 2026-03-22 19:23 | Worker iter 2 | done in 128s, ctx: 40%, tools: 25 |
| 2026-03-22 19:23 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-22 19:23 | Step 0 complete | Preflight |
| 2026-03-22 19:23 | Step 1 started | Engine Event Infrastructure |
| 2026-03-22 19:24 | Worker iter 1 | done in 163s, ctx: 41%, tools: 30 |
| 2026-03-22 19:24 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-22 19:24 | Step 0 complete | Preflight |
| 2026-03-22 19:24 | Step 1 started | Engine Event Infrastructure |
| 2026-03-22 19:25 | Review R001 | plan Step 1: APPROVE |
| 2026-03-22 19:25 | Review R001 | plan Step 1: APPROVE |
| 2026-03-22 19:35 | Step 1 impl | Engine event types, emitter, and emissions wired in types.ts, persistence.ts, engine.ts |
| 2026-03-22 19:34 | Worker iter 3 | done in 514s, ctx: 52%, tools: 75 |
| 2026-03-22 19:38 | Worker iter 2 | done in 755s, ctx: 59%, tools: 85 |
| 2026-03-22 19:38 | Review R002 | code Step 1: REVISE |

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
