## Code Review: Step 1: Verification Command Runner & Fingerprint Parser

### Verdict: REVISE

### Summary
The new `verification.ts` module is a strong start: command execution, normalization helpers, and set-based diffing are all present and readable. However, there is a blocking correctness gap in the vitest parser path that can silently treat real verification failures as passes. This needs to be fixed before Step 2 wiring, or merge-gate decisions can be wrong.

### Issues Found
1. **[extensions/taskplane/verification.ts:399] [critical]** — Non-zero vitest runs can return zero fingerprints and be treated as "no failures".
   - `parseTestOutput()` returns `vitestFingerprints` whenever parsing succeeds, even if that array is empty.
   - `parseVitestOutput()` only fingerprints failed assertions (`assertion.status === "failed"`) and ignores suite-level failures (`testResults[].status === "failed"` with empty `assertionResults`, message in `testResults[].message`).
   - Result: commands that fail due setup/import/runtime-at-file-load errors can produce `[]`, causing false "pass" behavior in baseline/post-merge diffing.
   - **Fix:** when `exitCode !== 0` and parsed vitest fingerprints are empty, emit a fallback `command_error` (or suite-level runtime fingerprint) using `testResults[].message`/stderr/stdout.

### Pattern Violations
- `taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:78-79` contains duplicate `R003` review rows. Minor bookkeeping issue; not blocking runtime behavior.

### Test Gaps
- No tests were added for the new parser/diff module yet.
- Missing coverage for the critical edge case above: vitest JSON with `success:false`, `testResults[].status:"failed"`, and empty `assertionResults`.
- Missing fallback normalization tests (malformed JSON, empty output, timeout/spawn-error fingerprints).

### Suggestions
- Add `extensions/tests/verification-baseline.test.ts` now for parser+diff pure functions (fast unit tests), even if merge-flow integration tests land in Step 2.
- Consider parsing suite-level vitest `message` into `runtime_error` fingerprints for better diagnostics than generic `command_error`.
