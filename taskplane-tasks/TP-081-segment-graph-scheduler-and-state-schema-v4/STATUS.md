# TP-081: State Schema v4 for Segment Execution — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read current persisted state schema/versioning and migration flow
- [ ] Define explicit v3→v4 migration strategy (fields/defaults/guards)
- [ ] Identify invariants required by resume and dashboard consumers

---

### Step 1: Add schema v4 contracts
**Status:** ⬜ Not Started

- [ ] Add v4 type contracts for task-level and segment-level persisted fields
- [ ] Add/adjust runtime state contracts needed for v4 serialization
- [ ] Document optional vs required fields for migration safety

---

### Step 2: Implement persistence + migration
**Status:** ⬜ Not Started

- [ ] Implement v4 serialize/load/validate paths
- [ ] Add compatibility for prior versions (at least v2/v3 load paths)
- [ ] Keep unsupported-version errors explicit and actionable

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust migration fixtures and regression tests
- [ ] Verify round-trip serialization for v4 fields
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec notes if implementation details differ from planned shape
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
