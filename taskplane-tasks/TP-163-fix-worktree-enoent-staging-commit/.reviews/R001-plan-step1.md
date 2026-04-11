## Plan Review: Step 1: Fast-forward orch branch after staging commit

### Verdict: REVISE

### Summary
The plan is close to the right area and sequencing, but its core mechanism (`git update-ref` after commit) is unsafe as currently specified. In multi-wave runs, this can move `orchBranch` backward and discard prior wave merge history, which is a correctness break. The step needs a true fast-forward strategy (or an explicit non-FF reconciliation path) before implementation.

### Issues Found
1. **[Severity: important]** — `git update-ref refs/heads/<orchBranch> <head>` is not a fast-forward operation; it force-moves the ref. After wave 1 merges, `orchBranch` can be ahead/diverged from `main`; a later staging commit on `main` (wave 2+) would make this pointer move potentially rewind `orchBranch` and lose prior wave results. **Fix:** require ancestry validation before ref move (e.g., `merge-base --is-ancestor <orchHead> <newHead>`) and update with expected-old-sha semantics; do not allow backward/non-FF ref moves.
2. **[Severity: important]** — The plan says non-fatal if fast-forward fails, but without a defined fallback this can leave the next worktree missing staged task files (same ENOENT class) in non-FF scenarios. **Fix:** define how task-file commit is made visible to `orchBranch` when FF is impossible (e.g., safe reconciliation path), not just log-and-continue.

### Missing Items
- Explicit handling for multi-wave staging where `orchBranch` has already advanced due to previous merges.
- Regression coverage intent for a multi-wave case (wave N commit + prior wave merged into orch) to ensure no branch rewind and no ENOENT recurrence.

### Suggestions
- Keep `executeWave`/`ensureTaskFilesCommitted` naming explicit (`orchBranch` instead of `baseBranch`) to reduce ambiguity at the call site.
- Add a short inline note documenting why ref movement must be FF-only (to preserve accumulated wave merges).
