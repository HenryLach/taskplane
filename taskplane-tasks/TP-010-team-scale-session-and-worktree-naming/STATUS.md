# TP-010: Team-Scale Session and Worktree Naming Hardening — Status

**Current Step:** Not Started
​**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Define naming contract
**Status:** ⬜ Not Started

- [ ] Design deterministic naming including repo slug + operator identifier + batch components
- [ ] Document fallback rules when operator metadata is unavailable

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
