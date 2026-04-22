## Plan Review: Step 2: Expansion test task creation

### Verdict: REVISE

### Summary
The Step 2 plan now includes the TP-007 authoring requirements and initial single-segment precondition I saw addressed in prior reviews, which is good progress. However, it currently does not explicitly preserve the core Step 2 end-to-end acceptance verification from `PROMPT.md` (segment completion + repo outcomes + merge success in the actual TP-007 run). As written, the remaining checklist could be completed mostly via unit tests while missing the required polyrepo execution proof.

### Issues Found
1. **[Severity: important]** `STATUS.md:33-37` omits an explicit Step 2 outcome check for `PROMPT.md:77-78` end-to-end behavior: expanded `web-client` segment executes after `api-service`, both segments complete, both repos contain the intended coordinated changes, and merge succeeds.  
   **Suggested fix:** Add a Step 2 checklist item (or items) requiring runtime evidence from TP-007 execution (batch/segment timeline + repo diff/result summary + merge success), not only unit-level assertions.

### Missing Items
- Explicit Step 2 verification that TP-007 runtime expansion executes in-order (`api-service` then `web-client`) in the polyrepo run.
- Explicit Step 2 verification that both repos have correct resulting changes and the task merge succeeds.

### Suggestions
- Keep the new unit-coverage items, but treat them as supplementary to (not a substitute for) the required TP-007 end-to-end acceptance evidence.
- Capture Step 2 evidence in one bundle (batch ID, segment transition proof, repo outcome summary) so Step 5 can reference it directly.
