## Code Review: Step 1: Remove remaining compatibility paths

### Verdict: REVISE

### Summary
The Step 1 changes correctly convert most TMUX compatibility ingress to explicit migration failures (config/user prefs) and preserve the one-release `lanes[].tmuxSessionName` migration path with normalization + warning. However, there is still a blocking path where `/task` silently swallows those new migration errors and falls back to defaults. That means the stated hard-error contract for legacy TMUX config is not consistently enforced yet.

### Issues Found
1. **[extensions/task-runner.ts:295] [important]** — `loadConfig()` catches all config-load failures and silently returns `DEFAULT_CONFIG`. With this Step 1 change, `loadProjectConfig()` now throws `CONFIG_LEGACY_FIELD` for legacy TMUX fields/values, but this catch block suppresses that failure for `/task`, violating the Step 0/Step 1 requirement of deterministic hard errors with migration hints.  
   **Fix:** Do not swallow `ConfigLoadError` with `code === "CONFIG_LEGACY_FIELD"` (and ideally other structural config errors). Re-throw or surface a user-facing error so operators see the migration guidance instead of running with silent defaults.

### Pattern Violations
- None beyond the blocking issue above.

### Test Gaps
- Add `/task`-side tests for `loadConfig()` behavior when config contains legacy TMUX fields/values (e.g., `worker.spawn_mode: tmux`, prefs `spawnMode: tmux`, prefs `tmuxPrefix`), asserting hard failure with migration guidance instead of default fallback.

### Suggestions
- In Step 2 cleanup, align settings/UI metadata that still advertises TMUX options so users are not prompted to choose values that are now invalid.