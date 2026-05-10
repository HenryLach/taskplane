## Code Review: Step 3: Cluster C — `taskplane doctor` empty pi version

### Verdict: REVISE

### Summary
The core fix direction is correct: `getVersion()` now captures both stdout and stderr, and manual `taskplane doctor` output shows `pi`'s version as intended. However, the switch from `execSync` to `spawnSync` introduced a regression in failure handling: non-zero command exits are now treated as version text instead of `null`. I did not run typecheck/lint/format checks because this repo/worktree does not declare any matching quality-check commands in `.pi/taskplane-config.json` (missing) or `package.json` scripts.

### Issues Found
1. **[bin/taskplane.mjs:146-155, 3094-3095] [important]** — `getVersion()` now returns stderr even when the subprocess fails (non-zero exit), because `spawnSync` does not throw on command failure. Previously `execSync` would throw and `getVersion()` returned `null` on failure. This can surface shell error text as a fake version (notably in `cmdVersion()`, which calls `getVersion("pi")` without a `commandExists` guard). Suggested fix: gate success before stream selection, e.g. `if (result.error || result.status !== 0) return null;` then apply stdout-first/stderr-fallback only for successful exits.

### Pattern Violations
- None.

### Test Gaps
- `extensions/tests/cli-doctor-version-capture.test.ts` only performs source-pattern assertions. Add one behavioral regression test for failure semantics (e.g., simulated non-zero `spawnSync` result) to ensure `getVersion()` returns `null` instead of stderr error text.

### Suggestions
- Consider extracting `getVersion()` into a small testable helper module so future changes can use behavioral tests instead of source-pattern matching.
