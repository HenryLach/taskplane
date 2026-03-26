# TP-071: Engine Worker Thread — Status

**Current Step:** Step 2: Update Extension to Spawn Worker + Wire Orch Tools + Lifecycle
**Status:** 🟡 In Progress
**Iteration:** 3
**Last Updated:** 2026-03-26
**Review Level:** 2
**Review Counter:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read startBatchAsync() entry point and callback pattern
- [x] Read how orch tools interact with running engine
- [x] Verify worker_threads works in pi extension runtime

---

### Step 1: Create Engine Worker Entry Point
**Status:** ✅ Complete
- [x] Create engine-worker.ts: receive workerData, listen parentPort, call executeOrchBatch/resumeOrchBatch with postMessage callbacks
- [x] Add message types and serialization helpers for WorkspaceConfig (Map→Array) and OrchBatchRuntimeState (Set→Array)

---

### Step 2: Update Extension + Wire Orch Tools + Lifecycle (merged Steps 2-4)
**Status:** ✅ Complete

**R001 review findings addressed:**
- Fallback: keep `startBatchAsync()` as fallback when worker spawn fails
- Pause bridge: include `activeWorker.postMessage({ type: "pause" })` in doOrchPause
- Terminal idempotency: `settled` flag prevents duplicate completion flows
- Message names: use `state-sync` (matching engine-worker.ts)
- Worker path resolution: resolve engine-worker.ts relative to extension using import.meta.url

**Implementation checklist:**
- [x] Add `startBatchInWorker()` that spawns Worker, handles messages, falls back to `startBatchAsync()`
- [x] Wire all worker message types (notify, state-sync, monitor-update, engine-event, complete, error)
- [x] Add `settled` terminal guard for idempotent completion
- [x] Track `activeWorker: Worker | null` at extension scope
- [x] Update `/orch` command handler to use `startBatchInWorker()`
- [x] Update `/orch-resume` to use `startBatchInWorker()`
- [x] Update `doOrchPause()` to forward to worker via `activeWorker.postMessage({ type: "pause" })`
- [x] Update `doOrchAbort()` to call `activeWorker.terminate()` for hard abort
- [x] Worker crash → log error, set batch state to failed, notify operator
- [x] Worker exit != 0 → failure notification
- [x] Session exit cleanup (terminate worker on pi session_end)

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Create engine-worker-thread.test.ts
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update architecture docs if needed
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 2 | REVISE | .reviews/R001-plan-step2.md |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-26 01:21 | Task started | Extension-driven execution (iter 2) |
| 2026-03-26 01:30 | Review R001 | plan Step 2: REVISE |
| 2026-03-26 01:35 | Step 2 resumed | Iteration 3, merged Steps 2-4 |

---

## Blockers

*None*

---

## Notes

*Depends on TP-070 (async I/O). The engine needs async I/O before it can run effectively in a worker thread — sync I/O still blocks the worker's event loop.*

### Discovery: Preflight findings
- `startBatchAsync()` is a fire-and-forget wrapper using `setTimeout(0)` + `.then().catch()`
- Pause control: `orchBatchState.pauseSignal.paused = true` (in-memory mutation). Worker needs `postMessage` bridge.
- Abort: writes `.pi/orch-abort-signal` file + kills tmux sessions + sets pauseSignal. File-based mechanism already works cross-thread.
- Resume: fresh state + `resumeOrchBatch()` via `startBatchAsync()`.
- Pi loads extensions via `@mariozechner/jiti`. Worker needs jiti for `.ts` imports.
- `worker_threads` module works in Node.js on this machine.
