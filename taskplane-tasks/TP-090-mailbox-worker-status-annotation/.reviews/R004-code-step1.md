# Code Review — TP-090 Step 1 (Steering-pending flag and STATUS.md injection)

## Verdict: APPROVE

## Scope reviewed
Diff base: `838035fa7aee62ca85640022130e5d6d8768a012..HEAD`

Implementation files reviewed:
- `bin/rpc-wrapper.mjs`
- `extensions/task-runner.ts`
- `extensions/tests/task-runner-rpc.test.ts`
- `templates/agents/task-worker.md`

Validation run:
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/rpc-wrapper.test.ts tests/task-runner-rpc.test.ts`
- Result: **PASS (150/150)**

---

## Resolution of prior blocking findings (R003)

1. **Steering timestamp fidelity fixed**
   - `task-runner` now uses the delivered message timestamp (`entry.ts`) when writing the execution-log row via `appendTableRow(...)`.
   - This resolves the previous mismatch where `logExecution(...)` used current poll time.

2. **Brittle return-shape test fixed**
   - `task-runner-rpc.test.ts` now uses `extractFunctionRegion(...)` instead of fixed source slicing windows.
   - This removes the regression caused by option-block growth in `spawnAgentTmux`.

---

## Additional checks

- Worker-only scoping of `--steering-pending-path` is correct.
- `rpc-wrapper` append behavior for `.steering-pending` is backward-compatible and fail-soft.
- Steering content sanitization for markdown table safety is present (newline collapse, `|` escaping, truncation).
- Poll-loop annotation placement is correctly before the `state.phase === "error"` early return.

Step 1 implementation is in good shape and ready to proceed to Step 2 testing/documentation work.
