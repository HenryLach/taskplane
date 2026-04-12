# TP-170: CLI Widget Session-Dead Display Fix — Status

**Current Step:** Step 3: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-12
**Review Level:** 1
**Review Counter:** 2
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
**Status:** ✅ Complete

- [x] Fix buildDashboardViewModel: detect stale monitor data from prior waves and fall back to currentLanes allocation data
- [x] Fix buildDashboardViewModel: reconcile lane identity — normalize workspace laneSessionId to V2 registry agentId for correct liveness resolution
- [x] Fix buildDashboardViewModel: derive status from lane-level sessionAlive when task snapshot says "running" but lane session is dead (prevent TOCTOU)
- [x] Fix renderLaneCard: improve "waiting for data" / "session dead" display for startup-grace and completed lanes
- [x] Run targeted tests (wave-transition stale monitor, workspace identity mismatch, startup no-registry-entry)

---

### Step 2: Testing & Verification
**Status:** ✅ Complete

- [x] FULL test suite passing
- [x] Tests for lane status display correctness (23 new assertions in orch-pure-functions.test.ts)
- [x] All failures fixed (0 failures across full suite)

---

### Step 3: Documentation & Delivery
**Status:** ✅ Complete

- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | 1 | REVISE | .reviews/R001-plan-step1.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| TOCTOU race: task-level sessionAlive from lane snapshot vs lane-level from PID check can diverge → "session dead" | Fixed — TOCTOU guard in status derivation | `formatting.ts:buildDashboardViewModel` |
| Stale monitor data across waves: buildDashboardViewModel uses wave N-1's monitor when wave N starts | Fixed — monitorIsFresh validation against currentLanes | `formatting.ts:buildDashboardViewModel` |
| Session name in workspace mode doesn't match registry agent IDs | Fixed — allocation index reconciliation | `formatting.ts:buildDashboardViewModel` |
| extension.ts monitor callback uses wrong property names (totalDone/totalFailed) | Tech debt — cosmetic, widget re-renders via TUI paint | `extension.ts:~2117` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 01:20 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 01:20 | Step 0 started | Preflight |
| 2026-04-12 | Step 0 complete | Identified 3 root causes: stale monitor, TOCTOU, session name mismatch |
| 2026-04-12 | Step 1 complete | Fixed buildDashboardViewModel + renderLaneCard |
| 2026-04-12 | Step 2 complete | 3220 tests pass, 23 new TP-170 assertions |
| 2026-04-12 | Step 3 complete | Discoveries logged, no docs update needed |
| 2026-04-12 01:43 | Worker iter 1 | done in 1364s, tools: 121 |
| 2026-04-12 01:43 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

GitHub issue: #425
| 2026-04-12 01:33 | Review R001 | plan Step 1: REVISE |
| 2026-04-12 01:34 | Review R002 | plan Step 1: APPROVE |
