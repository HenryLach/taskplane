## Plan Review: Step 3: Thread Through Orchestrator

### Verdict: REVISE

### Summary
The Step 3 direction is close, but the current plan bullets are too coarse and contain one wording conflict that can lead to incorrect state-path behavior. Right now it does not clearly separate “pointer for config/agents” from “workspace-root for runtime state,” and it does not specify how pointer output is threaded through orchestrator config loading. Tightening these outcomes will reduce regressions in merge and abort/state flows.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:55` (“Sidecar and merge agent paths use pointer”) conflicts with the established pointer contract that state/sidecar paths do **not** follow pointer (`STATUS.md:197`, `extensions/taskplane/types.ts:1892-1893`). **Fix:** split this into two outcomes: (a) sidecar/state paths remain `<workspaceRoot>/.pi`, (b) only merge agent prompt resolution uses `pointer.agentRoot`.
2. **[Severity: important]** — `STATUS.md:54` is underspecified for config threading. `buildExecutionContext()` currently loads configs directly from `cwd` (`extensions/taskplane/workspace.ts:553-554`), and wrappers currently call `loadProjectConfig(cwd)` with no pointer root (`extensions/taskplane/config.ts:27-42`). **Fix:** explicitly plan to resolve pointer in workspace mode and pass `pointer.configRoot` through orchestrator/task-runner config loaders while preserving repo-mode null behavior.
3. **[Severity: important]** — The plan does not call out the merge root-coupling risk: merge prompt path and merge request/result state files currently share `stateRoot ?? repoRoot` (`extensions/taskplane/merge.ts:307`, `extensions/taskplane/merge.ts:618-621`). **Fix:** require separate roots in plan outcomes so merge prompt can follow pointer while request/result/state files stay under workspace `.pi`.

### Missing Items
- Explicit warning/fallback outcome for orchestrator startup when pointer is missing/malformed/unknown repo (warn + fallback, never fatal).
- Explicit note that non-prompt runtime files (e.g., abort signal and batch/runtime sidecar artifacts) remain workspace-root scoped.
- Step 3 test intent: config pointer threading in `buildExecutionContext`, merge prompt path uses pointer agent root, and state files remain under workspace `.pi`.

### Suggestions
- Add one orchestrator-level helper that resolves pointer once and returns `{ pointer, pointerWarningLogged }` to avoid duplicated resolution behavior.
- Add targeted tests in `extensions/tests/workspace-config.test.ts` and merge-related tests to lock “pointer only for config/agents” semantics.
