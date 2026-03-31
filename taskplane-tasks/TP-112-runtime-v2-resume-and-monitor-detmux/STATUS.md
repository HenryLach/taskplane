# TP-112: Runtime V2 Resume and Monitor De-TMUX Parity — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-31
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight mapping
**Status:** ⬜ Not Started

- [ ] Enumerate Runtime V2 TMUX dependencies in resume/monitor paths
- [ ] Separate legacy-only vs V2-critical dependencies
- [ ] Record migration contract in STATUS.md

---

### Step 1: Resume path de-TMUX for V2
**Status:** ⬜ Not Started

- [ ] Replace V2 reconnect/re-exec TMUX dependency chain
- [ ] Keep legacy fallback behavior where required
- [ ] Validate resumed task outcomes and persistence parity

---

### Step 2: Monitor path de-TMUX for V2
**Status:** ⬜ Not Started

- [ ] Make monitoring/liveness checks backend-aware
- [ ] Use registry/snapshot/event signals for V2 liveness
- [ ] Preserve status transition semantics

---

### Step 3: Recovery and policy parity
**Status:** ⬜ Not Started

- [ ] Validate stop-wave/skip-dependents/stop-all semantics
- [ ] Validate pause/abort/resume behavior
- [ ] Validate retry/escalation parity

---

### Step 4: Testing & verification
**Status:** ⬜ Not Started

- [ ] Add behavioral tests for V2 no-TMUX resume/monitor correctness
- [ ] Run targeted tests
- [ ] Run full suite
- [ ] Fix all failures

---

### Step 5: Documentation & delivery
**Status:** ⬜ Not Started

- [ ] Update Runtime V2 rollout/process docs for de-TMUX status
- [ ] Log discoveries and remaining boundaries

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
| 2026-03-31 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
