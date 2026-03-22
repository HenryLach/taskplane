# TP-039: Tier 0 Watchdog Engine Integration — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-21
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read engine wave loop failure handling
- [ ] Read retry matrix from TP-033
- [ ] Read partial progress code from TP-028
- [ ] Read spec Sections 5.1-5.4

---

### Step 1: Wire Automatic Recovery into Engine
**Status:** ⬜ Not Started
- [ ] Merge timeout → automatic retry
- [ ] Session crash → partial progress save + retry if retryable
- [ ] Stale worktree → force cleanup + retry
- [ ] Cleanup failure → retry once, then wave gate
- [ ] Persist retry counters

---

### Step 2: Tier 0 Event Logging
**Status:** ⬜ Not Started
- [ ] Create .pi/supervisor/ directory
- [ ] Write JSONL events for recovery attempts/success/exhaustion
- [ ] Include full context in events

---

### Step 3: Escalation Interface
**Status:** ⬜ Not Started
- [ ] Define EscalationContext interface
- [ ] Emit escalation event on retry exhaustion
- [ ] Fall through to pause behavior

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Auto-retry test
- [ ] Exhaustion-pauses test
- [ ] Partial progress save test
- [ ] Worktree cleanup retry test
- [ ] Event logging test
- [ ] Happy path unaffected test
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-21 | Task staged | PROMPT.md and STATUS.md created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
