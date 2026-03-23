## Code Review: Step 2: Lockfile + Session Takeover

### Verdict: REVISE

### Summary
The lockfile helpers, heartbeat loop, startup arbitration, and stale/corrupt takeover flow are mostly in place and aligned with the step intent. However, one required outcome is still missing: there is no actual force-takeover path when a live lock is detected. In addition, lockfile cleanup is only wired to batch terminal paths/abort and not to session exit.

### Issues Found
1. **[extensions/taskplane/extension.ts:1839] [important]** — Live-lock handling only warns and suggests natural-language takeover, but there is no command/event handler that actually performs force takeover (rewrite lockfile + activate supervisor). This misses the Step 2 requirement: “On force takeover: update lockfile, previous session yields on next heartbeat check.”  
   **Fix:** Add an explicit takeover action (e.g., `/orch-supervisor-takeover` or an existing command flag) that writes a new lock with a new `sessionId`, hydrates supervisor state, and calls `activateSupervisor(...)`. Keep the heartbeat-based yield path in `startHeartbeat()` as the handoff mechanism.

2. **[extensions/taskplane/extension.ts:1712] [important]** — Lock cleanup is implemented for batch terminal/abort paths, but not for session exit. If the session ends cleanly while a batch is still running, lockfile removal is not attempted, which does not satisfy “cleanup on batch completion or session exit.”  
   **Fix:** Register a session/process shutdown cleanup path (if pi exposes a session-end event, use it; otherwise use `process.on("exit"|"SIGINT"|"SIGTERM")` best-effort cleanup) that calls `deactivateSupervisor(...)`.

### Pattern Violations
- None beyond the missing required takeover/exit outcomes above.

### Test Gaps
- No automated test covering **live lock → force takeover → prior supervisor yields on next heartbeat**.
- No automated test covering **session-exit cleanup path** for lockfile removal.

### Suggestions
- Consider updating lockfile `batchId` after engine initialization (currently it can stay `"(initializing)"` if activation happens before `batchId` is populated).
