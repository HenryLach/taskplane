# TP-015: Init v2: Mode Detection, Gitignore, and Artifact Cleanup — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Read current `cmdInit()` implementation
- [x] Read spec auto-detection and gitignore sections
- [ ] Verify spec reachability and record source path
- [ ] Verify TP-014 config loader/schema contract (JSON output shape, YAML fallback expectations)
- [ ] Record current `cmdInit()` behavior to preserve (--preset, YAML continuity, --tasks-root, --dry-run, --force, --no-examples)
- [ ] Identify downstream validation (existing tests, CLI checks for init regressions)

---

### Step 1: Mode Auto-Detection
**Status:** ⬜ Not Started

- [ ] Detection logic implemented (git repo, subdirectory scan, mode)
- [ ] Ambiguous case handled with prompt
- [ ] "Already initialized" detection for Scenario B

---

### Step 2: Gitignore Enforcement
**Status:** ⬜ Not Started

- [ ] Selective gitignore entries added during init
- [ ] Tracked artifact detection and `git rm --cached` offer

---

### Step 3: tmux and Environment Detection
**Status:** ⬜ Not Started

- [ ] tmux detection with spawn_mode defaulting
- [ ] Guidance message when tmux not found

---

### Step 4: Workspace Mode Init (Scenario C)
**Status:** ⬜ Not Started

- [ ] Config repo selection and `.taskplane/` creation
- [ ] Pointer file creation in workspace root
- [ ] Post-init merge guidance displayed

---

### Step 5: Workspace Join (Scenario D)
**Status:** ⬜ Not Started

- [ ] Existing `.taskplane/` discovery
- [ ] Pointer-only creation

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All four scenarios verified with `--dry-run`
- [ ] Mode detection edge cases tested

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Install tutorial updated
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 15:23 | Task started | Extension-driven execution |
| 2026-03-17 15:23 | Step 0 started | Preflight |
| 2026-03-17 15:23 | Task started | Extension-driven execution |
| 2026-03-17 15:23 | Step 0 started | Preflight |
| 2026-03-17 15:25 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 15:26 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
