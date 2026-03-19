## Code Review: Step 0: Preflight

### Verdict: REVISE

### Summary
Step 0 preflight content is substantive and the new findings in `STATUS.md` are useful for Steps 1–2. However, the status artifact has consistency problems that should be corrected before proceeding, including malformed review-table structure and contradictory review history. There are also unrelated task-file edits in this step range that should be scoped out.

### Issues Found
1. **[taskplane-tasks/TP-028-partial-progress-preservation/STATUS.md:68-71] [important]** — The Reviews table is malformed: the separator row (`|---|...|`) appears after data rows instead of directly below the header. This deviates from the project STATUS template and can break simple table parsing. **Fix:** move the separator to line 69 (immediately after the header), then list review rows below it.
2. **[taskplane-tasks/TP-028-partial-progress-preservation/STATUS.md:69-70, taskplane-tasks/TP-028-partial-progress-preservation/.reviews/R001-plan-step0.md:3] [important]** — Review history is internally inconsistent: `STATUS.md` records both `APPROVE` and `REVISE` for the same review ID/file (`R001`), but the referenced review file’s verdict is `REVISE`. **Fix:** keep only verifiable review entries, or add a new follow-up review artifact (new review ID/file) if the step was later approved.
3. **[taskplane-tasks/TP-028-partial-progress-preservation/STATUS.md:3-4,13-27] [minor]** — Top-level metadata says current step is `Step 0: Preflight` and overall status is `In Progress`, while Step 0 is marked `✅ Complete` and Step 1 remains `Not Started`. **Fix:** normalize header metadata to the actual next actionable state for operator clarity.
4. **[taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/.reviews/request-R010.md:1, taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/STATUS.md:186] [minor]** — The step diff includes unrelated TP-025 updates. **Fix:** keep TP-028 step commits/revisions scoped to TP-028 files unless cross-task edits are intentional and documented.

### Pattern Violations
- `STATUS.md` Reviews table ordering does not follow established template structure used across task status files.
- Step changes are not cleanly scoped to the task under execution (cross-task artifact touches).

### Test Gaps
- No runtime code was changed in this step, so there are no behavioral tests to evaluate yet.

### Suggestions
- After correcting the STATUS inconsistencies, add a single authoritative review entry for Step 0 (or new review ID) before starting Step 1 implementation.
