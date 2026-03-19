## Plan Review: Step 1: Define TaskExitDiagnostic Type & Classification Logic

### Verdict: APPROVE

### Summary
The Step 1 plan is now outcome-focused and materially improved: it defines the 9-value `ExitClassification` contract, introduces a structured `ExitClassificationInput`, and commits to explicit precedence in `classifyExit()`. This addresses the earlier determinism and contract-shape gaps and is sufficient to move into implementation. The added JSDoc precedence table and barrel re-export also reduce downstream integration drift.

### Issues Found
1. **[Severity: minor]** — `taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/STATUS.md:33` includes `user_killed` in precedence order, but collision behavior with `process_crash`/`wall_clock_timeout` is still implicit. Keep this deterministic in implementation comments/tests so `user_killed` is not accidentally shadowed by generic non-zero-exit handling.

### Missing Items
- None blocking for Step 1.

### Suggestions
- In Step 3 tests, include at least one precedence-collision case (e.g., non-zero exit + `userKilled=true`) to lock in intended behavior.
- Keep `ExitClassification` as the return type for `classifyExit()` so downstream code can stay exhaustively type-checked.
