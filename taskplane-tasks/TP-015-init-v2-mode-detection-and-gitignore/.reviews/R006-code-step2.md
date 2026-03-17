## Code Review: Step 2: Gitignore Enforcement

### Verdict: REVISE

### Summary
The step is close: `.gitignore` enforcement is integrated in the right place and the flow correctly avoids mutating git state in preset/non-interactive mode unless explicitly confirmed. However, tracked-artifact detection currently misses key directory-based patterns, so the cleanup prompt is incomplete for exactly the artifacts this step is meant to catch.

### Issues Found
1. **[bin/taskplane.mjs:691-738] [important]** — Directory-style ignore patterns are converted to exact-match regexes, so tracked files under those directories are not detected. For example, `.worktrees/`, `.pi/orch-logs/`, and `.pi/npm/` become `^.../$` and fail to match tracked files like `.worktrees/wt1/file.txt` or `.pi/orch-logs/log.txt`. This causes `detectAndOfferUntrackArtifacts()` to under-report tracked runtime artifacts. **Fix:** treat trailing-slash patterns as prefix matches (e.g., `^\.worktrees/.*`), or switch to pathspec-based matching (`git ls-files -- <pattern>`) that preserves gitignore-style semantics.

### Pattern Violations
- `buildGitignoreBlock()` is currently unused (`bin/taskplane.mjs:601-613`). Either remove it or use it in `ensureGitignoreEntries()` to avoid dead code drift.

### Test Gaps
- No automated coverage was added for tracked-artifact matching semantics (especially trailing-slash directory entries). Add tests for:
  - `.pi/orch-logs/<file>`
  - `.worktrees/<wt>/<file>`
  - `.pi/npm/<...>`
  - wildcard file patterns (e.g., `.pi/lane-state-*`) to confirm regressions are prevented.

### Suggestions
- Consider switching untrack execution to argument-safe invocation (`execFileSync("git", ["rm", "--cached", "--", ...matchedFiles])`) to avoid shell-quoting edge cases.
