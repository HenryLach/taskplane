# TP-033: Transactional Merge Envelope & Retry Matrix — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read merge flow end-to-end
- [ ] Read v3 state retry fields
- [ ] Read roadmap Phase 4 sections

---

### Step 1: Transaction Envelope
**Status:** ⬜ Not Started
- [ ] Capture pre/post merge refs
- [ ] Rollback on verification failure
- [ ] Safe-stop on rollback failure
- [ ] Persist transaction record

---

### Step 2: Retry Policy Matrix
**Status:** ⬜ Not Started
- [ ] Implement retry by failure classification
- [ ] Persist retry counters scoped by repo/wave/lane
- [ ] Enforce max attempts and cooldown
- [ ] Exhaustion enters paused

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Transaction record tests
- [ ] Rollback tests
- [ ] Safe-stop tests
- [ ] Retry counter persistence tests
- [ ] Exhaustion tests
- [ ] Workspace-scoped counter tests
- [ ] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Config reference docs updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
