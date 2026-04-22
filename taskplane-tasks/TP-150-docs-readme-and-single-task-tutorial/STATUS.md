# TP-150: Update docs README and rewrite single-task tutorial — Status

**Current Step:** Step 3: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-07
**Review Level:** 0
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `docs/README.md` and identify all `/task` references and stale content
- [x] Read `docs/tutorials/run-your-first-task.md` and understand current structure
- [x] Read root `README.md` sections on single-task execution via `/orch` for ground truth

---

### Step 1: Update docs/README.md
**Status:** ✅ Complete

- [x] Update "New Users" tutorial links — reframe "Run Your First Task" description
- [x] Update "Operators" section — fix "Configure Task Runner" link text
- [x] Remove all `/task` references throughout file
- [x] Verify all links resolve to valid files

---

### Step 2: Rewrite docs/tutorials/run-your-first-task.md
**Status:** ✅ Complete

- [x] Rewrite tutorial for `/orch`-based single task execution
- [x] Show running `/orch <path/to/PROMPT.md>` workflow
- [x] Explain PROMPT.md and STATUS.md
- [x] Show monitoring via `/orch-status` and dashboard
- [x] Show pause/resume via `/orch-pause` and `/orch-resume`
- [x] Show completion verification
- [x] Update troubleshooting and "Next Step" links

---

### Step 3: Documentation & Delivery
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
| Root README.md still has deprecated `/task` command entries in the commands table | Out of scope — another task handles root README cleanup | `README.md` |
| `docs/how-to/use-tmux-for-visibility.md` exists but may be stale with Runtime V2 subprocess backend | Out of scope — note for future cleanup | `docs/README.md` Operators section |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-07 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-07 18:55 | Task started | Runtime V2 lane-runner execution |
| 2026-04-07 18:55 | Step 0 started | Preflight |
| 2026-04-07 19:01 | Worker iter 1 | done in 326s, tools: 60 |
| 2026-04-07 19:01 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
