# TP-122: TMUX Reference Baseline and Guardrails — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** S

---

### Step 0: Baseline inventory
**Status:** ⬜ Not Started
- [ ] Record current TMUX reference counts by file for `extensions/taskplane/*.ts`
- [ ] Classify references into buckets: compat-code, user-facing strings, comments/docs, types/contracts
- [ ] Capture baseline in STATUS.md for future tasks

### Step 1: Add audit script
**Status:** ⬜ Not Started
- [ ] Create `scripts/tmux-reference-audit.mjs`
- [ ] Emit machine-readable summary (total + by-file + by-category)
- [ ] Support strict mode failure on functional TMUX usage

### Step 2: Add regression guard test
**Status:** ⬜ Not Started
- [ ] Add `extensions/tests/tmux-reference-guard.test.ts`
- [ ] Assert no functional TMUX command execution remains in `extensions/taskplane/*.ts`
- [ ] Assert audit script output stays parseable and deterministic

### Step 3: Tests and validation
**Status:** ⬜ Not Started
- [ ] Run targeted tests including new guard test
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Documentation & delivery
**Status:** ⬜ Not Started
- [ ] Update migration doc with guardrail usage
- [ ] Update STATUS.md summary with baseline numbers and commands

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
