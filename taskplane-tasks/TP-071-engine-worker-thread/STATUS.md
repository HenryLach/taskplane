# TP-071: Engine Worker Thread — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read startBatchAsync() entry point and callback pattern
- [ ] Read how orch tools interact with running engine
- [ ] Verify worker_threads works in pi extension runtime

---

### Step 1: Create Engine Worker Entry Point
**Status:** ⬜ Not Started
- [ ] Create engine-worker.ts with parentPort messaging
- [ ] Replace callbacks with postMessage calls

---

### Step 2: Update Extension to Spawn Worker
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on actual startBatchAsync call pattern discovered in Step 0

- [ ] Replace direct startBatchAsync() call with new Worker()
- [ ] Wire worker message handlers (notify, engine-event, complete)
- [ ] Handle worker error and exit events

---

### Step 3: Wire Orch Tools to Worker
**Status:** ⬜ Not Started
- [ ] Route pause/abort/resume through worker thread or signal files
- [ ] Verify all orch tools work across thread boundary

---

### Step 4: Handle Worker Lifecycle
**Status:** ⬜ Not Started
- [ ] Worker crash detection and reporting
- [ ] Clean termination on pi session exit

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

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Depends on TP-070 (async I/O). The engine needs async I/O before it can run effectively in a worker thread — sync I/O still blocks the worker's event loop.*
