## Code Review: Step 1: Verification Command Runner & Fingerprint Parser

### Verdict: REVISE

### Summary
The new `verification.ts` module establishes a solid foundation (typed command results, normalization helpers, adapter-style parsing, and set-based diffing). However, there is a correctness bug in failure parsing that can drop real command failures and let them appear as “no failures,” which is unsafe for merge-gate decisions. This needs to be fixed before Step 1 can be considered complete.

### Issues Found
1. **[extensions/taskplane/verification.ts:397-401] [critical]** — Non-zero command exits can incorrectly produce zero fingerprints.
   - `parseTestOutput()` returns `vitestFingerprints` whenever parsing succeeds, even if that array is empty.
   - This happens for valid vitest JSON where `success=false` but `testResults` has no failed assertions (e.g., no tests found, coverage/config/runtime-level failure represented outside assertion failures). In that case, a failed verification command becomes indistinguishable from success in fingerprint diffing.
   - **Fix:** For `exitCode !== 0`, treat `parseVitestOutput(...)` results as authoritative only when at least one fingerprint is produced. If parsing returns `null` **or an empty array**, emit fallback `command_error` fingerprint from `stderr || stdout || "Command failed with no output"`.

### Pattern Violations
- `taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:80-81` duplicates the same review row (`R003`) twice; status ledger should stay deduplicated for operator clarity.

### Test Gaps
- Missing unit test for `parseTestOutput()` where `exitCode !== 0` and vitest JSON parses successfully but has no failed assertions (`testResults: []` / `success:false`) — should yield a `command_error` fingerprint.
- Missing test for malformed/non-JSON fallback path asserting fingerprint is non-empty and normalized.

### Suggestions
- Add a small table-driven test suite for `parseTestOutput` covering: success(0), failed+vitest failures, failed+parseable empty vitest result, failed+malformed JSON, and spawn/timeout error.
