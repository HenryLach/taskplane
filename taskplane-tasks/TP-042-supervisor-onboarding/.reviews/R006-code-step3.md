## Code Review: Step 3: Returning User Flows (Scripts 6-8)

### Verdict: APPROVE

### Summary
The Step 3 changes correctly wire returning-user routing guidance in `buildRoutingSystemPrompt()` so the supervisor now gives explicit Script 6/7/8 instructions for `pending-tasks`, `no-tasks`, and `completed-batch` states. The updated prompt text is consistent with the expanded primer content and addresses the prior gap where completed-batch routing only emphasized integration. I did not find blocking functional issues in this step’s code changes.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:605-658] [minor]** — No blocking correctness issues identified in the modified routing prompt guidance.

### Pattern Violations
- None identified.

### Test Gaps
- No direct automated assertions currently validate the routing prompt text for returning-user states (especially completed-batch including retrospective guidance). Consider covering this in Step 4 with prompt-content/unit tests around `buildRoutingSystemPrompt()`.

### Suggestions
- `extensions/taskplane/supervisor.ts:654-657`: consider wording Script 8 as **post-integration by default** (while still allowing operator-requested pre-integration review) to align more tightly with the task prompt’s “triggered after integration” phrasing.
