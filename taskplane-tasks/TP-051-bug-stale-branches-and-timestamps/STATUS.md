# TP-051: Fix Stale Branches After Integrate and Task Timing — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read /orch-integrate handler and cleanup flow
- [ ] Read collectRepoCleanupFindings() for branch detection
- [ ] Read task start timing in execution.ts/engine.ts
- [ ] Identify branch naming patterns

---

### Step 1: Delete stale task/saved branches after integrate
**Status:** ⬜ Not Started

- [ ] Delete task/* branches for the integrated batch
- [ ] Delete saved/* branches for the integrated batch
- [ ] Best-effort cleanup of orphaned branches from previous batches
- [ ] Log deleted branches for operator visibility
- [ ] Preserve orch/* branch in PR mode

---

### Step 2: Fix task startedAt to use actual execution start
**Status:** ⬜ Not Started

- [ ] Find where startedAt uses STATUS.md mtime
- [ ] Replace with Date.now() at actual execution start
- [ ] Ensure fix applies to both dashboard and batch history

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for branch cleanup
- [ ] Tests for task timing

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

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
