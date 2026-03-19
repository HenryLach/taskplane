## Plan Review: Step 2: Build RPC Wrapper Script

### Verdict: REVISE

### Summary
The Step 2 checklist covers the major wrapper capabilities, but the current plan is still missing a few outcome-level decisions that are needed for deterministic behavior and clean integration with Step 1 diagnostics types. Most importantly, the exit-summary contract is currently ambiguous, and lifecycle finalization behavior is not explicit enough for crash/signal paths. Tightening these points now will reduce rework in Step 3 tests.

### Issues Found
1. **[Severity: important]** — `PROMPT.md:93` requires the wrapper summary to include `classification`, but `extensions/taskplane/diagnostics.ts:122-143` defines `ExitSummary` without that field. The Step 2 plan in `STATUS.md:44-51` does not state which schema is authoritative. **Suggested fix:** add an explicit Step 2 outcome to reconcile the contract (either include `classification` in `ExitSummary` + tests, or make `classifyExit()` the sole source and remove classification from wrapper summary requirements).
2. **[Severity: important]** — `STATUS.md:50-51` mentions exit summary writing and crash handling, but does not explicitly require idempotent finalization across all termination paths (`close`, `error`, SIGINT/SIGTERM abort flow). For this wrapper, “summary written exactly once” is a recoverability requirement, not an implementation detail. **Suggested fix:** add a plan item for single-write finalization semantics and precedence rules for `exitCode`/`exitSignal`/`error` when multiple handlers fire.
3. **[Severity: minor]** — The plan references JSONL framing (`STATUS.md:46`) but does not explicitly include the receive-side buffering edge cases already called out in preflight (`STATUS.md:139-144`): chunk-split lines, optional `\r`, and malformed trailing JSON. **Suggested fix:** add explicit parsing outcome language so protocol correctness is testable and deterministic.

### Missing Items
- Explicit schema-alignment decision between `PROMPT.md` Step 2 summary fields and `diagnostics.ts` `ExitSummary` contract.
- Explicit “write exit summary exactly once” outcome for normal exit, crash, and signal-abort paths.
- Explicit test-intent linkage for RPC framing edge cases and crash-without-`agent_end` behavior.

### Suggestions
- Reuse the existing line-buffer JSON parsing pattern in `extensions/task-runner.ts:910-975` (append chunk → split on `\n` → keep trailing buffer) to avoid framing regressions.
- Add one contract test that validates the exact exit-summary JSON shape consumed by `classifyExit()`.
