# TP-029: Cleanup Resilience & Post-Merge Gate — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read worktree cleanup flow
- [ ] Read merge worktree lifecycle
- [ ] Understand issue #93 root cause
- [ ] Read roadmap Phase 2 sections

---

### Step 1: Fix Per-Wave Cleanup Across All Repos
**Status:** ⬜ Not Started

- [ ] Iterate ALL repos per wave for cleanup
- [ ] Apply force cleanup fallback pattern
- [ ] Extend to merge worktrees
- [ ] Remove empty .worktrees/ dirs

---

### Step 2: Post-Merge Cleanup Gate
**Status:** ⬜ Not Started

- [ ] Verify cleanup success before advancing wave
- [ ] Pause batch on cleanup failure
- [ ] Emit diagnostic with recovery commands

---

### Step 3: Integrate Cleanup into /orch-integrate
**Status:** ⬜ Not Started

- [ ] Clean autostash entries after integrate
- [ ] Verify polyrepo acceptance criteria
- [ ] Report cleanup status

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Multi-repo cleanup tests
- [ ] Force cleanup fallback tests
- [ ] Cleanup gate tests
- [ ] Autostash cleanup tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Close issue #93
- [ ] `.DONE` created

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
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
