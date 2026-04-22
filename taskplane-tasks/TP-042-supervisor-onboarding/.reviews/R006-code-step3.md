## Code Review: Step 3: Returning User Flows (Scripts 6-8)

### Verdict: APPROVE

### Summary
Step 3 successfully expands the returning-user guidance in the supervisor primer and wires `/orch` no-args routing states to the correct Script 6/7/8 behavior in `buildRoutingSystemPrompt()`. The updated prompt content now covers pending-task planning, no-task work sourcing, health checks, and retrospective inputs in substantially more actionable detail. I did not find blocking correctness issues in this step.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:654-657] [minor]** — Completed-batch routing currently says Script 8 can be presented "either before or after integration." The task/spec framing for Script 8 is post-integration by default, so this wording may create operator-flow ambiguity.
   **Fix:** Prefer wording that defaults retrospective to post-integration, with pre-integration allowed only when explicitly requested.

### Pattern Violations
- None identified.

### Test Gaps
- `extensions/tests/supervisor.test.ts` currently validates `buildSupervisorSystemPrompt()` but has no direct assertions for `buildRoutingSystemPrompt()` content by routing state (`pending-tasks`, `no-tasks`, `completed-batch`).
- No regression test currently verifies that completed-batch routing guidance includes both integration and retrospective instructions.

### Suggestions
- Add focused unit tests for `buildRoutingSystemPrompt()` that assert key required lines for Scripts 6/7/8 per routing state.
