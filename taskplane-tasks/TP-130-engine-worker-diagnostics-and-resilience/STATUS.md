# TP-130: Engine Worker Diagnostics and Resilience — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-03
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read engine-worker.ts error handling
- [ ] Read extension.ts fork + exit handler
- [ ] Read lane-runner.ts reviewerRefresh

### Step 1: Process-level error handlers
**Status:** ⬜ Not Started
- [ ] Add uncaughtException handler with IPC error + stack
- [ ] Add unhandledRejection handler
- [ ] Ensure IPC reaches parent before exit

### Step 2: Stderr capture
**Status:** ⬜ Not Started
- [ ] Pipe child stderr to batch-scoped file
- [ ] Tee to parent stderr for terminal display
- [ ] Include stderr tail in failure alert

### Step 3: Snapshot failure counter
**Status:** ⬜ Not Started
- [ ] Add consecutive failure counter
- [ ] Disable interval after 5 failures
- [ ] Reset on success

### Step 4: Tests
**Status:** ⬜ Not Started
- [ ] Test: uncaughtException handler exists
- [ ] Test: unhandledRejection handler exists
- [ ] Run full suite
- [ ] Fix failures

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
