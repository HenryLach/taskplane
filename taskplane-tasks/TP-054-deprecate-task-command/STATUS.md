# TP-054: Deprecate /task Command — Status

**Current Step:** Step 1: Add Deprecation Warnings
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 2
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `/task` command registration in `task-runner.ts`
- [x] Read current `/task` documentation in `commands.md` and `README.md`
- [x] Confirm `review_step` tool is NOT registered in standalone `/task` mode

---

### Step 1: Add Deprecation Warnings
**Status:** ✅ Complete

- [x] Add deprecation warning to `/task` command handler
- [x] Add deprecation warning to `/task-status`, `/task-pause`, `/task-resume`
- [x] Warnings suggest specific `/orch` equivalents
- [x] Commands still function normally after warning

---

### Step 2: Update Documentation
**Status:** 🟨 In Progress

- [ ] Mark `/task*` commands as deprecated in `commands.md`
- [ ] Add deprecation note to `/task` mention in `README.md`
- [ ] Check `docs/tutorials/install.md` for `/task` references

---

### Step 3: Testing & Verification
**Status:** 🟨 In Progress

- [ ] Unit tests passing
- [ ] Deprecation strings verified in source
- [ ] Build passes

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] "Must Update" docs modified
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
| 2026-03-24 17:11 | Task started | Extension-driven execution |
| 2026-03-24 17:11 | Step 0 started | Preflight |
| 2026-03-24 17:11 | Step 1 started | Add Deprecation Warnings |
| 2026-03-24 17:11 | Step 2 started | Update Documentation |
| 2026-03-24 17:11 | Step 3 started | Testing & Verification |
| 2026-03-24 17:11 | Step 4 started | Documentation & Delivery |
| 2026-03-24 17:11 | Task started | Extension-driven execution |
| 2026-03-24 17:11 | Step 0 started | Preflight |
| 2026-03-24 17:11 | Step 1 started | Add Deprecation Warnings |
| 2026-03-24 17:11 | Step 2 started | Update Documentation |
| 2026-03-24 17:11 | Step 3 started | Testing & Verification |
| 2026-03-24 17:11 | Step 4 started | Documentation & Delivery |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
