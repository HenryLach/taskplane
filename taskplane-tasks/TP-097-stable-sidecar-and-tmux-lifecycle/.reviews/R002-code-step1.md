## Code Review: Step 1 — Stable sidecar identity (#354)

### Verdict: REVISE

### Summary
Worker-side stable sidecar wiring is mostly in place (`executeTask` precomputes a stable path + shared tail state and threads both into `runWorker`/`spawnAgentTmux`).

However, two important issues need correction before this should be considered complete/safe.

### Issues Found

1. **[Severity: important] Stable path fallback now applies to reviewer/fallback sessions too, which can replay old telemetry and double-count metrics.**
   - `spawnAgentTmux()` now generates deterministic paths when caller does not provide paths (`extensions/task-runner.ts:1880-1893`).
   - For reviewer paths that respawn with fresh tail state (e.g., persistent reviewer respawn/fallback), no shared tail offset is passed (`extensions/task-runner.ts:2692-2725`, `2905-2929`).
   - Because sidecar writes are append-only (`bin/rpc-wrapper.mjs:260-266`), a fresh tailer starting at offset 0 will re-read prior session events from the same file.
   - This changes prior behavior (per-spawn file separation) and can inflate reviewer tool/token telemetry and stale context signals.

   **Suggested fix:** Scope stable path reuse to the worker iteration flow only (where shared tail state is intentionally preserved), or when reusing paths without persisted offset initialize tail offset to EOF / rotate sidecar.

2. **[Severity: important] Orphan cleanup can send SIGTERM to arbitrary/self PID from sidecar `.pid` file without guardrails.**
   - `cleanupOrphanProcesses()` trusts PID file contents and kills whatever PIDs are listed (`extensions/task-runner.ts:2188-2205`).
   - There is no protection against `pid === process.pid`, stale PID reuse, or malformed/hostile pid-file content beyond type checks.
   - In worst case this can terminate the task-runner itself or an unrelated process if PID reuse occurs.

   **Suggested fix:** At minimum skip `process.pid`, dedupe PIDs, and add stronger validation (e.g., verify process command lineage when possible) before SIGTERM.

### Validation Performed
- Ran:
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/sidecar-tailing.test.ts tests/rpc-wrapper.test.ts tests/crash-recovery-spawn-reliability.test.ts`
- Result: pass (183/183)

### Notes
- The core worker-side Step 1 direction (generate once before loop + pass shared tail state) is implemented correctly.
- Please add focused regression tests for the two issues above once addressed.