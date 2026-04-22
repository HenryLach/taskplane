## Code Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The new `classifyExit()` coverage is strong and table-driven, and the suite does pass (`cd extensions && npx vitest run`). However, the `rpc-wrapper` “integration” portion is currently a no-op and does not verify the required sidecar/summary artifacts. The step is marked complete, but key lifecycle behaviors in `bin/rpc-wrapper.mjs` (single-write finalization and termination-path handling) are still unverified.

### Issues Found
1. **[extensions/tests/rpc-wrapper.test.ts:578-663] [important]** — The integration test does not execute `rpc-wrapper.mjs` and performs no assertions on output artifacts. It creates temp files and a mock script, then exits after cleanup; comments at lines 657-659 explicitly state the real integration path is not implemented.  
   **Fix:** Actually run `node bin/rpc-wrapper.mjs ...` with a controlled mock `pi` executable/script (e.g., PATH override or shim), then assert sidecar JSONL entries and exit summary JSON contents.
2. **[extensions/tests/rpc-wrapper.test.ts:1-8, bin/rpc-wrapper.mjs:588-650,711-717] [important]** — The test file claims coverage for “exit summary accumulation (token totals, retry aggregation, single-write guard)” but does not test `writeExitSummary`-driven lifecycle outcomes at all. This leaves regressions unprotected in the newly changed finalization paths (`close`/`error` handlers, exit code normalization, single-write guard).  
   **Fix:** Add process-level tests that drive scripted event streams and termination scenarios (normal close, spawn error, crash without `agent_end`, signal path) and assert: (a) correct token/retry aggregation, (b) summary written exactly once, (c) normalized `exitCode` behavior.

### Pattern Violations
- `extensions/tests/rpc-wrapper.test.ts` contains placeholder/dead integration scaffolding (unused `execFile`, `promisify`, `readFileSync`, `existsSync`) rather than executable verification.

### Test Gaps
- No artifact assertions for sidecar/summary in a true wrapper subprocess run.
- No validation of single-write behavior when multiple termination handlers race.
- No tests for spawn-failure fallback (`proc.on("error")`) summary semantics.
- No tests for close-path exit-code normalization (`null`/invalid code → wrapper `process.exitCode = 1`).

### Suggestions
- Consider extracting lifecycle/summary accumulation into a small pure helper module so unit tests can cover aggregation and single-write behavior without brittle subprocess orchestration.
- Keep one real subprocess integration test (mock `pi`) to verify end-to-end wiring and file artifacts.
