## Plan Review: Step 2: Stderr capture

### Verdict: APPROVE

### Summary
The Step 2 plan covers the required outcomes from PROMPT.md: persisting engine-worker stderr to a batch-scoped file, preserving terminal visibility via tee behavior, and surfacing stderr tail data in supervisor failure alerts. The scope is focused and consistent with the existing extension.ts failure/alert flow. I don’t see any blocking gaps that would prevent the step from meeting its objective.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- Define a fixed stderr-tail cap (for example 2–4KB) in the implementation plan text so alert payload size is deterministic.
- Call out non-fatal handling for log-stream write errors (warn/continue) so diagnostics never block engine failure handling.
- Ensure the plan explicitly includes creating `.pi/telemetry/` if missing before opening the batch log file.
