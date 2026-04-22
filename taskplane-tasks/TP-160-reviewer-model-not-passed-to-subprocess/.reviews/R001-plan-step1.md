## Plan Review: Step 1 — Thread reviewer config through the call chain

### Verdict: REVISE

### Summary

The overall approach is sound and well-structured: use the established `extraEnvVars` pattern to carry reviewer config from `executeWave` → `executeLaneV2` → `LaneRunnerConfig` → worker subprocess env → `spawnReviewer`. Parts A-D are correctly designed. However, two prerequisite changes identified in the Step 0 discoveries are not included in the Step 1 plan and without them the step **cannot compile**: (1) `TaskRunnerConfig` in `types.ts` has no `reviewer` field, making Part E's `runnerConfig?.reviewer?.model` a TypeScript error; and (2) the `executeWave` retry call inside `attemptStaleWorktreeRecovery` has no `runnerConfig` in scope, leaving the second call site unable to receive reviewer config.

### Issues Found

1. **types.ts / config-loader.ts — critical** — `TaskRunnerConfig` (the type used for `runnerConfig` in `engine.ts`) does NOT have a `reviewer` field. The field lives on `TaskplaneConfig.taskRunner` (camelCase) and is extracted by `toTaskConfig()` into an ad-hoc return type — but `toTaskRunnerConfig()` (which builds `TaskRunnerConfig`) does not include reviewer at all. Part E's access `runnerConfig?.reviewer?.model` is a TypeScript compile error that will block the entire step.

   **Required fix:** Add `reviewer?: { model: string; tools: string; thinking: string }` to `TaskRunnerConfig` in `types.ts`, and include it in `toTaskRunnerConfig()` in `config-loader.ts`:
   ```typescript
   reviewer: {
       model: config.taskRunner.reviewer.model,
       tools: config.taskRunner.reviewer.tools,
       thinking: config.taskRunner.reviewer.thinking,
   },
   ```
   This must be done before Part E can be written.

2. **engine.ts:1693 (`attemptStaleWorktreeRecovery`) — important** — The `executeWave` retry call at ~line 1795 is inside `attemptStaleWorktreeRecovery`, which receives `orchConfig: OrchestratorConfig` but no `runnerConfig`. Part E targets "both `executeWave` call sites" but the inner one cannot receive reviewer config with the current signature. Without this fix, stale-worktree-recovery retries will silently drop reviewer config.

   **Required fix:** Add `runnerConfig?: TaskRunnerConfig` to `attemptStaleWorktreeRecovery`'s parameter list (as a last/optional param to minimise diff), thread it into the `executeWave(...)` call as the new `reviewerConfig` argument, and update the call site in `executeOrchBatch` (~line 2362) to pass `runnerConfig` when invoking `attemptStaleWorktreeRecovery`.

Both of these were correctly identified in the Step 0 discoveries as "In-scope fix required", but they were not promoted into the Step 1 plan checklist after preflight completed. The step should be updated to include them before coding begins.

### Missing Items

- **Part 0 (prerequisite):** Add `reviewer` field to `TaskRunnerConfig` (types.ts) and `toTaskRunnerConfig()` (config-loader.ts) — required for Part E to compile.
- **Part E extension:** Extend `attemptStaleWorktreeRecovery` signature with `runnerConfig?` and pass it through to the retry `executeWave` call — required for full coverage of both call sites.

### Suggestions

- The fallback in Part E (`runnerConfig?.reviewer?.model || runnerConfig?.worker?.model || ""`) is reasonable: if no reviewer model is configured, inherit the worker model. Confirm this matches the intent (an explicitly empty reviewer model should probably mean "inherit from session", not "inherit worker model", depending on UX expectations). Minor — either behaviour is defensible.
- In Part D, the `--tools` flag for the reviewer is currently hardcoded to `"read,write,edit,bash,grep,find,ls"`. After this fix it will come from `TASKPLANE_REVIEWER_TOOLS`. Verify the env-var fallback default matches the hardcoded value to avoid a behaviour change for existing configs.
