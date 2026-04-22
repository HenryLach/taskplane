# TP-152: Remove /task commands from commands reference — Status

**Current Step:** Step 2: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-07
**Review Level:** 0
**Review Counter:** 0
**Iteration:** 1
**Size:** S

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `docs/reference/commands.md` and identify all `/task`-related content
- [x] Read root `README.md` command table for ground truth

---

### Step 1: Update docs/reference/commands.md
**Status:** ✅ Complete

- [x] Remove entire "Task Runner Commands" section
- [x] Update intro paragraph to remove `/task` reference
- [x] Clean up "Related" section links
- [x] Scan and fix remaining `/task` mentions in `/orch` sections
- [x] Verify section flow and numbering after removal

---

### Step 2: Documentation & Delivery
**Status:** ✅ Complete

- [x] Verify all internal doc links resolve correctly
- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| README.md still has /task commands marked deprecated in command table | Out of scope — separate task needed | README.md |
| `taskplane doctor` section had `/task` reference that was cleaned | Fixed in Step 1 | docs/reference/commands.md:558 |
| `--remove-tasks` flag references `.pi/task-runner.yaml` — this describes actual CLI behavior, not /task command | No change needed | docs/reference/commands.md:592 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-07 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-07 18:55 | Task started | Runtime V2 lane-runner execution |
| 2026-04-07 18:55 | Step 0 started | Preflight |
| 2026-04-07 18:59 | Worker iter 1 | done in 212s, tools: 45 |
| 2026-04-07 18:59 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
