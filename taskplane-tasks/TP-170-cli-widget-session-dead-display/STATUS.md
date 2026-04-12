# TP-170: CLI Widget Session-Dead Display Fix — Status

**Current Step:** Step 1: Fix Wave-Aware Lane Display
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-12
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read formatting.ts lane rendering
- [x] Read process-registry.ts session lookup
- [x] Understand lane list derivation (batch state vs registry)
- [x] Identify session name mismatch
- [x] Document findings

---

### Step 1: Fix Wave-Aware Lane Display
**Status:** 🟨 In Progress

- [ ] Fix buildDashboardViewModel: detect stale monitor data from prior waves and fall back to currentLanes allocation data
- [ ] Fix renderLaneCard: reconcile task-level vs lane-level sessionAlive to prevent false "session dead" display
- [ ] Fix renderLaneCard: improve "waiting for data" message for lanes in startup grace period
- [ ] Fix buildDashboardViewModel: derive status from lane-level sessionAlive when task snapshot status is "running" but lane session is dead
- [ ] Run targeted tests

---

### Step 2: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Tests for lane status display correctness
- [ ] All failures fixed

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| TOCTOU race: task-level sessionAlive from lane snapshot vs lane-level from PID check can diverge → "session dead" | Fix in Step 1 | `formatting.ts:renderLaneCard`, `execution.ts:monitorLanes` |
| Stale monitor data across waves: buildDashboardViewModel uses wave N-1's monitor when wave N starts | Fix in Step 1 | `formatting.ts:buildDashboardViewModel` |
| Session name in workspace mode doesn't match registry agent IDs | Fix in Step 1 | `formatting.ts:buildDashboardViewModel` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 01:20 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 01:20 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

GitHub issue: #425
