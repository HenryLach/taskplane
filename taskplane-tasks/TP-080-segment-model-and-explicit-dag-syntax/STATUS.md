# TP-080: Segment Model and Optional Explicit DAG Syntax — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read current task parsing and routing flow from discovery to waves
- [ ] Identify where file-scope/repo attribution can seed segment inference
- [ ] Confirm existing parser behavior for unknown metadata blocks in `PROMPT.md`

---

### Step 1: Add segment contracts
**Status:** ⬜ Not Started

- [ ] Define segment planning types (segment id, repo id, dependency edges)
- [ ] Define task-to-segment mapping contract with stable IDs (`<taskId>::<repoId>`)
- [ ] Add explicit typing for inferred vs explicit edges (for observability)

---

### Step 2: Support optional explicit segment DAG metadata
**Status:** ⬜ Not Started

- [ ] Add parser support for optional segment DAG metadata in `PROMPT.md`
- [ ] Ensure metadata is optional and non-breaking for existing tasks
- [ ] Validate explicit edges for unknown repo IDs and obvious cycles (fail fast)

---

### Step 3: Deterministic inference fallback
**Status:** ⬜ Not Started

- [ ] Build deterministic segment inference when explicit metadata is absent
- [ ] Use stable ordering inputs (repo touches, first appearance, task dependencies)
- [ ] Ensure one active segment per task policy is representable in planner output

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust tests for explicit segment metadata parsing
- [ ] Add/adjust tests for deterministic inference fallback
- [ ] Add/adjust regression tests for backward compatibility (no metadata)
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec wording if implementation reveals syntax or validation constraints
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
