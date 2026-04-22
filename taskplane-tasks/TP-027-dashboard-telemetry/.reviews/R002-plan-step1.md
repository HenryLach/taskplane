## Plan Review: Step 1: Dashboard Server — Serve Telemetry Data

### Verdict: REVISE

### Summary
The Step 1 plan covers the required high-level outcomes from `PROMPT.md`, but it is still missing a few outcome-level details needed to make implementation safe and testable. The current checklist in `STATUS.md:27-31` does not yet define how incremental JSONL tailing state is managed over time, or how telemetry is attributed to the exact lane keys the frontend already expects. Tightening those points now will reduce rework in Step 2.

### Issues Found
1. **[Severity: important]** — Incremental read lifecycle is underspecified for a polling server. `PROMPT.md:65-67` requires per-file incremental reads, but `STATUS.md:27` only states “Read sidecar JSONL files incrementally” without defining tail-state behavior (offset + partial trailing line + file reset/truncation handling). Given `buildDashboardState()` is called every poll (`dashboard/server.cjs:217-261`), add an explicit plan outcome for persistent per-file tail state and stale-file cleanup, modeled after existing sidecar tail robustness (`extensions/task-runner.ts:1164-1217`).
2. **[Severity: important]** — Lane attribution strategy is not explicit. The frontend currently resolves lane data by `lane.tmuxSessionName` (`dashboard/public/app.js:436`), while telemetry filenames are lane/role-oriented and can produce multiple files over time (`extensions/task-runner.ts:1488-1533`), and session naming includes repo context in workspace mode (`extensions/taskplane/waves.ts:508-512`). Add a plan item that defines the canonical server keying/merge rule so telemetry lands on the correct lane without duplication.
3. **[Severity: important]** — API payload contract for new telemetry fields is missing. Step 1 says telemetry should be included in the status response (`PROMPT.md:69`), but the plan does not specify where additive fields will live alongside current response shape (`dashboard/server.cjs:238-260`) or how no-telemetry sessions preserve existing behavior. Add an explicit response-shape outcome (including batch total cost field) to keep Step 2 integration deterministic.

### Missing Items
- Explicit verification intent for Step 1 parser/server behavior (missing telemetry dir, malformed JSONL line, retry start/end toggling, compaction increments, and batch cost rollup behavior).
- A no-regression contract that existing `laneStates`-driven stats remain available for pre-RPC sessions.

### Suggestions
- Reuse the event interpretation already established in `tailSidecarJsonl()` (`extensions/task-runner.ts:1234-1285`) to avoid parser drift.
- Record the planned telemetry response schema in `STATUS.md` Notes before implementation to align Step 1 and Step 2.
