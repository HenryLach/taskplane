## Code Review: Step 5: Resume compatibility

### Verdict: REVISE

### Summary
The Step 5 changes move resume forward: expanded frontiers are reconstructed, runtime wave plans can be extended, and targeted tests were added. However, the new wave-plan reconstruction currently changes wave semantics when multiple tasks in the same original wave are missing continuation rounds. That can change stop/merge behavior versus live execution and breaks the “behaviorally indistinguishable after resume” outcome.

### Issues Found
1. **[extensions/taskplane/resume.ts:658-673] [important]** — `buildResumeRuntimeWavePlan()` inserts one synthetic wave per task (`[taskId]`) instead of reconstructing continuation *rounds* shared by all affected tasks. In multi-task cases this splits what should be one continuation wave into multiple serial waves (e.g. `[[A,B],[C]]` with both A/B missing one round becomes `[[A,B],[B],[A],[C]]`), which can change failure-policy and merge semantics (notably `stop-wave`).
   - **Suggested fix:** rebuild missing rounds in grouped form: for tasks that shared an original wave/position, synthesize additional rounds like the engine’s continuation behavior (`[A,B]`, then `[A]`, etc. based on remaining counts), preserving relative ordering and concurrency.

### Pattern Violations
- None identified.

### Test Gaps
- `extensions/tests/resume-segment-frontier.test.ts:327-358` only validates the single-task missing-round case. Add a multi-task resume reconstruction case (two tasks missing rounds in the same wave) and assert grouped continuation wave shape to prevent the regression above.
- Step 5’s idempotency-on-resume requirement is still only indirectly covered by helper-level seeding checks; there is no resume-path scenario asserting replay prevention behavior after restart.

### Suggestions
- I flagged in R015 to include a “multiple approved requests at one boundary before restart” scenario; that case would also help verify this grouped-wave reconstruction behavior end-to-end.