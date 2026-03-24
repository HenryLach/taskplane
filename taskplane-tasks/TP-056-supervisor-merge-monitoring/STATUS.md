# TP-056: Supervisor Merge Monitoring — Status

**Current Step:** Step 3: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 3
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read supervisor merge event handling in `supervisor.ts`
- [x] Read `waitForMergeResult()` polling loop in `merge.ts`
- [x] Read merge phase orchestration in `engine.ts`
- [x] Review merge constants in `types.ts`

---

### Step 1: Implement Merge Health Monitor
**Status:** ✅ Complete

- [x] Implement session liveness check via `tmux has-session`
- [x] Implement activity detection via pane capture + snapshot comparison
- [x] Implement escalation tiers (healthy → warning → dead → stuck)
- [x] Emit structured events for each escalation tier

---

### Step 2: Integrate with Engine and Supervisor
**Status:** ✅ Complete

> Hydrated based on engine merge flow: engine.ts calls mergeWaveByRepo() which calls mergeWave() which runs a sequential loop of spawnMergeAgent() + waitForMergeResult() per lane. Health monitor needs to run alongside the waitForMergeResult() polling loop. Engine emits events via emitEngineEvent(). Supervisor processes events via processEvents() which uses SIGNIFICANT_EVENT_TYPES set and shouldNotify() for filtering.

- [x] Start/stop health monitor during engine merge phase (wrap mergeWaveByRepo call)
- [x] Pass health monitor through mergeWaveByRepo→mergeWave with session registration/deregistration
- [x] Add merge_health_warning, merge_health_dead, merge_health_stuck to EngineEventType union and event infrastructure
- [x] Handle new event types in supervisor formatEventNotification() and shouldNotify()

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Create `supervisor-merge-monitoring.test.ts` with health classification, snapshot, and event tests
- [x] Full test suite passing
- [x] Build passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update troubleshooting docs with merge stall guidance
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 18:37 | Step 0 completed | Preflight — read all relevant code |
| 2026-03-24 18:42 | Step 1 completed | MergeHealthMonitor class, classifyMergeHealth, captureMergePaneOutput |
| 2026-03-24 18:45 | Step 2 completed | Engine/supervisor integration, event handling |

---

## Blockers

*None*

---

## Notes

*Real-world failure from TP-053 batch (2026-03-24): merge agent stalled after 8 tool calls, tmux session alive but silent, no result file for 10+ minutes. Required manual `tmux kill-session` and batch state patching to recover.*
