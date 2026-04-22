## Code Review: Step 1: Define TaskExitDiagnostic Type & Classification Logic

### Verdict: REVISE

### Summary
The new `extensions/taskplane/diagnostics.ts` module is a solid foundation: it introduces the required exit-classification union, structured input contract, deterministic precedence, and barrel export wiring. However, there are two contract-level issues that will cause integration drift in Step 2/3 if left as-is: token shape mismatch against the RPC summary spec, and partial-summary handling that can misclassify exits as crashes. These should be fixed before building the wrapper/parser on top.

### Issues Found
1. **[extensions/taskplane/diagnostics.ts:12,100,169 + extensions/taskplane/types.ts:1643] [important]** — `diagnostics.ts` reuses `TokenCounts` from `types.ts`, but that interface requires `costUsd`. The TP-025 exit-summary contract defines `tokens` as `{input, output, cacheRead, cacheWrite}` and keeps `cost` as a separate top-level field. This currently makes `ExitSummary.tokens`/`TaskExitDiagnostic.tokensUsed` structurally inconsistent with the RPC summary artifact and duplicates cost semantics. **Fix:** define a diagnostics-specific token shape matching the RPC contract (or make shared `TokenCounts` compatible, e.g. optional `costUsd`) and keep `cost` separate.
2. **[extensions/taskplane/diagnostics.ts:91-93,94-115,260-263] [important]** — Comments state exit-summary fields may be partial/optional, but the interface marks most fields as required, and `classifyExit()` treats any non-null/non-zero `exitCode` as crash. With unvalidated JSON, `exitCode: undefined` satisfies `!== null && !== 0`, causing false `process_crash`. **Fix:** align type and logic for partial artifacts (`?`/`| undefined` where intended) and guard crash classification with a numeric check (e.g., `typeof exitSummary.exitCode === "number" && exitSummary.exitCode !== 0`).

### Pattern Violations
- None major; module/barrel structure and JSDoc style are consistent with existing `extensions/taskplane/*` patterns.

### Test Gaps
- No unit tests yet for `classifyExit()` precedence collisions (e.g., `userKilled + non-zero exit`, `timerKilled + non-zero exit`).
- No test for partial/malformed-but-parseable summary objects (missing `exitCode`, missing `retries`, etc.).
- No test locking expected token-shape contract for `ExitSummary.tokens`.

### Suggestions
- Add `EXIT_CLASSIFICATIONS` coverage test to ensure values stay aligned with the union over time.
- Keep `classifyExit()` input-based (current design is good) and document how `userKilled` is expected to be set when summary is missing.
