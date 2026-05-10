## Code Review: Step 3: Implement Part 2 — no-retry for spawn failures

### Verdict: APPROVE

### Summary
The Step 3 changes correctly enforce the intended no-retry posture for `spawn_failure` outcomes. `attemptWorkerCrashRetry` now includes an explicit defense-in-depth early-return with a clear operator-facing log message, while still preserving the canonical retry gate via `TIER0_RETRYABLE_CLASSIFICATIONS`. I also verified the targeted tests pass (`tier0-watchdog.test.ts` + `runtime-model-fallback.test.ts`: 144/144).

### Issues Found
1. None.

### Pattern Violations
- None observed.

### Test Gaps
- No blocking gaps for this step. Optional: add a direct `spawn_failure` assertion in `tier0-watchdog.test.ts` in a later step to pin the new explicit early-return branch (currently behavior is still covered indirectly by the non-retryable-classification gate).

### Suggestions
- Quality-check pipeline note: no project-configured static quality commands (`typecheck` / `lint` / `format:check`) were discoverable via `.pi/taskplane-config.json` (not present) or `package.json` scripts, so these checks were not run.
