# TP-064: Fix Dashboard Telemetry Crash — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read tailJsonlFile() and loadTelemetryData()
- [ ] Understand tail state model

---

### Step 1: Fix tailJsonlFile for Large Files
**Status:** ⬜ Not Started
- [ ] Add MAX_TAIL_BYTES cap on read size per tick
- [ ] Skip-to-tail on fresh dashboard start with large files
- [ ] Guard Buffer allocation

---

### Step 2: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*
