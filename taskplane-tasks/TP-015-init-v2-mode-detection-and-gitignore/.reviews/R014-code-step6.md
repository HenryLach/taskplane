## Code Review: Step 6: Testing & Verification

### Verdict: REVISE

### Summary
Step 6 adds substantial init-focused coverage and the new suite passes locally (`npx vitest run tests/init-mode-detection.test.ts`). However, the new Windows 8.3 path fix in `bin/taskplane.mjs` is not actually covered by the tests because the duplicated test helper has drifted from production logic. This leaves the key regression from this step unprotected.

### Issues Found
1. **[extensions/tests/init-mode-detection.test.ts:61-71] [important]** — `isGitRepoRoot()` in the test file no longer matches the production implementation in `bin/taskplane.mjs:771-789`. Production now normalizes `dir` via `fs.realpathSync.native(...)` to fix Windows 8.3 short-path mismatches, but the test helper still compares `resolve(toplevel) === resolve(dir)`. This means the new bug fix is not validated by the low-level mode-detection tests. **Fix:** update the duplicated helper to mirror production path normalization exactly (including guarded `realpathSync.native`) and add a regression test that exercises short-path vs long-path comparison behavior where possible.

### Pattern Violations
- Test-helper duplication is accepted in this repo, but this file currently violates the “keep mirrored helper logic in sync” expectation used in adjacent tests (same pattern as `gitignore-pattern-matching.test.ts`, but now out of sync with source behavior).

### Test Gaps
- No explicit automated regression case for the Windows short-name (`HENRYL~1`) mismatch that motivated the production fix.

### Suggestions
- Add one CLI-level Windows-only (or conditionally skipped) regression that runs `init --dry-run` from a short-path alias to prove end-to-end mode detection correctness.
