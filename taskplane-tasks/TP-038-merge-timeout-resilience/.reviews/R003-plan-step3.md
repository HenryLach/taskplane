## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan captures most required verification outcomes (timeout success acceptance, timeout-triggered retry, retry exhaustion, config reload, and full-suite validation). However, it omits one explicit PROMPT requirement: validating the **second** timeout retry uses a **4x** timeout multiplier. Without that test outcome, the backoff contract from TP-038 is not fully covered.

### Issues Found
1. **[Severity: important]** — Missing explicit coverage for the second retry backoff (`4x` timeout). `PROMPT.md:94` requires a dedicated test for “retry also times out → second retry with 4x timeout,” but Step 3 in `STATUS.md:39-43` only lists a generic “Kill-and-retry test” and “All-retries-exhausted test.” Suggested fix: add a distinct Step 3 checkbox/test outcome asserting timeout values across retries (initial, 2x, then 4x) before exhaustion.

### Missing Items
- Add a Step 3 outcome explicitly validating retry attempt 2 uses `4x` timeout after a second timeout (per `PROMPT.md:94`).

### Suggestions
- When adding the 4x test, assert the exact timeout values passed to `waitForMergeResult` (or equivalent seam) across attempts so regressions in backoff math are caught directly.
