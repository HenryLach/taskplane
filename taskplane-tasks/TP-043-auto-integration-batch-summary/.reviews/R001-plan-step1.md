## Plan Review: Step 1: Supervisor-Managed Integration

### Verdict: REVISE

### Summary
The Step 1 plan captures the high-level intent (batch-complete trigger, mode handling, branch protection, config updates), but it misses two execution-critical integration points in the current architecture. As written, supervisor-managed integration can be skipped or duplicated because existing engine/resume auto-integration and terminal supervisor teardown are still in place. The plan also does not explicitly cover the required CI wait/merge lifecycle from the prompt.

### Issues Found
1. **[Severity: critical]** — The plan does not account for existing auto-integration in the engine/resume path, which will conflict with supervisor-managed integration.
   - Evidence: `extensions/taskplane/engine.ts:2005-2031` and `extensions/taskplane/resume.ts:2110-2131` already run `attemptAutoIntegration(...)` when `orchestrator.integration === "auto"`.
   - Why this blocks: Step 1 expects supervisor-driven integration on `batch_complete`; leaving current behavior unchanged can cause duplicate integration attempts or bypass supervisor logic entirely.
   - Suggested fix: Add an explicit migration/coordination outcome in the plan (e.g., gate old engine/resume auto path when supervisor integration mode is enabled, or move ownership cleanly to one path).

2. **[Severity: critical]** — The plan does not include how supervisor remains active long enough to observe and act on `batch_complete`.
   - Evidence: `extensions/taskplane/extension.ts:1211-1214` and `extensions/taskplane/extension.ts:1480-1481` deactivate supervisor on terminal engine completion.
   - Why this blocks: Event-driven integration after completion is not reliable if the supervisor is torn down immediately.
   - Suggested fix: Add an explicit Step 1 outcome for terminal lifecycle control (defer deactivation until integration/manual handoff is complete).

3. **[Severity: important]** — Required CI lifecycle outcomes are not explicitly represented in the Step 1 plan.
   - Evidence: Step checklist in `STATUS.md:24-28` includes trigger/mode/conflicts/config, but not “wait for CI”, “merge after CI”, and CI failure handling required by `PROMPT.md:76-78`.
   - Why this matters: The prompt defines full integration lifecycle behavior; omitting CI wait/merge/failure handling risks incomplete delivery.
   - Suggested fix: Add explicit plan outcomes for PR status polling, CI failure path, merge action, and cleanup reporting.

### Missing Items
- Explicit ownership decision between existing `orchestrator.integration` behavior and new supervisor-managed integration mode.
- Explicit terminal-state lifecycle handling so integration can run after `batch_complete` before supervisor teardown.
- Explicit CI gate flow: PR creation → wait/checks → merge or failure escalation.

### Suggestions
- If reusing `/orch-integrate` internals (`executeIntegration`), extract shared integration helpers to a neutral module to avoid tight coupling/circular dependencies between `extension.ts` and `supervisor.ts`.
- Define and document the config contract clearly (`integration.mode` vs existing `orchestrator.orchestrator.integration`) before implementation to avoid schema drift across settings TUI, loader, and docs.
