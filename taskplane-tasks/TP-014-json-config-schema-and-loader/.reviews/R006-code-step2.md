## Code Review: Step 2: Implement Unified Config Loader

### Verdict: REVISE

### Summary
The unified loader structure is clean and the JSON-first + adapter approach is directionally right, but there are compatibility regressions in key conversion and workspace root resolution that change runtime behavior. In particular, map/dictionary keys are being transformed when they should remain literal, and workspace-mode task-runner config lookup no longer reliably reaches the workspace root. I also re-ran the existing suite (`cd extensions && npx vitest run`) and it passes, but targeted repro checks exposed these regressions.

### Issues Found
1. **[extensions/taskplane/config-loader.ts:275-282] [critical]** — `resolveConfigRoot()` returns `cwd` whenever `cwd/.pi` exists, which breaks workspace fallback when running inside worktrees that have a sidecar `.pi` but not the actual config files. This regresses prior behavior that used `TASKPLANE_WORKSPACE_ROOT` when local config was absent (see `extensions/taskplane/execution.ts:144-149`, `:479-480`). **Fix:** resolve per-file precedence (JSON/YAML) rather than `.pi` directory presence; if `TASKPLANE_WORKSPACE_ROOT` is set, prefer it when target config files are missing in `cwd`.
2. **[extensions/taskplane/config-loader.ts:335-362] [critical]** — `toOrchestratorConfig()` uses fully recursive `convertKeysToSnake()`, which mutates dictionary keys (not just schema field names). This rewrites `assignment.sizeWeights` keys like `M`/`L` into `_m`/`_l`, breaking size weight lookups in scheduling logic (`extensions/taskplane/waves.ts:639-640`) and altering other map-like keys (`pre_warm.commands`, etc.). **Fix:** replace generic recursive key conversion with explicit field mapping for known structural keys, preserving record keys verbatim.
3. **[extensions/taskplane/config-loader.ts:112-133, 210-215, 373-387] [important]** — `convertKeysToCamel()` recursively converts YAML map keys, so user-defined area IDs and override keys (e.g., `backend_api`) are changed to `backendApi`. That breaks CLI area addressing and routing assumptions where keys are treated as stable identifiers (`extensions/taskplane/discovery.ts:446-448`). **Fix:** only camel-case structural keys; preserve keys inside record-valued sections (`task_areas`, `standards_overrides`, `reference_docs`, `self_doc_targets`, etc.).

### Pattern Violations
- Generic recursive key transformers are being used where the project relies on literal identifier keys in config maps; this violates existing config contract semantics.

### Test Gaps
- Missing regression test: workspace mode with `TASKPLANE_WORKSPACE_ROOT` set and `cwd/.pi` present but config files absent in cwd.
- Missing regression test: `loadOrchestratorConfig()` preserves `size_weights` dictionary keys (`S/M/L/XL`) after adapter conversion.
- Missing regression test: task area / standards override keys containing underscores remain unchanged through YAML fallback.

### Suggestions
- Add focused unit tests for `config-loader.ts` adapters before broad integration tests (faster failure localization).
- Consider exporting small, explicit mapper helpers per section (`mapTaskRunnerYaml`, `mapOrchestratorYaml`, `toLegacyOrchestrator`) to make key-preservation rules self-documenting.
