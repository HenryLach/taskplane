## Plan Review: Step 4: Resume after expansion test

### Verdict: APPROVE

### Summary
The Step 4 plan is aligned with the amended task scope and covers the required resume-after-expansion outcomes for this run. In `STATUS.md` (lines 49-52), it explicitly targets approved-but-unexecuted persistence, resume frontier reconstruction, and duplicate request idempotency, which map to the Step 4 requirements in `PROMPT.md` (lines 93-97) and the steering amendment (lines 150-158). This is a workable, sufficient plan to complete the step.

### Issues Found
1. **[Severity: minor]** `STATUS.md:50` is slightly broad (“reactivates expanded segment execution frontier”) and could be interpreted without explicitly asserting downstream dependency ordering after resume.  
   **Suggested fix:** In the test intent, include an assertion that resumed execution order respects dependency wiring for both expanded and remaining pending segments.

### Missing Items
- None.

### Suggestions
- Add a quick pointer in Step 4 notes to the exact test file(s)/test names used for this resume scenario so Step 5 evidence mapping is faster during final review.
- After issue #439 is fixed, keep the planned follow-up live e2e run as a separate acceptance confirmation (already noted in the prompt amendment).
