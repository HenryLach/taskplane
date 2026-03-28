# TP-085: Segment Frontier Scheduler and Resume Reconstruction — Status

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

- [ ] Trace current task-level frontier lifecycle in engine/resume
- [ ] Map exact insertion points for segment-level runnable frontier
- [ ] Identify invariants to keep deterministic ordering stable across restarts

---

### Step 1: Segment frontier runtime integration
**Status:** ⬜ Not Started

- [ ] Replace/augment task-level frontier with segment-level runnable frontier
- [ ] Enforce one active segment per task at any time
- [ ] Preserve lane parallelism across tasks/segments when dependencies allow
- [ ] Keep deterministic tie-breaking and stable ordering

---

### Step 2: Resume reconstruction parity
**Status:** ⬜ Not Started

- [ ] Reconstruct frontier from persisted segment records (not fresh rediscovery)
- [ ] Preserve completed/blocked/failed counters with segment granularity
- [ ] Verify merge and cleanup transitions remain consistent after resume

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust direct-implementation tests for segment frontier routing
- [ ] Add/adjust polyrepo regressions for deterministic ordering and resume parity
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update docs if runtime behavior wording changed
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
