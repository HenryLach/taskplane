# TP-056: Supervisor Merge Monitoring — Status

**Current Step:** Step 1: Implement Merge Health Monitor
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
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
**Status:** 🟨 In Progress

- [ ] Implement session liveness check via `tmux has-session`
- [ ] Implement activity detection via pane capture + snapshot comparison
- [ ] Implement escalation tiers (healthy → warning → dead → stuck)
- [ ] Emit structured events for each escalation tier

---

### Step 2: Integrate with Engine and Supervisor
**Status:** 🟨 In Progress

> ⚠️ Hydrate: Expand based on actual engine merge-phase flow discovered in Step 0

- [ ] Start/stop health monitor during engine merge phase
- [ ] Signal early exit from `waitForMergeResult` on dead session detection
- [ ] Handle new merge health event types in supervisor
- [ ] Format health events for operator display

---

### Step 3: Testing & Verification
**Status:** 🟨 In Progress

- [ ] Create `supervisor-merge-monitoring.test.ts` with health classification, snapshot, and event tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

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
| 2026-03-24 18:37 | Task started | Extension-driven execution |
| 2026-03-24 18:37 | Step 0 started | Preflight |
| 2026-03-24 18:37 | Step 1 started | Implement Merge Health Monitor |
| 2026-03-24 18:37 | Step 2 started | Integrate with Engine and Supervisor |
| 2026-03-24 18:37 | Step 3 started | Testing & Verification |
| 2026-03-24 18:37 | Step 4 started | Documentation & Delivery |
| 2026-03-24 18:37 | Task started | Extension-driven execution |
| 2026-03-24 18:37 | Step 0 started | Preflight |
| 2026-03-24 18:37 | Step 1 started | Implement Merge Health Monitor |
| 2026-03-24 18:37 | Step 2 started | Integrate with Engine and Supervisor |
| 2026-03-24 18:37 | Step 3 started | Testing & Verification |
| 2026-03-24 18:37 | Step 4 started | Documentation & Delivery |

---

## Blockers

*None*

---

## Notes

*Real-world failure from TP-053 batch (2026-03-24): merge agent stalled after 8 tool calls, tmux session alive but silent, no result file for 10+ minutes. Required manual `tmux kill-session` and batch state patching to recover.*
