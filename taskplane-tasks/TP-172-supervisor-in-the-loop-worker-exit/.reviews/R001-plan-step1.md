## Plan Review: Step 1: Add Exit Interception to agent-host

### Verdict: REVISE

### Summary
The Step 1 plan is directionally correct and matches the discovered runtime behavior (`agent_end` before stdin close). However, it currently misses one explicit PROMPT requirement and one critical failure-path safeguard for the new async interception callback. Tightening those now will prevent hangs and ensure observability requirements are met.

### Issues Found
1. **[Severity: important]** — Telemetry requirement is incomplete. In `PROMPT.md` Step 1, interception telemetry must include both assistant message text **and whether supervisor was consulted**; the current Step 1 plan only calls out assistant message + interception count (STATUS.md:38). Add an explicit outcome for a `supervisorConsulted` (or equivalent) payload field on `exit_intercepted`.
2. **[Severity: important]** — Async callback failure handling is not planned. `onPrematureExit` is async; if it rejects or never resolves, the worker process can remain alive with stdin open and stall the lane until outer timeout. Add explicit handling: bounded wait + catch/fallback to `closeStdin()` and emit diagnostic telemetry.

### Missing Items
- Explicitly state `maxExitInterceptions` default is **2** and that reaching the cap forces normal close behavior.
- Add test intent for callback error/timeout fallback (not just happy-path interception).

### Suggestions
- Include a small payload contract note for `exit_intercepted` (e.g., `interceptionCount`, `assistantMessage`, `supervisorConsulted`, `action: reprompt|close`) so downstream dashboard/analysis consumers stay stable.
