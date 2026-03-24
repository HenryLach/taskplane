# TP-054: Deprecate /task Command — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-24
**Review Level:** 1
**Review Counter:** 1
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
**Status:** ✅ Complete

- [x] Mark `/task*` commands as deprecated in `commands.md`
- [x] Add deprecation note to `/task` mention in `README.md`
- [x] Check `docs/tutorials/install.md` for `/task` references

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit tests passing
- [x] Deprecation strings verified in source
- [x] Build passes

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] "Must Update" docs modified
- [x] "Check If Affected" docs reviewed
- [x] Discoveries logged
- [x] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | UNKNOWN | .reviews/R001-plan-step1.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Previous iteration completed Steps 0-2 code changes but was interrupted before committing Step 2 docs | Recovered in iteration 2 | STATUS.md |
| `/task` deprecation warning fires unconditionally (not gated by isOrchestratedMode) — acceptable since command handler is only hit by manual user input, not TASK_AUTOSTART | Keep as-is | task-runner.ts:3411 |

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
| 2026-03-24 17:15 | Review R001 | plan Step 1: UNKNOWN |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
