# TP-051: Fix Stale Branches After Integrate and Task Timing — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read /orch-integrate handler and cleanup flow
- [x] Read collectRepoCleanupFindings() for branch detection
- [x] Read task start timing in execution.ts/engine.ts
- [x] Identify branch naming patterns

---

### Step 1: Delete stale task/saved branches after integrate
**Status:** ✅ Complete

- [x] Add `deleteStaleTaskBranches()` function in worktree.ts that deletes task/* and saved/* branches for a given opId/batchId, plus orphaned branches from any batch
- [x] Call `deleteStaleTaskBranches()` from the /orch-integrate handler in extension.ts after successful integration, for all repos
- [x] Include deleted branches in the cleanup report for operator visibility
- [x] Ensure orch/* branch in PR mode is preserved (already handled by existing skipOrchBranch logic)

---

### Step 2: Fix task startedAt to use actual execution start
**Status:** ✅ Complete

- [x] Find where startedAt uses STATUS.md mtime
- [x] Replace with Date.now() at actual execution start
- [x] Ensure fix applies to both dashboard and batch history

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] All existing tests pass
- [x] Tests for branch cleanup
- [x] Tests for task timing

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | UNKNOWN | .reviews/R002-code-step1.md |
| R003 | plan | Step 2 | APPROVE | .reviews/R003-plan-step2.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| collectRepoCleanupFindings detects stale task/* branches but never deletes them | Fix in Step 1 | extension.ts |
| syncTaskOutcomesFromMonitor uses snap.lastHeartbeat (STATUS.md mtime) as fallback for task startTime | Fix in Step 2 | persistence.ts:222 |
| executeLane's taskStartTime already uses Date.now() correctly — bug is in the monitor sync path | Fix in Step 2 | execution.ts:1040, persistence.ts:222 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 12:49 | Task started | Extension-driven execution |
| 2026-03-24 12:49 | Step 0 started | Preflight |
| 2026-03-24 12:49 | Step 1 started | Delete stale task/saved branches after integrate |
| 2026-03-24 12:49 | Step 2 started | Fix task startedAt to use actual execution start |
| 2026-03-24 12:49 | Step 3 started | Testing & Verification |
| 2026-03-24 12:49 | Step 4 started | Documentation & Delivery |
| 2026-03-24 12:49 | Task started | Extension-driven execution |
| 2026-03-24 12:49 | Step 0 started | Preflight |
| 2026-03-24 12:49 | Step 1 started | Delete stale task/saved branches after integrate |
| 2026-03-24 12:49 | Step 2 started | Fix task startedAt to use actual execution start |
| 2026-03-24 12:49 | Step 3 started | Testing & Verification |
| 2026-03-24 12:49 | Step 4 started | Documentation & Delivery |
| 2026-03-24 12:57 | Review R001 | plan Step 1: REVISE |
| 2026-03-24 13:07 | Review R002 | code Step 1: UNKNOWN |
| 2026-03-24 13:11 | Review R003 | plan Step 2: APPROVE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
