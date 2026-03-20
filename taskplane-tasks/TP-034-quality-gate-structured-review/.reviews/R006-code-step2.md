## Code Review: Step 2: Implement Structured Review

### Verdict: REVISE

### Summary
The step adds the core quality-gate plumbing in the right places (`executeTask()` gating and `doQualityGateReview()` orchestration), and the fail-open handling for reviewer crashes/non-zero exits is thoughtfully implemented. However, there are two important correctness issues in the review-evidence and verdict-rule alignment that can cause false failures or low-fidelity reviews. These should be fixed before approving this step.

### Issues Found
1. **[extensions/taskplane/quality-gate.ts:473-480] [important]** — Prompt verdict rules are hardcoded and do not match the configured threshold semantics. The prompt always says “3+ important => NEEDS_FIXES”, but runtime `applyVerdictRules()` only enforces that for `no_important` (not `no_critical`). With current logic, a reviewer following the prompt can emit `NEEDS_FIXES`, and `applyVerdictRules()` will fail via `verdict_says_needs_fixes`, effectively overriding `no_critical` behavior. **Fix:** generate threshold-specific prompt rules from `passThreshold` (or instruct reviewer to report findings only and let runtime threshold logic determine pass/fail).

2. **[extensions/taskplane/quality-gate.ts:360-385] [important]** — `buildGitDiff()` uses a fixed `HEAD~20..HEAD` range and does not implement the documented fallback behavior. In repositories with fewer than 20 commits (or shallow history), this returns unavailable/empty evidence; in long-lived branches it may include unrelated history. **Fix:** compute a robust baseline (e.g., merge-base with main/default branch or bounded commit count), then fall back to a valid smaller range when needed.

### Pattern Violations
- `buildGitDiff()` comment promises fallback logic that the implementation does not perform (comment/behavior mismatch).

### Test Gaps
- No tests cover `generateQualityGatePrompt()` evidence range behavior (short history, fallback paths, file list correctness).
- No tests verify threshold-specific prompt consistency vs `applyVerdictRules()` behavior.

### Suggestions
- Add focused unit tests for `readAndEvaluateVerdict()` missing-file and malformed-file cases (to lock in fail-open behavior beyond `parseVerdict`).
