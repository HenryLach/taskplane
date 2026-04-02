# TP-127: Fix Wave Transition Stale Snapshot — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read resolveTaskMonitorState in execution.ts
- [ ] Understand current liveness check

### Step 1: Fix the stale snapshot check
**Status:** ⬜ Not Started
- [ ] Check snap.taskId matches monitored taskId
- [ ] Stale snapshot → assume alive
- [ ] Ensure readLaneSnapshot returns taskId

### Step 2: Tests
**Status:** ⬜ Not Started
- [ ] Test: stale snapshot → alive
- [ ] Test: current running snapshot → alive
- [ ] Test: current complete snapshot → dead
- [ ] Run full suite
- [ ] Fix failures

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
