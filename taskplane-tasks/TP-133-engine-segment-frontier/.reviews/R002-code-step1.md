## Code Review: Step 1: Segment frontier in engine

### Verdict: REVISE

### Summary
The segment-frontier scaffolding is solid overall (wave expansion, deterministic segment linearization, and active segment tracking are implemented), and the new focused tests pass. However, there is a repo-mode regression that violates the step requirement that repo-singleton behavior remain unchanged. As written, repo-mode tasks can be reclassified as if they had a workspace repo ID, which alters downstream lane/worktree behavior.

### Issues Found
1. **[extensions/taskplane/engine.ts:135, extensions/taskplane/engine.ts:1391] [important]** — Repo-mode tasks are forced into a synthetic repo ID (`"default"`) and then written back to `task.resolvedRepoId` during wave dispatch. In repo mode, `resolvedRepoId` should remain unset; setting it changes grouping/identity semantics downstream (e.g., lane/session naming and base-branch resolution behavior via `resolveBaseBranch` for truthy repo IDs in `extensions/taskplane/waves.ts:575-579`). This breaks the “repo-singleton unchanged” requirement.  
   **Fix:** Do not mutate `task.resolvedRepoId` in repo mode. Keep the fallback segment repo token local to segment identity only, or only assign `resolvedRepoId` when workspace routing is actually active.

### Pattern Violations
- Repo-mode invariants are not preserved: task metadata now implicitly switches to workspace-style repo attribution.

### Test Gaps
- Missing regression coverage for repo mode with `resolvedRepoId === undefined` (the unchanged path). Add an engine-level test that verifies singleton tasks do not acquire a synthetic repo ID and still follow repo-mode lane identity semantics.

### Suggestions
- Consider deduplicating blocked-task counting across expanded segment rounds (current `blockedTasks += blockedInWave.length` can overcount when the same blocked parent task appears in multiple segment rounds).
