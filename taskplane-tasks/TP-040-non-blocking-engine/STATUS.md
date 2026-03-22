# TP-040: Non-Blocking Engine Refactor — Status

**Current Step:** Step 4: Testing & Verification
**Status:** ✅ Step 4 Complete
**Last Updated:** 2026-03-22
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 6
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
**Status:** ✅ Complete
- [x] Define engine event types in types.ts (extend existing Tier0EventType with engine lifecycle events: wave_start, task_complete, task_failed, merge_start, merge_success, merge_failed, batch_complete, batch_paused)
- [x] Add EngineEvent interface and EngineEventCallback type in types.ts with shared base payload (timestamp, batchId, waveIndex)
- [x] Extend emitTier0Event in persistence.ts to emit engine events (or add unified emitEngineEvent)
- [x] Add event emission calls at state transitions in engine.ts (wave start/end, task transitions, merge phases, batch completion/pause)
- [x] Add event callback parameter to executeOrchBatch signature and wire callback invocations
- [x] R002-1: Route all early-return paths (detached HEAD, preflight failure, fatal discovery, no pending tasks, graph validation, wave computation, orch branch creation) through terminal event emission before returning
- [x] R002-2: Emit merge_failed event in the mixedOutcomeLanes branch (mergeableLaneCount === 0 && mixedOutcomeLanes.length > 0)
- [x] R002-3: Deduplicate batch_paused emissions for stop policies to ensure one-transition/one-event semantics

---

### Step 2: Make Engine Non-Blocking
**Status:** ✅ Complete
- [x] Create startBatchAsync/startResumeAsync helpers with .catch() error boundary in extension.ts
- [x] /orch handler calls startBatchAsync (fire-and-forget), returns immediately
- [x] /orch-resume handler calls startResumeAsync (fire-and-forget), returns immediately
- [x] Error boundary sets batchState phase/error, notifies operator, refreshes widget on unhandled rejection
- [x] Dashboard widget updates continue working via existing callback mechanism
- [x] R004-1: Detach engine start to next tick via setImmediate/setTimeout so handler returns before synchronous planning work begins

---

### Step 3: Preserve Existing Behavior
**Status:** ✅ Complete
- [x] R005-1: Fix pre-launch race window — set orchBatchState.phase to "launching" synchronously before setTimeout detach so /orch-status, /orch-pause, /orch-abort recognize the batch immediately
- [x] R005-2: Make /orch-status fall back to disk-persisted batch-state.json when in-memory state is idle (covers fresh-session queries and post-crash recovery)
- [x] Verify /orch all still works end-to-end (handler returns immediately, engine runs in background)
- [x] Verify /orch-pause, /orch-resume, /orch-abort work with launching phase
- [x] Existing tests pass
- [x] R006-1: Fix /orch-status disk fallback to resolve state root from workspaceRoot first, matching engine/resume persistence paths
- [x] R006-2: Fix /orch-resume early-return paths so batchState.phase doesn't stay stuck at "launching" when resumeOrchBatch returns early
- [x] R006-3: Verify all existing tests still pass after fixes

---

### Step 4: Testing & Verification
**Status:** ✅ Complete
- [x] Non-blocking handler test: /orch starts engine and returns control immediately (startBatchAsync + setTimeout detach)
- [x] Event emission tests: engine events emitted at correct state transitions (wave_start, task_complete/failed, merge_start/success/failed)
- [x] Completion/failure event tests: batch_complete emitted for success/failure, batch_paused for pause/stop, terminal event guard prevents duplicates
- [x] Events persisted to .pi/supervisor/events.jsonl (JSONL file creation + correct entries including terminal events)
- [x] Command compatibility: immediate post-launch /orch-status, /orch-pause, /orch-abort behavior (launching phase recognized)
- [x] /orch-resume early-return paths reset phase from "launching" to "idle" (no stuck state)
- [x] Full test suite passes: cd extensions && npx vitest run

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
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R004 | code | Step 2 | REVISE | .reviews/R004-code-step2.md |
| R004 | code | Step 2 | REVISE | .reviews/R004-code-step2.md |
| R005 | plan | Step 3 | REVISE | .reviews/R005-plan-step3.md |
| R005 | plan | Step 3 | REVISE | .reviews/R005-plan-step3.md |
| R006 | code | Step 3 | REVISE | .reviews/R006-code-step3.md |
| R006 | code | Step 3 | REVISE | .reviews/R006-code-step3.md |
| R007 | plan | Step 4 | REVISE | .reviews/R007-plan-step4.md |
| R007 | plan | Step 4 | REVISE | .reviews/R007-plan-step4.md |
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
| 2026-03-22 15:45 | Step 1 R002 fix | Applied R002 revisions: terminal event helper with guard flag, early-return emissions, merge_failed for mixed-outcome, batch_paused dedup |
| 2026-03-22 19:43 | Review R002 | code Step 1: REVISE |
| 2026-03-22 19:44 | Worker iter 3 | done in 351s, ctx: 24%, tools: 47 |
| 2026-03-22 19:44 | Step 1 complete | Engine Event Infrastructure |
| 2026-03-22 19:44 | Step 2 started | Make Engine Non-Blocking |
| 2026-03-22 19:46 | Worker iter 2 | done in 179s, ctx: 12%, tools: 20 |
| 2026-03-22 19:46 | Step 1 complete | Engine Event Infrastructure |
| 2026-03-22 19:46 | Step 2 started | Make Engine Non-Blocking |
| 2026-03-22 19:46 | Review R003 | plan Step 2: REVISE |
| 2026-03-22 19:47 | Review R003 | plan Step 2: REVISE |
| 2026-03-22 19:50 | Step 2 impl verified | startBatchAsync helper, fire-and-forget /orch and /orch-resume, error boundary — all already implemented by prev iteration |
| 2026-03-22 19:51 | Worker iter 3 | done in 205s, ctx: 25%, tools: 42 |
| 2026-03-22 19:51 | Worker iter 4 | done in 317s, ctx: 33%, tools: 40 |
| 2026-03-22 19:54 | Review R004 | code Step 2: REVISE |
| 2026-03-22 19:56 | Review R004 | code Step 2: REVISE |
| 2026-03-22 19:57 | Worker iter 4 | done in 52s, ctx: 17%, tools: 11 |
| 2026-03-22 19:57 | Step 2 complete | Make Engine Non-Blocking |
| 2026-03-22 19:57 | Step 3 started | Preserve Existing Behavior |
| 2026-03-22 19:59 | Review R005 | plan Step 3: REVISE |
| 2026-03-22 19:59 | Worker iter 3 | done in 341s, ctx: 15%, tools: 29 |
| 2026-03-22 19:59 | Step 2 complete | Make Engine Non-Blocking |
| 2026-03-22 19:59 | Step 3 started | Preserve Existing Behavior |
| 2026-03-22 20:01 | Review R005 | plan Step 3: REVISE |
| 2026-03-22 20:05 | Step 3 impl | R005-1 verified (already done), R005-2 /orch-status disk fallback added, all 1815 tests pass |
| 2026-03-22 20:05 | Worker iter 4 | done in 254s, ctx: 24%, tools: 32 |
| 2026-03-22 20:07 | Worker iter 5 | done in 489s, ctx: 27%, tools: 79 |
| 2026-03-22 20:10 | Review R006 | code Step 3: REVISE |
| 2026-03-22 20:11 | Review R006 | code Step 3: REVISE |
| 2026-03-22 20:15 | Worker iter 4 | done in 282s, ctx: 18%, tools: 46 |
| 2026-03-22 20:15 | Step 3 complete | Preserve Existing Behavior |
| 2026-03-22 20:15 | Step 4 started | Testing & Verification |
| 2026-03-22 20:16 | Worker iter 5 | done in 339s, ctx: 22%, tools: 48 |
| 2026-03-22 20:16 | Step 3 complete | Preserve Existing Behavior |
| 2026-03-22 20:16 | Step 4 started | Testing & Verification |
| 2026-03-22 20:18 | Review R007 | plan Step 4: REVISE |
| 2026-03-22 20:19 | Review R007 | plan Step 4: REVISE |

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
