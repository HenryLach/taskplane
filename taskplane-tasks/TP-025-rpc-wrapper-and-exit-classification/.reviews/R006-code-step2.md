## Code Review: Step 2: Build RPC Wrapper Script

### Verdict: REVISE

### Summary
The wrapper covers most Step 2 outcomes (JSONL framing, sidecar capture, single-write summary, signal forwarding), but there are a few integration bugs that will break or weaken real runs. The most significant are incorrect Pi CLI argument mapping for tools and Windows/subprocess spawn behavior. There is also a telemetry hygiene gap where summary fields can still persist unredacted sensitive data.

### Issues Found
1. **[bin/rpc-wrapper.mjs:350-352] [important]** — Tools are forwarded as repeated `--tool` flags, but Taskplane/Pi CLI patterns use `--tools <comma-list>`. This means configured tool restrictions are not applied correctly (and can be ignored/misparsed). **Fix:** pass one `--tools` argument (e.g., `piArgs.push("--tools", args.tools.join(","))`) to match existing usage in `extensions/task-runner.ts`.
2. **[bin/rpc-wrapper.mjs:360-363] [important]** — `spawn("pi", ...)` without shell/Windows handling fails with `ENOENT` in this environment (wrapper immediately writes spawn-error summary). Existing Taskplane spawn paths use `shell: true` for portability. **Fix:** align spawn strategy with existing patterns (at minimum platform-aware executable resolution for Windows, or `shell: true` with safe argument handling).
3. **[bin/rpc-wrapper.mjs:134-160, 409-410, 515-516] [important]** — Redaction is only applied to selected sidecar event fields and not to summary strings. `lastToolCall` and `error` are written unredacted, so secrets can still be persisted in exit summary (violates telemetry hygiene requirement for sidecar/summary artifacts). **Fix:** apply the same redaction helpers to summary fields before write, and redact event payloads more comprehensively (not just `args/result/error*`).
4. **[bin/rpc-wrapper.mjs:608-612] [minor]** — Wrapper exit code is set directly from child `close` code, which can be negative on spawn errors (observed as large unsigned process exit values). **Fix:** normalize non-finite/negative/null child codes to `1`.

### Pattern Violations
- Wrapper diverges from established Taskplane Pi spawn conventions in `extensions/task-runner.ts` (`--tools` usage and Windows-safe subprocess invocation).

### Test Gaps
- No validation yet for `--tools` forwarding contract to Pi.
- No regression test for spawn-error path on Windows/ENOENT.
- No test asserting redaction of exit-summary fields (`error`, `lastToolCall`) in addition to sidecar entries.

### Suggestions
- Add a small black-box test with a mock Pi binary to assert exact spawned argv and summary shape.
- Reuse one redaction pipeline for both sidecar entries and final summary to avoid drift.
