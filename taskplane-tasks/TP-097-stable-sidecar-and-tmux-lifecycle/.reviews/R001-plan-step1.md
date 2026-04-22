## Plan Review: Step 1: Stable sidecar identity (#354)

### Verdict: REVISE

### Summary
The Step 1 plan captures the core direction (move sidecar path generation to the caller and preserve tail state), but it currently omits several required outcomes from PROMPT.md that are necessary to fully resolve #354. In particular, the deterministic identity contract and required spawn parameter threading are not explicitly covered.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include making `sidecarPath` **and** `exitSummaryPath` required `spawnAgentTmux()` inputs (instead of internal generation). This is a required Step 1 outcome and should be called out directly.
2. **[Severity: important]** — The plan does not explicitly commit to generating the sidecar path once per session using the stable identity key (`{opId}-{batchId}-{repoId}-{taskId}-{lane}-{role}`). Without this, the fix can still regress into per-iteration or per-attempt path drift.
3. **[Severity: important]** — The plan does not explicitly state that the same sidecar file must be reused/appended across iterations. This is distinct from moving generation to caller and should be explicit to guarantee telemetry continuity.

### Missing Items
- Explicit outcome: `spawnAgentTmux()` signature now requires `sidecarPath` and `exitSummaryPath` from caller.
- Explicit outcome: one-time sidecar identity generation using the stable key components.
- Explicit outcome: guaranteed reuse of the same sidecar path across all iterations in a task session.

### Suggestions
- Keep current concise plan style, but add the missing outcomes above as outcome-level checkboxes so code review can verify them unambiguously.
- Optionally note where tail-state continuity is threaded (iteration loop variable ownership) to reduce implementation ambiguity.