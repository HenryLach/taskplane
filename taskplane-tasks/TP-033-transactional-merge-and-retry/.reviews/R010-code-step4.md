## Code Review: Step 4: Documentation & Delivery

### Verdict: REVISE

### Summary
The step completes the required artifacts (`task-orchestrator` config reference update, STATUS updates, and `.DONE` marker), and most of the new retry-matrix documentation matches the implemented TP-033 behavior. However, there is a key behavior mismatch in the retry flow description for non-retriable failures. That mismatch can mislead operators about whether `on_merge_failure: abort` will be honored.

### Issues Found
1. **[docs/reference/configuration/task-orchestrator.yaml.md:114] [important]** — The docs state that non-retriable classes “skip directly to step 4” (forced pause on exhaustion). This conflicts with implementation: non-retriable/no-retry outcomes fall through to standard `on_merge_failure` policy handling (`pause` **or** `abort`) in both engine and resume paths.
   - Evidence: `engine.ts:635-637`, `resume.ts:1610-1612`, `messages.ts:733-735`.
   - **Fix:** Update step 5 to: non-retriable classes skip retries and apply `on_merge_failure` immediately. Also adjust nearby table wording (`merge_conflict_unresolved` exhaustion/action phrasing) so it does not imply forced pause for initial non-retriable failures.

### Pattern Violations
- Documentation currently contains an internal behavioral contradiction in the retry behavior section (`task-orchestrator.yaml.md:90` vs `:114`).

### Test Gaps
- No code change in this step; no additional runtime test gaps identified for Step 4 itself.

### Suggestions
- Add one explicit note under the matrix: **forced pause overrides config only on retry exhaustion and rollback safe-stop**, not on initial non-retriable failures.
