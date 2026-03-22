## Code Review: Step 2: Lockfile + Session Takeover

### Verdict: REVISE

### Summary
The lockfile lifecycle, heartbeat updates, stale/corrupt lock takeover, and startup arbitration are mostly implemented as intended. However, the required **force takeover** path is not actually implemented in code: live-lock detection only notifies the user and does not provide any executable takeover flow in this session. As written, this step does not fully satisfy the Step 2 requirement for force takeover behavior.

### Issues Found
1. **[extensions/taskplane/extension.ts:1839-1853] [important]** — Live-lock handling only displays a warning and suggested wording ("take over the supervisor") but no command/event handler actually performs takeover (rewrite lock + activate local supervisor). This misses the prompt requirement: "On force takeover: update lockfile, previous session yields on next heartbeat check."  
   **Fix:** Add an explicit takeover path (e.g., dedicated command/flag or clear interactive flow) that, when confirmed, writes a new lock (new `sessionId`), activates the local supervisor, and updates in-memory batch state. The existing heartbeat mismatch logic in `startHeartbeat()` will then make the prior supervisor yield.

### Pattern Violations
- `extensions/taskplane/extension.ts` imports `writeLockfile`, `removeLockfile`, and `SupervisorLockfile` but does not use them, which suggests incomplete/abandoned takeover wiring.

### Test Gaps
- No tests were added for Step 2 behaviors, especially:
  - startup with live lock (must block duplicate supervisor)
  - explicit force takeover path (new session claims lock; old session yields on heartbeat)
  - stale/corrupt lock takeover rehydration summary

### Suggestions
- Minor: when stale is detected due heartbeat expiry (PID still alive), avoid messaging that always says PID is dead; report stale-heartbeat vs dead-PID distinctly for operator clarity.
