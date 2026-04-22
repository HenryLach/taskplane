## Code Review: Step 1: Add audit script

### Verdict: REVISE

### Summary
The new `scripts/tmux-reference-audit.mjs` is close to the intended Step 1 outcome: it provides deterministic schema fields, category totals, per-file stats, and strict-mode failure behavior. However, there is one blocking contract mismatch: file paths are not normalized to POSIX separators on Windows, which breaks the stated deterministic output/path-normalization contract for downstream guards. Fixing that path normalization bug should make this step ready.

### Issues Found
1. **[scripts/tmux-reference-audit.mjs:141] [important]** — Path normalization is incorrect: `split("\\\\")` looks for double backslashes, so Windows paths remain like `extensions\taskplane\abort.ts` instead of normalized POSIX paths. This violates the Step 1 contract (`repo-relative POSIX-style paths`) and can cause cross-platform nondeterminism in Step 2 guard tests. **Fix:** normalize with single-backslash replacement (e.g., `relative(...).split("\\").join("/")` or `replaceAll(path.sep, "/")`).

### Pattern Violations
- Deterministic output contract is partially violated for `byFile[].file` / `functionalUsage.matches[].file` path formatting on Windows.

### Test Gaps
- No verification yet that audit output uses POSIX-style paths on Windows environments.
- No regression check that path formatting remains stable across platforms (Windows vs POSIX).

### Suggestions
- Minor cleanup: `basename` is imported but unused in `scripts/tmux-reference-audit.mjs`.
