# TP-166: Wave Planner Excessive Waves and Global Lane Cap — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight and Analysis
**Status:** ⬜ Not Started

- [ ] Read waves.ts wave planning logic for multi-segment tasks
- [ ] Reproduce excessive-waves scenario (8 tasks → 6 waves instead of 3)
- [ ] Read `enforceGlobalLaneCap` and trace call sites
- [ ] Identify root cause of phantom waves
- [ ] Identify per-repo vs global maxLanes gap
- [ ] Document findings in STATUS.md

---

### Step 1: Fix Excessive Wave Generation
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on root cause analysis in Step 0

- [ ] Eliminate phantom/duplicate waves
- [ ] Wave count matches dependency graph depth
- [ ] Run targeted tests

---

### Step 2: Fix Global Lane Cap Enforcement
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on analysis in Step 0

- [ ] Ensure `enforceGlobalLaneCap` is effective in workspace path
- [ ] Add test: 3 repos, maxLanes=4 → total ≤ 4
- [ ] Run targeted tests

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Regression test: correct wave count for small graphs
- [ ] Regression test: global lane cap enforcement
- [ ] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update maxLanes docs
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
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

GitHub issues: #454, #451
