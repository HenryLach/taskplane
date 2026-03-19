## Plan Review: Step 2: Read Sidecar Telemetry During Polling

### Verdict: REVISE

### Summary
The Step 2 checklist captures the high-level intent from the prompt (incremental sidecar tailing, token/cost parsing, retry awareness). However, it is still missing key outcome details needed to reliably achieve telemetry parity in tmux mode and to make the data actually visible to current dashboard consumers. Tightening those outcomes now will reduce the risk of implementing a parser that works internally but does not surface actionable telemetry.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly cover **context% telemetry**, even though the mission requires tmux parity for context utilization (`PROMPT.md:29-31`). The Step 2 list in `STATUS.md:43-48` only mentions tokens/cost/retries. Add an explicit outcome for deriving and updating context percentage from telemetry (for dashboard/runtime visibility and Step 3 classification inputs).
2. **[Severity: important]** — “Make telemetry data available for dashboard” is currently underspecified (`STATUS.md:47`). In this codebase, the dashboard reads lane telemetry from `writeLaneState()` fields (`extensions/task-runner.ts:307-329`), while tmux polling currently only waits on `tmux has-session` (`extensions/task-runner.ts:1288-1297`). Add a concrete plan outcome for how parsed sidecar events will flow into existing state fields (and any new retry fields), so updates are observable without changing `/orch` paths.
3. **[Severity: important]** — The incremental-tail plan does not call out handling of **partial JSONL lines** when reading by byte offset (`PROMPT.md:82`, `STATUS.md:43-44`). Without a carry-buffer strategy, poll ticks can split a JSON object across reads and either drop or misparse events. Add a risk-mitigation item for incomplete-line buffering (and safe skip/log behavior for malformed lines).

### Missing Items
- Step-level outcome describing how retry activity is represented in runner state/lane-state payloads (not just detected internally).
- Explicit Step 2 test coverage intent for incremental tail edge cases (partial line across polls, missing file on early polls, malformed event line).
- A no-change guardrail reminder that `/orch` polling in `extensions/taskplane/execution.ts` remains untouched while implementing tmux telemetry in `extensions/task-runner.ts`.

### Suggestions
- Reuse the existing subprocess token accumulation semantics (per-turn additive updates) to avoid dashboard metric drift between spawn modes.
- Add a short Step 2 design note in `STATUS.md` naming the telemetry flow path (poll loop → task state → lane-state sidecar) so later code review can validate outcomes quickly.
