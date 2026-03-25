# TP-066: Fix Context Pressure Safety Net — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read latestTotalTokens calculation in task-runner.ts
- [ ] Read tmux mode context pressure handler
- [ ] Read RPC wrapper usage reporting
- [ ] Determine if pi's totalTokens includes cache reads

---

### Step 1: Fix Context Percentage Calculation
**Status:** ⬜ Not Started
- [ ] Include cache read tokens in context pressure calculation
- [ ] Fix in both tmux and subprocess modes
- [ ] Fix dashboard server accumulator if needed

---

### Step 2: Add Worker Template Guidance for Large Files
**Status:** ⬜ Not Started
- [ ] Add "File Reading Strategy" section to worker template
- [ ] Include grep-first, read-with-offset pattern examples
- [ ] Update local template comments

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Update context-window tests for cache-inclusive calculation
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Critical safety fix. TP-065 worker failed 3 times because the 85% wrap-up signal never fired despite 874K tokens consumed. Cache read tokens were invisible to the context pressure calculation.*
