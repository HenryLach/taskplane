## Plan Review: Step 1 — Add config reload at the top of doOrchStart()

### Verdict: APPROVE

### Summary
The plan correctly identifies the fix location, positions the reload before the `if (!execCtx)` guard (the key enabler for the stale-config scenario), and uses the right phase set to guard against mid-batch reloads. The plan also self-flags its own code snippet's atomicity discrepancy via the "Wait — re-read" note and a dedicated checkbox, so the worker is explicitly instructed to replicate the settings handler's proven atomic pattern rather than copy the illustrative snippet verbatim.

### Issues Found
_None blocking._

### Pattern Observations
1. **The illustrative code snippet in the plan is non-atomic** — it assigns `execCtx`, `orchConfig`, `runnerConfig` before calling `loadSupervisorConfig`, which differs from the settings handler's pattern (all four assigned only after `freshSupervisor` is determined). The plan already catches this with the "Wait — re-read…Replicate exactly" note and the corresponding checkbox, so this is informational rather than blocking. The worker must follow the settings handler's layout:
   ```typescript
   // Determine freshSupervisor first (with fallback)
   let freshSupervisor: SupervisorConfig;
   try { freshSupervisor = loadSupervisorConfig(...); }
   catch { freshSupervisor = { ...DEFAULT_SUPERVISOR_CONFIG }; }
   // Then commit atomically
   execCtx = freshCtx;
   orchConfig = freshCtx.orchestratorConfig;
   runnerConfig = freshCtx.taskRunnerConfig;
   supervisorConfig = freshSupervisor;
   ```

2. **`ctx.cwd` vs `execCtx.workspaceRoot` for `buildExecutionContext`** — the settings handler uses `execCtx!.workspaceRoot` as the reload root for consistency. In `doOrchStart`, `execCtx` may legitimately be `null` at reload time (that's the whole point of this fix), so `ctx.cwd` is the correct choice here. The worker should note this difference is intentional.

3. **`isActiveBatch` set is correct per spec** — `executing | launching | merging | planning` exactly matches the PROMPT requirement. `paused` and `paused-corrupt` are intentionally not blocked: if a user tries to start a new batch while paused, the existing concurrent-execution guard downstream will still reject it, so reloading config is harmless in that path.

### Suggestions
- The outer `catch` swallows silently. Consider adding a `ctx.ui.notify` warning (similar to the settings handler's "Saved to disk but live reload failed" toast) so the operator knows the reload was skipped and is running with stale config. Not required per spec, but improves operator visibility consistent with the project's stated priority.
- The `reloadCwd` variable name from the settings handler is a nice clarity hint; using it (or a local `const reloadCwd = ctx.cwd`) in `doOrchStart` would make the intent explicit if the settings handler's approach is being replicated.
