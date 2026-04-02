## Code Review: Step 1: Remove abort TMUX fallbacks

### Verdict: APPROVE

### Summary
The Step 1 implementation matches the stated scope: TMUX abort fallback paths were removed from `abort.ts`, `execution.ts` stall/stop-all kill paths, and `merge.ts` timeout/error cleanup paths in favor of Runtime V2 handle/PID-based cleanup. The updated tests were adjusted consistently and pass for the touched suites. I did not find any blocking correctness issues for Step 1 outcomes.

### Issues Found
1. **No blocking issues found.**

### Pattern Violations
- None observed for this step’s intended outcome.

### Test Gaps
- No blocking gaps for Step 1. (Targeted suites run: `engine-runtime-v2-routing`, `merge-timeout-resilience`, `supervisor-merge-monitoring`.)

### Suggestions
- `extensions/taskplane/merge.ts` comments around `waitForMergeResult` still reference TMUX-oriented liveness wording (e.g., “TMUX session name” / “backend-aware” narrative), while logic is now V2-handle-only in this path. Consider a small doc-comment cleanup for clarity.
- Consider adding a focused behavioral unit test for `abort.ts` `killOrchSessions()` deduping behavior (worker/reviewer/base session names) to lock in intended V2-only cleanup semantics.
