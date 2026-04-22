## Plan Review: Step 2: Update Worktree Listing and Cleanup

### Verdict: REVISE

### Summary
The Step 2 checklist captures the right files/functions at a high level, but it currently misses a key outcome needed to satisfy the task mission: true **batch-scoped** discovery/cleanup, not just operator-scoped matching. As written, the plan risks continuing cross-batch interference for the same operator and does not define enough failure-path behavior for safe container cleanup.

### Issues Found
1. **[Severity: critical]** — The plan does not explicitly require `listWorktrees()`/`removeAllWorktrees()` to scope to the **current batch** (e.g., by `batchId` or explicit container path), only “new nested structure” (`STATUS.md:43-45`). This is insufficient for the mission requirement to prevent collisions between concurrent batches by the same operator (`PROMPT.md:23-25`). Current runtime contracts are still opId-only (`extensions/taskplane/worktree.ts:1162,1441`) and callers also pass opId-only (`extensions/taskplane/engine.ts:484,679`, `extensions/taskplane/resume.ts:1295,1323`). **Suggested fix:** add a Step 2 outcome to introduce batch-scoped filtering (exact `{opId}-{batchId}` container) and stage caller updates in Step 3, including `resume.ts`.
2. **[Severity: important]** — The plan omits explicit transition compatibility guardrails for `listWorktrees()` while further refactoring it. The prompt requires not breaking old+new discovery during migration (`PROMPT.md:152`). **Suggested fix:** add a checklist item that any Step 2 list/filter changes must preserve legacy flat-path discovery behavior during transition.
3. **[Severity: important]** — Container cleanup behavior is under-specified. “Remove batch container if empty” (`STATUS.md:44`) does not define behavior for partial failures, multiple containers discovered, or force-cleanup paths. **Suggested fix:** specify that cleanup is per touched container, only after removals, only if directory is empty, and never attempts to remove non-empty/active containers.

### Missing Items
- Explicit Step 2 outcome for batch-level isolation in discovery/cleanup (not just nested path parsing).
- Explicit test intent for Step 2 edge cases: same-op concurrent batches, legacy+new mixed worktrees, and container removal when failures leave residual entries.
- Step 3 dependency note that `resume.ts` must be included when list/remove signatures or semantics change.

### Suggestions
- Add a small helper to derive/validate a batch container identity (`{opId}-{batchId}`) and reuse it across listing and cleanup paths.
- Keep Step 2 focused on behavioral outcomes (“only my batch’s worktrees are listed/removed”) and delegate detailed caller wiring to Step 3 checklist updates.
