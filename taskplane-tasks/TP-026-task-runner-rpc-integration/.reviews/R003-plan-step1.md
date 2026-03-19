## Plan Review: Step 1: Update spawnAgentTmux to Use RPC Wrapper

### Verdict: REVISE

### Summary
The Step 1 plan has the right edit boundary (`spawnAgentTmux` only) and keeps the `/orch` no-change guardrail visible via preflight notes. However, it currently under-specifies two critical outcomes from the prompt: strict naming-contract coverage for telemetry files and shell-safe command construction when replacing the tmux spawn command. Tightening those before implementation will reduce collision/regression risk.

### Issues Found
1. **[Severity: important]** — The Step 1 checklist in `taskplane-tasks/TP-026-task-runner-rpc-integration/STATUS.md:29-33` drops key detail from the task requirement in `.../PROMPT.md:70-74`: sidecar/summary paths must follow naming contract semantics (include `opId`, `batchId`, `repoId` where available, workspace `.pi/telemetry/` behavior). Add an explicit planning item for **how each token is sourced and what deterministic fallback is used** when a token is unavailable.
2. **[Severity: important]** — Command-construction risk is not explicitly mitigated. Current tmux spawn logic relies on careful quoting and Windows path normalization (`extensions/task-runner.ts:1068-1105`); replacing `pi -p` with wrapper invocation without a quoting plan is likely to break paths with spaces/shell metacharacters. Add a Step 1 checkpoint to preserve existing quoting behavior for wrapper path + all args + passthrough pi args.
3. **[Severity: minor]** — The plan does not state a Step 1 verification gate that `/orch` subprocess flow remains untouched, even though this is a hard constraint (`PROMPT.md:137`, `STATUS.md:94-95`). Add a brief “no-diff outside `spawnAgentTmux` path” validation item before moving to Step 2.

### Missing Items
- Explicit token-source/fallback mapping for telemetry naming (`opId`, `batchId`, `repoId`) and collision handling between worker/reviewer runs.
- Explicit intent to reuse existing workspace-aware sidecar root behavior (`extensions/task-runner.ts:282-301`) so telemetry lands under the correct `.pi` root.
- Step-level verification intent for wrapper path resolution across local/dev and installed-package contexts.

### Suggestions
- Reuse existing package-root resolution patterns already in code (`extensions/task-runner.ts:393-437` and `extensions/taskplane/execution.ts:27-60`) instead of introducing a new ad-hoc resolver.
- Add a small Step 1 dry-run assertion (unit test or command-string snapshot) before Step 2 to catch quoting/path regressions early.
