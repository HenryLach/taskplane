## Plan Review: Step 1: Fix STATUS.md viewer showing stale content across batches (#487)

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the required outcome: detect `batchId` transitions and reset STATUS.md viewer selection so stale content does not persist into a new batch. The approach in STATUS.md and the architecture notes is coherent with the existing `app.js` viewer state model (`viewerMode`/`viewerTarget` + `closeViewer()`). This is sufficient to achieve the step’s behavior target without over-scoping implementation detail.

### Issues Found
1. **[Severity: minor]** Consider explicitly scoping the reset to STATUS.md mode (`viewerMode === "status-md"`) so conversation viewer behavior remains intentional during batch transitions.

### Missing Items
- None blocking.

### Suggestions
- Add a short step-level verification note in STATUS.md for this step (e.g., "opened STATUS viewer on Batch A task, started Batch B, confirmed viewer cleared/placeholder shown") to make review evidence easy to trace before Step 7.
- When implementing `batchId` tracking, initialize and update the previous ID carefully around `no batch` states (`batch == null`) to avoid false positives on first render.
