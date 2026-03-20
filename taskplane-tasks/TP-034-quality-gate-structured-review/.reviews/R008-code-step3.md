## Code Review: Step 3: Remediation Cycle

### Verdict: REVISE

### Summary
The remediation loop is mostly in place (feedback file, fix-agent spawn, re-review loop, and terminal gate failure behavior), and the implementation is close to the intended Step 3 outcome. However, there are two important correctness gaps: blocking findings are not fully surfaced for the `all_clear` threshold, and fix-agent timeout behavior is documented but not actually enforced. These can cause non-remediable failures or indefinite hangs.

### Issues Found
1. **[extensions/taskplane/quality-gate.ts:647-666] [important]** — `generateFeedbackMd()` only includes `critical` and `important` findings, but under `pass_threshold = "all_clear"`, `suggestion` findings are also gate-blocking (`extensions/tests/quality-gate.test.ts:272-276`). This can produce `NEEDS_FIXES` cycles with no actionable blocking items in `REVIEW_FEEDBACK.md`. **Fix:** make feedback generation threshold-aware (or evaluation-aware) and include suggestion findings when they are blocking (at least for `all_clear`).
2. **[extensions/task-runner.ts:2739-2742, 2783-2837] [important]** — The fix-agent function claims deterministic handling for timeout paths, but no timeout kill logic exists in `doQualityGateFixAgent()` (it awaits agent completion indefinitely). A hung fix agent can stall the task permanently. **Fix:** add explicit wall-clock timeout handling (subprocess + tmux), kill the agent on timeout, and return non-zero so fix budget is consumed deterministically.

### Pattern Violations
- Comment/behavior mismatch: timeout handling is documented in the fix-agent contract but not implemented (`extensions/task-runner.ts:2739-2742`).

### Test Gaps
- No tests were added for remediation-specific behavior:
  - `all_clear` + suggestion-only blocking findings should produce actionable `REVIEW_FEEDBACK.md` content.
  - Fix-agent timeout/crash/non-zero paths should consume fix budget and continue/fail deterministically.
  - End-to-end review→fix→re-review budget exhaustion ordering (`max_review_cycles` vs `max_fix_cycles`).

### Suggestions
- Include suggestion counts in terminal failure summaries when threshold is `all_clear` so operator logs reflect actual blocking criteria.
