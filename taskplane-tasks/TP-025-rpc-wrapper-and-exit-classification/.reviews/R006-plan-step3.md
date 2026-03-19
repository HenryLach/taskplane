## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 checklist covers the broad test categories from the prompt, but it is still too coarse for the highest-risk behaviors introduced in Step 2. In particular, the plan does not yet make precedence, lifecycle, and protocol-edge outcomes explicit enough to guarantee deterministic verification. Tightening those outcomes will reduce the chance of shipping telemetry regressions that only appear under crash/signal conditions.

### Issues Found
1. **[Severity: important]** — The plan item in `STATUS.md:58` says “Unit tests for classifyExit()” but drops the explicit “all 9 classification paths” requirement from `PROMPT.md:104`, and does not call out precedence collisions from `extensions/taskplane/diagnostics.ts:230-310`. **Suggested fix:** make the outcome explicit as a matrix that covers all 9 classes plus precedence tie-cases (e.g., `.DONE` vs retries, timer kill vs non-zero exit, stall vs user-killed).
2. **[Severity: important]** — The Step 3 plan in `STATUS.md:60-61` does not explicitly verify the single-write finalization/lifecycle behavior added in `bin/rpc-wrapper.mjs:482-546` and signal forwarding in `bin/rpc-wrapper.mjs:559-589`. **Suggested fix:** add a required test outcome that proves exit summary is written exactly once across overlapping close/error/signal paths, with deterministic precedence for `exitCode`/`exitSignal`/`error`.
3. **[Severity: important]** — Redaction testing is underspecified relative to the task’s hard requirement not to persist secrets in either sidecar or summary (`PROMPT.md:150`). Current Step 3 wording (`STATUS.md:59`) does not explicitly include summary redaction assertions, while summary fields include error/retry text (`bin/rpc-wrapper.mjs:502-517`). **Suggested fix:** add explicit coverage that secret-like values are sanitized in both sidecar JSONL and exit summary JSON outputs.

### Missing Items
- Explicit protocol-edge test intent for JSONL framing guarantees already identified in preflight (`STATUS.md:144`) and implemented in `bin/rpc-wrapper.mjs:243-276` (chunk-split lines, optional `\r`, trailing partial line).
- A deterministic integration-test strategy for mocking `pi` (e.g., PATH-injected fake executable) so Step 3 is not dependent on live CLI behavior.
- Crash-without-`agent_end` verification outcome (required by `PROMPT.md:107` and implemented in `bin/rpc-wrapper.mjs:534-537`).

### Suggestions
- Keep one table-driven test file for classification precedence and one process-level fixture test for wrapper lifecycle; this keeps failures interpretable.
- Add one “golden” integration assertion for exact summary shape consumed by `ExitSummary` to protect TP-026 integration.
