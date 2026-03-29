# TP-083: Supervisor Segment Recovery and Reordering — Status

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

- [ ] Read current supervisor alert payloads and recovery hooks
- [ ] Identify where segment-level failure context must be added
- [ ] Identify frontier selection path where supervised reorder can be applied safely

---

### Step 1: Segment-level supervisor alerts
**Status:** ⬜ Not Started

- [ ] Add segment-level context to supervisor alert payloads (segment id, repo id, frontier snapshot)
- [ ] Ensure alert formatting remains concise and action-oriented
- [ ] Preserve backward compatibility for non-segment batches

---

### Step 2: Reordering policy + enforcement
**Status:** ⬜ Not Started

- [ ] Allow supervisor to reorder only dependency-ready, non-dependent pending segments
- [ ] Reject reorder requests that violate DAG constraints
- [ ] Apply deterministic tie-breaking when reorder input is partial/ambiguous
- [ ] Persist reorder action metadata (who/when/why/before→after)

---

### Step 3: Supervisor playbook updates
**Status:** ⬜ Not Started

- [ ] Update supervisor primer with segment-level recovery decision tree
- [ ] Add guidance for when reorder is appropriate vs retry/skip/abort
- [ ] Include explicit guardrails: never violate dependencies

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust tests for segment-level alerts and context payloads
- [ ] Add/adjust tests for allowed vs rejected reorder scenarios
- [ ] Add/adjust tests proving reorder audit trail persistence
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec docs if implementation constraints were discovered
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
