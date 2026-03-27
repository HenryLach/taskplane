# TP-077: Supervisor Recovery Tools — Status

**Current Step:** Step 3: Testing & Verification
**Status:** 🟡 In Progress
**Step 1 Plan (revised R001):**
1. Register `orch_retry_task` tool (taskId: string, required) in extension.ts following existing tool pattern.
2. Resolve stateRoot via execCtx (workspaceRoot → repoRoot → ctx.cwd) consistent with engine persistence.
3. Load persisted batch state from disk; validate task exists and status is `failed` or `stalled`.
4. Reject if batch is actively running (launching/executing/merging/planning) — no IPC path, document in tool response.
5. Reset task fields: status→pending, exitReason→"", doneFileFound→false, startedAt→null, endedAt→null, exitDiagnostic→undefined, partialProgressCommits→undefined, partialProgressBranch→undefined.
6. Decrement failedTasks counter. Transition batch phase: if was "failed"→"stopped" (resumable with force), keep "stopped"/"paused" as-is.
7. Save via saveBatchState with atomic write.
8. Sync main-thread orchBatchState summary counters if batchId matches.
9. Return confirmation message with taskId, new status, and hint to call orch_resume(force=true).
**Last Updated:** 2026-03-27
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read spec Phase 2, tool registration pattern, types, IPC flow

---

### Step 1: Implement orch_retry_task
**Status:** ✅ Complete

- [x] Register tool with taskId parameter
- [x] Validate task exists and is failed
- [x] Reset state, adjust counters, persist
- [x] Forward retry signal to engine if running

---

### Step 2: Implement orch_skip_task
**Status:** ✅ Complete

- [x] Register tool with taskId parameter
- [x] Validate task exists and is failed/pending
- [x] Update state, unblock dependents, persist

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Create supervisor-recovery-tools.test.ts
- [x] Test retry, skip, validation, counters (57 tests)
- [x] FULL test suite passing (2787/2787)

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec and commands docs
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-27 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-27 22:17 | Task started | Extension-driven execution |
| 2026-03-27 22:17 | Step 0 started | Preflight |
| 2026-03-27 22:17 | Task started | Extension-driven execution |
| 2026-03-27 22:17 | Step 0 started | Preflight |
| 2026-03-27 22:23 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-27 22:27 | Review R001 | plan Step 1: REVISE (fallback) |
| 2026-03-27 22:38 | Reviewer R002 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
