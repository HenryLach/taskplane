# R002 — Code Review (Step 1: Worker spawn reliability #335)

### Verdict: **REVISE**

I reviewed the step diff against baseline `92b60a3dd39579b4ac30a7867be71c84e6ee919e`, read the changed implementation/tests, and ran targeted test suites.

## What I checked
- Diff scope from baseline commit
- `extensions/task-runner.ts` (spawn/retry implementation)
- `extensions/taskplane/execution.ts` (stderr capture convention)
- `extensions/tests/crash-recovery-spawn-reliability.test.ts`
- Neighboring pattern tests (`extensions/tests/task-runner-rpc.test.ts`, `extensions/tests/orch-rpc-telemetry.test.ts`)

## Test runs
- ✅ `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/crash-recovery-spawn-reliability.test.ts`
- ✅ `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/task-runner-rpc.test.ts tests/orch-rpc-telemetry.test.ts`

---

## Blocking findings

### 1) Logged `-stderr.log` path is not actually produced by `spawnAgentTmux`
**Severity:** High (blocking)

`spawnAgentTmux()` now logs a diagnostic path like `...-stderr.log` on startup death/retry, but the worker/reviewer command in this function never redirects stderr to that file.

- Path is **logged** here:
  - `extensions/task-runner.ts:1951`
  - `extensions/task-runner.ts:1956`
  - `extensions/task-runner.ts:1985-1988`
- But command construction has no `2>>` redirect:
  - `extensions/task-runner.ts:1889-1911`

So the message points operators to a file that usually won’t exist, which undermines the stated Step 1 diagnostic requirement.

**Required fix:** either
1. append stderr redirection in `spawnAgentTmux` command construction (same quoting/pattern as execution.ts), or
2. stop claiming that path exists and log actionable diagnostics that are actually persisted.

---

## Non-blocking note

### 2) Delay path depends on external `sleep` command
`spawnAgentTmux` delay/poll waits use `spawnSync("sleep", ..., { shell: true })` at:
- `extensions/task-runner.ts:1941`
- `extensions/task-runner.ts:1948`
- `extensions/task-runner.ts:1960`
- `extensions/task-runner.ts:1978`

This works in environments with `sleep` on PATH (e.g., Git Bash), but is brittle as a reliability mechanism on Windows variants where that binary is missing. Consider a cross-platform internal wait utility for deterministic behavior.

---

## Summary
The retry structure and polling logic are directionally correct, but the key diagnostic contract is incomplete/misleading right now (logged stderr file path without corresponding stderr capture in this spawn path). Please address finding #1 before approval.
