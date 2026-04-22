## Plan Review: Step 2: Add Supervisor Escalation to lane-runner

### Verdict: REVISE

### Summary
The Step 2 plan is mostly aligned with the interception architecture from Step 1: it hooks `onPrematureExit`, escalates on no-progress exits, and includes a 60s timeout fallback. However, it currently misses one explicit required outcome from the task prompt: allowing the supervisor to intentionally let the worker session close (instead of always reprompting when a reply arrives). Adding that outcome now will prevent protocol ambiguity and incorrect reprompts.

### Issues Found
1. **[Severity: important]** — Missing explicit handling for supervisor-directed normal exit. `PROMPT.md` requires: “If supervisor says to let the worker exit ... return null from the callback” (PROMPT.md:108). The current Step 2 plan says to “return the reply as new prompt” and only uses `null` on timeout (STATUS.md:49-54), which can cause explicit “let it fail/skip” responses to be injected as worker prompts instead of closing the session. **Fix:** add an explicit outcome for interpreting a supervisor close directive and returning `null` immediately.

### Missing Items
- Add an explicit Step 2 outcome for **reply interpretation**: “instructional reply → reprompt, close directive (`skip`/`let it fail`) → return `null`.”
- Add targeted test intent for that branch (supervisor reply requests exit, session closes without reprompt).

### Suggestions
- Consider a simple correlation guard when polling inbox (e.g., only accept messages newer than escalation timestamp) to avoid consuming stale/manual steering messages as interception replies.
