## Plan Review: Step 1: Segment frontier in engine

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the task outcomes: it covers segment decomposition, per-task sequential execution, and updating `ParsedTask.activeSegmentId`/`segmentIds`. It also preserves repo-singleton behavior, which protects current single-repo semantics. Overall, this is sufficient to implement the frontier MVP without over-specifying internals.

### Issues Found
1. **[Severity: minor]** — The checklist implies (but does not explicitly state) preserving cross-task parallelism across lanes while sequencing segments within each task. This is already consistent with the mission and can be handled during implementation.

### Missing Items
- None blocking for Step 1.

### Suggestions
- Add one explicit note in Step 1 wording that segment decomposition should consume `computeWaveAssignments().segmentPlans` directly, to avoid accidental duplicate planning logic.
- During implementation, keep lane-level parallelism unchanged and only serialize within a task’s segment frontier.
