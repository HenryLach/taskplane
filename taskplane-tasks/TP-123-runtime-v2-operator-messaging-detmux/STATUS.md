# TP-123: Runtime V2 Operator Messaging De-TMUX — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight copy inventory
**Status:** ⬜ Not Started
- [ ] List all user-facing strings containing `tmux` in extension + dashboard runtime files
- [ ] Classify each as hint/status/diagnostic/compat-note
- [ ] Log inventory in STATUS.md

### Step 1: Replace operator guidance strings
**Status:** ⬜ Not Started
- [ ] Replace `tmux attach ...` hints with Runtime V2 guidance
- [ ] Update "TMUX sessions" wording to backend-neutral terminology
- [ ] Keep historical migration context only where needed

### Step 2: Dashboard label cleanup
**Status:** ⬜ Not Started
- [ ] Update dashboard labels/tooltips that imply tmux is active
- [ ] Preserve compatibility behavior for data shape fields
- [ ] Ensure merge/lane liveness indicators still render correctly

### Step 3: Tests
**Status:** ⬜ Not Started
- [ ] Update/extend tests asserting old TMUX wording
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Documentation & delivery
**Status:** ⬜ Not Started
- [ ] Update migration docs with messaging changes
- [ ] Record before/after inventory in STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
