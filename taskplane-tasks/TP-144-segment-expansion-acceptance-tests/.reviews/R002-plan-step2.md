## Plan Review: Step 2: Expansion test task creation

### Verdict: REVISE

### Summary
The Step 2 plan captures the high-level flow (create task, trigger expansion, complete segments, merge), but it currently omits two required acceptance outcomes from `PROMPT.md` that make this an actual expansion validation instead of just another passing multi-repo task. Without tightening those checks, the step could complete while missing the core behavior being tested.

### Issues Found
1. **[Severity: important]** `STATUS.md` Step 2 checklist (`lines 30-33`) does not explicitly preserve the required precondition that TP-007 starts with a single initial segment (`api-service`) and only gains `web-client` via runtime expansion (required by `PROMPT.md:71-78`).  
   **Suggested fix:** Add an explicit outcome/verification item that initial segment planning is single-repo (`api-service`) and that `web-client` appears only after `request_segment_expansion`, executing after `api-service`.
2. **[Severity: important]** The current Step 2 plan does not explicitly require verification that **both repos contain the intended coordinated changes** (required by `PROMPT.md:78`), only that segments complete and merge succeeds.  
   **Suggested fix:** Add a checklist item to validate concrete repo outcomes in `api-service` and `web-client` (not just execution status), with evidence captured in the task log/STATUS notes.

### Missing Items
- Explicit verification of initial single-segment plan (`api-service`) before expansion.
- Explicit verification of correct cross-repo content changes in both repos after execution.

### Suggestions
- Record where Step 2 evidence will be captured (e.g., batch ID + segment transition snippet + repo diff summary) so Step 5 can reference it directly.