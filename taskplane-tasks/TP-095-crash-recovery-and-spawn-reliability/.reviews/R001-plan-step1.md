# R001 — Plan Review (Step 1: Worker spawn reliability #335)

### Verdict: REVISE

Step 1 intent is correct, but the plan artifact is still too underspecified for deterministic implementation and verification.

## Reviewed artifacts
- `taskplane-tasks/TP-095-crash-recovery-and-spawn-reliability/PROMPT.md`
- `taskplane-tasks/TP-095-crash-recovery-and-spawn-reliability/STATUS.md`
- `extensions/task-runner.ts` (spawn path + tmux lifecycle)
- `extensions/taskplane/execution.ts` (stderr capture pattern)
- `extensions/tests/task-runner-rpc.test.ts` (spawnAgentTmux source-contract tests)

## Blocking findings

### 1) Step 1 checklist in STATUS drops required acceptance details
`PROMPT.md` defines concrete behavior (3x `has-session` poll @ 200ms, max 2 spawn retries, and stderr-path logging) (`PROMPT.md:70-72`), but `STATUS.md` currently compresses this into two broad items (`STATUS.md:24-25`).

That loses contract precision and makes it easy to “complete” Step 1 without matching the numeric retry/timing requirements.

### 2) Stderr-path requirement is not concretely planned
The Step 1 requirement explicitly says to log the stderr output path on startup failure (`PROMPT.md:72`).

In the worker spawn path, the telemetry artifacts are already deterministic (`sidecarPath`, `exitSummaryPath` in `task-runner.ts` around `1860+`), but there is no explicit Step 1 plan item defining the stderr filename derivation convention. Use the existing lane pattern from `execution.ts` (`.jsonl -> -stderr.log`, `execution.ts:611-615`) so the logged path is exact and machine-derivable.

### 3) No explicit test strategy for startup-flake recovery behavior
Step 1 changes are control-flow-heavy and timing-sensitive. The plan should explicitly include how this is tested without relying on real tmux flakiness (mocked `spawnSync` sequence / source-contract assertion additions in the task-runner RPC tests).

Without that, regressions are likely and difficult to reproduce.

## Required plan updates before implementation
1. Expand Step 1 in `STATUS.md` into explicit checklist items matching `PROMPT.md` contract:
   - verification poll count/interval,
   - max retry count,
   - failure logging content including stderr path.
2. Define stderr log path convention for worker sessions (recommended: derive from sidecar basename as `-stderr.log`, aligned with `execution.ts`).
3. Add Step 1 test bullets now (to be executed in Step 5):
   - startup verification success on first try,
   - retry path when first spawn dies,
   - terminal failure after max retries,
   - emitted diagnostic includes concrete stderr log path.
4. Record whether Step 1 applies to both worker and reviewer invocations of `spawnAgentTmux` (same function) or worker-only, to avoid accidental behavior drift.

## Non-blocking note
- There is a state mismatch: this request is for “Step 1 being planned,” but `STATUS.md` already marks Step 1 complete and current progress at Step 5 (`STATUS.md:3`, `STATUS.md:21-25`). Aligning status sequencing will improve review traceability.
