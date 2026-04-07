## Plan Review: Step 1 — Fix .DONE timing for multi-segment tasks

### Verdict: APPROVE

### Summary
The plan correctly identifies Option A (lane-runner suppresses .DONE) as the right approach. The lane-runner has all necessary context to implement this: `ExecutionUnit.task.segmentIds` provides the full ordered segment list, and `ExecutionUnit.segmentId` identifies the currently-executing segment. The fix is a straightforward gate in `executeTaskV2()` at the `.DONE` creation site (~line 533 of `lane-runner.ts`). The checkboxes cover the key outcomes.

### Issues Found
No blocking issues.

### Missing Items
None — the five checkboxes (determine segment awareness, gate .DONE, .DONE on last segment, single-segment unaffected, run targeted tests) cover the required outcomes for this step.

### Suggestions

- **Segment awareness mechanism:** The lane-runner can determine whether more segments remain by comparing `unit.segmentId` against the last entry in `unit.task.segmentIds`. Specifically: `unit.task.segmentIds` is populated by the engine before execution (`task.segmentIds = segmentState.orderedSegments.map(...)` at engine.ts:2237), and `unit.segmentId` comes from `task.activeSegmentId` (execution.ts:1996). A simple check like `segmentIds && segmentId && segmentId !== segmentIds[segmentIds.length - 1]` would identify non-final segments. This avoids needing to thread any new data through `ExecutionUnit`.

- **Engine-side .DONE check:** The engine's segment frontier advancement code (engine.ts:2656) checks `segmentState.nextSegmentIndex >= segmentState.orderedSegments.length` to determine task-level terminal status. It does NOT check for `.DONE` existence at that boundary — it uses `waveResult.succeededTaskIds` from lane-runner outcomes. This means the primary concern is indeed the lane-runner: if `.DONE` exists prematurely, a _future_ segment round's wave-prep loop would see `.DONE` and potentially short-circuit. Confirming this interaction will strengthen confidence in the fix.

- **Log message clarity:** When suppressing `.DONE`, consider logging a clear message like "Segment N of M complete — .DONE deferred (pending segments remain)" so operators can trace the behavior in STATUS.md execution logs.
