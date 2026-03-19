## Plan Review: Step 3: Produce Structured Exit Diagnostic

### Verdict: REVISE

### Summary
The Step 3 checklist captures the core intent (read exit summary, classify, persist diagnostics), but it is still too high-level for a safe implementation in this codebase. Two key contracts are at risk: complete classification inputs and additive persistence compatibility for batch state records. The plan should be tightened around these outcomes before coding.

### Issues Found
1. **[Severity: important]** — Classification inputs are underspecified. `STATUS.md:56-57` says to read summary + call `classifyExit()`, but `classifyExit` requires additional signals (`timerKilled`, `stallDetected`, `userKilled`, `contextPct`) in `extensions/taskplane/diagnostics.ts:162-174`. Please add an explicit Step 3 outcome for how those signals are sourced (or defaulted) from task-runner runtime state/timers (see tmux timeout paths in `extensions/task-runner.ts:2053-2066`) so classifications like `wall_clock_timeout`/`context_overflow` are not silently degraded.
2. **[Severity: important]** — “Add `exitDiagnostic` to batch state task record” is not implementation-ready as currently written (`STATUS.md:58`). Current persisted task contracts still only carry `exitReason` (`extensions/taskplane/types.ts:1243-1261`), and persistence validation/serialization is keyed to that field (`extensions/taskplane/persistence.ts:510`, `extensions/taskplane/persistence.ts:783`). The plan needs an explicit additive-compatibility outcome for end-to-end propagation (runtime outcome → serialized state → validation/resume readers) while preserving legacy `exitReason`.
3. **[Severity: important]** — Telemetry artifact retention policy is ambiguous. `STATUS.md:59` says “clean up or preserve telemetry files,” but the prompt explicitly forbids deleting sidecar/summary artifacts before dashboard consumption unless configured (`PROMPT.md:97`, `PROMPT.md:148`). Add a concrete default policy and lifecycle point for cleanup vs preservation to avoid accidental data loss.

### Missing Items
- Explicit failure-path handling intent for missing/malformed/partial exit summary files (non-fatal read/parse path, deterministic fallback classification).
- Step-level test intent for classification signal mapping (especially timer-kill and high-context paths), not only “summary exists/missing”.
- A compatibility note confirming `/orch` subprocess execution paths remain untouched while adding diagnostic persistence.

### Suggestions
- Add a short Step 3 design note in `STATUS.md` mapping each `TaskExitDiagnostic` field to its source (exit summary, `.DONE`, runtime timers/state).
- Reuse existing `extensions/tests/exit-classification.test.ts` patterns and add integration tests that verify diagnostic fields are written into persisted task records without breaking legacy readers.
