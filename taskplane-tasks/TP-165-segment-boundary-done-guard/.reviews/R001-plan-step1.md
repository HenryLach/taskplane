## Plan Review: Step 1: Fix Premature .DONE Creation

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the root-cause findings and targets the two high-impact failure points: premature `.DONE` creation in `lane-runner.ts` and incorrect `.DONE` safety-net removal pathing in `engine.ts`. The proposed outcomes are sufficient to stop first-segment short-circuiting while preserving the existing final-segment completion flow. This is a workable and appropriately scoped plan for the step.

### Issues Found
1. **[Severity: minor]** — The outbox guard item should be implemented as a **task/segment-scoped pending-request check** (not a generic “any pending file exists” check) to avoid accidental `.DONE` suppression from unrelated or stale request files. Suggested fix: explicitly scope by `taskId` + `fromSegmentId` when evaluating whether to suppress `.DONE`.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Add one targeted assertion for single-segment/no-expansion behavior (still creates `.DONE`) as a non-regression while changing the guard logic.
- When fixing the engine safety net path, prefer worktree-resolved path via lane/task mapping as documented in Step 0 findings to avoid deleting `.DONE` in packet roots that are not the active execution worktree.
