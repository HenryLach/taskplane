# TP-076: Autonomous Supervisor Alerts (Phase 1) — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-27
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

- [ ] Read autonomous supervisor spec (Phase 1, Alert Categories, Event Flow)
- [ ] Read engine-worker.ts IPC message types
- [ ] Read extension.ts IPC handler
- [ ] Read engine.ts failure/completion emission points

---

### Step 1: Define Alert IPC Message Type
**Status:** ⬜ Not Started

- [ ] Add `supervisor-alert` to `WorkerToMainMessage` union
- [ ] Define `SupervisorAlert` interface (category, summary, context)
- [ ] Ensure payload is IPC-serializable

---

### Step 2: Emit Alerts from Engine
**Status:** ⬜ Not Started

- [ ] Task failure alert emission (after deterministic recovery exhausted)
- [ ] Merge failure alert emission (when batch pauses)
- [ ] Batch complete notification emission

---

### Step 3: Handle Alerts on Main Thread
**Status:** ⬜ Not Started

- [ ] Add `supervisor-alert` case to IPC message handler
- [ ] Format alert as readable message, call `sendUserMessage`
- [ ] Gate on supervisor activation (don't send orphaned messages)
- [ ] Handle engine process death as critical alert

---

### Step 4: Update Supervisor Primer
**Status:** ⬜ Not Started

- [ ] Add "Autonomous Alert Handling" section to primer
- [ ] Document alert format and response protocol
- [ ] Instruct: don't ask permission for routine recovery, escalate only for ambiguity

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create supervisor-alerts.test.ts
- [ ] Test alert types, formatting, and required fields
- [ ] FULL test suite passing
- [ ] All failures fixed

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update autonomous supervisor spec (mark Phase 1 complete)
- [ ] Discoveries logged

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
| 2026-03-27 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
