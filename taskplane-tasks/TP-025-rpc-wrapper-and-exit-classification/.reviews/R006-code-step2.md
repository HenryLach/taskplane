## Code Review: Step 2: Build RPC Wrapper Script

### Verdict: REVISE

### Summary
The wrapper covers most of the Step 2 surface (arg parsing, JSONL buffering, sidecar writing, and single-write summary guards), but there are two blocking runtime issues and one security gap. In its current form, the child process lifecycle is not deterministic (can hang after `agent_end`), and process spawning is not cross-platform-safe in this repo’s Windows environment. Summary redaction is also incomplete, which violates the task’s “no unredacted secrets in sidecar or summary” requirement.

### Issues Found
1. **[bin/rpc-wrapper.mjs:368,444-447,530-541] [critical]** — The wrapper never closes `proc.stdin` after sending the prompt, so `pi --mode rpc` can remain alive indefinitely after `agent_end` (RPC mode waits for more commands while stdin stays open). This can prevent `close` from firing, so exit summaries and downstream classification may never complete. **Fix:** close stdin at a deterministic terminal point (e.g., on `agent_end` / terminal `response` error) while still keeping abort behavior during active runs.
2. **[bin/rpc-wrapper.mjs:360-363] [critical]** — `spawn("pi", ...)` is used without `shell: true` (or explicit platform handling). In this Windows worktree, that resolves to `spawn pi ENOENT` from Node even though `pi` works in shell sessions (`pi.cmd`/shim resolution difference). This makes the wrapper unusable in the current target environment. **Fix:** follow the existing project spawn pattern (see `extensions/task-runner.ts:900-905`, `shell: true`) or resolve an explicit executable path (`pi.cmd` on win32).
3. **[bin/rpc-wrapper.mjs:502-517,394-411] [important]** — Exit summary fields are written without redaction (`error`, `lastToolCall`). `lastToolCall` is built from raw tool args, and `error` can carry token-like strings; both are persisted directly. This violates the redaction requirement for both sidecar and summary artifacts. **Fix:** apply the same redaction pipeline to summary fields before serialization (at minimum `error` and `lastToolCall`; ideally full summary object).

### Pattern Violations
- Diverges from established subprocess spawning pattern in `extensions/task-runner.ts` (`shell: true`), causing platform inconsistency.
- Redaction policy is applied to sidecar events but not consistently to all persisted telemetry artifacts (summary file).

### Test Gaps
- No test proving the wrapper exits after `agent_end` (and writes summary) when RPC stdin would otherwise remain open.
- No test for Windows spawn behavior (`pi` shim / `pi.cmd` resolution).
- No test asserting summary redaction for `error` and `lastToolCall` fields.

### Suggestions
- Add a focused integration test with a mock RPC child that emits `agent_end` and then waits for EOF; assert wrapper closes stdin and exits.
- Add a helper `redactSummary(summary)` and unit-test it alongside `redactEvent()`.
