## Plan Review: Step 1: Register orch_start Tool

### Verdict: REVISE

### Summary
The direction is mostly correct: extracting `doOrchStart()` and routing `/orch <target>` through it is the right foundation for sharing command/tool behavior. However, the current plan (as reflected in STATUS + helper draft) misses a required outcome from the task prompt: the tool ACK contract (batch ID + task count + wave count) and explicit handling for invalid/empty target input in the tool path. Those need to be explicit before implementation is considered complete.

### Issues Found
1. **[Severity: important]** — Required ACK fields are not planned concretely.
   - `doOrchStart()` currently returns a generic success string (`extension.ts`, around `doOrchStart` return) and does not include batch ID, task count, or wave count, even though the step requirements call for that immediate ACK shape.
   - Suggested fix: decide and document how to provide these fields deterministically at start time (e.g., synchronous pre-discovery for counts, or explicit two-phase ACK contract if immediate counts are unavailable), then implement consistently for both `/orch` and `orch_start`.

2. **[Severity: important]** — Tool input guard behavior is under-specified.
   - Step requirements call out guards for invalid target / no tasks. The helper currently assumes `target` is valid and defers failures to deeper execution paths.
   - Suggested fix: make plan explicit that `orch_start(target)` must validate non-empty/trimmed target and return a descriptive tool response for bad input before launching.

### Missing Items
- Explicit plan item for the `orch_start` ACK payload/summary requirements (batch ID, task count, wave count).
- Explicit plan item for target normalization/validation (`target.trim()`, empty string handling, invalid target messaging) on the tool entry path.

### Suggestions
- Keep `/orch` no-args routing untouched (already done) and restrict helper sharing to the start path only.
- When registering `orch_start`, mirror the existing TP-053 tool style (`description`, `promptSnippet`, `promptGuidelines`, try/catch wrapper) so Step 3 source-based tests are straightforward.