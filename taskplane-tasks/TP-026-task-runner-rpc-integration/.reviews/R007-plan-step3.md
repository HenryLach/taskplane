## Plan Review: Step 3: Produce Structured Exit Diagnostic

### Verdict: APPROVE

### Summary
The Step 3 plan is now outcome-focused and aligned with the task requirements: it covers non-fatal exit summary ingestion, full `ExitClassificationInput` signal assembly, deterministic classification, and additive persistence compatibility for `exitDiagnostic`. It also resolves the prior telemetry-retention ambiguity by explicitly preserving sidecar/summary artifacts for dashboard consumers. This is sufficient to proceed with implementation.

### Issues Found
1. **[Severity: minor]** — Step 4 test bullets (`STATUS.md:67-72`) do not yet explicitly call out persistence compatibility assertions for `exitDiagnostic` (new field present vs absent in state/resume paths). Add one scenario to confirm additive schema behavior remains backward compatible.

### Missing Items
- Non-blocking: a short source-of-truth note for where `stallDetected` and `userKilled` are derived in task-runner runtime state would make code review faster.

### Suggestions
- Add a brief Step 3 design note mapping each `TaskExitDiagnostic` field to its source (exit summary, `.DONE`, kill reason flags, sidecar context%, STATUS metadata).
- Include one regression test that validates state-file validation/serialization when `exitDiagnostic` is undefined (legacy) and populated (new).
