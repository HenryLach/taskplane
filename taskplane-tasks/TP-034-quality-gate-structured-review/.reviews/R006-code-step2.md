## Code Review: Step 2: Implement Structured Review

### Verdict: REVISE

### Summary
The structured review path is wired into `executeTask()` correctly, and the fail-open behavior for agent failure/malformed verdicts is implemented in the right place. However, two implementation choices in `quality-gate.ts` materially weaken correctness: the reviewer prompt’s verdict rules are hard-coded and can conflict with configured `pass_threshold`, and the git diff evidence range is not actually task-scoped. These can cause false NEEDS_FIXES outcomes or noisy/unreliable evidence during gate evaluation.

### Issues Found
1. **[extensions/taskplane/quality-gate.ts:473-480] [important]** — The prompt always instructs reviewers to fail on `3+ important` findings, regardless of configured `passThreshold`. With `pass_threshold: no_critical`, this conflicts with runtime policy and can still force failure via `verdict_says_needs_fixes` in `applyVerdictRules()`. **Fix:** generate threshold-specific verdict instructions (or explicitly instruct reviewer to align `verdict` with `Current pass threshold`) so reviewer output and evaluator policy are consistent.
2. **[extensions/taskplane/quality-gate.ts:357-381] [important]** — `buildGitDiff()` uses a fixed `HEAD~20..HEAD` range and does not implement the documented fallback. This can include unrelated upstream commits (noise) or fail in shallow/short histories, producing poor evidence (`"(git diff unavailable)"`). **Fix:** compute a task-appropriate base commit (e.g., merge-base with `main`/`origin/main` or persisted task baseline), then diff `base..HEAD`; implement real fallback chain for both file list and diff.

### Pattern Violations
- `buildGitDiff()` docstring promises behavior (“N determined by branch vs main”, fallback to `git diff HEAD`) that is not implemented.

### Test Gaps
- No tests for prompt generation honoring different `passThreshold` values.
- No tests for diff-base selection/fallback behavior in `buildGitDiff()` (short history, missing main ref, fallback success).

### Suggestions
- Add a small unit test around `readAndEvaluateVerdict()` for missing verdict file fail-open to lock in Step 2 behavior.
