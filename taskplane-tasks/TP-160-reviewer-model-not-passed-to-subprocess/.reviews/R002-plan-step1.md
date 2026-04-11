## Plan Review: Step 1 — Thread reviewer config through the call chain (revised)

### Verdict: APPROVE

### Summary

The revised plan fully addresses both critical issues raised in R001. Part 0-A and 0-B add the missing `reviewer` field to `TaskRunnerConfig` and `toTaskRunnerConfig()` before Part E tries to access it, eliminating the TypeScript compile error. Part E-retry extends `attemptStaleWorktreeRecovery` with `runnerConfig?` and threads it through to the retry `executeWave` call at line 1795, covering the second call site that previously had no `runnerConfig` in scope. The overall approach (extraEnvVars → LaneRunnerConfig → hostOpts.env → spawnReviewer CLI args) is technically sound and confirmed correct by the codebase.

### Issues Found

_None._

### Technical Validation

The env inheritance chain was verified to work end-to-end:

1. **`spawnAgent` merges envs correctly** (`agent-host.ts:261`):  
   `env: { ...process.env, ...(opts.env ?? {}) }` — the worker subprocess receives all parent env vars plus the `TASKPLANE_REVIEWER_*` additions from `hostOpts.env`.

2. **`spawnReviewer` inherits via `{ ...process.env }`** (`agent-bridge-extension.ts:447`) — the reviewer subprocess creation already spreads `process.env`. After Part C sets the vars in `hostOpts.env`, the worker's `process.env` will contain them, and `spawnReviewer` will see them when it reads `process.env.TASKPLANE_REVIEWER_MODEL` etc.

3. **`attemptStaleWorktreeRecovery` call site at ~line 2385** — `runnerConfig` is confirmed in scope inside `executeOrchBatch` at the call site that invokes `attemptStaleWorktreeRecovery`. Part E-retry's "thread through" wording covers adding it to both the function signature and the call site.

4. **`LaneRunnerConfig` currently has no `reviewerModel`/etc. fields** — confirmed clean addition with no conflicts.

### Suggestions

- The `TASKPLANE_REVIEWER_TOOLS` fallback default in Part D (`"read,write,edit,bash,grep,find,ls"`) should exactly match the current hardcoded value in `spawnReviewer` (`agent-bridge-extension.ts:435`) to avoid an unintentional behaviour change for existing configs that don't set a reviewer tools list. This is a correctness concern only if the default is changed — keeping the same string is fine.

- The fallback in Part E-main (`runnerConfig?.reviewer?.model || runnerConfig?.worker?.model || ""`) — if a user explicitly sets `reviewer.model: ""` to mean "inherit from session", this fallback silently substitutes the worker model instead. Consider whether `|| ""` is sufficient (treating empty-string as "not set") or whether `null`/`undefined` distinction matters. Minor — current approach is acceptable for V1.

- When updating `attemptStaleWorktreeRecovery`, the call site at engine.ts ~line 2385 (`attemptStaleWorktreeRecovery(waveResult, waveTasks, waveIdx, ...)`) also needs to be updated to pass `runnerConfig`. This is implied by Part E-retry but worth keeping in mind during implementation so neither the function signature nor its call site is missed.
