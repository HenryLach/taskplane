## Plan Review: Step 2: Implement Unified Config Loader

### Verdict: REVISE

### Summary
The Step 2 plan captures the core direction (JSON-first, YAML fallback, shared loader adoption), but it is still missing a few outcome-level compatibility and risk controls needed to avoid runtime regressions. In particular, existing consumers still depend on snake_case config contracts, and task-runner has a workspace-root path fallback that must be preserved. Tightening these outcomes now will reduce migration risk before implementation begins.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly preserve legacy consumer contracts while introducing the unified camelCase schema. Current orchestrator/runtime code reads snake_case fields from `OrchestratorConfig`/`TaskRunnerConfig` (e.g., `max_lanes`, `pre_warm`, `task_areas`) across modules (`extensions/taskplane/types.ts`, `extensions/taskplane/engine.ts:233`, `extensions/taskplane/execution.ts:1268`, `extensions/taskplane/extension.ts:686`). Add an explicit Step 2 outcome that `loadOrchestratorConfig()` and `loadTaskRunnerConfig()` remain backward-compatible wrappers over `loadProjectConfig()`.
2. **[Severity: important]** — The plan omits config path resolution parity for orchestrated/workspace runs. `task-runner` currently falls back to `TASKPLANE_WORKSPACE_ROOT` when local `.pi/task-runner.yaml` is absent (`extensions/task-runner.ts:140-145`). Add an outcome that unified loading preserves this precedence for `.pi/taskplane-config.json` and YAML fallback files.
3. **[Severity: important]** — JSON validation/error semantics are not stated in the Step 2 plan, even though Step 1 defined `configVersion` rejection behavior (`extensions/taskplane/config-schema.ts:53,324`). Add an explicit outcome for how loader behaves when JSON exists but is invalid/unsupported (do not silently mask with YAML), while keeping "file missing => fallback/defaults" behavior deterministic.

### Missing Items
- Explicit migration-rule outcome for file precedence when multiple files exist (JSON vs `task-runner.yaml`/`task-orchestrator.yaml`).
- Explicit note that loader merges/clones from defaults without mutating exported default objects (`DEFAULT_PROJECT_CONFIG`, etc.).
- Step 2 acceptance note to hand off concrete test intent to Step 3 (JSON valid, JSON invalid, YAML-only, mixed presence, workspace-root fallback).

### Suggestions
- Keep `loadProjectConfig()` as the single source of truth, and make existing per-domain loaders thin adapters to minimize blast radius in Step 2.
- Record the final precedence/error matrix in `STATUS.md` Discoveries so Step 3 tests can mirror it exactly.
