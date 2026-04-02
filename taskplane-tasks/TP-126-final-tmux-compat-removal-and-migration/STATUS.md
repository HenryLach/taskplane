# TP-126: Final TMUX Compatibility Removal and Migration — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Removal plan and migration contract
**Status:** ⬜ Not Started
- [ ] Define exact legacy inputs to retire
- [ ] Choose migration policy per input (normalize/error/grace period)
- [ ] Document policy in STATUS.md before code changes

### Step 1: Remove remaining compatibility paths
**Status:** ⬜ Not Started
- [ ] Remove/retire `tmuxPrefix` config alias handling
- [ ] Remove/retire `tmuxSessionName` persisted-lane ingress handling
- [ ] Remove/retire `spawnMode: "tmux"` acceptance paths
- [ ] Keep explicit migration guidance in errors/warnings

### Step 2: Update schema/types/docs/templates
**Status:** ⬜ Not Started
- [ ] Update schema/types to canonical non-TMUX contract
- [ ] Update templates/config docs to canonical keys
- [ ] Update command/doctor docs to final no-TMUX contract

### Step 3: Tests and migration coverage
**Status:** ⬜ Not Started
- [ ] Update fixtures using TMUX-era fields
- [ ] Add migration/failure tests for legacy input detection and guidance
- [ ] Run full extension suite
- [ ] Run CLI smoke tests (`help`, `doctor`)

### Step 4: Final verification & delivery
**Status:** ⬜ Not Started
- [ ] Re-run TMUX reference audit and record final counts
- [ ] Confirm no functional TMUX runtime logic remains
- [ ] Publish migration notes in docs and STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
