# TP-004: Repo-Scoped Lane Allocation and Worktree Lifecycle — Status

**Current Step:** Not Started
​**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Refactor lane allocation model
**Status:** ⬜ Not Started

- [ ] Group wave tasks by repoId and allocate lanes per repo group
- [ ] Extend lane identity contracts to include repo dimension (repoId, repo-aware lane IDs)

---

### Step 1: Make worktree operations repo-scoped
**Status:** ⬜ Not Started

- [ ] Ensure create/reset/remove worktree operations execute against each target repo root
- [ ] Keep deterministic ordering across repo groups and lane numbers

---

### Step 2: Update execution contracts
**Status:** ⬜ Not Started

- [ ] Thread repo-aware lane contracts through execution engine callbacks and state updates
- [ ] Preserve single-repo behavior when workspace mode is disabled

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit/regression tests passing
- [ ] Targeted tests for changed modules passing
- [ ] All failures fixed
- [ ] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
