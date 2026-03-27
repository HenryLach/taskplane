# TP-077: Supervisor Recovery Tools — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-27
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read spec Phase 2, tool registration pattern, types, IPC flow

---

### Step 1: Implement orch_retry_task
**Status:** ⬜ Not Started

- [ ] Register tool with taskId parameter
- [ ] Validate task exists and is failed
- [ ] Reset state, adjust counters, persist
- [ ] Forward retry signal to engine if running

---

### Step 2: Implement orch_skip_task
**Status:** ⬜ Not Started

- [ ] Register tool with taskId parameter
- [ ] Validate task exists and is failed/pending
- [ ] Update state, unblock dependents, persist

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create supervisor-recovery-tools.test.ts
- [ ] Test retry, skip, validation, counters
- [ ] FULL test suite passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec and commands docs
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
