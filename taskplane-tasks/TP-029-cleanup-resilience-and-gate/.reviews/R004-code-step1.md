## Code Review: Step 1: Fix Per-Wave Cleanup Across All Repos

### Verdict: REVISE

### Summary
The Step 1 implementation is directionally strong: it expands cleanup/reset coverage across encountered repos and adds a robust merge-worktree force-cleanup fallback. However, there is one important correctness/maintainability issue in module boundaries (new circular dependency) that should be fixed before approval. Test coverage is also still light on the new merge-worktree fallback path.

### Issues Found
1. **[extensions/taskplane/engine.ts:19] [important]** — `engine.ts` imports `resolveRepoIdFromRoot` from `resume.ts`, but the symbol is never used in `engine.ts`. This introduces an unnecessary circular dependency (`engine.ts -> resume.ts -> engine.ts`, with `resume.ts` importing `executeOrchBatch` at `resume.ts:9`) and increases risk of initialization-order regressions. **Fix:** remove the unused import from `engine.ts`; if a shared helper is actually needed later, move it to a neutral utility module (not `resume.ts`).
2. **[extensions/taskplane/engine.ts:901-922, extensions/taskplane/worktree.ts:1575-1588] [minor]** — Empty `.worktrees` base-dir cleanup is implemented in two places (inside `removeAllWorktrees()` and again in `engine.ts` terminal cleanup). This duplicates responsibility and can drift over time. **Fix:** keep one owner (prefer `removeAllWorktrees()`), and remove the duplicate engine-level pass.

### Pattern Violations
- Introduces a cross-module cycle between `engine.ts` and `resume.ts` (layering drift and avoidable coupling).

### Test Gaps
- No behavioral test directly exercises the new `merge.ts` merge-worktree fallback (`forceRemoveMergeWorktree`) for both stale-prep and end-of-wave cleanup paths.
- No engine-level behavioral test confirms inter-wave reset/terminal cleanup behavior across repos encountered in earlier waves (current checks are mostly structural string assertions).

### Suggestions
- After removing the circular import, run `cd extensions && npx vitest run` again and confirm green; current full-suite run in this branch still hits the long-running timeout in `orch-direct-implementation.test.ts` under default 60s test timeout.
