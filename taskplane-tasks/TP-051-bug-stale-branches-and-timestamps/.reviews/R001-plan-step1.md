## Plan Review: Step 1 — Delete stale task/saved branches after integrate

### Verdict: REVISE

### Summary
The Step 1 plan is directionally correct (new cleanup helper in `worktree.ts`, call from `/orch-integrate`, workspace-wide execution, and operator-visible output). However, it needs tighter scope boundaries to avoid violating recoverability and to keep cleanup reporting truthful.

### Issues Found
1. **[Severity: important] Over-broad `saved/*` deletion risks deleting intentional recovery refs.**  
   The plan says to delete `saved/*` broadly. That conflicts with partial-progress preservation semantics, where failed-task recovery branches are intentionally stored as `saved/{opId}-{taskId}-{batchId}` (and workspace variant `saved/{opId}-{repoId}-{taskId}-{batchId}`) (`extensions/taskplane/worktree.ts:2033-2056`).  
   **Required revision:** explicitly limit deletion to stale lane-derived refs (`saved/task/{opId}-lane-*`) unless there is an explicit, separately justified policy change for partial-progress branches.

2. **[Severity: important] Plan does not include acceptance/report alignment for saved-lane leftovers.**  
   Current cleanup acceptance only scans `task/{opId}-lane-*` (`extensions/taskplane/extension.ts:648-656`) and `computeIntegrateCleanupResult()` only evaluates those existing buckets (`extensions/taskplane/messages.ts:888-894`). If saved-lane deletion fails, cleanup can still report clean.  
   **Required revision:** update Step 1 plan to either (a) extend findings/result model to include `saved/task/...` leftovers, or (b) add an equivalent failure surfacing path that prevents false “cleanup verified”.

### Missing Items
- Explicit branch allowlist in the plan (what is deleted vs explicitly preserved), including protection of partial-progress `saved/{opId}-...` branches.
- Explicit statement that failed branch deletes must be surfaced in final operator output (not only debug logs).
- Test intent for negative cases: do **not** delete unrelated `saved/*` refs and do **not** delete other operators’ branches.

### Suggestions
- Reuse `deleteBranchBestEffort()` for idempotent deletion behavior (`extensions/taskplane/worktree.ts:874-915`).
- Keep matching operator-scoped (`opId`) and lane-pattern-scoped to avoid cross-operator branch removal.
- Add Step 1 tests for:
  - deletes `task/{opId}-lane-*` and `saved/task/{opId}-lane-*`
  - preserves `saved/{opId}-{taskId}-{batchId}` partial-progress refs
  - reports failed deletions in integrate output
  - preserves `orch/*` in PR mode (already listed, keep it)
