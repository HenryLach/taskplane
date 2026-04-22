## Plan Review: Step 4: Tests

### Verdict: APPROVE

### Summary
The Step 4 plan is directionally correct and should achieve the intended outcome: align tests with removed legacy TMUX code, run the full suite, and resolve breakages. I spot-checked current failures and confirmed there are expected structural test breaks in files that still assert removed function signatures, which this plan explicitly covers. No blocking gaps were found.

### Issues Found
1. **[Severity: minor]** — `STATUS.md:43-45` omits the explicit PROMPT Step 4 outcome to “verify test count is reasonable” (`PROMPT.md:85`). This is not correctness-blocking, but adding it would better mirror the step acceptance criteria.

### Missing Items
- No blocking missing outcomes.

### Suggestions
- Explicitly call out `extensions/tests/orch-rpc-telemetry.test.ts` and `extensions/tests/crash-recovery-spawn-reliability.test.ts` as likely primary update targets (both currently reference removed signatures like `buildTmuxSpawnArgs`, `spawnLaneSession`, and legacy `spawnMergeAgent`).
- When removing obsolete assertions, retain coverage for still-valid helpers/behaviors (e.g., `resolveRpcWrapperPath`, V2 merge/lane paths, and remaining TMUX abort fallbacks).
- Record pre/post test counts in Step 4 notes to satisfy the “reasonable test count” check with a clear audit trail.
