# TP-127: Fix Wave Transition Stale Snapshot — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-03
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 1
**Size:** S

---

### Step 0: Preflight
**Status:** 🟨 In Progress
- [x] Read PROMPT.md and STATUS.md
- [x] Read resolveTaskMonitorState in execution.ts
- [x] Understand current liveness check

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
| 2026-04-03 01:29 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 01:29 | Step 0 started | Preflight |
|-----------|--------|---------|
