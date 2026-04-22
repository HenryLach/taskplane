## Plan Review: Step 1: Wire Automatic Recovery into Engine

### Verdict: REVISE

### Summary
The plan captures the right high-level outcomes for Tier 0 recovery, but it is missing two implementation-critical outcomes needed to make those outcomes achievable in the current code shape. In particular, the current plan does not account for missing failure metadata in the execution path, which blocks correct worker-crash classification and stale-worktree auto-recovery. Add those outcomes to the step plan before implementation.

### Issues Found
1. **[Severity: important]** Worker-crash retry is planned as an engine change, but the engine currently does not receive structured exit classification data needed to decide retryability.
   - Evidence: `taskplane-tasks/TP-039-tier0-watchdog-integration/STATUS.md:25` requires “classify exit, retry if retryable”, but `extensions/taskplane/execution.ts:891-899` only records `exitReason`/`doneFileFound` and does not populate `exitDiagnostic`.
   - Suggested fix: Add a plan outcome to plumb deterministic crash classification (e.g., `exitDiagnostic.classification`) into lane task outcomes, then use that in engine retry decisions.

2. **[Severity: important]** Stale-worktree recovery at wave provisioning is not implementable from engine alone with current result contracts.
   - Evidence: `taskplane-tasks/TP-039-tier0-watchdog-integration/STATUS.md:26` requires “force cleanup + retry”, but `extensions/taskplane/execution.ts:1794-1813` collapses allocation failure to a generic failed wave and drops structured allocation error data; `extensions/taskplane/worktree.ts:1430-1458` returns provisioning errors without a built-in force-cleanup retry path.
   - Suggested fix: Add a plan outcome to either (a) propagate allocation error codes/details into `WaveExecutionResult` so engine can target stale-worktree recovery, or (b) implement the force-cleanup+retry directly in allocation/worktree provisioning.

3. **[Severity: important]** Retry-counter persistence is listed, but the plan does not define scope-key semantics for the new non-merge retry paths.
   - Evidence: `taskplane-tasks/TP-039-tier0-watchdog-integration/STATUS.md:28` lists persistence, while merge scopes are already repo-scoped and documented in `extensions/taskplane/messages.ts:610-619`.
   - Suggested fix: Add a concrete outcome for retry scope naming and increment/persist points for worker-crash and stale-worktree retries so counters survive resume without colliding with existing merge scopes.

### Missing Items
- Explicit outcome for exposing crash classification data to the engine retry logic.
- Explicit outcome for carrying allocation/provisioning failure metadata needed for stale-worktree targeted recovery.
- Explicit outcome for non-merge retry scope-key design and persistence trigger points.

### Suggestions
- Treat merge-timeout wiring as a regression verification item (existing loop already present in `extensions/taskplane/engine.ts:559-605`) to avoid duplicating retry logic.
- Consider cleaning duplicate execution-log rows in `STATUS.md` after review; not blocking.
