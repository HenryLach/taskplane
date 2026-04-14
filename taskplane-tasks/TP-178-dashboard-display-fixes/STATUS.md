# TP-178: Dashboard Display Fixes — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-13
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read app.js rendering architecture
- [ ] Read all 6 linked issues
- [ ] Document findings

---

### Step 1: Stale STATUS.md viewer across batches (#487)
**Status:** ⬜ Not Started
- [ ] Detect batchId change → clear viewer
- [ ] Auto-select or show placeholder

---

### Step 2: Lane step label never updates (#488)
**Status:** ⬜ Not Started
- [ ] Re-read step name on every poll
- [ ] Fallback to STATUS.md Current Step field

---

### Step 3: Succeeded tasks show 0% (#491)
**Status:** ⬜ Not Started
- [ ] Override to 100% when succeeded
- [ ] Show "Complete" as step label

---

### Step 4: Wave indicators flash green during merge (#493)
**Status:** ⬜ Not Started
- [ ] Only completed waves green during merge
- [ ] Current merging wave shows merging indicator

---

### Step 5: Merge telemetry duplicated across waves (#498)
**Status:** ⬜ Not Started
- [ ] Associate telemetry with correct wave via waveIndex
- [ ] Only display on matching wave

---

### Step 6: No progress for non-final segments (#494)
**Status:** ⬜ Not Started
- [ ] Segment-scoped progress from sidecar
- [ ] Fallback "executing" indicator

---

### Step 7: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full test suite passing
- [ ] Manual dashboard testing

---

### Step 8: Documentation & Delivery
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

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-13 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

GitHub issues: #487, #488, #491, #493, #494, #498
All fixes in dashboard/public/app.js — no runtime code changes.
