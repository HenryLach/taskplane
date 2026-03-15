# TP-010: Team-Scale Session and Worktree Naming Hardening — Status

**Current Step:** Step 1: Apply naming contract consistently
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Define naming contract
**Status:** ✅ Complete

- [x] Design deterministic naming including repo slug + operator identifier + batch components
- [x] Document fallback rules when operator metadata is unavailable

---

### Step 1: Apply naming contract consistently
**Status:** ⬜ Not Started

- [ ] Update lane TMUX sessions, worker/reviewer prefixes, merge sessions, and worktree prefixes
- [ ] Ensure log/sidecar file naming aligns with new identifiers

---

### Step 2: Validate collision resistance
**Status:** ⬜ Not Started

- [ ] Add tests/smoke scenarios for concurrent runs in shared environments
- [ ] Confirm naming remains human-readable for debugging and lane-agent-style supervision views

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
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 18:55 | Task started | Extension-driven execution |
| 2026-03-15 18:55 | Step 0 started | Define naming contract |
| 2026-03-15 18:55 | Task started | Extension-driven execution |
| 2026-03-15 18:55 | Step 0 started | Define naming contract |
| 2026-03-15 18:58 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 19:10 | Step 0 completed | naming-contract.md created with full contract table, operator fallback matrix, parser compat plan, test plan |
| 2026-03-15 18:59 | Review R001 | plan Step 0: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
