# TP-006: Persisted State Schema v2 with Repo-Aware Records — Status

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

### Step 0: Define schema v2
**Status:** ⬜ Not Started

- [ ] Bump batch-state schema version and add repo-aware fields on lane/task records
- [ ] Document field contracts and compatibility expectations

---

### Step 1: Implement serialization and validation
**Status:** ⬜ Not Started

- [ ] Persist repo-aware fields at all state transition checkpoints
- [ ] Validate schema v2 with explicit errors for malformed records

---

### Step 2: Handle schema v1 compatibility
**Status:** ⬜ Not Started

- [ ] Add v1->v2 up-conversion or explicit migration guardrails
- [ ] Add regression tests covering v1 and v2 loading paths

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
