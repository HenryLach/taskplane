## Plan Review: Step 2: Expansion test task creation

### Verdict: REVISE

### Summary
The Step 2 plan is improved from R002 and now includes two previously missing outcomes: initial single-segment verification and coordinated repo-change verification. However, it still misses one core acceptance behavior from `PROMPT.md` and one task-authoring requirement that makes TP-007 repeatable as a long-term acceptance test artifact. Those should be added before implementation proceeds.

### Issues Found
1. **[Severity: important]** `STATUS.md:32-33` confirms expansion happened and both segments completed, but does not explicitly verify the required execution order that the expanded `web-client` segment runs **after** `api-service` (`PROMPT.md:77`).  
   **Suggested fix:** Add a checklist item to verify segment transition/order evidence (e.g., batch segment timeline showing `TP-007::api-service` completion before `TP-007::web-client` starts).
2. **[Severity: important]** The plan does not explicitly include validating TP-007 task authoring requirements from `PROMPT.md:72-76` (worker instructions to discover dependency and call `request_segment_expansion`). A generic “Create expansion test task” item can pass even if the prompt is underspecified.  
   **Suggested fix:** Add a checklist item to confirm TP-007 `PROMPT.md` explicitly instructs the worker flow (api change → discover web dependency → call expansion tool → finish api segment).

### Missing Items
- Explicit verification that expanded segment execution order is `api-service` then `web-client`.
- Explicit verification that TP-007 `PROMPT.md` contains the required expansion-invocation workflow instructions.

### Suggestions
- Keep the Step 2 evidence bundle noted in STATUS notes (batch ID + segment transition proof + repo diff summary) so Step 5 can reference it directly without rerunning analysis.
