## Plan Review: Step 1: Dashboard Server — Serve Telemetry Data

### Verdict: REVISE

### Summary
The Step 1 plan captures the high-level outcomes from the prompt, but it is still too thin on risk handling for incremental JSONL ingestion and lane attribution. Given the existing dashboard shape (`laneStates` keyed by tmux prefix) and the new `.pi/telemetry/*.jsonl` naming contract, the plan needs explicit guardrails to avoid incorrect aggregation or double counting. It also needs a concrete test/verification intent for the new server-side parsing path.

### Issues Found
1. **[Severity: important]** — Incremental tailing requirements are underspecified. `PROMPT.md:66` requires tracked read offsets per file, but `STATUS.md:27-31` does not define tail-state lifecycle (offset + partial line buffering + file truncation/recreation handling). Add a plan outcome to maintain per-file tail state and handle malformed/partial JSONL lines similar to existing sidecar parsing robustness (`extensions/task-runner.ts:1164-1227`).
2. **[Severity: important]** — Lane attribution/aggregation strategy is missing. Current dashboard data is keyed by lane tmux prefix (`dashboard/server.cjs:198-214`), while telemetry files are named by lane number + role and may produce multiple files per lane over time (`extensions/task-runner.ts:1488-1533`). Add a plan item defining how telemetry files map to `batch.lanes[*].tmuxSessionName` (including custom prefixes from `TASK_RUNNER_TMUX_PREFIX`, `extensions/taskplane/execution.ts:193`) and how worker/reviewer files are merged without duplication.
3. **[Severity: important]** — No explicit Step 1 verification intent is documented. Even though full validation is in Step 3, this plan lacks concrete server-side scenarios to validate (missing telemetry dir, malformed JSONL line, retry start/end toggling, compaction increments, batch cost sum across lanes/roles per roadmap `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:333-343`). Add these as planned checks so implementation is testable, not just code-complete.

### Missing Items
- Explicit additive API contract for Step 1 response payload (where telemetry fields and batch total cost live) while preserving existing `laneStates` consumers.
- File lifecycle handling policy for telemetry files that disappear/rotate between polls (cleanup stale tail state).
- A clear no-regression guardrail that existing lane-state-driven stats remain available when telemetry sidecars are absent (pre-RPC sessions).

### Suggestions
- Reuse the same event interpretation rules already implemented in `tailSidecarJsonl` (message/tool/retry semantics) to avoid parser drift between task-runner and dashboard.
- Record Step 1 design decisions in `STATUS.md` Discoveries/Notes with file+line anchors before implementation starts.
