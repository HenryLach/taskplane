# TP-109: Workspace Packet-Home and Resume on Runtime V2 — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Trace every Runtime V2 completion, artifact, and reconciliation path that reads or writes packet files
- [ ] Identify every place remaining `cwd`-derived assumptions could still corrupt packet-home authority in workspace mode

---

### Step 1: Packet-Home Threading in Runtime V2 Execution
**Status:** ⬜ Not Started

- [ ] Ensure Runtime V2 engine, lane-runner, and merge flows receive and use authoritative packet paths consistently
- [ ] Make `.DONE`, `STATUS.md`, and `.reviews/` checks fully packet-path authoritative when explicit paths exist
- [ ] Preserve single-repo backward behavior when packet paths are local

---

### Step 2: Resume and Reconciliation
**Status:** ⬜ Not Started

- [ ] Make resume/reconciliation use authoritative packet paths end-to-end on the Runtime V2 backend
- [ ] Verify archive-path and completion fallback behavior remains correct for packet-home repos
- [ ] Preserve deterministic batch-state reconstruction under interruption

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or extend workspace/polyrepo behavioral tests covering packet-home execution and resume on Runtime V2
- [ ] Run the full suite
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update Runtime V2 and multi-repo docs if implementation details or names differ from plan
- [ ] Log discoveries in STATUS.md

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
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
