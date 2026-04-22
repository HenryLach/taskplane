# TP-054: Deprecate /task Command — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read `/task` command registration in `task-runner.ts`
- [ ] Read current `/task` documentation in `commands.md` and `README.md`
- [ ] Confirm `review_step` tool is NOT registered in standalone `/task` mode

---

### Step 1: Add Deprecation Warnings
**Status:** ⬜ Not Started

- [ ] Add deprecation warning to `/task` command handler
- [ ] Add deprecation warning to `/task-status`, `/task-pause`, `/task-resume`
- [ ] Warnings suggest specific `/orch` equivalents
- [ ] Commands still function normally after warning

---

### Step 2: Update Documentation
**Status:** ⬜ Not Started

- [ ] Mark `/task*` commands as deprecated in `commands.md`
- [ ] Add deprecation note to `/task` mention in `README.md`
- [ ] Check `docs/tutorials/install.md` for `/task` references

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests passing
- [ ] Deprecation strings verified in source
- [ ] Build passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
