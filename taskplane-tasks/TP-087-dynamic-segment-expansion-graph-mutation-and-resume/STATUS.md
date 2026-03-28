# TP-087: Dynamic Segment Expansion Graph Mutation and Resume — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Identify exact frontier mutation points for approved decisions
- [ ] Define deterministic update order for added nodes/edges
- [ ] Define persistence shape for graph revisions and audit records

---

### Step 1: Runtime graph mutation
**Status:** ⬜ Not Started

- [ ] Apply approved expansion decisions to in-memory segment graph
- [ ] Validate edge additions and reject cycles deterministically
- [ ] Update runnable frontier without violating one-active-segment-per-task invariant

---

### Step 2: Persisted revision + audit trail
**Status:** ⬜ Not Started

- [ ] Persist graph revision metadata and before/after frontier snapshots (as designed)
- [ ] Persist decision audit details (`who/when/why/decision`)
- [ ] Ensure serialization/validation supports revised state shape

---

### Step 3: Resume reconstruction for expanded graph
**Status:** ⬜ Not Started

- [ ] Reconstruct expanded graph/frontier from persisted state
- [ ] Ensure no rediscovery ambiguity after restart
- [ ] Preserve deterministic scheduling order after expansion across resume boundary

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust tests for approved expansion mutation behavior
- [ ] Add/adjust tests for cycle rejection and frontier consistency
- [ ] Add/adjust tests for expanded-graph resume reconstruction
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec/docs if revision schema details differ from planned wording
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

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
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
