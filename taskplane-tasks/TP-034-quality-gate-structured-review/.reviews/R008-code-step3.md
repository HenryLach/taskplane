## Code Review: Step 3: Remediation Cycle

### Verdict: REVISE

### Summary
The remediation loop is largely in place (feedback generation, fix-agent invocation, and re-review), and the core `.DONE` gating behavior remains correct. However, two reliability gaps remain in fix-agent execution semantics, especially in TMUX mode. These gaps break the stated deterministic handling for timeout/crash paths and can misreport failed fix attempts as successful.

### Issues Found
1. **[extensions/task-runner.ts:2741, 2791-2824] [important]** — Timeout handling is documented but not implemented for the fix agent. `doQualityGateFixAgent()` claims timeout paths are handled, but unlike `doWorkIteration()` it sets no wall-clock timers and passes no context/wrap-up kill controls to `spawnAgent()`, so a hung fix run can block indefinitely. **Fix:** add explicit timeout enforcement (warn + hard kill) for both subprocess and TMUX fix runs, and return non-zero when timeout kills the agent.
2. **[extensions/task-runner.ts:2795-2834, 1436, 1671-1673] [important]** — TMUX fix-agent abnormal exits are not reliably detected. In TMUX mode, `spawnAgentTmux()` reports `exitCode: 0` on normal session end regardless of underlying Pi process exit, but `doQualityGateFixAgent()` uses that exit code to classify success/failure. This can log crashed/non-zero runs as “completed”. **Fix:** consume `exitSummaryPath` (as done in worker flow) or propagate wrapper exit code from `spawnAgentTmux()` so TMUX fix cycles can be classified deterministically.

### Pattern Violations
- `doQualityGateFixAgent()` comments promise deterministic timeout/crash handling, but implementation currently lacks timeout enforcement and TMUX exit classification parity with the worker path.

### Test Gaps
- No tests covering fix-agent timeout behavior.
- No TMUX-path test validating that fix-agent crashes/non-zero exits are logged and treated as failed fix attempts.
- No regression test for remediation-loop behavior when fix agent hangs or exits abnormally before producing changes.

### Suggestions
- Reuse the existing worker timeout/kill scaffolding in `doQualityGateFixAgent()` to keep behavior consistent.
- Add a small helper to normalize subprocess/TMUX result classification into a single `FixAgentOutcome` type to avoid drift.
