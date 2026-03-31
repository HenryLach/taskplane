# TP-102: Runtime V2 ExecutionUnit and Packet-Path Contracts — Status

**Current Step:** Step 1: Define Runtime V2 Contracts
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-30
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Trace the current task/lane runtime contracts through engine, execution, and resume
- [x] Identify where packet paths, runtime identity, and live artifacts are currently implicit or TMUX-derived

---

### Step 1: Define Runtime V2 Contracts
**Status:** ⬜ Not Started

- [ ] Add ExecutionUnit, packet-path, registry manifest, and normalized event type contracts to `types.ts`
- [ ] Add validation helpers and naming rules that preserve repo/workspace correctness
- [ ] Document compatibility shims where legacy task/lane records still need to coexist during migration

---

### Step 2: Thread Contracts into Orchestrator Interfaces
**Status:** ⬜ Not Started

- [ ] Update engine/execution/resume signatures to accept explicit packet-path and runtime identity data where needed
- [ ] Add helper functions for resolving runtime artifact roots without TMUX/session assumptions
- [ ] Ensure new contracts are additive and do not yet force the full backend cutover

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or update behavioral tests covering ExecutionUnit shape, packet-path authority precedence, and runtime artifact naming
- [ ] Run the full suite
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update the Runtime V2 docs if implementation naming diverges from the spec suite
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
| 2026-03-30 | Preflight complete | Traced ParsedTask, AllocatedLane, PersistedTaskRecord, LaneTaskOutcome, resolveCanonicalTaskPaths. TMUX naming in AllocatedLane.tmuxSessionName, PersistedLaneRecord.tmuxSessionName, LaneStatus.tmuxSession. Packet paths partially lifted in v4/TP-081 fields but not yet authoritative. |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
