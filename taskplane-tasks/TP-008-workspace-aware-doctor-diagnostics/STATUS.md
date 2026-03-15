# TP-008: Workspace-Aware Doctor Diagnostics and Validation — Status

**Current Step:** Not Started
​**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Detect workspace mode in doctor
**Status:** ⬜ Not Started

- [ ] Load workspace config when present and branch diagnostics accordingly
- [ ] Avoid false negatives when workspace root is intentionally non-git

---

### Step 1: Validate repo and routing topology
**Status:** ⬜ Not Started

- [ ] Check each configured repo path exists and is a git repo
- [ ] Validate area/default routing targets reference known repos

---

### Step 2: Improve operator guidance
**Status:** ⬜ Not Started

- [ ] Emit actionable remediation hints for missing repos/mappings
- [ ] Keep existing repo-mode doctor output unchanged

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
