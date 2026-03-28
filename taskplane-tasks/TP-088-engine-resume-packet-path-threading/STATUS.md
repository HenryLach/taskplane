# TP-088: Engine/Resume Packet-Path Threading and Reconciliation — Status

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

- [ ] Trace engine/resume task launch and completion detection paths
- [ ] Identify all `.DONE`/packet path checks that still rely on cwd assumptions
- [ ] Define minimal API contract between engine/resume and execution layer

---

### Step 1: Engine packet-path threading
**Status:** ⬜ Not Started

- [ ] Ensure engine passes authoritative packet paths for each active segment execution
- [ ] Ensure post-execution completion checks read authoritative packet `.DONE` path
- [ ] Preserve mono-repo backward behavior

---

### Step 2: Resume/reconciliation packet-path threading
**Status:** ⬜ Not Started

- [ ] Ensure resume re-execution paths pass authoritative packet paths
- [ ] Ensure reconciliation checks use authoritative packet `.DONE` path candidates
- [ ] Validate archive-path fallback remains correct for packet-home repo

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust tests for engine/resume packet-path propagation
- [ ] Add/adjust tests for cross-repo completion/reconciliation correctness
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update docs if orchestrator runtime behavior wording changed
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
