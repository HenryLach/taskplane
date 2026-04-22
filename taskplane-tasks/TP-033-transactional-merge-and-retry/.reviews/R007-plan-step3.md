## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan covers the major themes (transaction records, rollback, safe-stop, retry counters, exhaustion), but it is still missing a few required verification outcomes for TP-033. Most importantly, the current checklist does not fully mirror the prompt’s test requirements and does not yet guard key parity/risk paths introduced in Step 2. Tightening those outcomes now will reduce regression risk in merge recovery behavior.

### Issues Found
1. **[Severity: important]** — The plan dropped a required cooldown test from the prompt.
   - Evidence: `PROMPT.md:93-100` explicitly requires “cooldown delay enforced between retries,” but Step 3 checklist in `STATUS.md:56-62` does not include it.
   - Suggested fix: Add an explicit Step 3 outcome for cooldown enforcement (including at least one class with non-zero cooldown).

2. **[Severity: important]** — Retry-matrix coverage is not explicit for the class behaviors that motivated R006.
   - Evidence: matrix includes both non-retriable and multi-attempt behavior (`types.ts:1311-1316`, `types.ts:1330-1333`), and loop semantics depend on re-checking decisions (`messages.ts:745-806`), but Step 3 currently only says “Exhaustion tests” (`STATUS.md:60`).
   - Suggested fix: Add outcome-level tests for (a) non-retriable class immediate no-retry path and (b) `git_lock_file` multi-attempt behavior (attempt 1 retry, attempt 2 exhaustion).

3. **[Severity: important]** — Plan does not state execution/resume parity verification for retry/safe-stop paths.
   - Evidence: both `engine.ts` and `resume.ts` run the retry loop and safe-stop handling (`engine.ts:568-651`, `resume.ts:1545-1625`), but Step 3 checklist is not explicit about parity.
   - Suggested fix: Add a parity outcome that the same failure classification leads to the same phase transition/counter updates in both fresh execution and resume flows.

### Missing Items
- Explicit cooldown test requirement from prompt (`PROMPT.md:98`).
- Explicit parity test intent for engine vs resume on retry exhaustion and safe-stop forcing `paused`.
- Explicit coverage for non-retriable class behavior and multi-attempt (`maxAttempts > 1`) behavior.

### Suggestions
- Add a short “Step 3 done when” matrix mapping each TP-033 class to expected retry behavior (retry/no-retry, cooldown, exhaustion phase).
- Include one operator-visibility test for transaction persistence warning propagation (`merge.ts:558-581`, `engine.ts:528-531`) since recovery guidance depends on it.
