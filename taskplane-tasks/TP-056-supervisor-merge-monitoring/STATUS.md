# TP-056: Supervisor Merge Monitoring — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read supervisor merge event handling in `supervisor.ts`
- [ ] Read `waitForMergeResult()` polling loop in `merge.ts`
- [ ] Read merge phase orchestration in `engine.ts`
- [ ] Review merge constants in `types.ts`

---

### Step 1: Implement Merge Health Monitor
**Status:** ⬜ Not Started

- [ ] Implement session liveness check via `tmux has-session`
- [ ] Implement activity detection via pane capture + snapshot comparison
- [ ] Implement escalation tiers (healthy → warning → dead → stuck)
- [ ] Emit structured events for each escalation tier

---

### Step 2: Integrate with Engine and Supervisor
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on actual engine merge-phase flow discovered in Step 0

- [ ] Start/stop health monitor during engine merge phase
- [ ] Signal early exit from `waitForMergeResult` on dead session detection
- [ ] Handle new merge health event types in supervisor
- [ ] Format health events for operator display

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create `supervisor-merge-monitoring.test.ts` with health classification, snapshot, and event tests
- [ ] Full test suite passing
- [ ] Build passes

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

---

## Blockers

*None*

---

## Notes

*Real-world failure from TP-053 batch (2026-03-24): merge agent stalled after 8 tool calls, tmux session alive but silent, no result file for 10+ minutes. Required manual `tmux kill-session` and batch state patching to recover.*
