## Code Review: Step 1: Update spawnAgentTmux to Use RPC Wrapper

### Verdict: REVISE

### Summary
The tmux spawn path has been correctly switched from `pi -p` to `rpc-wrapper.mjs`, and the command-quoting discipline from the previous implementation is largely preserved. However, two important contract issues remain: telemetry file naming does not follow the required op/batch/repo naming contract, and rpc-wrapper path resolution is currently brittle in non-global install layouts. These should be fixed before proceeding to Step 2.

### Issues Found
1. **[extensions/task-runner.ts:1093-1101] [important]** — Telemetry filenames are generated as `{sessionName}-{timestamp}` instead of using the required naming contract (`{opId}-{batchId}-{repoId}[-lane-{N}]`). This diverges from the task prompt and resilience roadmap contract and can weaken cross-batch/repo traceability. **Fix:** build sidecar/summary names from explicit IDs where available (opId/batchId/repoId/lane), with deterministic fallbacks only when unavailable (e.g., repo mode `repoId=default`).
2. **[extensions/task-runner.ts:459-474] [important]** — `resolveRpcWrapperPath()` only checks `findPackageRoot()` and `<cwd>/bin/rpc-wrapper.mjs`, then throws. This can fail for valid installs such as project-local `node_modules/taskplane/bin/rpc-wrapper.mjs` (or other npm prefix layouts), turning a previously working tmux flow into a hard failure. **Fix:** align candidate resolution with `resolveTaskRunnerExtensionPath()` patterns (including project-local `node_modules/taskplane`) or centralize path resolution logic.

### Pattern Violations
- Naming contract from the roadmap/prompt is not applied to telemetry artifacts in this step.

### Test Gaps
- No test asserts the telemetry filename contract in tmux mode.
- No test covers rpc-wrapper path resolution across install contexts (global install, workspace install, project-local `node_modules`).

### Suggestions
- Update the `spawnAgentTmux` doc block to reflect the new return shape (`sidecarPath`, `exitSummaryPath`) instead of “identical return shape” wording.
- Consider avoiding duplicate `--no-session` passthrough (wrapper already injects it), to keep spawned pi args easier to reason about.
