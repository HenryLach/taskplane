# TP-019: Doctor Enhancements: Gitignore, Artifact, and Workspace Validation — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Read current `cmdDoctor()`, spec doctor checks, and reusable helpers — capture baseline and patterns
- [ ] Document preflight findings in STATUS Notes (baseline output, helper inventory, spec acceptance criteria)

---

### Step 1: Gitignore and Tracked Artifact Checks
**Status:** ⬜ Not Started

- [ ] Gitignore entry validation implemented
- [ ] Tracked artifact detection with remediation

---

### Step 2: Workspace Pointer Chain Validation
**Status:** ⬜ Not Started

- [ ] Pointer → config repo → `.taskplane/` chain validated
- [ ] Default branch check for config presence

---

### Step 3: Legacy Config Migration Warning
**Status:** ⬜ Not Started

- [ ] YAML-without-JSON detection and migration warning

---

### Step 4: tmux vs spawn_mode Check
**Status:** ⬜ Not Started

- [ ] Mismatch detection with `install-tmux` suggestion

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Doctor output verified for all new checks
- [ ] `node bin/taskplane.mjs doctor`

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 20:33 | Task started | Extension-driven execution |
| 2026-03-17 20:33 | Step 0 started | Preflight |
| 2026-03-17 20:33 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
