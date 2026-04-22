## Code Review: Step 2: Resume reconstruction

### Verdict: REVISE

### Summary
The segment-frontier reconstruction is directionally correct and the new mapping logic in `computeResumePoint()` does connect wave occurrences to per-task segment IDs. However, there are two blocking correctness regressions in fallback behavior: `.DONE` authority can be suppressed for partially/legacy-segmented state, and missing segment records are treated as pending even when task-level reconciliation says terminal. Those issues can cause unnecessary re-execution and break the existing resume contract for older/partial state files.

### Issues Found
1. **[extensions/taskplane/resume.ts:1099-1101] [important]** — `.DONE` detection is gated behind `segmentFrontier.allSucceeded`, so tasks with a real `.DONE` marker are ignored whenever segment records are stale/missing/not fully terminal. This reverses the existing precedence where `.DONE` is authoritative and can force completed work to be re-executed after crash/restart.
   - **Suggested fix:** Always evaluate `.DONE` markers first (as before). If a marker is found, allow reconciliation to mark-complete regardless of frontier completeness; optionally normalize segment records afterward.

2. **[extensions/taskplane/resume.ts:706-713, 742-745, 770-776] [important]** — Segment-aware wave logic defaults missing segment records to `"pending"` and bypasses task-level reconciled state. For tasks that have `segmentIds` but no corresponding `segments[]` record (legacy/partial state), `computeResumePoint()` incorrectly keeps waves pending and re-queues tasks.
   - **Suggested fix:** Only use segment-status override when a concrete segment record exists (`segmentStatusBySegmentId.has(waveSegmentId)`). Otherwise fall back to the existing reconciled task-level logic for `allDone`, `hasSucceededTasks`, and pending-task derivation.

### Pattern Violations
- Non-regression/backward-compat expectation is violated for resume semantics when segment metadata is partial (legacy or crash-window states).

### Test Gaps
- Missing regression test: `.DONE` exists + segment frontier not all-succeeded (e.g., segment record still `running`) should still mark task complete.
- Missing regression test: task has `segmentIds` but `segments[]` record absent should fall back to task-level reconciliation in `computeResumePoint()`.

### Suggestions
- I flagged this fallback concern in Step 2 plan review as a minor risk; now that code is in place, it should be hardened before proceeding to Step 3 edge-case work.
- Add small targeted unit tests directly around `reconstructSegmentFrontier()` + `computeResumePoint()` to lock fallback behavior before broader resume-edge-case tests in Step 4.
