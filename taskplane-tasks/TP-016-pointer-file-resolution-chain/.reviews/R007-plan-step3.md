## Plan Review: Step 3: Thread Through Orchestrator

### Verdict: REVISE

### Summary
The Step 3 intent is correct, but the current plan is too ambiguous to safely thread pointer behavior through orchestrator paths without regressing state-root semantics. In particular, it blurs config/agent pointer usage with sidecar/state paths, which are explicitly documented to remain workspace-root based. Tightening the outcomes now will prevent coupling bugs in merge and execution paths.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:55` (“Sidecar and merge agent paths use pointer”) conflicts with the task’s own design contract that state/sidecar paths do **not** follow pointer (`STATUS.md:190-193`) and with pointer type docs (`extensions/taskplane/types.ts:1892-1893`). This wording can cause incorrect implementation. **Fix:** split outcomes: (a) sidecar/state stays `<workspaceRoot>/.pi`, (b) only merge agent prompt path follows `pointer.agentRoot`.
2. **[Severity: important]** — `STATUS.md:54` is underspecified for how `buildExecutionContext()` should actually thread pointer into config loading. Current code calls config loaders with only `cwd` (`extensions/taskplane/workspace.ts:553-554`, `extensions/taskplane/config.ts:27-42`). The plan should explicitly require resolving pointer once in workspace mode and passing `pointer.configRoot` into both orchestrator/task-runner config loads, with repo-mode null behavior preserved.
3. **[Severity: important]** — The plan does not mitigate the existing merge coupling where agent prompt and state artifacts share the same root parameter (`extensions/taskplane/merge.ts:307`, `merge.ts:618-621`). If Step 3 “uses pointer” naively, merge request/result files may be relocated into the config repo. **Fix:** require separate roots (agent root vs state root) so prompt follows pointer while request/result/state remain under workspace `.pi`.

### Missing Items
- Step-specific warning/fallback outcome for orchestrator startup (missing/malformed/unknown pointer should warn + continue using fallback root, matching Step 1 contract).
- Explicit state-root invariants for orchestrator paths beyond `ORCH_SIDECAR_DIR` (e.g., abort signal and other `.pi` runtime files remain workspace-root based).
- Test coverage intent for Step 3 wiring (buildExecutionContext pointer threading, merge prompt resolution via pointer, and no movement of state files).

### Suggestions
- Add a single orchestrator-level helper to resolve pointer once and reuse it across config + merge setup to avoid divergent behavior.
- Add targeted tests in `extensions/tests/workspace-config.test.ts` and merge-related tests to lock “pointer for config/agents only; state at workspace root” semantics.
